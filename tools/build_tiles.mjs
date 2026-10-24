// Split the built campus model (hku.glb, every 3dmap tile in one file) into streamed tiles, Google Earth style:
// the map then loads only the tiles around the view, and each tile's aerial photo as a quadtree of small pictures
// that sharpen as you zoom in.
//
//   node tools/build_tiles.mjs <raw.glb from tools/build_raw.py, or hku.glb> [<older hku.glb> <its buildings.json>]
//     -> assets/tiles/index.json, assets/tiles/heights.bin, assets/tiles/<tile id>/...
//   node tools/build_tiles.mjs --index     (only list each tile's feature files in index.json again)
//
// Per tile (data/tiles.json; a mesh belongs to the tile its centre lies in):
// - terrain.glb: the terrain mesh, positions and photo UVs exactly as in the input (same quantized values and node
//   transform). Primitive 0 holds every triangle, sorted by the 8 x 8 grid cell of its centre in Morton (Z) order, so
//   each node of the quadtree (levels 0-3: 1, 4, 16, 64 cells) is one contiguous run of triangles; primitive 1 is a
//   simplified copy (about 12 %, tile edges locked, so neighbouring tiles always meet) for tiles not close by, sorted
//   the same way.
// - t<level>_<i>_<j>.webp: the photo of each quadtree node, cut to the UV box of its triangles, at 512 px for the whole
//   tile (level 0) up to the full 4096 px resolution (level 3); index.json gives each node's
//   [first triangle, count, u0, v0, u1, v1, first simplified triangle, count].
// - objects.glb: the tile's buildings and bridges, never simplified: from a raw (float) model quantized to 16 bits over
//   the tile's own box (about 1.2 cm steps), from a quantized one bit for bit as in the input; only the triangles of
//   the tile are kept, in the order that compresses best. A building belongs to the tile its centre
//   (assets/model/buildings.json) lies in; one far outside every tile is left out.
// - lod.glb (tools/build_lod.mjs: the buildings and bridges simplified, for the distance), bridges.json + .webp
//   (tools/build_bridge_photo.mjs: the photo for the bridges in the satellite map), land.json, roads.glb (tiles with a
//   high-quality release, tools/build_tile_features.py), photo-roads.glb, hku-photo.glb + .json, city-photo.glb (their
//   surveyed photo roads and bridges, HKU buildings and other buildings, tools/README.md): listed in index.json when
//   they are in the tile's folder (with the ids of the photo HKU buildings).
// heights.bin: ground height every 10 m over all tiles (int16, decimetres), for pins and labels on tiles not loaded.
// With an older model: buildings it has keep its geometry (e.g. the main campus, quantized finer before the far tiles
// stretched the model's bounding box), and so do its bridges within its terrain tiles.
// needs: npm i @gltf-transform/core@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp
import fs from 'fs';
import path from 'path';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { weld, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [, , input, oldInput, oldBjson] = process.argv;
const OUT = process.env.OUT || 'assets/tiles', DEPTH = 3, NODE_PX = 512;
// a tile's feature files (tools/build_tile_features.py), when present
function features(item) {
  for (const [k, f] of [['lod', 'lod.glb'], ['bridges', 'bridges.json'], ['land', 'land.json'], ['roads', 'roads.glb'], ['photoRoads', 'photo-roads.glb'], ['cityPhoto', 'city-photo.glb'], ['hkuPhoto', 'hku-photo.glb']]) {
    if (fs.existsSync(path.join(OUT, item.id, f))) item[k] = `${item.id}/${f}`; else delete item[k];
  }
  if (item.hkuPhoto) item.hkuPhotoIds = JSON.parse(fs.readFileSync(path.join(OUT, item.id, 'hku-photo.json'), 'utf8')); else delete item.hkuPhotoIds;
  delete item.canopy; delete item.canopyMesh;   // (the 3D photo canopy is gone: tools/build_tree_colours.mjs)
  return item;
}
if (input === '--index') {
  const index = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
  index.tiles.forEach(features);
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
  console.log(index.tiles.filter((t) => t.land).map((t) => t.id).join(' ') || 'no tile features');
  process.exit(0);
}
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const TILES = JSON.parse(fs.readFileSync('data/tiles.json', 'utf8')).tiles;
const BJ = JSON.parse(fs.readFileSync('assets/model/buildings.json', 'utf8'));
const bidByCode = new Map(BJ.map((b, i) => [b[0], i]));

// ---- helpers ----
const inside = (e, x, z) => x >= e[0] && x < e[1] && z >= e[2] && z < e[3];
function tileAt(x, z, slack = 0) {
  let best = null, bd = Infinity;
  for (const t of TILES) {
    if (inside(t.extent, x, z)) return t;
    const e = t.extent, d = Math.hypot(Math.max(e[0] - x, 0, x - e[1]), Math.max(e[2] - z, 0, z - e[3]));
    if (d < bd) { bd = d; best = t; }
  }
  return bd <= slack ? best : null;
}
const denorm = (a) => (a instanceof Int16Array ? (v) => Math.max(v / 32767, -1) : a instanceof Uint16Array ? (v) => v / 65535 : a instanceof Int8Array ? (v) => Math.max(v / 127, -1) : a instanceof Uint8Array ? (v) => v / 255 : (v) => v);
// world positions (Float64) of a primitive's POSITION under its node's translation / scale
function world(node, acc) {
  const a = acc.getArray(), f = acc.getNormalized() ? denorm(a) : (v) => v;
  const t = node.getTranslation(), s = node.getScale(), out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = f(a[i + k]) * s[k] + t[k];
  return out;
}
const morton = (i, j) => { let m = 0; for (let b = 0; b < 8; b++) m |= ((i >> b) & 1) << (2 * b) | ((j >> b) & 1) << (2 * b + 1); return m; };
function meshNodes(doc) {
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) out.push({ name: node.getName() || mesh.getName(), node, prim });
  }
  return out;
}

