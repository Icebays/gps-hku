/* Indoor floor plans on the 3D map, like Google / Apple Maps: picking a building that has plans
   (data/indoor/index.json) shows a floor selector; the chosen floor is drawn in the site's own colours
   at its real height and the building is cut away above it. The plans are built from the owners'
   floor-plan PDFs by tools/build_indoor.py (walls, shelves, study areas, furniture, labels, symbols). */
import * as THREE from 'three';
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
  light: { slab: 0xfbf8f1, areaY: 0xf4e7c3, areaG: 0xdcebc9, areaC: 0xcfe9e6, areaN: 0xe4e6e3, areaP: 0xf5ddd2, void: 0xd3d7d4,
    shelf: 0xd2b896, shelfG: 0x9cc285, table: 0xcfe2ee, chair: 0xbcc4c0, seat: 0xe7a35a, counter: 0xefc98f, column: 0xb7bfbb,
    wall: 0x8d9893, door: 0x9aa5a0, stairs: 0x5aa39b, thin: 0xb5bcb8, edge: 0x7c8781 },
  dark: { slab: 0x2a302d, areaY: 0x4a4330, areaG: 0x34452f, areaC: 0x2c4746, areaN: 0x393d3b, areaP: 0x4a3832, void: 0x1d2220,
    shelf: 0x7b6650, shelfG: 0x4f6e43, table: 0x3b4f5c, chair: 0x6c7772, seat: 0x9b6a3a, counter: 0x8a7350, column: 0x5f6863,
    wall: 0xa9b4ae, door: 0x6f7a74, stairs: 0x5aa39b, thin: 0x56605b, edge: 0x8a948f },
};
// extrusion heights (m) of the drawn furniture and walls
const HEIGHT = { shelf: 1.6, shelfG: 1.3, table: 0.75, chair: 0.45, seat: 0.45, counter: 1.0, column: 3.2, wall: 1.6 };
const WALL_H = 1.6, LIFT = 0.12;   // walls; the floor sits a little above its level so it never fights the roof below

