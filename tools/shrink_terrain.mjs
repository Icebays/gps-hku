// Fit the terrain photos of a built hku.glb to a GPU budget: each terrain tile's photo is resized by where the tile
// lies, so a model of many tiles still opens on phones (26 tiles at 4096 px need ~1.9 GB of GPU memory; at this
// budget ~0.35 GB). Geometry (buildings, terrain, bridges) is read and written back unchanged.
//   node tools/shrink_terrain.mjs assets/model/hku.glb assets/model/hku.glb
// Tile names are terrain_T{E}{N}...: E, N = the tile's south-west corner (E - 800000, N - 800000), 750 x 600 m.
// needs: npm i @gltf-transform/core@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [, , input, output] = process.argv;
// photo size (longest side) per tile; tiles not listed get FAR
const SIZE = {
  T31500156000: 4096, T32250156000: 4096,   // 11-SW-7C, 7D: main campus
  T30750138000: 2048, T30750144000: 2048,   // 11-SW-16B, 11D: Sassoon Road (medical campus) and the slope above it
};
const FAR = 1024;
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
const done = new Set();
for (const mesh of doc.getRoot().listMeshes()) {
  const m = mesh.getName().match(/^terrain_(T\d{11})/);
  if (!m) continue;
  const want = SIZE[m[1]] ?? FAR;
  for (const prim of mesh.listPrimitives()) {
    const tex = prim.getMaterial()?.getBaseColorTexture();
    if (!tex || done.has(tex)) continue;
    done.add(tex);
    const img = sharp(Buffer.from(tex.getImage()));
    const { width, height } = await img.metadata();
    if (Math.max(width, height) <= want) { console.log(mesh.getName(), `${width}x${height}`, 'kept'); continue; }
    const out = await img.resize({ width: width >= height ? want : null, height: height > width ? want : null }).webp({ quality: 80 }).toBuffer();
    tex.setImage(new Uint8Array(out)).setMimeType('image/webp');
    console.log(mesh.getName(), `${width}x${height}`, '->', want, Math.round(out.length / 1024), 'KB');
  }
}
await io.write(output, doc);
console.log('written', output);
