// Simpler buildings away from HKU's, Google Earth style. For each tile:
// - lod.glb: its buildings and bridges simplified to about FAR metres (1.5), for the distance: the map draws a tile's
//   lod.glb from as far as its terrain loads, block by block where the full models are not near;
// - objects.glb (from tools/build_tiles.mjs) keeps HKU's buildings (data/places.json, data/campus.json: the map's
//   rule) and the bridges exact, and its other buildings are simplified to about NEAR metres (0.3): close by they look
//   the same and take far less memory. Marked in the file, so running this again does not simplify them twice.
// - every building gets a colour (COLOR_0, per vertex), the mean of the aerial photo under its vertices (mostly its
//   roof), for the satellite map: buildings without photo textures stand in their own colours.
//
//   node tools/build_lod.mjs [far error in m, default 1.5] [near error in m, default 0.3]
//     -> assets/tiles/<tile>/lod.glb (and objects.glb), then node tools/build_tiles.mjs --index
// needs: npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@0.22
import fs from 'fs';
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { reorder, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const OUT = process.env.OUT || 'assets/tiles', FAR = +(process.argv[2] || 1.5), NEAR = +(process.argv[3] || 0.3);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
MeshoptSimplifier.useExperimentalFeatures = true;   // (Prune)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const index = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));

// HKU buildings (building index numbers, the _BID values): as assets/map.js splitBuildings
const BJ = JSON.parse(fs.readFileSync('assets/model/buildings.json', 'utf8'));
const P = JSON.parse(fs.readFileSync('data/places.json', 'utf8')), C = JSON.parse(fs.readFileSync('data/campus.json', 'utf8'));
const inside = (x, z, poly) => { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [x1, z1] = poly[i], [x2, z2] = poly[j]; if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) r = !r; } return r; };
const codes = new Set([...(C.include || []), ...P.places.filter((p) => p.hku !== false).flatMap((p) => p.buildings)]), exclude = new Set(C.exclude || []);
const polys = (C.areas || []).filter((a) => a.solid !== false).map((a) => a.boundary);
const HKU = new Set(BJ.map((b, i) => (codes.has(b[0]) || (!exclude.has(b[0]) && polys.some((p) => inside(b[1], b[2], p))) ? i : -1)).filter((i) => i >= 0));

// a tile's photo at level 2 (about 0.37 m/px) and its terrain's UV mapping (as tools/build_tree_colours.mjs)
const denorm = (a) => (a instanceof Int16Array ? (v) => Math.max(v / 32767, -1) : a instanceof Uint16Array ? (v) => v / 65535 : (v) => v);
async function photo(t, L = 2) {
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
  const f = 2 ** (L - index.depth), W = Math.round(t.photo[0] * f), H = Math.round(t.photo[1] * f), img = Buffer.alloc(W * H * 3), N = 1 << L;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const nd = t.nodes[L][j * N + i]; if (!nd) continue;
    const { data, info } = await sharp(path.join(OUT, t.id, `t${L}_${i}_${j}.webp`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const x0 = Math.round(nd[2] * W), y0 = Math.round(nd[3] * H), w = Math.min(info.width, W - x0);
    for (let y = 0; y < info.height && y0 + y < H; y++) data.copy(img, ((y0 + y) * W + x0) * 3, y * info.width * 3, (y * info.width + w) * 3);
  }
  return (x, z) => { const px = Math.min(W - 1, Math.max(0, Math.floor((a * x + b) * W))), py = Math.min(H - 1, Math.max(0, Math.floor((c * z + d) * H))), o = (py * W + px) * 3; return [img[o], img[o + 1], img[o + 2]]; };
}
// COLOR_0 (RGBA bytes: 4-byte aligned for iOS) per building: the mean photo colour under its vertices
async function addColours(doc, t) {
  const at = await photo(t);
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh() || !/^buildings/.test(node.getName())) continue;
    const tr = node.getTranslation(), sc = node.getScale();
    for (const prim of node.getMesh().listPrimitives()) {
      const pa = prim.getAttribute('POSITION'), q = pa.getArray(), fp = pa.getNormalized() ? denorm(q) : (v) => v, bid = prim.getAttribute('_BID').getArray();
      const sum = new Map();
      for (let i = 0; i < bid.length; i++) {
        const [r, g, b] = at(fp(q[i * 3]) * sc[0] + tr[0], fp(q[i * 3 + 2]) * sc[2] + tr[2]);
        const e = sum.get(bid[i]) || [0, 0, 0, 0]; e[0] += r; e[1] += g; e[2] += b; e[3]++; sum.set(bid[i], e);
      }
      const col = new Uint8Array(bid.length * 4);
      for (let i = 0; i < bid.length; i++) { const e = sum.get(bid[i]); col.set([e[0] / e[3], e[1] / e[3], e[2] / e[3], 255], i * 4); }
      prim.setAttribute('COLOR_0', doc.createAccessor().setArray(col).setType('VEC4').setNormalized(true).setBuffer(pa.getBuffer()));
    }
  }
}