const ICONS = {
  'wc-m': '<circle cx="12" cy="5.2" r="2.2" fill="currentColor"/><path d="M9 9h6v6.5h-1.6V21h-2.8v-5.5H9z" fill="currentColor"/>',
  'wc-f': '<circle cx="12" cy="5.2" r="2.2" fill="currentColor"/><path d="M10 9h4l2.4 7h-2.6V21h-3.6v-5H7.6z" fill="currentColor"/>',
  lift: '<rect x="5" y="3.5" width="14" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 10.5l3-3.5 3 3.5zM9 13.5l3 3.5 3-3.5z" fill="currentColor"/>',
  exit: '<circle cx="14.5" cy="4.6" r="2" fill="currentColor"/><path d="M13 7.5l-3.5 2.2-2 3.3M13 7.5l-1.2 5 3.6 2.4-1.2 5.3M11.8 12.5l-2.4 3.4-3.6.6M13.4 9.6l2.5 2.4 3 .4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  printer: '<path d="M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 14h10v6H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  opac: '<rect x="3.5" y="4.5" width="17" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 20h6M12 15.5V20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="11" cy="9.6" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12.7 11.3l2.3 2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  dict: '<path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v13H7.5A2.5 2.5 0 0 1 5 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H17M9 8.5h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};
const ICON_NAME = {
  'wc-m': { en: 'Male toilet', zh: '男洗手間' }, 'wc-f': { en: 'Female toilet', zh: '女洗手間' }, lift: { en: 'Lift', zh: '升降機' },
  exit: { en: 'Fire exit', zh: '走火通道' }, printer: { en: 'Multi-function printer', zh: '多功能打印機' },
  opac: { en: 'Library catalogue (OPAC)', zh: '館藏目錄電腦 (OPAC)' }, dict: { en: 'Dictionary stand', zh: '字典架' },
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
const flatGeo = (polys) => new THREE.ShapeGeometry(shapes(polys)).rotateX(-Math.PI / 2);
const blockGeo = (polys, h) => new THREE.ExtrudeGeometry(shapes(polys), { depth: h, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2);
function lineGeo(lines, y) {
  const v = [];
  for (const f of lines) for (let i = 0; i + 3 < f.length; i += 2) v.push(f[i], y, f[i + 1], f[i + 2], y, f[i + 3]);
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
}
function wallGeo(segs, h) {   // thin upright panels along the wall lines
  const v = [];
  for (const f of segs) for (let i = 0; i + 3 < f.length; i += 2) {
    const [ax, az, bx, bz] = [f[i], f[i + 1], f[i + 2], f[i + 3]];
    v.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, 0, az, bx, h, bz, ax, h, az);
  }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export function createIndoor(S) {
  const wrap = S.wrap;
  const labelBox = document.createElement('div'); labelBox.className = 'labels indoor-labels'; wrap.appendChild(labelBox);
  const st = { index: null, data: {}, place: null, floor: null, group: null, labels: [], ui: null, theme: null };
  const mats = {};
  const mat = (k, lit, extra = {}) => {
    const key = k + (lit ? 'L' : 'B');
    if (!mats[key]) mats[key] = lit ? new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide, ...extra }) : new THREE.MeshBasicMaterial({ ...extra });
    return mats[key];
  };
  const lmat = (k) => mats[k + 'Ln'] || (mats[k + 'Ln'] = new THREE.LineBasicMaterial());
  function paint() {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const P = THEME[dark ? 'dark' : 'light'];
    for (const [key, m] of Object.entries(mats)) { const k = key.replace(/(L|B|Ln)$/, ''); if (P[k] != null) m.color.set(P[k]); }
  }
  const loadIndex = () => st.index || (st.index = fetch('data/indoor/index.json').then((r) => r.json()).catch(() => ({})));

  function cutMask(d) {
    // all floors' outlines, 1.5 m wider, as the top-down cut mask
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const fl of d.floors) for (const p of fl.slab) for (let i = 0; i < p[0].length; i += 2) {
      x0 = Math.min(x0, p[0][i]); x1 = Math.max(x1, p[0][i]); z0 = Math.min(z0, p[0][i + 1]); z1 = Math.max(z1, p[0][i + 1]);
    }
    x0 -= 4; z0 -= 4; x1 += 4; z1 += 4;
    const R = 4, cv = document.createElement('canvas'); cv.width = Math.ceil((x1 - x0) * R); cv.height = Math.ceil((z1 - z0) * R);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 3 * R; g.lineJoin = 'round';
    for (const fl of d.floors) for (const p of fl.slab) {
      g.beginPath();
      for (let i = 0; i < p[0].length; i += 2) g[i ? 'lineTo' : 'moveTo']((p[0][i] - x0) * R, (p[0][i + 1] - z0) * R);
      g.closePath(); g.fill(); g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv); tex.flipY = false; tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    return { tex, box: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) };
  }

  function build(fl) {
    const g = new THREE.Group(); g.position.y = fl.y + LIFT; g.name = 'indoor-' + fl.id;
    const add = (geo, m, y = 0, order = 0) => { const o = new THREE.Mesh(geo, m); o.position.y = y; o.renderOrder = order; g.add(o); return o; };
    const flatMat = (k, o) => mat(k, false, { polygonOffset: true, polygonOffsetFactor: -1 - o, polygonOffsetUnits: -2 - 2 * o });
    if (fl.slab.length) add(flatGeo(fl.slab), flatMat('slab', 0), 0);
    let o = 1;
    for (const [k, polys] of Object.entries(fl.areas || {})) if (polys.length) add(flatGeo(polys), flatMat(k, o++), 0.01 * o);
    for (const [k, polys] of Object.entries(fl.blocks || {})) if (polys.length) add(blockGeo(polys, HEIGHT[k] || 1), mat(k, true));
    if (fl.walls.length) add(wallGeo(fl.walls, WALL_H), mat('wall', true));
    for (const k of ['thin', 'doors', 'stairs']) if (fl[k]?.length) {
      const key = k === 'doors' ? 'door' : k;
      const ln = new THREE.LineSegments(lineGeo(fl[k], 0.08), lmat(key)); g.add(ln);
    }
    // labels and symbols (DOM, kept upright and readable)
    const labels = [];
    for (const l of fl.labels) {
      const el = document.createElement('div');
      el.className = 'indoor-label ' + l.k;
      el.innerHTML = esc(l.t).replace(/\n/g, '<br>');
      labels.push({ el, pos: new THREE.Vector3(l.x, fl.y + LIFT + 0.3, l.z), h: l.h, k: l.k });
    }
    for (const [k, x, z] of fl.icons) {
      const el = document.createElement('div');
      el.className = 'indoor-icon ' + k; el.title = T(ICON_NAME[k] || { en: k });
      el.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">${ICONS[k] || ''}</svg>`;
      labels.push({ el, pos: new THREE.Vector3(x, fl.y + LIFT + 0.3, z), h: 1, k: 'icon' });
    }
    return { group: g, labels };
  }

  function show(floorId) {
    const d = st.data[st.place]; if (!d) return;
    if (st.group) { S.scene.remove(st.group.group); st.group.labels.forEach((l) => l.el.remove()); st.group = null; }
    st.floor = floorId;
    st.ui?.querySelectorAll('[data-floor]').forEach((b) => b.classList.toggle('on', b.dataset.floor === String(floorId)));
    if (floorId == null) { CUT_U.uCutOn.value = 0; S.onIndoor?.(null); return; }
    const fl = d.floors.find((f) => f.id === floorId); if (!fl) return;
    fl._built = fl._built || build(fl);
    if (!fl._c) {   // centre and size of the floor, for the camera
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const p of fl.slab) for (let i = 0; i < p[0].length; i += 2) { x0 = Math.min(x0, p[0][i]); x1 = Math.max(x1, p[0][i]); z0 = Math.min(z0, p[0][i + 1]); z1 = Math.max(z1, p[0][i + 1]); }
      fl._c = { center: new THREE.Vector3((x0 + x1) / 2, fl.y, (z0 + z1) / 2), size: Math.max(x1 - x0, z1 - z0) };
    }
    st.group = fl._built;
    S.scene.add(st.group.group);
    st.group.labels.forEach((l) => labelBox.appendChild(l.el));
    CUT_U.uCutOn.value = 1; CUT_U.uCutY.value = fl.y + 0.25;
    paint();
    S.onIndoor?.(fl);
  }

  function selector(d) {
    st.ui?.remove();
    const ui = document.createElement('div'); ui.className = 'map-ui map-floors';
    const sorted = [...d.floors].sort((a, b) => b.y - a.y);
    ui.innerHTML = `<button data-floor="" title="${getLang() === 'zh' ? '外觀' : 'Outside view'}" class="out"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6M3 21h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>` +
      sorted.map((f) => `<button data-floor="${f.id}" title="${esc(L(f.name))}">${esc(f.id)}</button>`).join('') +
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
    const idx = await loadIndex();
    if (!idx[placeId]) return false;
    if (!st.data[placeId]) {
      const d = await fetch('data/indoor/' + idx[placeId]).then((r) => r.json()).catch(() => null);
      if (!d) return false;
      d._cut = cutMask(d); st.data[placeId] = d;
    }
    const d = st.data[placeId];
    if (st.place !== placeId) close();
    st.place = placeId;
    CUT_U.uCutMap.value = d._cut.tex; CUT_U.uCutBox.value.copy(d._cut.box);
    selector(d);
    show(floorId && d.floors.some((f) => f.id === floorId) ? floorId : d.default || d.floors[0].id);
    return true;
  }
  function close() {
    if (st.group) { S.scene.remove(st.group.group); st.group.labels.forEach((l) => l.el.remove()); st.group = null; }
    st.ui?.remove(); st.ui = null; st.place = null; st.floor = null; CUT_U.uCutOn.value = 0;
  }

  const _v = new THREE.Vector3();
  function update() {
    if (!st.group) return;
    place();
    const w = wrap.clientWidth, h = wrap.clientHeight, cam = S.camera;
    const pxPerM = (d) => h / 2 / (d * Math.tan((cam.fov * Math.PI) / 360));
    const placed = [];
    // symbols first, then room names, zones, shelf marks (biggest first)
    const order = st.group.labels.map((l) => ({ l, d: cam.position.distanceTo(l.pos) }))
      .sort((a, b) => (a.l.k === 'icon' ? -1 : 0) - (b.l.k === 'icon' ? -1 : 0) || b.l.h - a.l.h);
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
    get floor() { return st.floor; }, get place() { return st.place; },
  };
}
