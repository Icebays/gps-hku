// Split and compress the satellite layer from tools/build_satellite.py:
//   assets/model/satellite-buildings.glb  HKU buildings: geometry exactly as surveyed (full float
//                                         positions, no simplification or quantization); only the
//                                         photo atlas pages are re-encoded as WebP
//   assets/model/satellite-trees.glb      vegetation: simplified, quantized, meshopt-compressed
//   node tools/optimize_satellite.mjs out/sat-raw.glb [vegetationRatio]
// needs: npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplifyPrimitive, quantize, meshopt, textureCompress, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [, , input, vegRatio = '0.06'] = process.argv;
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

async function part(prefix, out, compressGeometry) {
  const doc = await io.read(input);
  for (const node of doc.getRoot().listNodes()) if (!node.getName().startsWith(prefix)) node.dispose();
  for (const mesh of doc.getRoot().listMeshes()) if (!mesh.getName().startsWith(prefix)) mesh.dispose();
  await doc.transform(prune(), weld());   // weld only merges identical vertices: lossless
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const n0 = prim.getIndices().getCount() / 3;
    if (compressGeometry) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: +vegRatio, error: 0.03 });
    console.log(mesh.getName(), n0, '->', prim.getIndices().getCount() / 3, 'triangles');
  }
  const steps = [prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82 })];
  if (compressGeometry) steps.push(quantize({ quantizePosition: 16, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await doc.transform(...steps);
  await io.write(out, doc);
  console.log('written', out);
}
await part('hku_buildings', 'assets/model/satellite-buildings.glb', false);
await part('vegetation', 'assets/model/satellite-trees.glb', true);
