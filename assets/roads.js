/* Roads drawn as 3D geometry draped on the terrain (or on flyover decks):
   pavement, kerb, tarmac, lane / edge markings, zebra crossings, 慢駛 and bus-bay
   markings, footpaths, and street lamps modelled on the Hill Road flyover's.
   Input: data/mapfeatures.json (tools/build_mapfeatures.py). */
import * as THREE from 'three';

/* ---------- height lookup: uniform grid over world-space triangles ---------- */
export function heightIndex(meshes, { cell = 4, upOnly = false } = {}) {
  const tris = [];
  let n = 0;
  for (const m of meshes) { m.updateMatrixWorld(true); n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }
  const T = new Float32Array(n * 9);
  const v = new THREE.Vector3();
  let k = 0;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position, idx = m.geometry.index;
    const cnt = idx ? idx.count : pos.count;
    for (let i = 0; i < cnt; i += 3) {
      for (let j = 0; j < 3; j++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(m.matrixWorld);
        T[k * 9 + j * 3] = v.x; T[k * 9 + j * 3 + 1] = v.y; T[k * 9 + j * 3 + 2] = v.z;
      }
      if (upOnly) { // keep only up-facing triangles (decks, not piers / undersides)
        const o = k * 9;
        const ax = T[o + 3] - T[o], ay = T[o + 4] - T[o + 1], az = T[o + 5] - T[o + 2];
        const bx = T[o + 6] - T[o], by = T[o + 7] - T[o + 1], bz = T[o + 8] - T[o + 2];
        const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        if (Math.abs(ny) < 0.6 * Math.hypot(nx, ny, nz)) continue;
      }
      k++;
    }
  }
  tris.length = 0;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let t = 0; t < k; t++) for (let j = 0; j < 3; j++) {
    const x = T[t * 9 + j * 3], z = T[t * 9 + j * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell)), rows = Math.max(1, Math.ceil((z1 - z0) / cell));
  const counts = new Uint32Array(cols * rows + 1);
  const span = (t, fn) => {
    const o = t * 9;
    const a = Math.min(T[o], T[o + 3], T[o + 6]), b = Math.max(T[o], T[o + 3], T[o + 6]);
    const c = Math.min(T[o + 2], T[o + 5], T[o + 8]), d = Math.max(T[o + 2], T[o + 5], T[o + 8]);
    const ca = Math.max(0, Math.floor((a - x0) / cell)), cb = Math.min(cols - 1, Math.floor((b - x0) / cell));
    const ra = Math.max(0, Math.floor((c - z0) / cell)), rb = Math.min(rows - 1, Math.floor((d - z0) / cell));
    for (let r = ra; r <= rb; r++) for (let q = ca; q <= cb; q++) fn(r * cols + q);
  };
  for (let t = 0; t < k; t++) span(t, (c) => counts[c + 1]++);
  for (let c = 0; c < cols * rows; c++) counts[c + 1] += counts[c];
  const fill = counts.slice(), ids = new Uint32Array(counts[cols * rows]);
  for (let t = 0; t < k; t++) span(t, (c) => { ids[fill[c]++] = t; });
  // topmost surface height at (x, z), or with ref the surface nearest to height ref; NaN if none
  return function heightAt(x, z, ref) {
    const q = Math.floor((x - x0) / cell), r = Math.floor((z - z0) / cell);
    if (q < 0 || r < 0 || q >= cols || r >= rows) return NaN;
    const c = r * cols + q;
    let best = NaN;
    for (let i = counts[c]; i < counts[c + 1]; i++) {
      const o = ids[i] * 9;
      const ax = T[o], az = T[o + 2], bx = T[o + 3], bz = T[o + 5], cx = T[o + 6], cz = T[o + 8];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
      const y = l1 * T[o + 1] + l2 * T[o + 4] + l3 * T[o + 7];
      if (ref === undefined ? !(y <= best) : !(Math.abs(y - ref) >= Math.abs(best - ref))) best = y;
    }
    return best;
  };
}

