import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplifyPrimitive, quantize, meshopt, textureCompress, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [, , input, output, terrainRatio = '0.2', texSize = '4096', quality = '78'] = process.argv;
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);

for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setAttribute('NORMAL', null);
await doc.transform(weld());
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const n0 = prim.getAttribute('POSITION').getCount();
    if (mesh.getName().startsWith('terrain')) {
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: +terrainRatio, error: 0.0006, lockBorder: true });
    }
    console.log(mesh.getName(), n0, '->', prim.getAttribute('POSITION').getCount());
  }
}
await doc.transform(
  dedup(), prune({ keepAttributes: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+texSize, +texSize], quality: +quality }),
  quantize({ quantizePosition: 16, quantizeTexcoord: 14, pattern: /^(POSITION|TEXCOORD_0)$/ }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await io.write(output, doc);
console.log('written', output);
