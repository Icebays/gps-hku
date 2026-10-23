// Simplified buildings and bridges for the distance, Google Earth style: each tile's objects.glb (exact geometry,
// tools/build_tiles.mjs) gets a lod.glb beside it, simplified to about ERROR metres. The map draws a tile's lod.glb
// from as far as its terrain loads, and while its full objects.glb downloads; the full models replace it close by.
//
//   node tools/build_lod.mjs [error in m, default 1.5]
//     assets/tiles/<tile>/objects.glb -> assets/tiles/<tile>/lod.glb, listed in index.json (build_tiles.mjs --index)
// needs: npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@0.22
import fs from 'fs';
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { reorder, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

const OUT = process.env.OUT || 'assets/tiles', ERROR = +(process.argv[2] || 1.5);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
MeshoptSimplifier.useExperimentalFeatures = true;   // (Prune)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const index = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
let n0 = 0, n1 = 0;
for (const t of index.tiles) {
  if (!t.objects) continue;
  const doc = await io.read(path.join(OUT, t.objects));
  let a = 0, b = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const scale = node.getScale()[0];
    for (const prim of mesh.listPrimitives()) {
      // positions in metres (int16 normalized x node scale), for the simplifier's error
      const pa = prim.getAttribute('POSITION'), q = pa.getArray(), P = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) P[i] = (pa.getNormalized() ? Math.max(q[i] / 32767, -1) : q[i]) * scale;
      const I = Uint32Array.from(prim.getIndices().getArray());
      // (Prune: parts smaller than the error, such as rooftop clutter, go altogether)
      const [S] = MeshoptSimplifier.simplify(I, P, 3, 0, ERROR, ['ErrorAbsolute', 'Prune']);
      // keep the used vertices only
      const remap = new Int32Array(pa.getCount()).fill(-1), keep = [];
      const idx = new Uint32Array(S.length);
      S.forEach((v, k) => { if (remap[v] < 0) { remap[v] = keep.length; keep.push(v); } idx[k] = remap[v]; });
      for (const sem of prim.listSemantics()) {
        const at = prim.getAttribute(sem), arr = at.getArray(), e = at.getElementSize(), out = new arr.constructor(keep.length * e);
        keep.forEach((v, k) => { for (let j = 0; j < e; j++) out[k * e + j] = arr[v * e + j]; });
        prim.setAttribute(sem, doc.createAccessor().setArray(out).setType(at.getType()).setNormalized(at.getNormalized()).setBuffer(pa.getBuffer()));
      }
      prim.setIndices(doc.createAccessor().setArray(keep.length < 65536 ? Uint16Array.from(idx) : idx).setType('SCALAR').setBuffer(pa.getBuffer()));
      a += I.length / 3; b += S.length / 3;
    }
  }
  await doc.transform(prune(), reorder({ encoder: MeshoptEncoder, target: 'size' }));
  const rel = `${t.id}/lod.glb`;
  fs.writeFileSync(path.join(OUT, rel), await io.writeBinary(doc));
  console.log(t.id, a, '->', b, 'triangles,', (fs.statSync(path.join(OUT, rel)).size / 1e3).toFixed(0), 'kB');
  n0 += a; n1 += b;
}
console.log('all tiles', n0, '->', n1, 'triangles');