// ---- writing ----
function newDoc() {
  const doc = new Document(); doc.createBuffer();
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return doc;
}
const acc = (doc, arr, type, normalized = false) => doc.createAccessor().setArray(arr).setType(type).setNormalized(normalized).setBuffer(doc.getRoot().listBuffers()[0]);
const indexArray = (idx, nVerts) => (nVerts < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx));
// a subset of triangles of a primitive (vertices compacted), attributes copied raw
function subset(doc, src, tris, attrs) {
  const I = src.prim.getIndices().getArray(), remap = new Map(), keep = [];
  const idx = new Uint32Array(tris.length * 3);
  tris.forEach((t, n) => { for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; let r = remap.get(v); if (r === undefined) { r = keep.length; remap.set(v, r); keep.push(v); } idx[n * 3 + k] = r; } });
  const prim = doc.createPrimitive().setIndices(acc(doc, indexArray(idx, keep.length), 'SCALAR'));
  for (const a of attrs) {
    const sa = src.prim.getAttribute(a); if (!sa) continue;
    const arr = sa.getArray(), n = sa.getElementSize(), out = new arr.constructor(keep.length * n);
    keep.forEach((v, i) => { for (let k = 0; k < n; k++) out[i * n + k] = arr[v * n + k]; });
    prim.setAttribute(a, acc(doc, out, sa.getType(), sa.getNormalized()));
  }
  return prim;
}
// float positions (a raw build): 16-bit integers over this primitive's own box (about 1 cm in a tile) -> node transform
function quantizePrim(doc, prim) {
  const a = prim.getAttribute('POSITION'), f = a.getArray();
  if (!(f instanceof Float32Array)) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < f.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], f[i + k]); hi[k] = Math.max(hi[k], f[i + k]); }
  const t = lo.map((v, k) => (v + hi[k]) / 2), sc = Math.max(...hi.map((v, k) => (v - lo[k]) / 2), 1e-3);
  const q = new Int16Array(f.length);
  for (let i = 0; i < f.length; i += 3) for (let k = 0; k < 3; k++) q[i + k] = Math.round(((f[i + k] - t[k]) / sc) * 32767);
  prim.setAttribute('POSITION', acc(doc, q, 'VEC3', true));
  return { getTranslation: () => t, getScale: () => [sc, sc, sc] };
}
function place(doc, name, src, prims) {
  const mesh = doc.createMesh(name); prims.forEach((p) => mesh.addPrimitive(p));
  doc.getRoot().listScenes()[0] || doc.createScene();
  const qn = prims.length === 1 ? quantizePrim(doc, prims[0]) : null, n0 = qn || src.node;
  const node = doc.createNode(name).setMesh(mesh).setTranslation(n0.getTranslation()).setScale(n0.getScale());
  (doc.getRoot().listScenes()[0] || doc.createScene()).addChild(node);
}

