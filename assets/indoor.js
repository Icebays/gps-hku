/* Indoor floor plans on the 3D map, like Google / Apple Maps: picking a building that has plans
   (data/indoor/index.json) shows a floor selector; the chosen floor is drawn in the site's own colours
   at its real height and the building is cut away above it. The plans are built from the owners'
   floor-plan PDFs by tools/build_indoor.py (walls, shelves, study areas, furniture, labels, symbols). */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { L, getLang, esc } from './app.js';

/* ---------- cutting buildings open above the floor ---------- */
// uCutMap: top-down mask of the building (all floors' outlines, a little wider) over uCutBox (x0, z0, w, d)
export const CUT_U = { uCutOn: { value: 0 }, uCutY: { value: 0 }, uCutMap: { value: null }, uCutBox: { value: new THREE.Vector4(0, 0, 1, 1) } };
export function cutify(m) {
  if (!m || m.userData.cutified) return m;
  m.userData.cutified = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    Object.assign(sh.uniforms, CUT_U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCutW;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
{ vec4 cw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  cw = instanceMatrix * cw;
#endif
  vCutW = (modelMatrix * cw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vCutW;
uniform float uCutOn, uCutY;
uniform sampler2D uCutMap;
uniform vec4 uCutBox;`).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (uCutOn > 0.5 && vCutW.y > uCutY) {
  vec2 cuv = (vCutW.xz - uCutBox.xy) / uCutBox.zw;
  if (cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0 && texture2D(uCutMap, cuv).r > 0.5) discard;
}`);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : prev ? prev.toString() : '') + '|cut';
  m.needsUpdate = true;
  return m;
}

/* ---------- look ---------- */
const THEME = {
  light: { shaft: 0x8fa5ba, shaftEdge: 0x4b5f73, slab: 0xfbf8f1, areaY: 0xf4e7c3, areaG: 0xdcebc9, areaC: 0xcfe9e6, areaN: 0xe4e6e3, areaP: 0xf5ddd2, areaR: 0xe4def4, void: 0x9aa39e,
    shelf: 0xd8c09f, shelfDark: 0xb08d68, shelfG: 0x9cc285, column: 0xc3cac6, wallFill: 0x9aa49f, counter: 0xefc98f,
    bench: 0x9aa4a0, stool: 0x9aa4a0, armchair: 0xf0a24a, seat: 0x9aa4a0, top: 0xd9e8f1, leg: 0x7d8783, chair: 0x6f8f86,
    wall: 0x9aa49f, ghost: 0x9aa49f, door: 0x9aa5a0, stairs: 0x5aa39b, thin: 0xb5bcb8, step: 0xc9d8d4, screen: 0xa9c3cc, ink: 0x7d8783 },
  dark: { shaft: 0x6c8aa6, shaftEdge: 0x9fb6cc, slab: 0x2a302d, areaY: 0x4a4330, areaG: 0x34452f, areaC: 0x2c4746, areaN: 0x393d3b, areaP: 0x4a3832, areaR: 0x3b3752, void: 0x141816,
    shelf: 0x7d6a54, shelfDark: 0x5e4c3a, shelfG: 0x4f6e43, column: 0x5f6863, wallFill: 0x8a958f, counter: 0x8a7350,
    bench: 0x5d6762, stool: 0x5d6762, armchair: 0xa86c34, seat: 0x5d6762, top: 0x47606e, leg: 0x8a948f, chair: 0x5f8077,
    wall: 0x8a958f, ghost: 0x8a958f, door: 0x6f7a74, stairs: 0x5aa39b, thin: 0x56605b, step: 0x55625e, screen: 0x4f6670, ink: 0x8f9a94 },
};
// heights (m) of the drawn furniture and walls
const HEIGHT = { shelf: 1.8, shelfDark: 1.83, shelfG: 1.4, column: 3.4, wallFill: 2.4, counter: 1.05, bench: 0.45, stool: 0.45, armchair: 0.7, seat: 0.45 };
const WALL_H = 2.4, WALL_T = 0.16, LIFT = 0.12;   // the floor sits a little above its level so it never fights the roof below
const LOW_WALL = 0.35;
const SCREEN_H = 1.1, SCREEN_T = 0.05;   // desk partitions, low screens and atrium balustrades
/* Walls (like The Sims): 'full', 'cutaway' (walls facing the camera drop to a low sill and the rest of
   them turns to glass, following the view angle) or 'low' (all walls low). Saved per viewer. */
export const WALL_U = { uWallMode: { value: 1 }, uCamDir: { value: new THREE.Vector2(0, 1) }, uLow: { value: LOW_WALL / WALL_H } };
const WALL_MODES = ['full', 'cutaway', 'low'];
let wallMode = 'cutaway';
try { wallMode = localStorage.getItem('gps-walls') || 'cutaway'; } catch (e) {}
WALL_U.uWallMode.value = Math.max(0, WALL_MODES.indexOf(wallMode));
function wallShader(m, ghost) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WALL_U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 aDir;
attribute float aTop;
uniform float uWallMode, uLow;
uniform vec2 uCamDir;`).replace('#include <begin_vertex>', `#include <begin_vertex>
{
  // how much this wall blocks the view: 1 = across the line of sight, 0 = along it
  float across = 1.0 - smoothstep(0.35, 0.8, abs(dot(normalize(aDir + vec2(1e-5)), uCamDir)));
  float keep = uWallMode < 0.5 ? 1.0 : uWallMode < 1.5 ? mix(1.0, uLow, across) : uLow;
  ${ghost ? 'keep = 1.0; if (uWallMode < 0.5) keep = 0.0;' : ''}
  if (aTop > 0.5) transformed.y *= keep;
}`);
  };
  m.customProgramCacheKey = () => 'wall' + (ghost ? 'g' : '');
  return m;
}

const ICONS = {
  'wc-m': '<circle cx="12" cy="5.2" r="2.2" fill="currentColor"/><path d="M9 9h6v6.5h-1.6V21h-2.8v-5.5H9z" fill="currentColor"/>',
  'wc-f': '<circle cx="12" cy="5.2" r="2.2" fill="currentColor"/><path d="M10 9h4l2.4 7h-2.6V21h-3.6v-5H7.6z" fill="currentColor"/>',
  lift: '<rect x="5" y="3.5" width="14" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 10.5l3-3.5 3 3.5zM9 13.5l3 3.5 3-3.5z" fill="currentColor"/>',
  exit: '<circle cx="14.5" cy="4.6" r="2" fill="currentColor"/><path d="M13 7.5l-3.5 2.2-2 3.3M13 7.5l-1.2 5 3.6 2.4-1.2 5.3M11.8 12.5l-2.4 3.4-3.6.6M13.4 9.6l2.5 2.4 3 .4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  printer: '<path d="M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 14h10v6H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  opac: '<rect x="3.5" y="4.5" width="17" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 20h6M12 15.5V20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="11" cy="9.6" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12.7 11.3l2.3 2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  dict: '<path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v13H7.5A2.5 2.5 0 0 1 5 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H17M9 8.5h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  // MTR stations (tools/build_station_plans.py)
  'wc-a': '<circle cx="10.5" cy="4.3" r="2" fill="currentColor"/><path d="M10.5 7.5v6h4.6l2.4 5.2M10.5 10.6h4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 11.3a5 5 0 1 0 6.9 6.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  escalator: '<path d="M3 18.5h4.2l9.2-10.5H21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="4.6" r="1.8" fill="currentColor"/><path d="M10 7.6v4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  gate: '<path d="M5 4v16M19 4v16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M8 12h8M13 9l3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  aed: '<path d="M12 20.5s-8-4.9-8-10.7A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 8 2.4c0 5.8-8 10.7-8 10.7z" fill="currentColor"/><path d="M12.8 9.6l-2.6 3.8h3l-2 3.6" fill="none" stroke="#dc2626" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10.5v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.3" r="1.3" fill="currentColor"/>',
  ticket: '<path d="M3.5 7.5h17v3a1.8 1.8 0 0 0 0 3.6v3h-17v-3a1.8 1.8 0 0 0 0-3.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 8.5v7" stroke="currentColor" stroke-width="1.5" stroke-dasharray="1.5 1.5"/>',
  // the MTR's exit sign (出), as on the map's exit pins
  'mtr-exit': '<path transform="translate(-3 0.5) scale(0.3)" fill="currentColor" d="M44.4 14h11.2v48.8H44.4zM24 16.8h10.8v8.4H24zM65.2 16.8H76v8.4H65.2zM24 25.2h52v10.4H24zM24 41.2h10.8v12H24zM65.2 41.2H76v12H65.2zM24 53.2h52v9.6H24z"/>',
};
const ICON_NAME = {
  'wc-m': { en: 'Male toilet', zh: '男洗手間' }, 'wc-f': { en: 'Female toilet', zh: '女洗手間' }, lift: { en: 'Lift', zh: '升降機' },
  exit: { en: 'Fire exit', zh: '走火通道' }, printer: { en: 'Multi-function printer', zh: '多功能打印機' },
  opac: { en: 'Library catalogue (OPAC)', zh: '館藏目錄電腦 (OPAC)' }, dict: { en: 'Dictionary stand', zh: '字典架' },
  'wc-a': { en: 'Accessible toilet', zh: '暢通易達洗手間' }, escalator: { en: 'Escalator', zh: '扶手電梯' }, gate: { en: 'Fare gates', zh: '入閘機' },
  aed: { en: 'Defibrillator (AED)', zh: '自動心臟除顫器' }, info: { en: 'Customer service / enquiry', zh: '客務中心／查詢' },
  ticket: { en: 'Ticket machine', zh: '售票機' }, 'mtr-exit': { en: 'Station exit', zh: '車站出口' },
};
const T = (o) => o[getLang()] || o.en;

/* ---------- geometry from the plan data (model frame: x, z; flat [x0, z0, x1, z1, ...]) ---------- */
const ring = (f) => { const v = []; for (let i = 0; i < f.length; i += 2) v.push(new THREE.Vector2(f[i], -f[i + 1])); return v; };
function shapes(polys) {   // [[outer, hole, ...], ...] or [outer, ...]
  return polys.map((p) => {
    const rings = Array.isArray(p[0]) ? p : [p];
    const s = new THREE.Shape(ring(rings[0]));
    for (const h of rings.slice(1)) s.holes.push(new THREE.Path(ring(h)));
    return s;
  });
}
// flat polygons with the floor's open holes (atria) cut out of any polygon that contains them
function flatGeo(polys, holes = []) {
  const sh = shapes(polys);
  if (holes.length) for (const s of sh) {
    const b = new THREE.Box2().setFromPoints(s.getPoints());
    for (const h of holes) { const r = ring(h), hb = new THREE.Box2().setFromPoints(r); if (b.containsBox(hb)) s.holes.push(new THREE.Path(r)); }
  }
  return new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2);
}
const blockGeo = (polys, h) => new THREE.ExtrudeGeometry(shapes(polys), { depth: h, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2);
function lineGeo(lines, y) {
  const v = [];
  for (const f of lines) for (let i = 0; i + 3 < f.length; i += 2) v.push(f[i], y, f[i + 1], f[i + 2], y, f[i + 3]);
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
}
// a solid with aDir (its long direction) and aTop (top vertices) for the wall modes
function tagWall(geo, dx, dz, h) {
  const n = geo.attributes.position.count, dir = new Float32Array(n * 2), top = new Float32Array(n);
  for (let i = 0; i < n; i++) { dir[2 * i] = dx; dir[2 * i + 1] = dz; top[i] = geo.attributes.position.getY(i) > h * 0.5 ? 1 : 0; }
  geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 2)); geo.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
  return geo;
}
function wallGeo(segs, fills, h, t = WALL_T) {   // wall lines as boxes t thick, plus the plans' solid wall fills
  const parts = [];
  for (const f of segs) for (let i = 0; i + 3 < f.length; i += 2) {
    const ax = f[i], az = f[i + 1], bx = f[i + 2], bz = f[i + 3], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const g = new THREE.BoxGeometry(L + t * 0.6, h, t).translate(0, h / 2, 0)
      .rotateY(-Math.atan2(bz - az, bx - ax)).translate((ax + bx) / 2, 0, (az + bz) / 2);
    g.deleteAttribute('uv');
    parts.push(tagWall(g, (bx - ax) / L, (bz - az) / L, h));
  }
  for (const f of fills) {
    const P = []; for (let i = 0; i < f.length; i += 2) P.push([f[i], f[i + 1]]);
    // long axis of the fill (for the cutaway)
    let best = [1, 0], bl = 0;
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > bl) { bl = l; best = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; } }
    const g = new THREE.ExtrudeGeometry(shapes([f]), { depth: h, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2);
    g.deleteAttribute('uv');
    parts.push(tagWall(g, best[0], best[1], h));
  }
  return parts.length ? mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))) : null;
}
// stairs: each step a block up to its tread from the floor, or hanging below it ([x0, z0, ... x3, z3, top, bottom]);
// flights above a landing and the landings themselves float (bottom > 0)
function stepsGeo(steps) {
  const v = [];
  const quad = (a, b, c, d) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const s of steps) {
    const h = s[8], lo = s[9] || 0, p = [0, 1, 2, 3].map((i) => [s[2 * i], s[2 * i + 1]]);
    const B = p.map(([x, z]) => [x, lo, z]), T = p.map(([x, z]) => [x, h, z]);
    quad(T[0], T[3], T[2], T[1]);   // tread
    if (lo > 0) quad(B[0], B[1], B[2], B[3]);   // floating treads and landings: their underside
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(B[i], B[j], T[j], T[i]); }
  }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
// tables: a top on legs (round or odd shapes: one pedestal); chairs: seat, back and legs, facing the table
let CHAIR = null;
function chairGeo() {
  if (CHAIR) return CHAIR;
  const parts = [new THREE.BoxGeometry(0.42, 0.05, 0.42).translate(0, 0.45, 0), new THREE.BoxGeometry(0.05, 0.42, 0.42).translate(-0.19, 0.69, 0)];
  for (const [x, z] of [[-0.17, -0.17], [-0.17, 0.17], [0.17, -0.17], [0.17, 0.17]]) parts.push(new THREE.BoxGeometry(0.035, 0.45, 0.035).translate(x, 0.225, z));
  CHAIR = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return (g.index ? g.toNonIndexed() : g); }));
  return CHAIR;
}
function tableGeo(tables) {
  const tops = [], legs = [];
  for (const f of tables) {
    const P = []; for (let i = 0; i < f.length; i += 2) P.push([f[i], f[i + 1]]);
    if (P.length > 3 && Math.hypot(P[0][0] - P.at(-1)[0], P[0][1] - P.at(-1)[1]) < 0.02) P.pop();
    tops.push(f);
    const cx = P.reduce((a, p) => a + p[0], 0) / P.length, cz = P.reduce((a, p) => a + p[1], 0) / P.length;
    if (P.length === 4) {
      for (const [x, z] of P) { const d = Math.hypot(cx - x, cz - z), k = Math.min(0.08, d * 0.3) / d; legs.push(new THREE.BoxGeometry(0.05, 0.72, 0.05).translate(x + (cx - x) * k, 0.36, z + (cz - z) * k)); }
    } else {
      legs.push(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 8).translate(cx, 0.36, cz), new THREE.CylinderGeometry(0.22, 0.24, 0.03, 12).translate(cx, 0.015, cz));
    }
  }
  const top = tops.length ? new THREE.ExtrudeGeometry(shapes(tops), { depth: 0.04, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2).translate(0, 0.72, 0) : null;
  return { top, legs: legs.length ? mergeGeometries(legs.map((g) => { g.deleteAttribute('uv'); return (g.index ? g.toNonIndexed() : g); })) : null };
}

export function createIndoor(S) {
  const wrap = S.wrap;
  const labelBox = document.createElement('div'); labelBox.className = 'labels indoor-labels'; wrap.appendChild(labelBox);
  const st = { index: null, data: {}, place: null, floor: null, shown: null, under: [], labels: [], views: {}, shafts: null, ui: null, theme: null };
  const mats = {};
  const mat = (k, lit, extra = {}) => {
    const key = k + (lit ? 'L' : 'B');
    if (!mats[key]) mats[key] = lit ? new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide, ...extra }) : new THREE.MeshBasicMaterial({ ...extra });
    return mats[key];
  };
  const lmat = (k) => mats[k + 'Ln'] || (mats[k + 'Ln'] = new THREE.LineBasicMaterial());
  const wallMat = () => mats.wallL || (mats.wallL = wallShader(new THREE.MeshLambertMaterial({ flatShading: true })));
  // glass: only the nearest face is blended (depth-written, a little behind the solid wall), so walls never stack up into grey
  const ghostMat = () => mats.ghostB || (mats.ghostB = wallShader(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }), true));
  function paint() {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const P = THEME[dark ? 'dark' : 'light'];
    for (const [key, m] of Object.entries(mats)) { const k = key.replace(/(L|B|Ln)$/, ''); if (P[k] != null) m.color.set(P[k]); }
  }
  const loadIndex = () => st.index || (st.index = fetch('data/indoor/index.json').then((r) => r.json()).catch(() => ({})));

  function cutMask(d, cur) {
    // the outlines of this floor and the floors above it, 1.5 m wider, as the top-down cut mask: the building is cut
    // open where the plan is drawn and where floors above it stand, so a neighbouring part the plans only cover lower
    // down (the west building, on G/F and 1/F) stays whole, roof and all, when the floor shown is above it
    const floors = d.floors.filter((fl) => fl.y >= cur.y - 0.1);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const fl of floors) for (const p of fl.slab) for (let i = 0; i < p[0].length; i += 2) {
      x0 = Math.min(x0, p[0][i]); x1 = Math.max(x1, p[0][i]); z0 = Math.min(z0, p[0][i + 1]); z1 = Math.max(z1, p[0][i + 1]);
    }
    x0 -= 4; z0 -= 4; x1 += 4; z1 += 4;
    const R = 4, cv = document.createElement('canvas'); cv.width = Math.ceil((x1 - x0) * R); cv.height = Math.ceil((z1 - z0) * R);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 3 * R; g.lineJoin = 'round';
    for (const fl of floors) for (const p of fl.slab) {
      g.beginPath();
      for (let i = 0; i < p[0].length; i += 2) g[i ? 'lineTo' : 'moveTo']((p[0][i] - x0) * R, (p[0][i + 1] - z0) * R);
      g.closePath(); g.fill(); g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv); tex.flipY = false; tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    return { tex, box: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) };
  }

  function build(fl) {
    const g = new THREE.Group(); g.position.y = fl.y + LIFT; g.name = 'indoor-' + fl.id;
    const add = (geo, m, y = 0, order = 0) => { if (!geo) return null; const o = new THREE.Mesh(geo, m); o.position.y = y; o.renderOrder = order; g.add(o); return o; };
    const flatMat = (k, o) => mat(k, false, { polygonOffset: true, polygonOffsetFactor: -1 - o, polygonOffsetUnits: -2 - 2 * o });
    if (fl.slab.length) add(flatGeo(fl.slab), flatMat('slab', 0), 0);
    let o = 1;
    for (const [k, polys] of Object.entries(fl.areas || {})) if (polys.length) add(flatGeo(polys, fl.holes || []), flatMat(k, o++), 0.01 * o);
    if (fl.voids?.length) add(flatGeo(fl.voids), flatMat('void', o++), 0.01 * o);   // lift shafts
    if (fl.holes?.length) {   // atria: a glass balustrade round the edge, the floors below a little in shadow
      const rails = fl.holes.map((h) => { const r = []; for (let i = 0; i + 1 < h.length; i += 2) r.push(h[i], h[i + 1]); r.push(h[0], h[1]); return r; });
      const rg = wallGeo(rails, [], 1.1); if (rg) add(rg, mats.railB || (mats.railB = new THREE.MeshBasicMaterial({ color: 0xbfe0e6, transparent: true, opacity: 0.35, depthWrite: false })));
      add(new THREE.ShapeGeometry(shapes(fl.holes)).rotateX(-Math.PI / 2), mats.shadeB || (mats.shadeB = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false })), -0.4);
    }
    for (const [k, polys] of Object.entries(fl.solids || {})) {
      if (!polys.length || k === 'wallFill') continue;
      add(new THREE.ExtrudeGeometry(shapes(polys), { depth: HEIGHT[k] || 1, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2), mat(k, true));
    }
    const wg = wallGeo(fl.walls || [], fl.solids?.wallFill || [], WALL_H);
    if (wg) { add(wg, wallMat()); add(wg, ghostMat(), 0, 5); }
    if (fl.screens?.length) add(wallGeo(fl.screens, [], SCREEN_H, SCREEN_T), mat('screen', true));
    if (fl.steps?.length) add(stepsGeo(fl.steps), mat('step', true));
    if (fl.tables?.length) { const t = tableGeo(fl.tables); add(t.top, mat('top', true)); add(t.legs, mat('leg', true)); }
    if (fl.chairs?.length) {
      const im = new THREE.InstancedMesh(chairGeo(), mat('chair', true), fl.chairs.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      fl.chairs.forEach(([x, z, a], i) => im.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(up, -a), new THREE.Vector3(1, 1, 1))));
      g.add(im);
    }
    // ink: the whole drawing of a scanned plan (tools/build_indoor_raster.py), darker than the minor lines
    for (const k of ['thin', 'doors', 'stairs', 'ink']) if (fl[k]?.length) {
      const key = k === 'doors' ? 'door' : k;
      const ln = new THREE.LineSegments(lineGeo(fl[k], 0.08), lmat(key)); g.add(ln);
    }
    // labels and symbols (DOM, kept upright and readable)
    const labels = [];
    for (const l of fl.labels) {
      const el = document.createElement('div');
      el.className = 'indoor-label ' + l.k + (l.r ? ' r' : '');   // r: a room (shaded on the plan), shown as a sign
      el.innerHTML = esc((getLang() === 'zh' && l.zh) || l.t).replace(/\n/g, '<br>');   // (zh: the plans that name both)
      labels.push({ el, pos: new THREE.Vector3(l.x, fl.y + LIFT + 0.3, l.z), h: l.h, k: l.k, r: l.r });
    }
    for (const [k, x, z] of fl.icons) {
      const el = document.createElement('div');
      el.className = 'indoor-icon ' + k; el.title = T(ICON_NAME[k] || { en: k });
      el.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">${ICONS[k] || ''}</svg>`;
      labels.push({ el, pos: new THREE.Vector3(x, fl.y + LIFT + 0.3, z), h: 1, k: 'icon' });
    }
    g.traverse((o) => o.layers.set(1));   // (layer 1: drawn over the faded map when the floor is below ground)
    return { group: g, labels };
  }
  const built = (fl) => (fl._built = fl._built || build(fl));
  // lift shafts (a station's 'shafts'): glass columns from the lowest level a lift serves to above its highest
  function shaftsOf(d) {
    if (d._shafts !== undefined) return d._shafts;
    if (!d.shafts?.length) return (d._shafts = null);
    const g = new THREE.Group(); g.name = 'indoor-shafts';
    const glass = mats.shaftB || (mats.shaftB = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    const edge = mats.shaftEdgeLn || (mats.shaftEdgeLn = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.7 }));
    for (const sh of d.shafts) {
      const geo = new THREE.ExtrudeGeometry(shapes([sh.ring]), { depth: sh.y1 - sh.y0, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2).translate(0, sh.y0, 0);
      const m = new THREE.Mesh(geo, glass); m.renderOrder = 6; g.add(m);
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edge));
    }
    g.traverse((o) => o.layers.set(1));
    return (d._shafts = g);
  }
  // floors below that show through atria (open holes in the floor), down to two levels
  function below(d, fl) {
    const out = [], sorted = [...d.floors].sort((a, b) => b.y - a.y);
    let cur = fl;
    for (let k = 0; k < 2 && cur.holes?.length; k++) {
      const nxt = sorted.find((f) => f.y < cur.y - 0.5 && f.y >= cur.y - 4.5);
      if (!nxt) break;
      out.push(nxt); cur = nxt;
    }
    return out;
  }
  function detach() {
    if (st.shafts) { S.scene.remove(st.shafts); st.shafts = null; }
    if (!st.shown) return;
    for (const b of [...st.shown, ...(st.under || [])]) S.scene.remove(b.group);
    st.labels.forEach((l) => l.el.remove());
    st.shown = null; st.under = []; st.labels = [];
  }
  // a selector entry's floors: a station's storey - its levels at their own heights - or the one floor
  const members = (d, id) => {
    const g = d.groups?.find((x) => x.id === id);
    return g ? g.floors.map((f) => d.floors.find((x) => x.id === f)).filter(Boolean) : d.floors.filter((f) => f.id === id);
  };
  const entries = (d) => d.groups || [...d.floors].sort((a, b) => b.y - a.y);   // top first
  function bounds(fls) {   // centre and size of floors, for the camera
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const fl of fls) for (const p of fl.slab) for (let i = 0; i < p[0].length; i += 2) { x0 = Math.min(x0, p[0][i]); x1 = Math.max(x1, p[0][i]); z0 = Math.min(z0, p[0][i + 1]); z1 = Math.max(z1, p[0][i + 1]); }
    return { center: new THREE.Vector3((x0 + x1) / 2, Math.min(...fls.map((f) => f.y)), (z0 + z1) / 2), size: Math.max(x1 - x0, z1 - z0) };
  }

  function show(floorId) {
    const d = st.data[st.place]; if (!d) return;
    detach();
    st.floor = floorId;
    st.ui?.querySelectorAll('[data-floor]').forEach((b) => b.classList.toggle('on', b.dataset.floor === String(floorId ?? '')));   // (none: the outside view's)
    if (floorId == null) { CUT_U.uCutOn.value = 0; S.xray = false; S.onIndoor?.(null); return; }
    const fls = members(d, floorId); if (!fls.length) return;
    st.shown = fls.map(built);
    st.shown.forEach((b) => S.scene.add(b.group));
    st.under = fls.length === 1 ? below(d, fls[0]).map(built) : []; st.under.forEach((u) => S.scene.add(u.group));
    st.labels = st.shown.flatMap((b) => b.labels); st.labels.forEach((l) => labelBox.appendChild(l.el));
    st.shafts = shaftsOf(d); if (st.shafts) S.scene.add(st.shafts);
    const v = (st.views[st.place + '|' + floorId] = st.views[st.place + '|' + floorId] || { id: floorId, _c: bounds(fls) });
    // below ground (a station's platform, concourse...): no cutting - the whole map fades (map.js x-ray view) and the
    // floor is drawn over it; above ground the buildings are cut open above the lowest of the floors shown
    if (v.deep == null) v.deep = fls.some((f) => { const c = bounds([f]).center, gy = S.tiles?.heightAt(c.x, c.z); return gy != null && gy > f.y + 3; });
    if (v.deep) { CUT_U.uCutOn.value = 0; S.xray = true; }
    else {
      const low = fls.reduce((a, b) => (b.y < a.y ? b : a));
      low._cut = low._cut || cutMask(d, low);
      CUT_U.uCutMap.value = low._cut.tex; CUT_U.uCutBox.value.copy(low._cut.box);
      CUT_U.uCutOn.value = 1; CUT_U.uCutY.value = low.y + 0.25; S.xray = false;
    }
    paint();
    S.onIndoor?.(v);
  }

  function selector(d) {
    st.ui?.remove();
    const ui = document.createElement('div'); ui.className = 'map-ui map-floors';
    const sorted = entries(d);
    ui.innerHTML = `<button data-floor="" title="${getLang() === 'zh' ? '外觀' : 'Outside view'}" class="out"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6M3 21h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>` +
      // (a station's exit levels: the exit above the level, 'A1' over 'G')
      sorted.map((f) => `<button data-floor="${f.id}" title="${esc(L(f.name))}"${f.tag ? ' class="tag"' : ''}>${f.tag ? `<small>${esc(f.tag)}</small>${esc(f.short)}` : esc(f.id)}</button>`).join('') +
      `<a class="src" href="${d.source?.url || '#'}" target="_blank" rel="noopener" title="${esc(L(d.source || {}))}">ⓘ</a>`;
    ui.addEventListener('click', (e) => {
      const b = e.target.closest('[data-floor]'); if (!b) return;
      show(b.dataset.floor === '' ? null : b.dataset.floor);
    });
    wrap.appendChild(ui); st.ui = ui;
    place();
  }
  // the selector sits above the info card / weather on the left
  function place() {
    if (!st.ui) return;
    const info = S.info?.isConnected ? S.info.getBoundingClientRect() : null, wr = wrap.getBoundingClientRect();
    const bottom = info ? wr.bottom - info.top + 10 : 66;
    st.ui.style.bottom = bottom + 'px';
  }

  async function open(placeId, floorId) {
    const idx = await loadIndex(), entry = idx[placeId];
    if (!entry) return false;
    // an entry is the plan's file, or { file, floor }: a place that opens the plan at its own floor (a station's exit)
    const file = entry.file || entry;
    if (!st.data[placeId]) {
      st.files = st.files || {};   // (places sharing a plan share its data: a station's exits)
      const d = await (st.files[file] || (st.files[file] = fetch('data/indoor/' + file).then((r) => r.json()).catch(() => (delete st.files[file], null))));
      if (!d) return false;
      st.data[placeId] = d;
    }
    const d = st.data[placeId];
    if (st.place !== placeId) close();
    st.place = placeId;
    selector(d);
    // the building as it is, with the floor selector beside it: the user picks a floor (a shared link's floor opens)
    show(floorId && members(d, floorId).length ? floorId : null);
    return true;
  }
  function close() {
    detach(); S.xray = false;
    st.ui?.remove(); st.ui = null; st.place = null; st.floor = null; CUT_U.uCutOn.value = 0;
  }

  const _v = new THREE.Vector3();
  function update() {
    if (!st.shown) return;
    place();
    const w = wrap.clientWidth, h = wrap.clientHeight, cam = S.camera;
    // view direction across the floor, for the cutaway walls
    const vd = cam.getWorldDirection(_v); WALL_U.uCamDir.value.set(vd.x, vd.z);
    if (WALL_U.uCamDir.value.lengthSq() < 1e-6) WALL_U.uCamDir.value.set(0, 1); else WALL_U.uCamDir.value.normalize();
    const pxPerM = (d) => h / 2 / (d * Math.tan((cam.fov * Math.PI) / 360));
    const placed = [];
    // symbols first, then room names, zones, shelf marks (biggest first)
    const order = st.labels.map((l) => ({ l, d: cam.position.distanceTo(l.pos) }))
      .sort((a, b) => (a.l.k === 'icon' ? -2 : a.l.r ? -1 : 0) - (b.l.k === 'icon' ? -2 : b.l.r ? -1 : 0) || b.l.h - a.l.h);
    for (const { l, d } of order) {
      _v.copy(l.pos).project(cam);
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      const s = pxPerM(d);
      // a label shows once the plan is zoomed in enough for its own text size to be readable
      let vis = _v.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20 &&
        (l.k === 'icon' ? s > 5 : l.k === 'zone' ? s > 2.5 : l.h * s > (l.k === 'shelf' ? 5.5 : 4));
      if (vis) {
        const bw = l.k === 'icon' ? 24 : Math.min(160, l.el.textContent.length * 6.5) / (l.el.childElementCount + 1) + 10, bh = l.k === 'icon' ? 24 : 14 * (l.el.childElementCount + 1);
        const r = { x: x - bw / 2, y: y - bh / 2, w: bw, h: bh };
        if (placed.some((q) => !(r.x + r.w < q.x || q.x + q.w < r.x || r.y + r.h < q.y || q.y + q.h < r.y))) vis = false; else placed.push(r);
      }
      l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  return {
    has: async (placeId) => !!(await loadIndex())[placeId],
    open, close, update, paint,
    get wallMode() { return wallMode; },
    setWallMode(m) { wallMode = m; WALL_U.uWallMode.value = Math.max(0, WALL_MODES.indexOf(m)); try { localStorage.setItem('gps-walls', m); } catch (e) {} },
    get floor() { return st.floor; }, get place() { return st.place; },
  };
}
