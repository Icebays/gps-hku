// Compress the canopy height field from tools/build_canopy.py.
//   node tools/optimize_canopy.mjs out/canopy-raw.glb assets/model/satellite-trees.glb [ratio]
// needs: npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplifyPrimitive, quantize, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const [, , input, output, ratio = '0.35'] = process.argv;
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
await doc.transform(weld());
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const n0 = prim.getIndices().getCount() / 3;
  simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: +ratio, error: 0.0005 });   // UVs are planar: safe to simplify
  console.log(mesh.getName(), n0, '->', prim.getIndices().getCount() / 3, 'triangles');
}
// the site maps the aerial photo from world position (same affine map as the terrain), so the UVs are
// not shipped: no quantized texcoords for mobile GPUs to mis-handle
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('TEXCOORD_0', null);
await doc.transform(prune(), quantize({ quantizePosition: 16, pattern: /^POSITION$/ }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await io.write(output, doc);
console.log('written', output);