// ---- read ----
const src = await io.read(input);
// a raw build (tools/build_raw.py: float positions, full terrain): drop normals, weld, simplify the terrain (as
// tools/optimize.mjs did, edges locked) and quantize it per tile; buildings are quantized per tile when written
if (meshNodes(src).some((p) => p.prim.getAttribute('POSITION').getArray() instanceof Float32Array)) {
  for (const m of src.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setAttribute('NORMAL', null);
  await src.transform(weld());
  for (const p of meshNodes(src)) {
    if (!p.name.startsWith('terrain')) continue;
    const P = p.prim.getAttribute('POSITION').getArray(), I = Uint32Array.from(p.prim.getIndices().getArray());
    const [S] = MeshoptSimplifier.simplify(I, P, 3, Math.floor(I.length * 0.4 / 3) * 3, 0.0006, ['LockBorder']);
    const remap = new Map(), keep = [], idx = new Uint32Array(S.length);
    S.forEach((v, n) => { let r = remap.get(v); if (r === undefined) { r = keep.length; remap.set(v, r); keep.push(v); } idx[n] = r; });
    const uv = p.prim.getAttribute('TEXCOORD_0').getArray(), np = new Float32Array(keep.length * 3), nu = new Uint16Array(keep.length * 2);
    keep.forEach((v, i) => { for (let k = 0; k < 3; k++) np[i * 3 + k] = P[v * 3 + k]; for (let k = 0; k < 2; k++) nu[i * 2 + k] = Math.round(Math.min(1, Math.max(0, uv[v * 2 + k])) * 65535); });
    const prim = p.prim;
    prim.setIndices(src.createAccessor().setArray(idx).setType('SCALAR'));
    prim.setAttribute('POSITION', src.createAccessor().setArray(np).setType('VEC3'));
    prim.setAttribute('TEXCOORD_0', src.createAccessor().setArray(nu).setType('VEC2').setNormalized(true));
    const qn = quantizePrim(src, prim); p.node.setTranslation(qn.getTranslation()).setScale(qn.getScale());
    console.log(p.name, I.length / 3, '->', S.length / 3, 'triangles');
  }
}
const parts = meshNodes(src);
const old = oldInput ? meshNodes(await io.read(oldInput)) : [];
const OB = oldBjson ? JSON.parse(fs.readFileSync(oldBjson, 'utf8')) : [];
const oldCodes = new Set(OB.map((b) => b[0]));
fs.mkdirSync(OUT, { recursive: true });

// terrain tiles of the older model: its bridges replace the new ones there
const oldTerrainTiles = new Set(old.filter((p) => p.name.startsWith('terrain')).map((p) => {
  const w = world(p.node, p.prim.getAttribute('POSITION')); let x = 0, z = 0;
  for (let i = 0; i < w.length; i += 3) { x += w[i]; z += w[i + 2]; }
  return tileAt(x / (w.length / 3), z / (w.length / 3))?.id;
}));

const index = { v: 1, depth: DEPTH, nodePx: NODE_PX, tiles: [] };
const perTile = new Map(TILES.map((t) => [t.id, { tile: t, objects: [] }]));

// ---- buildings and bridges ----
function triTiles(p, byBid, oldMap) {
  const I = p.prim.getIndices().getArray(), groups = new Map();
  const bidA = p.prim.getAttribute('_BID')?.getArray();
  const w = byBid ? null : world(p.node, p.prim.getAttribute('POSITION'));
  for (let t = 0; t < I.length / 3; t++) {
    let tile;
    if (byBid) {
      let bid = bidA[I[t * 3]];
      if (oldMap) { bid = oldMap[bid]; if (bid == null) continue; }
      else if (oldCodes.has(BJ[bid][0])) continue;      // replaced by the older model's geometry
      const b = BJ[bid]; tile = tileAt(b[1], b[2], 50);
    } else {
      let x = 0, z = 0; for (let k = 0; k < 3; k++) { const v = I[t * 3 + k] * 3; x += w[v]; z += w[v + 2]; }
      tile = tileAt(x / 3, z / 3, 50);
      if (tile && (oldMap ? !oldTerrainTiles.has(tile.id) : oldTerrainTiles.has(tile.id))) continue;
    }
    if (!tile) continue;
    (groups.get(tile.id) || groups.set(tile.id, []).get(tile.id)).push(t);
  }
  return groups;
}
const oldBidMap = OB.map((b) => bidByCode.get(b[0]));
for (const [set, isOld] of [[parts, false], [old, true]]) {
  for (const p of set) {
    if (p.name.startsWith('terrain')) continue;
    const isB = p.name.startsWith('buildings');
    const groups = triTiles(p, isB, isOld && isB ? oldBidMap : isOld ? true : null);
    for (const [id, tris] of groups) perTile.get(id).objects.push({ p, tris, isB, isOld });
  }
}

// ---- heights ----
const all = TILES.map((t) => t.extent);
const H = { x0: Math.min(...all.map((e) => e[0])), z0: Math.min(...all.map((e) => e[2])), cell: 10 };
H.cols = Math.ceil((Math.max(...all.map((e) => e[1])) - H.x0) / H.cell); H.rows = Math.ceil((Math.max(...all.map((e) => e[3])) - H.z0) / H.cell);
const HG = new Int16Array(H.cols * H.rows).fill(-32768);
function rasterHeights(w, I) {
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = w[a], az = w[a + 2], bx = w[b], bz = w[b + 2], cx = w[c], cz = w[c + 2];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-9) continue;
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - H.x0) / H.cell - 0.5)), i1 = Math.min(H.cols - 1, Math.floor((Math.max(ax, bx, cx) - H.x0) / H.cell - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - H.z0) / H.cell - 0.5)), j1 = Math.min(H.rows - 1, Math.floor((Math.max(az, bz, cz) - H.z0) / H.cell - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = H.x0 + (i + 0.5) * H.cell, z = H.z0 + (j + 0.5) * H.cell;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      HG[j * H.cols + i] = Math.round((l1 * w[a + 1] + l2 * w[b + 1] + l3 * w[c + 1]) * 10);
    }
  }
}

