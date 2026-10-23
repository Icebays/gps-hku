// Aerial photo for the bridges in the satellite map, every tile: the standard 3dmap release has no textures on its
// bridges (INFRASTRUCTURE), and the high-quality one only for some tiles. The tile's own orthophoto shows the decks
// from above, so the map paints each bridge with the photo under it (by world x / z, through the terrain's UV
// mapping). Only the photo around the bridges is shipped: the 32 px blocks (about 6 m) they cover, taken from the
// full-resolution photo pieces (t3_*.webp) and packed into one atlas per tile, with a 2 px border of their real
// neighbours so filtering never shows the seams.
//
//   node tools/build_bridge_photo.mjs
//     assets/tiles/<tile>/objects.glb + terrain.glb + t3_*.webp -> bridges.webp + bridges.json, then
//     node tools/build_tiles.mjs --index
// bridges.json: { fit: [a, b, c, d] (u = a x + b, v = c z + d), photo: [W, H], src: 32 (block in photo px),
//   dst: block in atlas px, pad, cols (slots per atlas row), size: [w, h], blocks: [[bx, by], ...] in slot order }
// needs: npm i @gltf-transform/core@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp
import fs from 'fs';
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const OUT = process.env.OUT || 'assets/tiles', SRC = 32, PAD = 2, PAGE = 2048;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const index = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
const denorm = (a) => (a instanceof Int16Array ? (v) => Math.max(v / 32767, -1) : a instanceof Uint16Array ? (v) => v / 65535 : (v) => v);
// world positions of a primitive under its node (translation + uniform scale)
function world(node, prim) {
  const a = prim.getAttribute('POSITION'), q = a.getArray(), f = a.getNormalized() ? denorm(q) : (v) => v;
  const t = node.getTranslation(), s = node.getScale(), P = new Float64Array(q.length);
  for (let i = 0; i < q.length; i += 3) for (let k = 0; k < 3; k++) P[i + k] = f(q[i + k]) * s[k] + t[k];
  return P;
}