/* ---------- polyline helpers ---------- */
function resample(pts, step) {
  const out = [pts[0].slice()], L = [0];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]), L.push(acc);
  const n = Math.max(1, Math.ceil(acc / step));
  let j = 1;
  for (let s = 1; s <= n; s++) {
    const t = (acc * s) / n;
    while (j < L.length - 1 && L[j] < t) j++;
    const f = (t - L[j - 1]) / Math.max(L[j] - L[j - 1], 1e-9);
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f]);
  }
  return { pts: out, len: acc };
}
function normalsOf(q) {
  return q.map((p, i) => {
    const a = q[Math.max(i - 1, 0)], b = q[Math.min(i + 1, q.length - 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], n = Math.hypot(dx, dz) || 1;
    return [-dz / n, dx / n];
  });
}

/* ---------- geometry accumulator per layer ---------- */
class Layer {
  constructor() { this.p = []; this.i = []; this.uv = []; }
  quad(a, b, c, d, uv) { // a b on one side, c d on the other (a-c, b-d across)
    const o = this.p.length / 3;
    this.p.push(...a, ...b, ...c, ...d);
    this.uv.push(...(uv || [0, 0, 0, 0, 0, 0, 0, 0]));
    this.i.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
  }
  mesh(mat, order) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.i); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.renderOrder = order; m.frustumCulled = true;
    return m;
  }
}

const STYLE = {
  light: { pavement: 0xe9e5dd, kerb: 0xc4bcae, tarmac: 0x9ea4ad, deck: 0xa3a9b1, paint: 0xffffff, yellow: 0xf1c232, walk: 0xeadfc8, indoor: 0x8b90a0, lamp: 0x8d939b, lantern: 0xfff3c4 },
  dark: { pavement: 0x3c403e, kerb: 0x2a2d2c, tarmac: 0x4d535b, deck: 0x50565e, paint: 0xd5d9de, yellow: 0xc9a33a, walk: 0x55503f, indoor: 0x9aa0b0, lamp: 0x6b7178, lantern: 0xffd27a },
};