// ---- terrain ----
let bytes = 0;
const write = (rel, buf) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); bytes += buf.length; };
for (const p of parts) {
  if (!p.name.startsWith('terrain')) continue;
  const posA = p.prim.getAttribute('POSITION'), uvA = p.prim.getAttribute('TEXCOORD_0');
  const w = world(p.node, posA), I = p.prim.getIndices().getArray(), nT = I.length / 3;
  let cx = 0, cz = 0, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < w.length; i += 3) { cx += w[i]; cz += w[i + 2]; y0 = Math.min(y0, w[i + 1]); y1 = Math.max(y1, w[i + 1]); }
  const tile = tileAt(cx / (w.length / 3), cz / (w.length / 3), 50);
  if (!tile) { console.warn('terrain outside every tile', p.name); continue; }
  rasterHeights(w, I);
  const e = tile.extent, N = 1 << DEPTH, cw = (e[1] - e[0]) / N, ch = (e[3] - e[2]) / N;
  // triangles sorted by the Morton code of their centre's cell
  const code = new Uint32Array(nT);
  for (let t = 0; t < nT; t++) {
    let x = 0, z = 0; for (let k = 0; k < 3; k++) { const v = I[t * 3 + k] * 3; x += w[v]; z += w[v + 2]; }
    const i = Math.min(N - 1, Math.max(0, Math.floor((x / 3 - e[0]) / cw))), j = Math.min(N - 1, Math.max(0, Math.floor((z / 3 - e[2]) / ch)));
    code[t] = morton(i, j);
  }
  const order = Array.from({ length: nT }, (_, t) => t).sort((a, b) => code[a] - code[b] || a - b);
  const sorted = new Uint32Array(nT * 3);
  order.forEach((t, n) => { sorted[n * 3] = I[t * 3]; sorted[n * 3 + 1] = I[t * 3 + 1]; sorted[n * 3 + 2] = I[t * 3 + 2]; });
  const start = new Uint32Array(N * N + 1);
  for (let t = 0; t < nT; t++) start[code[t] + 1]++;
  for (let c = 0; c < N * N; c++) start[c + 1] += start[c];
  // simplified copy for far away (tile edges locked)
  const wf = Float32Array.from(w, (v, i) => v - (i % 3 === 0 ? e[0] : i % 3 === 2 ? e[2] : 0));
  const [coarse0] = MeshoptSimplifier.simplify(sorted, wf, 3, Math.min(sorted.length, Math.max(300, Math.floor(sorted.length * 0.12 / 3) * 3)), 0.004, ['LockBorder']);
  // ... sorted the same way, so each quadtree node is a run of it too
  const cellOf = (Ix, t) => {
    let x = 0, z = 0; for (let k = 0; k < 3; k++) { const v = Ix[t * 3 + k] * 3; x += w[v]; z += w[v + 2]; }
    return morton(Math.min(N - 1, Math.max(0, Math.floor((x / 3 - e[0]) / cw))), Math.min(N - 1, Math.max(0, Math.floor((z / 3 - e[2]) / ch))));
  };
  const nC = coarse0.length / 3, ccode = Uint32Array.from({ length: nC }, (_, t) => cellOf(coarse0, t));
  const corder = Array.from({ length: nC }, (_, t) => t).sort((a, b) => ccode[a] - ccode[b] || a - b);
  const coarse = new Uint32Array(nC * 3);
  corder.forEach((t, n) => { for (let k = 0; k < 3; k++) coarse[n * 3 + k] = coarse0[t * 3 + k]; });
  const cstart = new Uint32Array(N * N + 1);
  for (let t = 0; t < nC; t++) cstart[ccode[t] + 1]++;
  for (let c = 0; c < N * N; c++) cstart[c + 1] += cstart[c];
  // photo: decoded once, cut into the quadtree
  const tex = p.prim.getMaterial()?.getBaseColorTexture();
  const img = sharp(Buffer.from(tex.getImage())), meta = await img.metadata();
  const raw = await img.ensureAlpha().raw().toBuffer(), W = meta.width, Hh = meta.height;
  const rawImg = () => sharp(raw, { raw: { width: W, height: Hh, channels: 4 } });
  const uv = uvA.getArray(), uf = uvA.getNormalized() ? denorm(uv) : (v) => v;
  const nodes = [];
  for (let L = 0; L <= DEPTH; L++) {
    const n = 1 << L, span = 1 << (2 * (DEPTH - L)), f = 2 ** (L - DEPTH), lev = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const m = morton(i, j), t0 = start[m * span], t1 = start[(m + 1) * span], c0 = cstart[m * span], c1 = cstart[(m + 1) * span];
      if (t1 === t0 && c1 === c0) { lev.push(null); continue; }
      // photo box: the UVs of the node's triangles, full and simplified
      let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
      for (const [arr, a0, a1] of [[sorted, t0, t1], [coarse, c0, c1]]) for (let k = a0 * 3; k < a1 * 3; k++) { const v = arr[k]; const u = uf(uv[v * 2]), vv = uf(uv[v * 2 + 1]); if (u < u0) u0 = u; if (u > u1) u1 = u; if (vv < v0) v0 = vv; if (vv > v1) v1 = vv; }
      const pad = 2 / f;   // 2 output pixels
      const px0 = Math.max(0, Math.floor(u0 * W - pad)), py0 = Math.max(0, Math.floor(v0 * Hh - pad));
      const px1 = Math.min(W, Math.ceil(u1 * W + pad)), py1 = Math.min(Hh, Math.ceil(v1 * Hh + pad));
      const ow = Math.max(1, Math.round((px1 - px0) * f)), oh = Math.max(1, Math.round((py1 - py0) * f));
      const buf = await rawImg().extract({ left: px0, top: py0, width: px1 - px0, height: py1 - py0 }).resize(ow, oh, { kernel: 'lanczos3' }).removeAlpha().webp({ quality: 78 }).toBuffer();
      write(`${tile.id}/t${L}_${i}_${j}.webp`, buf);
      lev.push([t0, t1 - t0, +(px0 / W).toFixed(6), +(py0 / Hh).toFixed(6), +(px1 / W).toFixed(6), +(py1 / Hh).toFixed(6), c0, c1 - c0]);
    }
    nodes.push(lev);
  }
  // terrain.glb
  const doc = newDoc();
  const P = acc(doc, posA.getArray().slice(), 'VEC3', posA.getNormalized()), UV = acc(doc, uv.slice(), 'VEC2', uvA.getNormalized());
  const nV = posA.getCount();
  const full = doc.createPrimitive().setAttribute('POSITION', P).setAttribute('TEXCOORD_0', UV).setIndices(acc(doc, indexArray(sorted, nV), 'SCALAR'));
  const far = doc.createPrimitive().setAttribute('POSITION', P).setAttribute('TEXCOORD_0', UV).setIndices(acc(doc, indexArray(coarse, nV), 'SCALAR'));
  place(doc, 'terrain', p, [full, far]);
  write(`${tile.id}/terrain.glb`, await io.writeBinary(doc));
  const rec = perTile.get(tile.id);
  Object.assign(rec, { y: [+y0.toFixed(1), +y1.toFixed(1)], nodes, tris: nT, coarse: coarse.length / 3, photo: [W, Hh] });
  console.log(tile.id, p.name, nT, 'triangles,', coarse.length / 3, 'far,', 'photo', `${W}x${Hh}`);
}

