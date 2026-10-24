// Compress the photo roads from tools/build_roads_photo.py for the satellite base map:
// meshopt geometry and KTX2 (Basis ETC1S) atlas pages, which stay compressed on the GPU (about 3 MB a
// page with mipmaps instead of 22 MB as a decoded image), so phones can hold the survey's sharpness.
//   node tools/optimize_roads_photo.mjs out/roads-photo-raw.glb assets/model/roads-photo.glb
//   EXACT=1 node tools/optimize_roads_photo.mjs <in> <out>   (pictures only: positions stay exactly as surveyed, for buildings)
// needs: npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp ktx2-encoder@0.6
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, quantize, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import sharp from 'sharp';

const [, , input, output, quality = '230'] = process.argv;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const imageDecoder = async (buf) => {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
const exact = !!process.env.EXACT;
await doc.transform(
  weld(), prune(),
  ktx2({ isUASTC: false, qualityLevel: +quality, compressionLevel: 2, generateMipmap: true, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, imageDecoder }),
  ...(exact ? [] : [quantize({ quantizePosition: 16, quantizeTexcoord: 16, pattern: /^(POSITION|TEXCOORD_0)$/ }), meshopt({ encoder: MeshoptEncoder, level: 'high' })]),
);
await io.write(output, doc);
console.log('written', output);
