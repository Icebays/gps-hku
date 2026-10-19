// Build the photo-textured surface layers from the high-quality 3dmap.gov.hk tiles
// (model/11-SW-7C.zip, model/11-SW-7D.zip, unzipped into work/7C, work/7D):
//   assets/model/roads.glb   INFRASTRUCTURE(TB) road surfaces + INFRASTRUCTURE flyovers / footbridges
//   assets/model/ground.glb  GENERIC ground surfaces (pavements, plazas, courts, gardens) + WATERBODY
// Everything is moved into the site's model frame (x = E - 832250, y = mPD, z = -(N - 815900)),
// primitives sharing a texture are joined, textures become WebP, geometry is meshopt-compressed.
//
//   node tools/build_surfaces.mjs work/7C work/7D
// needs: npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, unpartition, flatten, join, weld, dedup, prune, quantize, meshopt, textureCompress, transformMesh, palette } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mat4 } from 'gl-matrix';
import fs from 'node:fs';
import path from 'node:path';

const tiles = process.argv.slice(2);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const ORIGIN = [-832250, 0, 815900];

const gltfs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).map((d) => path.join(dir, d, d + '.gltf')).filter((f) => fs.existsSync(f) && fs.statSync(f).size > 10) : []);

async function build(layers, out, texSize, quality) {
  const doc = new Document();
  doc.createBuffer();
  for (const [name, files] of layers) {
    for (const f of files) {
      const src = await io.read(f);
      // bake node transforms + origin shift into the vertices
      for (const scene of src.getRoot().listScenes()) {
        scene.traverse((node) => {
          const mesh = node.getMesh();
          if (!mesh) return;
          const m = mat4.fromTranslation(mat4.create(), ORIGIN);
          mat4.multiply(m, m, node.getWorldMatrix());
          transformMesh(mesh, m);
          mesh.setName(name);
        });
        scene.traverse((node) => { node.setMatrix(mat4.create()); });
      }
      for (const mat of src.getRoot().listMaterials()) { mat.setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(false); }
      mergeDocuments(doc, src);
    }
  }
  const scenes = doc.getRoot().listScenes();
  for (const s of scenes.slice(1)) { for (const n of s.listChildren()) scenes[0].addChild(n); s.dispose(); }
  doc.getRoot().setDefaultScene(scenes[0]);
  await doc.transform(unpartition(), flatten(), dedup(), join({ keepNamed: true }), weld(), prune());
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { p.setAttribute('NORMAL', null); p.setAttribute('COLOR_0', null); }
  await doc.transform(
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality }),
    quantize({ quantizePosition: 16, quantizeTexcoord: 14, pattern: /^(POSITION|TEXCOORD_0)$/ }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await io.write(out, doc);
  console.log(out, (fs.statSync(out).size / 1e6).toFixed(1), 'MB', doc.getRoot().listMeshes().map((m) => `${m.getName()}:${m.listPrimitives().length}`).join(' '));
}

const pick = (sub) => tiles.flatMap((t) => gltfs(path.join(t, sub)));
await build([['roads', pick('INFRASTRUCTURE(TB)')], ['bridges', pick('INFRASTRUCTURE')]], 'assets/model/roads.glb', 2048, 80);
await build([['ground', pick('GENERIC')], ['water', pick('WATERBODY')]], 'assets/model/ground.glb', 1024, 72);