// ---- objects.glb ----
for (const rec of perTile.values()) {
  if (!rec.nodes) continue;
  const t = rec.tile, item = { id: t.id, extent: t.extent, y: rec.y, terrain: `${t.id}/terrain.glb`, nodes: rec.nodes, photo: rec.photo };
  if (rec.objects.length) {
    const doc = newDoc(); let nb = 0;
    for (const o of rec.objects) {
      const attrs = o.isB ? ['POSITION', '_BID'] : ['POSITION'];
      const prim = subset(doc, o.p, o.tris, attrs);
      if (o.isB && o.isOld) {     // older model's building ids -> this model's
        const a = prim.getAttribute('_BID'), arr = a.getArray(); for (let i = 0; i < arr.length; i++) arr[i] = oldBidMap[arr[i]];
      }
      if (o.isB) nb += o.tris.length;
      place(doc, (o.isB ? 'buildings' : 'infrastructure') + (o.isOld ? '_old' : ''), o.p, [prim]);
    }
    await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));   // triangle order is free here (not in the terrain)
    write(`${t.id}/objects.glb`, await io.writeBinary(doc));
    item.objects = `${t.id}/objects.glb`; item.buildingTris = nb;
  }
  index.tiles.push(features(item));
}
index.heights = { file: 'heights.bin', x0: H.x0, z0: H.z0, cell: H.cell, cols: H.cols, rows: H.rows, scale: 0.1, none: -32768 };
write('heights.bin', Buffer.from(HG.buffer));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
console.log(index.tiles.length, 'tiles,', (bytes / 1e6).toFixed(1), 'MB');