// simplify a primitive's triangles to `error` metres, except those keep(triangle) says to keep exactly
function simplify(doc, node, prim, error, keep = () => false) {
  const pa = prim.getAttribute('POSITION'), q = pa.getArray(), s = node.getScale()[0], Pm = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) Pm[i] = (pa.getNormalized() ? Math.max(q[i] / 32767, -1) : q[i]) * s;   // metres
  const I = prim.getIndices().getArray(), exact = [], rest = [];
  for (let t = 0; t < I.length; t += 3) (keep(I[t]) ? exact : rest).push(I[t], I[t + 1], I[t + 2]);
  // (Prune: parts smaller than the error, such as rooftop clutter, go altogether)
  const [S] = rest.length ? MeshoptSimplifier.simplify(Uint32Array.from(rest), Pm, 3, 0, error, ['ErrorAbsolute', 'Prune']) : [new Uint32Array(0)];
  const all = exact.concat(Array.from(S));
  // keep the used vertices only
  const remap = new Int32Array(pa.getCount()).fill(-1), used = [], idx = new Uint32Array(all.length);
  all.forEach((v, k) => { if (remap[v] < 0) { remap[v] = used.length; used.push(v); } idx[k] = remap[v]; });
  for (const sem of prim.listSemantics()) {
    const at = prim.getAttribute(sem), arr = at.getArray(), e = at.getElementSize(), out = new arr.constructor(used.length * e);
    used.forEach((v, k) => { for (let j = 0; j < e; j++) out[k * e + j] = arr[v * e + j]; });
    prim.setAttribute(sem, doc.createAccessor().setArray(out).setType(at.getType()).setNormalized(at.getNormalized()).setBuffer(pa.getBuffer()));
  }
  prim.setIndices(doc.createAccessor().setArray(used.length < 65536 ? Uint16Array.from(idx) : idx).setType('SCALAR').setBuffer(pa.getBuffer()));
  return [I.length / 3, all.length / 3];
}
const write = async (doc, rel) => { await doc.transform(prune(), reorder({ encoder: MeshoptEncoder, target: 'size' })); fs.writeFileSync(path.join(OUT, rel), await io.writeBinary(doc)); return (fs.statSync(path.join(OUT, rel)).size / 1e3).toFixed(0) + ' kB'; };

for (const t of index.tiles) {
  if (!t.objects) continue;
  const doc = await io.read(path.join(OUT, t.objects)), extras = doc.getRoot().getExtras();
  // colours, once
  const hasColours = doc.getRoot().listMeshes().some((m) => m.listPrimitives().some((p) => p.getAttribute('COLOR_0')));
  if (!hasColours) { await addColours(doc, t); if (extras.nearError) console.log(t.id, 'objects coloured,', await write(doc, t.objects)); }
  // near: the other buildings at NEAR, once
  let c = 0, d = 0;
  if (!extras.nearError) {
    for (const node of doc.getRoot().listNodes()) {
      if (!node.getMesh() || !/^buildings/.test(node.getName())) continue;
      for (const prim of node.getMesh().listPrimitives()) {
        const bid = prim.getAttribute('_BID').getArray();
        const [x, y] = simplify(doc, node, prim, NEAR, (v) => HKU.has(bid[v])); c += x; d += y;
      }
    }
    doc.getRoot().setExtras({ ...extras, nearError: NEAR });
    console.log(t.id, 'objects', c, '->', d, 'building triangles,', await write(doc, t.objects));
  }
  // far: everything at FAR (from the objects as they now are)
  const far = await io.read(path.join(OUT, t.objects));
  let a = 0, b = 0;
  for (const node of far.getRoot().listNodes()) for (const prim of node.getMesh()?.listPrimitives() || []) { const [x, y] = simplify(far, node, prim, FAR); a += x; b += y; }
  console.log(t.id, 'lod', a, '->', b, 'triangles,', await write(far, `${t.id}/lod.glb`));
}