for (const t of index.tiles) {
  if (!t.objects) continue;
  const odoc = await io.read(path.join(OUT, t.objects));
  const tris = [];   // [x, z] x 3 per triangle
  for (const node of odoc.getRoot().listNodes()) {
    if (!node.getMesh() || !/^infrastructure/.test(node.getName())) continue;
    for (const prim of node.getMesh().listPrimitives()) {
      const P = world(node, prim), I = prim.getIndices().getArray();
      for (let i = 0; i < I.length; i += 3) tris.push([0, 1, 2].map((k) => [P[I[i + k] * 3], P[I[i + k] * 3 + 2]]));
    }
  }
  if (!tris.length) continue;
  // the terrain's UV mapping (an orthophoto: u = a x + b, v = c z + d), fitted from its vertices
  const tdoc = await io.read(path.join(OUT, t.terrain)), tn = tdoc.getRoot().listNodes().find((n) => n.getMesh());
  const tp = tn.getMesh().listPrimitives()[0], TP = world(tn, tp), uvA = tp.getAttribute('TEXCOORD_0'), uq = uvA.getArray(), uf = uvA.getNormalized() ? denorm(uq) : (v) => v;
  let n = 0, sx = 0, su = 0, sxx = 0, sxu = 0, sz = 0, sv = 0, szz = 0, szv = 0;
  for (let i = 0; i < TP.length / 3; i += 7) {
    const x = TP[i * 3], z = TP[i * 3 + 2], u = uf(uq[i * 2]), v = uf(uq[i * 2 + 1]);
    n++; sx += x; su += u; sxx += x * x; sxu += x * u; sz += z; sv += v; szz += z * z; szv += z * v;
  }
  const a = (n * sxu - sx * su) / (n * sxx - sx * sx), b = (su - a * sx) / n, c = (n * szv - sz * sv) / (n * szz - sz * sz), d = (sv - c * sz) / n;
  const [W, H] = t.photo, BW = Math.ceil(W / SRC), BH = Math.ceil(H / SRC);
  // blocks under the bridges: each triangle sampled every quarter block (and a block's ring around it, for filtering)
  const used = new Uint8Array(BW * BH);
  const mark = (px, py) => { const bx = Math.floor(px / SRC), by = Math.floor(py / SRC); if (bx >= 0 && by >= 0 && bx < BW && by < BH) used[by * BW + bx] = 1; };
  for (const T of tris) {
    const p = T.map(([x, z]) => [(a * x + b) * W, (c * z + d) * H]);
    const e1 = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), e2 = Math.hypot(p[2][0] - p[0][0], p[2][1] - p[0][1]);
    const ns = Math.max(1, Math.ceil(Math.max(e1, e2) / (SRC / 4)));
    for (let i = 0; i <= ns; i++) for (let j = 0; j <= ns - i; j++) {
      const s1 = i / ns, s2 = j / ns;
      mark(p[0][0] + (p[1][0] - p[0][0]) * s1 + (p[2][0] - p[0][0]) * s2, p[0][1] + (p[1][1] - p[0][1]) * s1 + (p[2][1] - p[0][1]) * s2);
    }
  }
  const blocks = [];
  for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) if (used[by * BW + bx]) blocks.push([bx, by]);
  // atlas: full resolution if the blocks fit one page, else halved (or quartered)
  let dst = SRC, cols, rows;
  for (;;) { cols = Math.floor(PAGE / (dst + 2 * PAD)); rows = Math.ceil(blocks.length / cols); if (rows <= cols || dst <= 8) break; dst /= 2; }
  const slot = dst + 2 * PAD, aw = Math.min(cols, blocks.length) * slot, ah = rows * slot;
  // the full photo from its level-3 pieces
  const full = Buffer.alloc(W * H * 3);
  const nodes = t.nodes[3], N = 1 << 3;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const nd = nodes[j * N + i]; if (!nd) continue;
    const { data, info } = await sharp(path.join(OUT, t.id, `t3_${i}_${j}.webp`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const x0 = Math.round(nd[2] * W), y0 = Math.round(nd[3] * H);
    for (let y = 0; y < info.height && y0 + y < H; y++) data.copy(full, ((y0 + y) * W + x0) * 3, y * info.width * 3, (y * info.width + Math.min(info.width, W - x0)) * 3);
  }
  const atlas = Buffer.alloc(aw * ah * 3, 128);
  const k = dst / SRC;
  blocks.forEach(([bx, by], s) => {
    const ox = (s % cols) * slot, oy = Math.floor(s / cols) * slot;
    for (let y = 0; y < slot; y++) for (let x = 0; x < slot; x++) {
      // atlas pixel -> photo pixel (box filter when shrunk), clamped to the photo
      let r = 0, g = 0, bl = 0, m = 0;
      for (let yy = 0; yy < 1 / k; yy++) for (let xx = 0; xx < 1 / k; xx++) {
        const px = Math.min(W - 1, Math.max(0, Math.floor(bx * SRC + (x - PAD) / k + xx))), py = Math.min(H - 1, Math.max(0, Math.floor(by * SRC + (y - PAD) / k + yy)));
        const o = (py * W + px) * 3; r += full[o]; g += full[o + 1]; bl += full[o + 2]; m++;
      }
      const o = ((oy + y) * aw + ox + x) * 3; atlas[o] = r / m; atlas[o + 1] = g / m; atlas[o + 2] = bl / m;
    }
  });
  fs.writeFileSync(path.join(OUT, t.id, 'bridges.webp'), await sharp(atlas, { raw: { width: aw, height: ah, channels: 3 } }).webp({ quality: 82 }).toBuffer());
  fs.writeFileSync(path.join(OUT, t.id, 'bridges.json'), JSON.stringify({ fit: [a, b, c, d], photo: [W, H], src: SRC, dst, pad: PAD, cols, size: [aw, ah], blocks }));
  console.log(t.id, tris.length, 'bridge triangles,', blocks.length, 'blocks, atlas', `${aw}x${ah}`, (fs.statSync(path.join(OUT, t.id, 'bridges.webp')).size / 1e3).toFixed(0), 'kB');
}
