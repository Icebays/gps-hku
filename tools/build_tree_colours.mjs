// Photo colours for the trees, so the satellite map can stand them up in 3D in the colours of the aerial photo
// (a tree whose crown spreads over a road then stands over it, instead of lying flat in the photo).
//
//   node tools/build_tree_colours.mjs
//     data/landcover.json (main campus) and assets/tiles/<tile>/land.json: each tree [x, z, y, h, r] gets a 6th value,
//     the mean colour (0xrrggbb) of the photo within its crown, from the tile's photo pieces at level 2 (about 0.37 m/px)
// needs: npm i @gltf-transform/core@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp
import fs from 'fs';
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const OUT = 'assets/tiles', L = 2;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const index = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
const denorm = (a) => (a instanceof Int16Array ? (v) => Math.max(v / 32767, -1) : a instanceof Uint16Array ? (v) => v / 65535 : (v) => v);

// a tile's photo at level L, and its terrain's UV mapping (u = a x + b, v = c z + d)
const photos = new Map();
async function photo(t) {
  if (photos.has(t.id)) return photos.get(t.id);
  const doc = await io.read(path.join(OUT, t.terrain)), node = doc.getRoot().listNodes().find((n) => n.getMesh());
  const prim = node.getMesh().listPrimitives()[0], pa = prim.getAttribute('POSITION'), q = pa.getArray(), fp = pa.getNormalized() ? denorm(q) : (v) => v;
  const ua = prim.getAttribute('TEXCOORD_0'), uq = ua.getArray(), fu = ua.getNormalized() ? denorm(uq) : (v) => v;
  const tr = node.getTranslation(), sc = node.getScale();
  let n = 0, sx = 0, su = 0, sxx = 0, sxu = 0, sz = 0, sv = 0, szz = 0, szv = 0;
  for (let i = 0; i < q.length / 3; i += 7) {
    const x = fp(q[i * 3]) * sc[0] + tr[0], z = fp(q[i * 3 + 2]) * sc[2] + tr[2], u = fu(uq[i * 2]), v = fu(uq[i * 2 + 1]);
    n++; sx += x; su += u; sxx += x * x; sxu += x * u; sz += z; sv += v; szz += z * z; szv += z * v;
  }
  const a = (n * sxu - sx * su) / (n * sxx - sx * sx), b = (su - a * sx) / n, c = (n * szv - sz * sv) / (n * szz - sz * sz), d = (sv - c * sz) / n;
  const f = 2 ** (L - index.depth), W = Math.round(t.photo[0] * f), H = Math.round(t.photo[1] * f), img = Buffer.alloc(W * H * 3);
  const N = 1 << L;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const nd = t.nodes[L][j * N + i]; if (!nd) continue;
    const { data, info } = await sharp(path.join(OUT, t.id, `t${L}_${i}_${j}.webp`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const x0 = Math.round(nd[2] * W), y0 = Math.round(nd[3] * H), w = Math.min(info.width, W - x0);
    for (let y = 0; y < info.height && y0 + y < H; y++) data.copy(img, ((y0 + y) * W + x0) * 3, y * info.width * 3, (y * info.width + w) * 3);
  }
  const p = { a, b, c, d, W, H, img };
  photos.set(t.id, p);
  return p;
}
const tileAt = (x, z) => index.tiles.find((t) => x >= t.extent[0] && x < t.extent[1] && z >= t.extent[2] && z < t.extent[3]);
async function colour([x, z, , , r]) {
  const t = tileAt(x, z); if (!t) return 0x5d7a4a;
  const P = await photo(t), px = (P.a * x + P.b) * P.W, py = (P.c * z + P.d) * P.H, rp = Math.max(1, r * 0.7 * P.W * Math.abs(P.a));
  let R = 0, G = 0, B = 0, m = 0;
  for (let y = Math.floor(py - rp); y <= py + rp; y++) for (let xx = Math.floor(px - rp); xx <= px + rp; xx++) {
    if (xx < 0 || y < 0 || xx >= P.W || y >= P.H || (xx - px) ** 2 + (y - py) ** 2 > rp * rp) continue;
    const o = (y * P.W + xx) * 3; R += P.img[o]; G += P.img[o + 1]; B += P.img[o + 2]; m++;
  }
  return m ? (Math.round(R / m) << 16) | (Math.round(G / m) << 8) | Math.round(B / m) : 0x5d7a4a;
}
for (const f of ['data/landcover.json', ...index.tiles.filter((t) => t.land).map((t) => path.join(OUT, t.land))]) {
  const J = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const tr of J.trees || []) tr[5] = await colour(tr);
  fs.writeFileSync(f, JSON.stringify(J));
  console.log(f, (J.trees || []).length, 'trees');
}