function decalAtlas() {
  // 4 cells: 慢駛, 巴士站, bus icon, lift icon, taxi icon
  const c = Object.assign(document.createElement('canvas'), { width: 1536, height: 256 });
  const g = c.getContext('2d');
  const F = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // road words: characters stacked along the direction of travel (first character farthest), stretched 2.2x
  const word = (cx, text, color) => {
    g.save(); g.fillStyle = color; g.font = `bold 92px ${F}`;
    const n = text.length;
    [...text].forEach((ch, i) => { g.save(); g.translate(cx, 128 + (i - (n - 1) / 2) * (240 / n)); g.scale(1.25, 2.4 / n); g.fillText(ch, 0, 4); g.restore(); });
    g.restore();
  };
  word(128, '慢駛', '#ffffff');
  word(384, '巴士站', '#f1c232');
  const badge = (cx, draw) => {
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(cx - 110, 18, 220, 220, 46); g.fill();
    g.fillStyle = '#1c7ed6'; g.beginPath(); g.roundRect(cx - 96, 32, 192, 192, 38); g.fill();
    g.fillStyle = '#ffffff'; draw(cx);
  };
  badge(640, (x) => { g.beginPath(); g.roundRect(x - 55, 62, 110, 118, 18); g.fill(); g.fillStyle = '#1c7ed6'; g.fillRect(x - 42, 78, 84, 40); g.fillStyle = '#fff'; g.fillRect(x - 46, 182, 22, 22); g.fillRect(x + 24, 182, 22, 22); });
  badge(896, (x) => { g.fillRect(x - 40, 60, 80, 136); g.fillStyle = '#1c7ed6'; g.beginPath(); g.moveTo(x, 78); g.lineTo(x - 22, 112); g.lineTo(x + 22, 112); g.fill(); g.beginPath(); g.moveTo(x, 178); g.lineTo(x - 22, 144); g.lineTo(x + 22, 144); g.fill(); });
  badge(1152, (x) => { g.font = `bold 96px ${F}`; g.fillText('的士', x, 132); });
  // 望右 / LOOK RIGHT, painted at the kerb of HK crossings
  g.fillStyle = '#ffffff'; g.font = `bold 92px ${F}`; g.fillText('望右', 1408, 78);
  g.font = `bold 52px sans-serif`; g.fillText('LOOK RIGHT', 1408, 186);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const CELL = { slow: 0, bus_text: 1, bus: 2, lift: 3, taxi: 4, look: 5 };

/* ---------- build everything ---------- */
// surface: height lookup of the surveyed road surface (roads.glb). When given, that mesh is the
// road itself, so no road bands are drawn - only the markings, draped onto it, plus lamps and icons.
export function buildRoads({ FEAT, ground, deck, building, lampGeo, dark, surface = null }) {
  const furnitureOnly = false;
  const st = STYLE[dark ? 'dark' : 'light'];
  const L = { pave: new Layer(), kerb: new Layer(), tar: new Layer(), deckTar: new Layer(), white: new Layer(), yellow: new Layer(), walk: new Layer(), walkEdge: new Layer(), indoor: new Layer(), decal: new Layer() };
  const lamps = [];
  const roads = FEAT.roads.map((r) => ({ ...r }));

  // junction nodes and degree
  // Markings are only painted where a road runs on its own: anywhere another road's surface comes
  // close (junctions, merges, overlapping skeleton branches) stays plain tarmac.
  const CELLSZ = 10, segIdx = new Map();
  roads.forEach((r, ri) => {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [a, b] = [r.pts[i], r.pts[i + 1]];
      for (let cx = Math.floor(Math.min(a[0], b[0]) / CELLSZ) - 1; cx <= Math.floor(Math.max(a[0], b[0]) / CELLSZ) + 1; cx++)
        for (let cz = Math.floor(Math.min(a[1], b[1]) / CELLSZ) - 1; cz <= Math.floor(Math.max(a[1], b[1]) / CELLSZ) + 1; cz++) {
          const k = cx + ',' + cz; if (!segIdx.has(k)) segIdx.set(k, []); segIdx.get(k).push([a, b, ri]);
        }
    }
  });
  const clear = (x, z, ri, margin = 2.5) => {
    const list = segIdx.get(Math.floor(x / CELLSZ) + ',' + Math.floor(z / CELLSZ)) || [];
    const hr = roads[ri]?.width / 2 || 0;
    for (const [a, b, rj] of list) {
      if (rj === ri) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
      const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
      if (d < roads[rj].width / 2 + hr + margin) return false;
    }
    return true;
  };
  const key = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  const deg = new Map();
  for (const r of roads) for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) deg.set(key(p), (deg.get(key(p)) || 0) + 1);
  // twin carriageways: a parallel major road 6–16 m away
  const majors = roads.filter((r) => r.class === 'major');
  for (const r of majors) {
    const mid = resample(r.pts, 6).pts;
    let hits = 0;
    for (const p of mid) {
      if (majors.some((o) => o !== r && o.pts.some((q) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); return d > 5 && d < 16; }))) hits++;
    }
    r.twin = hits > mid.length * 0.5;
    if (r.twin) r.width = Math.min(r.width, 9);
  }

  const lift = 0.2;
  // highest ground within ~0.7 m, so the surface rides over small terrain bumps instead of being pierced
  const groundMax = (x, z) => {
    let m = ground(x, z);
    for (const [dx, dz] of [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) { const v = ground(x + dx, z + dz); if (v > m || !Number.isFinite(m)) m = v; }
    return m;
  };
  const heightFor = (x, z, elev) => {
    const g = groundMax(x, z);
    if (surface) {
      // stacked roads (flyover over road): take the road surface nearest the level this road runs at
      const d0 = deck(x, z), ref = elev && Number.isFinite(d0) ? d0 : g;
      let sv = surface(x, z, ref);
      if (!(Math.abs(sv - ref) < 4)) sv = surface(x, z, g);
      // never fall back to a bridge deck: markings stay on a road surface or on the ground
      return Number.isFinite(sv) && Math.abs(sv - g) < 15 ? sv + 0.02 : (Number.isFinite(g) ? g : 0) + lift;
    }
    const d = deck(x, z);
    if (elev && Number.isFinite(d)) return d + 0.1;
    if (Number.isFinite(d) && d > g && d - g < 2.5) return d + 0.1; // ramp ends of a deck
    return (Number.isFinite(g) ? g : 0) + lift;
  };

  for (const [ri, r] of roads.entries()) {
    const { pts: q, len } = resample(r.pts, 1);
    if (q.length < 2) continue;
    const n = normalsOf(q), w = r.width, h = w / 2;
    // elevated runs (on a flyover deck) must be long; short ones pass under a bridge
    const onDeck = (x, z) => { const g = ground(x, z), d = deck(x, z); return Number.isFinite(d) && Number.isFinite(g) && d - g > 2.5; };
    let elev = q.map(([x, z]) => onDeck(x, z));
    elev = runFilter(elev, 1, 25);
    // the whole road follows the deck when most of it is elevated (flyover approach ramps)
    if (elev.filter(Boolean).length > elev.length * 0.6) elev = elev.map((e, i) => e || Number.isFinite(deck(q[i][0], q[i][1])));
    r.elevated = elev;
    const ht = (x, z, i) => heightFor(x, z, elev[i]);
    // surfaces: pavement (ground only), kerb, tarmac; 5 vertices across so terrain cannot poke through
    const band = (layer, half, dy, onlyGround, onlyElev) => {
      const nA = Math.max(2, Math.ceil((2 * half) / 1.2)), across = Array.from({ length: nA + 1 }, (_, k) => -half + (2 * half * k) / nA);
      for (let i = 0; i < q.length - 1; i++) {
        if (onlyGround && (elev[i] || elev[i + 1])) continue;
        if (onlyElev && !(elev[i] && elev[i + 1])) continue;
        if (!onlyElev && !onlyGround && (elev[i] && elev[i + 1])) continue;
        for (let k = 0; k < across.length - 1; k++) {
          const P = (j, o) => { const x = q[j][0] + n[j][0] * o, z = q[j][1] + n[j][1] * o; return [x, ht(x, z, j) + dy, z]; };
          layer.quad(P(i, across[k]), P(i + 1, across[k]), P(i, across[k + 1]), P(i + 1, across[k + 1]));
        }
      }
    };
    if (!surface) {
      band(L.pave, h + 1.8, 0, true);
      band(L.kerb, h + 0.3, 0.02, true);
      band(L.tar, h, 0.04, false);
      band(L.deckTar, h, 0.04, false, true);
    }

    // markings, trimmed near junctions
    const trimA = (deg.get(key(r.pts[0])) || 0) >= 2 ? h + 4 : 0.5, trimB = (deg.get(key(r.pts[r.pts.length - 1])) || 0) >= 2 ? h + 4 : 0.5;
    const line = (layer, off, width, dash, gap) => {
      const S = 0.5, { pts: qq } = resample(r.pts, S), nn = normalsOf(qq);
      for (let i = 0; i < qq.length - 1; i++) {
        const s = i * S * (len / Math.max((qq.length - 1) * S, 1e-6));
        if (s < trimA || s > len - trimB) continue;
        if (dash && (s % (dash + gap)) > dash) continue;
        if (surface && !clear(qq[i][0], qq[i][1], ri)) continue;
        const idx = Math.min(Math.round(i * S), elev.length - 1);
        const P = (j, o) => { const x = qq[j][0] + nn[j][0] * o, z = qq[j][1] + nn[j][1] * o; return [x, heightFor(x, z, elev[idx]) + 0.07, z]; };
        layer.quad(P(i, off - width / 2), P(i + 1, off - width / 2), P(i, off + width / 2), P(i + 1, off + width / 2));
      }
    };
    if (surface) {
      // Kept deliberately simple: lines are placed from the centre line only (the measured width is a
      // per-road median, so kerb-offset lines would drift off curving / narrowing roads).
      // Main roads: dashed lane lines + HK double white centre line; campus roads: one dashed centre line.
      if (len >= 20) {
        if (r.class === 'major' && !r.twin) {
          const lanes = Math.max(2, 2 * Math.round(w / 6.8));
          line(L.white, -0.18, 0.12); line(L.white, 0.18, 0.12);
          for (let k = 1; k < lanes / 2; k++) for (const sg of [-1, 1]) line(L.white, sg * (w * k) / lanes, 0.12, 3, 6);
        } else if (r.class === 'major') {
          const lanes = Math.max(2, Math.round(w / 3.4));
          for (let k = 1; k < lanes; k++) line(L.white, -h + (w * k) / lanes, 0.12, 3, 6);
        } else if (w >= 5) {
          line(L.white, 0, 0.12, 3, 3);
        }
      }
    } else if (r.class === 'major') {
      const lanes = Math.max(2, Math.round(w / 3.4));
      for (let k = 1; k < lanes; k++) {
        const off = -h + (w * k) / lanes;
        if (!r.twin && k === lanes / 2) { line(L.white, off - 0.18, 0.13); line(L.white, off + 0.18, 0.13); }
        else line(L.white, off, 0.13, 3, 6);
      }
      for (const sg of [-1, 1]) { line(L.yellow, sg * (h - 0.35), 0.12); line(L.yellow, sg * (h - 0.6), 0.12); }
    } else if (w >= 5) {
      line(L.white, 0, 0.13, 3, 3);
      for (const sg of [-1, 1]) line(L.yellow, sg * (h - 0.35), 0.11);
    }

    // street lamps along ground sections: ~32 m apart, alternating sides on wide roads
    if (len > (surface ? 40 : 24)) {
      let side = 1;
      for (let s = 12; s < len - 10; s += r.class === 'major' ? 32 : 40) {
        const i = Math.min(Math.round(s), q.length - 1);
        if (elev[i]) continue;
        const o = h + 0.9, x = q[i][0] + n[i][0] * o * side, z = q[i][1] + n[i][1] * o * side;
        const y = ground(x, z);
        if (!Number.isFinite(y)) continue;
        if (Number.isFinite(building(x, z)) && building(x, z) > y + 2) continue;   // inside a building
        if (Number.isFinite(deck(x, z)) && deck(x, z) > y + 2) continue;           // under a flyover / footbridge
        lamps.push({ x, y: y + lift, z, ang: Math.atan2(-n[i][1] * side, -n[i][0] * side) });
        if (r.class === 'major' || w >= 6) side = -side;
      }
    }
  }

  // junction plates: round tarmac where 3+ roads meet, so corners are filled
  for (const [k, d] of surface ? [] : deg) {
    if (d < 3) continue;
    const [x, z] = k.split(',').map((v) => +v / 2);
    const rr = Math.max(...roads.filter((r) => [r.pts[0], r.pts[r.pts.length - 1]].some((p) => key(p) === k)).map((r) => r.width)) / 2;
    disc(L.pave, x, z, rr + 1.8, (xx, zz) => heightFor(xx, zz, false));
    disc(L.kerb, x, z, rr + 0.3, (xx, zz) => heightFor(xx, zz, false) + 0.02);
    disc(L.tar, x, z, rr, (xx, zz) => heightFor(xx, zz, false) + 0.04);
  }

  // footpaths
  for (const p of surface ? [] : FEAT.paths) {
    const { pts: q } = resample(p.pts, 1.5);
    if (q.length < 2) continue;
    const n = normalsOf(q);
    const strip = (layer, half, dy, dash) => {
      for (let i = 0; i < q.length - 1; i++) {
        if (dash && i % 2) continue;
        const P = (j, o) => { const x = q[j][0] + n[j][0] * o, z = q[j][1] + n[j][1] * o; return [x, heightFor(x, z, false) + dy, z]; };
        layer.quad(P(i, -half), P(i + 1, -half), P(i, half), P(i + 1, half));
      }
    };
    if (p.indoor) strip(L.indoor, 0.35, 0.02, true);
    else { strip(L.walkEdge, 1.05, -0.01); strip(L.walk, 0.85, 0); }
  }

  // zebra crossings, 慢駛, bus bays, icons
  const M = FEAT.marks || {};
  const flat = (layer, cx, cz, ux, uz, a0, a1, b0, b1, dy, uv) => { // rectangle in (u along, v across) frame
    const vx = -uz, vz = ux;
    const P = (a, b) => { const x = cx + ux * a + vx * b, z = cz + uz * a + vz * b; return [x, heightFor(x, z, false) + dy, z]; };
    layer.quad(P(a0, b0), P(a1, b0), P(a0, b1), P(a1, b1), uv);
  };
  const cellUV = (k) => { const u0 = k / 6, u1 = (k + 1) / 6; return [u0, 1, u1, 1, u0, 0, u1, 0]; };
  const uvFor = (k, turn) => { const uv = cellUV(k); return turn ? [uv[6], uv[7], uv[4], uv[5], uv[2], uv[3], uv[0], uv[1]] : uv; }; // turn = rotate 180°
  const clearAt = (p) => !surface || roads.every((_, ri) => {
    // clear of junctions: the point must be clear relative to the road it sits on
    const r = roads[ri]; let best = Infinity;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [a, b] = [r.pts[i], r.pts[i + 1]], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
      best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t));
    }
    return best > r.width / 2 + 0.5 || clear(p[0], p[1], ri, 1);
  });
  const kept = [];
  for (const c of M.crossings || []) {
    if (!clearAt(c.p) || kept.some((k) => Math.hypot(k[0] - c.p[0], k[1] - c.p[1]) < 20)) continue;
    // crossings are inferred where a mapped footpath meets a road; when a bridge spans the spot the
    // path goes over (footbridge), not across - no zebra there
    const g0 = ground(c.p[0], c.p[1]);
    let bridged = false;
    for (let dx = -8; dx <= 8 && !bridged; dx += 2) for (let dz = -8; dz <= 8 && !bridged; dz += 2) {
      const d = deck(c.p[0] + dx, c.p[1] + dz);
      if (Number.isFinite(d) && d > (Number.isFinite(g0) ? g0 : -1e9) + 3) bridged = true;
    }
    if (bridged) continue;
    kept.push(c.p);
    for (let t = -c.width / 2 + 0.6; t <= c.width / 2 - 0.5; t += 1.0) flat(L.white, c.p[0], c.p[1], c.dir[0], c.dir[1], -1.8, 1.8, t - 0.25, t + 0.25, 0.08);
    // 望右 LOOK RIGHT just off each kerb end, readable by the pedestrian about to cross
    // (beside the zebra at each kerb, text top towards the road centre)
    if (c.width >= 5) for (const sg of [-1, 1]) {
      const o = sg * (c.width / 2 - 1.1);
      flat(L.decal, c.p[0], c.p[1], c.dir[0], c.dir[1], 2.0, 3.8, o - 0.9, o + 0.9, 0.09, uvFor(CELL.look, sg < 0));
    }
  }
  for (const s of M.slow || []) {
    if (!clearAt(s.p) || !kept.some((k) => Math.hypot(k[0] - s.p[0], k[1] - s.p[1]) < 12)) continue;
    const half = Math.min(1.1, s.width * 0.18);
    // glyph tops point along the direction of travel, so the approaching driver reads 慢 then 駛
    flat(L.decal, s.p[0], s.p[1], -s.up[1], s.up[0], -half, half, -2.6, 2.6, 0.09, uvFor(CELL.slow));
  }
  for (const b of M.busStops || []) {
    const nx = -b.dir[1] * b.side, nz = b.dir[0] * b.side, off = b.width / 2 - 1.5;
    const cx = b.p[0] + nx * off, cz = b.p[1] + nz * off;
    const okBay = clearAt([cx, cz]);
    if (okBay) for (const [a0, a1, b0, b1] of [[-7.5, 7.5, -1.4, -1.25], [-7.5, 7.5, 1.25, 1.4], [-7.5, -7.35, -1.4, 1.4], [7.35, 7.5, -1.4, 1.4]]) flat(L.yellow, cx, cz, b.dir[0], b.dir[1], a0, a1, b0, b1, 0.08);
    // 巴士站 reads for traffic in the kerb lane (HK drives on the left)
    if (okBay) flat(L.decal, cx, cz, b.dir[1] * b.side, -b.dir[0] * b.side, -0.9, 0.9, -3.4, 3.4, 0.09, uvFor(CELL.bus_text)); // tops toward -side*dir
    const ix = b.p[0] + nx * (b.width / 2 + 1.2), iz = b.p[1] + nz * (b.width / 2 + 1.2);
    flat(L.decal, ix, iz, 1, 0, -1.3, 1.3, -1.3, 1.3, 0.12, uvFor(CELL.bus));
  }
  for (const ic of M.icons || []) flat(L.decal, ic.p[0], ic.p[1], 1, 0, -1.3, 1.3, -1.3, 1.3, 0.12, uvFor(CELL[ic.kind] ?? CELL.lift));

  // assemble
  const group = new THREE.Group(); group.name = 'roads';
  const mat = (color, order, extra = {}) => new THREE.MeshBasicMaterial({ color, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 * order, ...extra });
  const mats = {
    pave: mat(st.pavement, 1), kerb: mat(st.kerb, 2), tar: mat(st.tarmac, 3), deckTar: mat(st.deck, 3), walkEdge: mat(st.kerb, 1), walk: mat(st.walk, 2),
    indoor: mat(st.indoor, 3), white: mat(st.paint, 5), yellow: mat(st.yellow, 5),
    decal: mat(0xffffff, 6, { map: decalAtlas(), transparent: true }),
  };
  const order = { pave: 1, walkEdge: 1, walk: 2, kerb: 2, tar: 3, deckTar: 3, indoor: 3, white: 5, yellow: 5, decal: 6 };
  for (const k of Object.keys(L)) if (L[k].i.length && (!furnitureOnly || k === 'decal')) group.add(L[k].mesh(mats[k], order[k]));

  // lamps (instanced) + lanterns
  if (lampGeo && lamps.length) {
    const pole = new THREE.InstancedMesh(lampGeo, new THREE.MeshLambertMaterial({ color: st.lamp }), lamps.length);
    const lantern = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.18, 0.35), new THREE.MeshBasicMaterial({ color: st.lantern }), lamps.length);
    const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    lamps.forEach((l, i) => {
      qn.setFromAxisAngle(up, -l.ang);
      pole.setMatrixAt(i, m4.compose(new THREE.Vector3(l.x, l.y, l.z), qn, one));
      const tip = new THREE.Vector3(1.75, 11.95, 0.25).applyQuaternion(qn);
      lantern.setMatrixAt(i, m4.compose(new THREE.Vector3(l.x + tip.x, l.y + tip.y, l.z + tip.z), qn, one));
    });
    pole.name = 'streetlamps'; lantern.name = 'lanterns';
    group.add(pole, lantern);
    mats.lamp = pole.material; mats.lantern = lantern.material;
  }
  group.userData.setTheme = themeSetter(mats);
  group.userData.lampCount = lamps.length;
  return group;
}
// (made outside buildRoads: a closure inside it would keep all of its height lookups alive, tens of MB a tile)
function themeSetter(mats) {
  return (d) => {
    const s = STYLE[d ? 'dark' : 'light'];
    mats.pave.color.set(s.pavement); mats.kerb.color.set(s.kerb); mats.walkEdge.color.set(s.kerb); mats.tar.color.set(s.tarmac); mats.deckTar.color.set(s.deck);
    mats.walk.color.set(s.walk); mats.indoor.color.set(s.indoor); mats.white.color.set(s.paint); mats.yellow.color.set(s.yellow);
    mats.lamp?.color.set(s.lamp); mats.lantern?.color.set(s.lantern);
  };
}

function runFilter(flags, step, minLen) {
  const out = flags.slice();
  let i = 0;
  while (i < out.length) {
    if (!out[i]) { i++; continue; }
    let j = i;
    while (j < out.length && out[j]) j++;
    if ((j - i) * step < minLen) for (let k = i; k < j; k++) out[k] = false;
    i = j;
  }
  return out;
}
function disc(layer, cx, cz, r, hfn) {
  const N = 28, R = Math.max(3, Math.ceil(r / 1.5));
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const P = (a, rr) => { const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr; return [x, hfn(x, z), z]; };
    for (let k = 0; k < R; k++) layer.quad(P(a0, (r * k) / R + 0.001), P(a1, (r * k) / R + 0.001), P(a0, (r * (k + 1)) / R), P(a1, (r * (k + 1)) / R));
  }
}

export async function loadLampGeometry(url) {
  const j = await (await fetch(url)).json();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(j.positions, 3));
  g.setIndex(j.indices); g.computeVertexNormals();
  return g;
}
