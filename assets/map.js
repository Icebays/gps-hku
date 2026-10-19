import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadPlaces, loadRoutes, isPinned, L, href, esc, getLang, REPO } from './app.js';
import { heightIndex, buildRoads, loadLampGeometry } from './roads.js';

/* Model frame: x = HK1980 Easting − 832250, z = −(Northing − 815900), y = height in mPD */
const ORIGIN = { E: 832250, N: 815900 };
const DECO_OPACITY = 0.18;
const T = {
  en: { loading: 'Loading 3D campus…', find: 'Find a building or place…', reset: 'Reset view', top: 'Top / 3D view', north: 'Face north',
        locate: 'My location (GPS)', layers: 'Layers', routes: 'Walking routes', edit: 'Edit mode', unnamed: 'Unlabelled building',
        height: 'Height', guide: 'Building guide', floorPlans: 'Floor plans', help: 'Know this building? Help label it',
        editBar: 'Edit mode — click a building to tag it', exportPlaces: 'Export places.json', drawRoute: 'Draw route', finishRoute: 'Copy route JSON',
        undo: 'Undo', assign: 'Assign this building to…', choose: '— choose a place —', remove: 'Remove from', copied: 'Copied to clipboard',
        outside: 'You appear to be outside the mapped area.', noGps: 'Location not available.', noRoutes: 'No routes yet. Use Edit mode › Draw route to create one.',
        min: 'min', notPinned: 'not on map yet', webgl: 'Your browser could not start 3D (WebGL).', you: 'You',
        guess: 'Approximate position, not yet confirmed. Know better? Fix it in Edit mode.', photo: 'Aerial photo' },
  zh: { loading: '正在載入 3D 校園…', find: '搜尋大樓或地點…', reset: '重設視角', top: '俯視 / 3D', north: '朝北',
        locate: '我的位置（GPS）', layers: '圖層', routes: '步行路線', edit: '編輯模式', unnamed: '未命名大樓',
        height: '高度', guide: '大樓指南', floorPlans: '平面圖', help: '認得這座大樓？幫手標示',
        editBar: '編輯模式 — 點選大樓以標示', exportPlaces: '匯出 places.json', drawRoute: '繪畫路線', finishRoute: '複製路線 JSON',
        undo: '復原', assign: '將此大樓標示為…', choose: '— 選擇地點 —', remove: '移除自', copied: '已複製',
        outside: '你似乎不在地圖範圍內。', noGps: '無法取得位置。', noRoutes: '暫未有路線。可用編輯模式 › 繪畫路線建立。',
        min: '分鐘', notPinned: '尚未標示', webgl: '你的瀏覽器無法啟動 3D（WebGL）。', you: '你',
        guess: '位置係估計，未經確認。如有錯漏，可用編輯模式修正。', photo: '航拍相片' },
};
const tt = (k) => T[getLang()][k] ?? k;
const ICON = {
  reset: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  top: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  north: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2l4 10h-8z" fill="#dc2626"/><path d="M12 22l-4-10h8z" fill="currentColor" opacity=".5"/></svg>',
  locate: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  layers: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/></svg>',
  routes: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="6" cy="19" r="2.5" fill="currentColor"/><circle cx="18" cy="5" r="2.5" fill="currentColor"/><path d="M6 16.5V12a3 3 0 0 1 3-3h6a3 3 0 0 0 3-3V7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

let S = null; // persistent state across mounts

export async function mount(container, { params }) {
  if (!S) S = await init();
  S.params = params;
  S.places = S.places || structuredClone(await loadPlaces());
  S.routes = S.routes || (await loadRoutes()).routes || [];
  container.innerHTML = '';
  container.appendChild(S.wrap);
  if (!S.renderer) return;
  buildUI();
  resize();
  S.running = true;
  S.renderer.setAnimationLoop(frame);
  await S.ready;
  splitBuildings();
  makeAreas();
  makePins();
  applyParams();
}
export function unmount() {
  if (!S) return;
  S.running = false;
  S.renderer.setAnimationLoop(null);
  S.wrap.remove();
}

/* ---------------- init (once) ---------------- */
async function init() {
  const wrap = document.createElement('div');
  wrap.className = 'map-wrap';
  wrap.innerHTML = `<div class="map-loading"><div class="box"><b data-t="loading"></b><div class="bar"><i></i></div><small class="pct">0%</small></div></div><div class="labels area-labels"></div><div class="labels pin-labels"></div>`;
  const s = { wrap, labels: wrap.querySelector('.pin-labels'), areaLabels: wrap.querySelector('.area-labels'), pins: [], selected: null, edit: false, drawing: null, highlightCache: new Map() };

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { wrap.querySelector('.box').innerHTML = tt('webgl'); s.ready = Promise.resolve(); return s; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  wrap.prepend(renderer.domElement);
  s.renderer = renderer;

  const scene = new THREE.Scene();
  s.scene = scene;
  const camera = new THREE.PerspectiveCamera(45, 1, 2, 8000);
  s.camera = camera;
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.46; controls.minDistance = 25; controls.maxDistance = 1800;
  controls.zoomToCursor = true; controls.screenSpacePanning = false;
  s.controls = controls;
  s.home = { pos: new THREE.Vector3(-110, 400, 210), target: new THREE.Vector3(-100, 75, -130) };
  if (innerWidth < innerHeight) s.home.pos = s.home.target.clone().add(s.home.pos.clone().sub(s.home.target).multiplyScalar(1.7));
  camera.position.copy(s.home.pos); controls.target.copy(s.home.target);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f7a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-300, 600, 250); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshBasicMaterial({ color: 0x5d6b52 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2; scene.add(ground); s.ground = ground;
  setSky(s);
  window.addEventListener('gps-theme', () => setSky(s));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setSky(s));

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const bar = wrap.querySelector('.bar i'), pct = wrap.querySelector('.pct');
  s.ready = Promise.all([
    new Promise((res, rej) => loader.load('assets/model/hku.glb', res, (e) => {
      if (e.total) { const p = Math.min(100, Math.round((e.loaded / e.total) * 100)); bar.style.width = p + '%'; pct.textContent = p + '%'; }
      else pct.textContent = (e.loaded / 1e6).toFixed(1) + ' MB';
    }, rej)),
    fetch('assets/model/buildings.json').then((r) => r.json()),
    fetch('data/campus.json').then((r) => r.json()).catch(() => null),
    loadOverlay(),
  ]).then(([gltf, bjson, campus]) => {
    s.campus = campus;
    setHills(campus?.hills);
    s.bmeta = bjson.map(([id, x, z, base, top]) => ({ id, x, z, base, top }));
    s.bidByCode = new Map(s.bmeta.map((b, i) => [b.id, i]));
    const root = gltf.scene;
    s.pickables = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name || o.parent?.name || '';
      if (n.startsWith('terrain')) {
        const map = o.material.map; if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
        o.material = terrainMaterial(map);
        o.material.polygonOffset = true; o.material.polygonOffsetFactor = 1; o.material.polygonOffsetUnits = 4; // roads draped on top win near-ties
        s.terrain = (s.terrain || []).concat(o);
      } else if (n.startsWith('buildings')) {
        o.material = new THREE.MeshLambertMaterial({ color: 0xf1eee8, flatShading: true });
        s.buildings = o;
        s.bIndexAll = o.geometry.index.array;
      } else {
        o.material = infraMaterial();
        s.infra = o;
      }
      s.pickables.push(o);
    });
    // non-HKU buildings: see-through decoration, not clickable (except in edit mode).
    // Child of the buildings mesh so it shares its (dequantizing) transform.
    const bg = s.buildings.geometry;
    s.deco = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ color: 0xf1eee8, flatShading: true, transparent: true, opacity: DECO_OPACITY, depthWrite: false }));
    for (const k of ['position', 'normal', '_bid']) if (bg.attributes[k]) s.deco.geometry.setAttribute(k, bg.attributes[k]);
    s.deco.renderOrder = 1;
    s.buildings.add(s.deco);
    s.pickables.push(s.deco);
    scene.add(root);
    root.updateMatrixWorld(true);
    makeExtraBuildings(s, campus?.extraBuildings || []);
    setTimeout(() => makeRoads(s), 0);
    const ld = wrap.querySelector('.map-loading');
    ld.style.opacity = 0; setTimeout(() => ld.remove(), 450);
  }).catch((e) => { console.error(e); pct.textContent = 'Error: ' + e.message; });

  // picking
  s.ray = new THREE.Raycaster();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 500) return;
    onClick(e);
  });
  new ResizeObserver(resize).observe(wrap);
  return s;
}

/* ---------------- terrain ----------------
   Default "map" style: the aerial photo is only used (heavily blurred) to tell
   greenery from paved ground; both are drawn as flat map colours with shaded
   relief and 10 m / 50 m contour lines that fade into mist with height.
   With the aerial-photo layer on, the photo shows except inside the 'hills'
   polygon (data/campus.json), which keeps the map style. */
const MAX_HILL_PTS = 32;
const TERRAIN_U = {
  uHill: { value: Array.from({ length: MAX_HILL_PTS }, () => new THREE.Vector2()) },
  uHillN: { value: 0 },
  uBase: { value: new THREE.Color(0xcfe0bf) },
  uLine: { value: new THREE.Color(0x5d7a63) },
  uMist: { value: new THREE.Color(0xcfe0e8) },
  uPaved: { value: new THREE.Color(0xf6f3ec) },
  uPhoto: { value: 0 },
  // land cover (data/landcover.json, surveyed) drawn into canvases: A = water colour layer, B.r = vegetation mask
  uOvA: { value: null },
  uOvB: { value: null },
  uOvExt: { value: new THREE.Vector4(0, 1, 0, 1) },
  uOvOn: { value: 0 },
};
let FEAT = null, LAND = null;
const isDark = () => { const root = document.documentElement; return root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
async function loadOverlay() {
  const get = (u) => fetch(u).then((r) => r.json()).catch((e) => (console.warn(u, e), null));
  [FEAT, LAND] = await Promise.all([get('data/mapfeatures.json'), get('data/landcover.json')]);
  if (LAND) { LAND.ext = [-750, 750, -305, 305]; drawMapFeatures(isDark()); }
}
/* Ground cover drawn into the terrain from the surveyed land cover: the vegetation mask (green relief +
   contours) and water. Roads and their markings are 3D geometry (roads.glb + data/roadmarks.json). */
const MAP_STYLE = {
  light: { waterEdge: '#7fb3cf', garden: '#b5e0a6', gardenEdge: '#7fbf72', water: '#a9cfe2', pavement: '#ebe7df', kerb: '#c8c1b4', tarmac: '#aeb3ba', tarmacMajor: '#a3a9b1',
           paint: '#ffffff', yellow: '#f2c230', walk: '#eadbc0', walkEdge: '#cfb48a', indoor: '#8b90a0', icon: '#1c7ed6' },
  dark: { waterEdge: '#3d6a84', garden: '#35593a', gardenEdge: '#4d7a52', water: '#29475a', pavement: '#3d413f', kerb: '#2a2d2c', tarmac: '#50555c', tarmacMajor: '#4a4f57',
          paint: '#d9dde2', yellow: '#c9a33a', walk: '#5a5144', walkEdge: '#6f634f', indoor: '#9aa0b0', icon: '#4dabf7' },
};
// shift a polyline sideways by d metres (positive = left of travel direction in map view)
function offsetLine(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], n = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / n) * d, p[1] + (dx / n) * d];
  });
}
function drawMapFeatures(dark) {
  if (!LAND) return;
  const [x0, x1, z0, z1] = LAND.ext;
  const RES = 0.75, RB = 1;   // kept small: large canvases crash mobile Safari
  const mk = (r) => Object.assign(document.createElement('canvas'), { width: Math.ceil((x1 - x0) / r), height: Math.ceil((z1 - z0) / r) });
  const A = LAND.canvasA || (LAND.canvasA = mk(RES)), B = LAND.canvasB || (LAND.canvasB = mk(RB));
  const a = A.getContext('2d'), b = B.getContext('2d'), st = MAP_STYLE[dark ? 'dark' : 'light'];
  a.setTransform(1, 0, 0, 1, 0, 0); b.setTransform(1, 0, 0, 1, 0, 0);
  a.clearRect(0, 0, A.width, A.height); b.clearRect(0, 0, B.width, B.height);
  // draw in metres: canvas units = model metres
  a.setTransform(1 / RES, 0, 0, 1 / RES, -x0 / RES, -z0 / RES); b.setTransform(1 / RB, 0, 0, 1 / RB, -x0 / RB, -z0 / RB);
  const path = (ctx, pts) => pts.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](x, z));
  const poly = (ctx, ar) => { ctx.beginPath(); for (const ring of [ar.outer, ...ar.holes]) { path(ctx, ring); ctx.closePath(); } };
  // vegetation feeds the green base (relief + contours); water is filled on top
  b.fillStyle = '#ff0000';
  for (const ar of LAND.green) { poly(b, ar); b.fill('evenodd'); }
  for (const ar of LAND.water) {
    poly(a, ar); a.fillStyle = st.water; a.fill('evenodd');
    a.strokeStyle = st.waterEdge; a.lineWidth = 0.5; a.stroke();
  }
  for (const [k, c] of [['uOvA', A], ['uOvB', B]]) {
    const t = TERRAIN_U[k].value || (TERRAIN_U[k].value = new THREE.CanvasTexture(c));
    t.flipY = false; t.colorSpace = k === 'uOvA' ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.needsUpdate = true;
  }
  TERRAIN_U.uOvExt.value.set(x0, x1, z0, z1); TERRAIN_U.uOvOn.value = 1;
}
function setHills(pts) {
  pts = (pts || []).slice(0, MAX_HILL_PTS);
  pts.forEach(([x, z], i) => TERRAIN_U.uHill.value[i].set(x, z));
  TERRAIN_U.uHillN.value = pts.length;
}
function terrainMaterial(map) {
  const m = new THREE.MeshBasicMaterial({ map });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, TERRAIN_U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorld;
uniform vec2 uHill[${MAX_HILL_PTS}];
uniform int uHillN;
uniform vec3 uBase, uLine, uMist, uPaved;
uniform float uPhoto, uOvOn;
uniform sampler2D uOvA, uOvB;
uniform vec4 uOvExt;
// signed distance to the hill polygon: > 0 inside
float hillDist(vec2 p) {
  float d = 1e9; bool inside = false;
  for (int i = 0; i < ${MAX_HILL_PTS}; i++) {
    if (i >= uHillN) break;
    vec2 a = uHill[i], b = uHill[i == 0 ? uHillN - 1 : i - 1];
    vec2 e = b - a, w = p - a;
    d = min(d, length(w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0)));
    if ((a.y > p.y) != (b.y > p.y) && p.x < e.x * (p.y - a.y) / e.y + a.x) inside = !inside;
  }
  return inside ? d : -d;
}
float contour(float h, float step) {
  float v = h / step;
  return 1.0 - clamp(abs(fract(v - 0.5) - 0.5) / fwidth(v), 0.0, 1.0);
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  float hill = uHillN > 2 ? smoothstep(0.0, 25.0, hillDist(vWorld.xz)) : 0.0;
  float k = max(1.0 - uPhoto, hill);
  vec4 oa = vec4(0.0), ob = vec4(0.0);
  float cov = 0.0;
  if (uOvOn > 0.5) {
    vec2 ouv = vec2((vWorld.x - uOvExt.x) / (uOvExt.y - uOvExt.x), (vWorld.z - uOvExt.z) / (uOvExt.w - uOvExt.z));
    if (ouv.x > 0.0 && ouv.x < 1.0 && ouv.y > 0.0 && ouv.y < 1.0) {
      oa = texture2D(uOvA, ouv); ob = texture2D(uOvB, ouv);
      cov = smoothstep(0.0, 0.03, min(min(ouv.x, 1.0 - ouv.x), min(ouv.y, 1.0 - ouv.y)));
      oa.a *= cov;
    }
  }
  if (k > 0.0) {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (n.y < 0.0) n = -n;
    float shade = clamp(dot(n, normalize(vec3(-0.5, 0.8, -0.35))), 0.0, 1.0);
    vec3 blur = texture2D(map, vMapUv, 3.5).rgb;
    float green = smoothstep(0.0, 0.05, blur.g - max(blur.r, blur.b) * 0.97);
    green = mix(green, ob.r, cov);   // surveyed vegetation where covered
    green = green * (1.0 - hill) + hill * mix(1.0, ob.r, cov);
    vec3 col = mix(uPaved, uBase, green) * (0.86 + 0.18 * shade) * (0.94 + 0.12 * smoothstep(40.0, 300.0, vWorld.y));
    col = mix(col, uLine, (contour(vWorld.y, 10.0) * 0.4 + contour(vWorld.y, 50.0) * 0.75) * mix(0.35, 1.0, green));
    col = mix(col, uMist, smoothstep(140.0, 420.0, vWorld.y) * 0.55 * green);
    // drawn map features: gardens, water, roads, footpaths
    col = mix(col, oa.rgb * (0.93 + 0.1 * shade), oa.a);
    diffuseColor.rgb = mix(diffuseColor.rgb, col, k);
  }
  // with the aerial photo on, the drawn features sit on top of it
  diffuseColor.rgb = mix(diffuseColor.rgb, oa.rgb, oa.a * 0.85 * (1.0 - k));
}`);
  };
  return m;
}

function setSky(s) {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const c = new THREE.Color(dark ? 0x1a2420 : 0xcfe0e8);
  s.scene.background = c;
  s.scene.fog = new THREE.Fog(c, 1200, 3800);
  const photo = TERRAIN_U.uPhoto.value;
  s.ground?.material.color.set(photo ? (dark ? 0x26302a : 0x6d7a62) : (dark ? 0x1d2b35 : 0xb9d3e0));
  TERRAIN_U.uBase.value.set(dark ? 0x2c3d30 : 0xcfe0bf);
  TERRAIN_U.uLine.value.set(dark ? 0x8fb39a : 0x5d7a63);
  TERRAIN_U.uMist.value.copy(c);
  TERRAIN_U.uPaved.value.set(dark ? 0x3a3f3c : 0xf6f3ec);
  drawMapFeatures(dark);
  s.roads?.userData.setTheme(dark);
  ROAD_MAT.color.set(dark ? 0x4d535b : 0xa7acb3);
  BRIDGE_MAT.color.set(dark ? 0x7a7d7b : 0xd9d5cc);
  setTreeTheme(s, dark);
  INFRA_U.uDeck.value.set(dark ? 0x50565e : 0xa3a9b1); INFRA_U.uSide.value.set(dark ? 0x5a5e5c : 0xd6d1c7);
}

function resize() {
  if (!S?.renderer) return;
  const r = S.wrap.getBoundingClientRect();
  if (!r.width) return;
  S.renderer.setSize(r.width, r.height, false);
  S.camera.aspect = r.width / r.height; S.camera.updateProjectionMatrix();
}

/* ---------------- UI ---------------- */
function buildUI() {
  S.wrap.querySelectorAll('.map-ui').forEach((n) => n.remove());
  S.wrap.querySelectorAll('[data-t]').forEach((n) => (n.textContent = tt(n.dataset.t)));
  const ui = (cls, html) => { const d = document.createElement('div'); d.className = 'map-ui ' + cls; d.innerHTML = html; S.wrap.appendChild(d); return d; };

  // search
  const search = ui('map-search', `<div class="field"><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="search" placeholder="${tt('find')}"></div><div class="list" hidden></div>`);
  const input = search.querySelector('input'), list = search.querySelector('.list');
  const showList = () => {
    const q = input.value.trim().toLowerCase();
    const items = (S.places?.places || []).filter((p) => !q || `${p.name.en} ${p.name.zh} ${p.no || ''}`.toLowerCase().includes(q))
      .sort((a, b) => isPinned(b) - isPinned(a));
    list.hidden = false;
    list.innerHTML = items.slice(0, 40).map((p) => `<button data-id="${p.id}" class="${isPinned(p) ? '' : 'unpinned'}"><i class="dot" style="background:${S.places.categories[p.cat]?.color}"></i>${esc(L(p.name))}<small>${isPinned(p) ? (p.no ? '#' + p.no : '') : tt('notPinned')}</small></button>`).join('');
  };
  input.addEventListener('focus', showList); input.addEventListener('input', showList);
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    list.hidden = true; input.value = ''; input.blur();
    const p = S.places.places.find((x) => x.id === b.dataset.id);
    if (isPinned(p)) selectPlace(p, true);
    else location.hash = href('buildings', { b: p.id });
  });
  S.wrap.addEventListener('pointerdown', (e) => { if (!e.target.closest('.map-search')) list.hidden = true; });

  // tools
  const tools = ui('map-tools', `
    <button class="compass" data-a="north" title="${tt('north')}">${ICON.north}</button>
    <button data-a="reset" title="${tt('reset')}">${ICON.reset}</button>
    <button data-a="top" title="${tt('top')}">${ICON.top}</button>
    <button data-a="locate" title="${tt('locate')}">${ICON.locate}</button>
    <button data-a="routes" title="${tt('routes')}">${ICON.routes}</button>
    <button data-a="layers" title="${tt('layers')}">${ICON.layers}</button>
    <button data-a="edit" title="${tt('edit')}" class="${S.edit ? 'on' : ''}">${ICON.edit}</button>`);
  S.compass = tools.querySelector('.compass svg');
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    ({ north: faceNorth, reset: () => flyTo(S.home.pos, S.home.target), top: toggleTop, locate, routes: toggleRoutes, layers: toggleLayers, edit: () => setEdit(!S.edit) })[b.dataset.a]();
  });

  const cats = S.places?.categories || {};
  S.hiddenCats = S.hiddenCats || new Set();
  S.legend = ui('map-legend', `<label><input type="checkbox" data-photo ${TERRAIN_U.uPhoto.value ? 'checked' : ''}>🛰 ${tt('photo')}</label><hr>` + Object.entries(cats).map(([k, c]) => `<label><input type="checkbox" data-cat="${k}" ${S.hiddenCats.has(k) ? '' : 'checked'}><i class="dot" style="background:${c.color}"></i>${esc(L(c))}</label>`).join(''));
  S.legend.hidden = true;
  S.legend.addEventListener('change', (e) => {
    if ('photo' in e.target.dataset) { TERRAIN_U.uPhoto.value = e.target.checked ? 1 : 0; setSky(S); return; }
    const k = e.target.dataset.cat; e.target.checked ? S.hiddenCats.delete(k) : S.hiddenCats.add(k); makePins(); });

  ui('map-credit', '3D Spatial Data © Lands Department, HKSAR · Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors');
  S.info = null; S.editBar = null; S.routePanel = null;
  if (S.edit) setEdit(true);
}

function toggleLayers() { S.legend.hidden = !S.legend.hidden; S.legend.classList.toggle('show', !S.legend.hidden); }

/* ---------------- campus areas ---------------- */
function makeAreas() {
  const areas = S.campus?.areas || [];
  if (!S.areaLines) {
    S.areaLines = new THREE.Group();
    for (const a of areas) {
      const pts = [];
      a.boundary.forEach((p, i) => {
        const q = a.boundary[(i + 1) % a.boundary.length];
        const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 4));
        for (let k = 0; k < n; k++) {
          const x = p[0] + ((q[0] - p[0]) * k) / n, z = p[1] + ((q[1] - p[1]) * k) / n;
          pts.push(new THREE.Vector3(x, (groundHeight(x, z, S.terrain) ?? 60) + 1.5, z));
        }
      });
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: 0x0f5132, dashSize: 6, gapSize: 4, transparent: true, opacity: 0.45 }));
      line.computeLineDistances(); line.renderOrder = 2;
      S.areaLines.add(line);
    }
    S.scene.add(S.areaLines);
  }
  S.areaLabels.innerHTML = '';
  S.areas = areas.map((a) => {
    const [x, z] = a.label;
    const el = document.createElement('div');
    el.className = 'area-label';
    el.innerHTML = `${esc(L(a.name))}<small>${esc(getLang() === 'zh' ? a.name.en : a.name.zh)}</small>`;
    S.areaLabels.appendChild(el);
    return { el, pos: new THREE.Vector3(x, (groundHeight(x, z, S.terrain) ?? 60) + 40, z) };
  });
}

/* ---------------- pins ---------------- */
function placeAnchor(p) {
  if (p.at) {
    const [x, z] = p.at;
    return new THREE.Vector3(x, (groundHeight(x, z, S.terrain) ?? 80) + 6, z);
  }
  const bs = p.buildings.map((c) => S.bmeta[S.bidByCode.get(c)]).filter(Boolean);
  if (!bs.length) return null;
  const v = new THREE.Vector3();
  bs.forEach((b) => v.add(new THREE.Vector3(b.x, 0, b.z)));
  v.divideScalar(bs.length);
  v.y = Math.max(...bs.map((b) => b.top)) + 4;
  return v;
}
function makePins() {
  if (!S.places || !S.bmeta) return;
  S.labels.innerHTML = ''; S.pins = [];
  for (const p of S.places.places) {
    if (S.hiddenCats?.has(p.cat)) continue;
    const pos = placeAnchor(p); if (!pos) continue;
    const el = document.createElement('div');
    el.className = 'pin' + (p.cat === 'landmark' || p.cat === 'transport' ? '' : ' small') + (S.selected?.place?.id === p.id ? ' active' : '');
    el.innerHTML = `<span><i class="dot" style="background:${S.places.categories[p.cat]?.color}"></i>${esc(L(p.name))}</span><i></i>`;
    el.addEventListener('click', () => selectPlace(p, true));
    S.labels.appendChild(el);
    S.pins.push({ el, pos, place: p });
  }
}
const _v = new THREE.Vector3();
function updatePins() {
  const w = S.wrap.clientWidth, h = S.wrap.clientHeight;
  for (const a of S.areas || []) {
    _v.copy(a.pos).project(S.camera);
    const vis = _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2;
    a.el.style.display = vis ? '' : 'none';
    if (vis) a.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
  }
  const camPos = S.camera.position;
  const sorted = S.pins.map((p) => ({ p, d: camPos.distanceTo(p.pos) })).sort((a, b) => a.d - b.d);
  const placed = [];
  for (const { p, d } of sorted) {
    _v.copy(p.pos).project(S.camera);
    const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
    let vis = _v.z < 1 && x > -50 && x < w + 50 && y > -20 && y < h + 40 && d < 2200;
    const active = S.selected?.place?.id === p.place.id;
    if (vis && !active) { // declutter
      const r = { x: x - 60, y: y - 30, w: 120, h: 26 };
      if (placed.some((q) => !(r.x + r.w < q.x || q.x + q.w < r.x || r.y + r.h < q.y || q.y + q.h < r.y))) vis = false;
      else placed.push(r);
    }
    p.el.style.display = vis || active ? '' : 'none';
    if (vis || active) { p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`; p.el.style.zIndex = active ? 999 : Math.round(1000 - d / 3); }
  }
  if (S.me) {
    _v.copy(S.me.pos).project(S.camera);
    S.me.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
  }
}

/* Flyovers, footbridges, lamp posts (3D infrastructure): road decks are drawn as tarmac with a
   white edge line, sides and piers as concrete. */
const INFRA_U = { uDeck: { value: new THREE.Color(0xa3a9b1) }, uSide: { value: new THREE.Color(0xd6d1c7) }, uEdge: { value: new THREE.Color(0xffffff) } };
function infraMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, INFRA_U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;\nuniform vec3 uDeck, uSide, uEdge;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec3 nW = normalize(cross(dFdx(vW), dFdy(vW)));
  float up = abs(nW.y);
  diffuseColor.rgb = mix(uSide, uDeck, smoothstep(0.85, 0.95, up));`);
  };
  return m;
}

/* ---------------- roads, footpaths, street lamps ---------------- */
/* Surveyed surfaces from the high-quality 3D data (tools/build_surfaces.mjs): photo-textured road
   surfaces, flyovers and footbridges (roads.glb), and ground surfaces such as pavements, plazas,
   courts and water (ground.glb). They replace the plain infrastructure mesh. */
/* Surveyed road surfaces and bridges (roads.glb, geometry only - tools/build_surfaces.mjs). The road
   mesh is the grey base; markings from data/roadnet.json are painted onto it (roads.js). */
// flyovers and footbridges: plain concrete, shaded like the buildings (the road surface on a flyover
// deck is part of the road mesh, so the structure itself is never drawn as tarmac)
const BRIDGE_MAT = new THREE.MeshLambertMaterial({ color: 0xd9d5cc, flatShading: true });
const ROAD_MAT = new THREE.MeshBasicMaterial({ color: 0xa7acb3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
async function loadSurfaces(s) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const roads = await loader.loadAsync('assets/model/roads.glb').catch((e) => (console.warn('roads.glb', e), null));
  if (!roads) return;
  s.roadMeshes = [];
  roads.scene.traverse((o) => {
    if (!o.isMesh) return;
    const bridge = /bridge/i.test(o.name || o.parent?.name || '');
    o.material = bridge ? BRIDGE_MAT : ROAD_MAT;
    o.renderOrder = bridge ? 0 : 2;
    s.roadMeshes.push(o);
  });
  s.roads3d = roads.scene;
  s.scene.add(s.roads3d);
  if (s.infra) s.infra.visible = false;
  s.scene.updateMatrixWorld(true);
}

// per-tree colours are tints; the material colour sets the overall tone (night: darker, cooler)
function setTreeTheme(s, dark) {
  if (!s.trees) return;
  const [crown, trunk] = s.trees.children;
  crown.material.color.set(dark ? 0x5d7c6a : 0xffffff);
  trunk.material.color.set(dark ? 0x4a4038 : 0x8a7462);
}
/* Trees from the surveyed canopy (data/landcover.json): one instanced trunk + crown per tree. */
function makeTrees(s) {
  if (!LAND?.trees?.length) return;
  const trees = LAND.trees.filter((t) => t[3] >= 3);
  const crownGeo = new THREE.IcosahedronGeometry(1, 0), trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 5).translate(0, 0.5, 0);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), trees.length);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x8a7462 }), trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), e = new THREE.Euler();
  trees.forEach(([x, z, y, h, r], i) => {
    const ch = Math.min(h * 0.55, r * 1.6), cy = y + h - ch / 2;
    const k = ((x * 73.1 + z * 31.7) % 1 + 1) % 1;               // stable per-tree variation
    q.setFromEuler(e.set(0, k * 6.28, 0));
    crown.setMatrixAt(i, m.compose(new THREE.Vector3(x, cy, z), q, new THREE.Vector3(r, ch / 2, r)));
    trunk.setMatrixAt(i, m.compose(new THREE.Vector3(x, y - 0.3, z), q, new THREE.Vector3(1, Math.max(0.5, h - ch + 0.6), 1)));
    crown.setColorAt(i, c.setHSL(0.27 + k * 0.06, 0.32 + k * 0.12, 0.36 + k * 0.08));
  });
  crown.name = 'trees'; trunk.name = 'trunks';
  s.trees = new THREE.Group(); s.trees.add(crown, trunk); s.scene.add(s.trees);
  setTreeTheme(s, isDark());
}

async function makeRoads(s) {
  if (!FEAT) return;
  try {
    await loadSurfaces(s);
    const t0 = performance.now();
    const bridges = (s.roadMeshes || []).filter((m) => m.material === BRIDGE_MAT);
    const deckMeshes = bridges.length ? bridges : s.infra ? [s.infra] : [];
    const ground = heightIndex(s.terrain), deck = deckMeshes.length ? heightIndex(deckMeshes, { upOnly: true }) : () => NaN;
    const bIdx = heightIndex([s.buildings]);
    const lampGeo = await loadLampGeometry('assets/model/streetlamp.json').catch(() => null);
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    makeTrees(s);
    const NET = await fetch('data/roadnet.json').then((r) => r.json()).catch(() => null);
    const surface = s.roadMeshes ? heightIndex(s.roadMeshes, { upOnly: true }) : null;
    const feat = NET && surface ? { ...FEAT, roads: NET.roads, marks: { ...NET.marks, icons: FEAT.marks?.icons || [] } } : FEAT;
    s.roads = buildRoads({ FEAT: feat, ground, deck, building: bIdx, lampGeo, dark, surface: NET ? surface : null });
    s.scene.add(s.roads);
    console.info(`roads built in ${Math.round(performance.now() - t0)} ms, ${s.roads.userData.lampCount} street lamps`);
  } catch (e) { console.warn('roads not built', e); }
}

/* ---------------- extra buildings ----------------
   Buildings missing from the 3D data (campus.json 'extraBuildings', footprints
   from OpenStreetMap) are extruded from the ground and get bids after the model's. */
function makeExtraBuildings(s, list) {
  s.extras = [];
  const mat = new THREE.MeshLambertMaterial({ color: 0xf1eee8, flatShading: true });
  for (const e of list) {
    const ground = Math.min(...e.footprint.map(([x, z]) => groundHeightIn(s, x, z) ?? 80));
    const shape = new THREE.Shape(e.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: e.height + 3, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); geo.translate(0, ground - 3, 0);
    const mesh = new THREE.Mesh(geo, mat);
    const bid = s.bmeta.length;
    const cx = e.footprint.reduce((a, p) => a + p[0], 0) / e.footprint.length, cz = e.footprint.reduce((a, p) => a + p[1], 0) / e.footprint.length;
    s.bmeta.push({ id: e.id, x: cx, z: cz, base: ground, top: ground + e.height, extra: mesh });
    s.bidByCode.set(e.id, bid);
    mesh.userData.bid = bid;
    s.scene.add(mesh); s.pickables.push(mesh); s.extras.push(mesh);
  }
}
function groundHeightIn(s, x, z) {
  s.ray = s.ray || new THREE.Raycaster();
  s.ray.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
  const hit = s.ray.intersectObjects(s.terrain || [], false)[0];
  return hit ? hit.point.y : null;
}

/* ---------------- selection ---------------- */
// HKU buildings (inside data/campus.json's boundary, or tagged in places.json) stay solid; the rest go to the transparent deco mesh.
function insidePoly(x, z, poly) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[j];
    if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) r = !r;
  }
  return r;
}
function splitBuildings() {
  if (!S.buildings) return;
  const bidAttr = S.buildings.geometry.attributes._bid, idx = S.bIndexAll, hku = [], deco = [];
  const c = S.campus || {}, polys = (c.areas || []).map((a) => a.boundary), exclude = new Set(c.exclude || []);
  const codes = new Set([...(c.include || []), ...S.places.places.filter((p) => p.hku !== false).flatMap((p) => p.buildings)]);
  const set = new Set();
  S.bmeta.forEach((b, i) => { if (codes.has(b.id) || (!exclude.has(b.id) && polys.some((poly) => insidePoly(b.x, b.z, poly)))) set.add(i); });
  for (let i = 0; i < idx.length; i += 3) (set.has(bidAttr.getX(idx[i])) ? hku : deco).push(idx[i], idx[i + 1], idx[i + 2]);
  S.buildings.geometry.setIndex(hku);
  S.deco.geometry.setIndex(deco);
  S.deco.geometry.computeBoundingSphere(); S.deco.geometry.computeBoundingBox();
}
const HL_MAT = new THREE.MeshLambertMaterial({ color: 0xf5b82e, flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
function highlight(bids) {
  if (S.hl) { S.hl.parent?.remove(S.hl); S.hl = null; }
  (S.hlx || []).forEach((m) => S.scene.remove(m)); S.hlx = [];
  for (const b of bids || []) {
    const ex = S.bmeta[b]?.extra;
    if (ex) { const m = new THREE.Mesh(ex.geometry, HL_MAT); S.scene.add(m); S.hlx.push(m); }
  }
  bids = (bids || []).filter((b) => !S.bmeta[b]?.extra);
  if (!bids.length || !S.buildings) return;
  const g = S.buildings.geometry;
  const key = bids.join(',');
  let geo = S.highlightCache.get(key);
  if (!geo) {
    const bidAttr = g.attributes._bid, idx = S.bIndexAll, set = new Set(bids), out = [];
    for (let i = 0; i < idx.length; i += 3) if (set.has(bidAttr.getX(idx[i]))) out.push(idx[i], idx[i + 1], idx[i + 2]);
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', g.attributes.position);
    geo.setIndex(out);
    S.highlightCache.set(key, geo);
  }
  S.hl = new THREE.Mesh(geo, HL_MAT);
  S.buildings.add(S.hl);
}
function selectPlace(p, fly) {
  const bids = p.buildings.map((c) => S.bidByCode.get(c)).filter((x) => x != null);
  S.selected = { place: p, bids };
  highlight(bids);
  S.pins.forEach((q) => q.el.classList.toggle('active', q.place.id === p.id));
  showInfo();
  if (fly) {
    const a = placeAnchor(p);
    if (a) {
      const span = Math.max(90, ...bids.map((i) => Math.hypot(S.bmeta[i].x - a.x, S.bmeta[i].z - a.z) * 2 + 60));
      const target = new THREE.Vector3(a.x, a.y - 15, a.z);
      const dir = S.camera.position.clone().sub(S.controls.target).setY(0).normalize();
      if (!isFinite(dir.x)) dir.set(0, 0, 1);
      const pos = target.clone().add(dir.multiplyScalar(span * 2.6)).add(new THREE.Vector3(0, span * 2.0, 0));
      flyTo(pos, target);
    }
  }
  setParam('place', p.id);
}
function selectBuilding(bid) {
  const code = S.bmeta[bid].id;
  // a building can belong to several places (e.g. a tower and its campus): pick the most specific
  const p = S.places.places.filter((x) => x.buildings.includes(code)).sort((a, b) => a.buildings.length - b.buildings.length)[0];
  if (p && !S.edit) return selectPlace(p, false);
  S.selected = { bid, place: p || null, bids: [bid] };
  highlight([bid]);
  S.pins.forEach((q) => q.el.classList.toggle('active', false));
  showInfo();
  setParam('place', null);
}
function clearSelection() {
  S.selected = null; highlight(null);
  S.pins.forEach((q) => q.el.classList.remove('active'));
  S.info?.remove(); S.info = null;
  setParam('place', null);
}
function showInfo() {
  S.info?.remove();
  const d = document.createElement('div');
  d.className = 'map-ui map-info';
  const sel = S.selected;
  const p = sel.place;
  const bm = sel.bids.map((i) => S.bmeta[i]);
  const hgt = bm.length ? Math.round(Math.max(...bm.map((b) => b.top - b.base))) : null;
  const cat = p && S.places.categories[p.cat];
  let html = `<button class="icon-btn close">${ICON.close}</button>`;
  if (p && (!S.edit || sel.bid == null)) {
    html += `<h3>${esc(L(p.name))}</h3><div class="sub"><i class="dot" style="background:${cat?.color}"></i>${esc(L(cat))}${p.no ? ` · #${esc(p.no)}` : ''}${hgt ? ` · ${tt('height')} ≈ ${hgt} m` : ''}</div>
      ${L(p.desc) ? `<p>${esc(L(p.desc))}</p>` : '<p></p>'}${p.guess ? `<p class="guess">⚠︎ ${tt('guess')}</p>` : ''}
      <div class="acts"><a class="btn primary" href="${href('buildings', { b: p.id })}">${tt('guide')}</a>${p.floors?.length ? `<a class="btn" href="${href('buildings', { b: p.id })}">🗺 ${tt('floorPlans')} (${p.floors.length})</a>` : ''}</div>`;
  } else {
    const b = S.bmeta[sel.bid];
    html += `<h3>${p ? esc(L(p.name)) : tt('unnamed')}</h3><div class="sub">${tt('height')} ≈ ${hgt} m · ${Math.round(b.base)}–${Math.round(b.top)} mPD</div>`;
    if (S.edit) {
      html += `<p><code>${b.id}</code></p><label style="font-size:13px">${tt('assign')}</label><select>${`<option value="">${tt('choose')}</option>` +
        S.places.places.map((x) => `<option value="${x.id}" ${x.buildings.includes(b.id) ? 'selected' : ''}>${esc(L(x.name))}${x.buildings.includes(b.id) ? ' ✓' : ''}</option>`).join('')}</select>
        <div class="acts"><button class="btn" data-copy="${b.id}">Copy ID</button>${p ? `<button class="btn" data-remove="${p.id}">${tt('remove')} ${esc(L(p.name))}</button>` : ''}</div>`;
    } else {
      html += `<p></p><div class="acts"><a class="btn" href="${href('contribute')}">${tt('help')}</a></div>`;
    }
  }
  d.innerHTML = html;
  d.querySelector('.close').addEventListener('click', clearSelection);
  d.querySelector('select')?.addEventListener('change', (e) => {
    const target = S.places.places.find((x) => x.id === e.target.value); if (!target) return;
    const code = S.bmeta[sel.bid].id;
    if (!target.buildings.includes(code)) target.buildings.push(code);
    S.dirty = true; splitBuildings(); makePins(); selectBuilding(sel.bid); updateEditBar();
  });
  d.querySelector('[data-remove]')?.addEventListener('click', (e) => {
    const target = S.places.places.find((x) => x.id === e.target.dataset.remove);
    target.buildings = target.buildings.filter((c) => c !== S.bmeta[sel.bid].id);
    S.dirty = true; splitBuildings(); makePins(); selectBuilding(sel.bid); updateEditBar();
  });
  d.querySelector('[data-copy]')?.addEventListener('click', (e) => copy(e.target.dataset.copy));
  S.wrap.appendChild(d);
  S.info = d;
}

/* ---------------- click ---------------- */
const _ndc = new THREE.Vector2();
function onClick(e) {
  if (!S.pickables) return;
  const r = S.renderer.domElement.getBoundingClientRect();
  _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  S.ray.setFromCamera(_ndc, S.camera);
  const hits = S.ray.intersectObjects(S.pickables, false);
  if (S.drawing) { if (hits[0]) addRoutePoint(hits[0].point); return; }
  // decorative buildings only react in edit mode (so they can still be tagged)
  const hit = S.edit ? hits[0] : hits.find((h) => h.object !== S.deco);
  if (!S.edit && hits[0]?.object === S.deco && hit?.object !== S.buildings) return;
  if (!hit) return clearSelection();
  if (hit.object === S.buildings || hit.object === S.deco) {
    const bid = S.buildings.geometry.attributes._bid.getX(hit.face.a);
    selectBuilding(bid);
  } else if (hit.object.userData.bid != null) selectBuilding(hit.object.userData.bid);
  else if (!S.edit) clearSelection();
}

/* ---------------- camera ---------------- */
function flyTo(pos, target, dur = 1100) {
  const p0 = S.camera.position.clone(), t0 = S.controls.target.clone(), start = performance.now();
  S.anim = (now) => {
    let k = Math.min(1, (now - start) / dur); k = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    S.camera.position.lerpVectors(p0, pos, k); S.controls.target.lerpVectors(t0, target, k);
    if (k >= 1) S.anim = null;
  };
}
function faceNorth() {
  const tg = S.controls.target, off = S.camera.position.clone().sub(tg);
  const horiz = Math.hypot(off.x, off.z);
  flyTo(new THREE.Vector3(tg.x, S.camera.position.y, tg.z + horiz), tg.clone(), 700);
}
function toggleTop() {
  const tg = S.controls.target.clone(), dist = S.camera.position.distanceTo(tg);
  const isTop = S.controls.getPolarAngle() < 0.2;
  if (isTop) {
    const az = S.controls.getAzimuthalAngle(), pol = 0.9;
    flyTo(new THREE.Vector3(tg.x + dist * Math.sin(pol) * Math.sin(az), tg.y + dist * Math.cos(pol), tg.z + dist * Math.sin(pol) * Math.cos(az)), tg, 800);
  } else {
    flyTo(new THREE.Vector3(tg.x, tg.y + dist, tg.z + 0.01), tg, 800);
  }
}

/* ---------------- GPS ---------------- */
export function wgs84ToModel(lat, lon) {
  // Local affine fit of WGS84 → HK1980 Grid (EPSG:2326) around HKU; error < 5 cm within ~1 km.
  const dl = lon - 114.137, dp = lat - 22.283;
  const E = 832158.706 + 103056.101 * dl + 29.1887 * dp;
  const N = 816013.806 - 27.1647 * dl + 110734.208 * dp;
  return { x: E - ORIGIN.E, z: -(N - ORIGIN.N) };
}
function locate() {
  if (!navigator.geolocation) return toast(tt('noGps'));
  navigator.geolocation.getCurrentPosition((pos) => {
    const { x, z } = wgs84ToModel(pos.coords.latitude, pos.coords.longitude);
    if (Math.abs(x) > 760 || z < -320 || z > 320) toast(tt('outside'));
    const y = groundHeight(x, z) ?? 60;
    if (!S.me) {
      const el = document.createElement('div');
      el.className = 'pin';
      el.innerHTML = `<span style="background:#2563eb;color:#fff;border-color:transparent">● ${tt('you')}</span><i></i>`;
      S.labels.appendChild(el);
      S.me = { el };
    }
    S.me.pos = new THREE.Vector3(x, y + 3, z);
    if (!S.me.el.isConnected) S.labels.appendChild(S.me.el);
    const tg = new THREE.Vector3(x, y, z);
    flyTo(tg.clone().add(new THREE.Vector3(0, 220, 200)), tg);
  }, () => toast(tt('noGps')), { enableHighAccuracy: true, timeout: 10000 });
}
function groundHeight(x, z, targets = S.pickables) {
  if (!targets) return null;
  S.ray.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
  const hit = S.ray.intersectObjects(targets, false)[0];
  return hit ? hit.point.y : null;
}

/* ---------------- routes ---------------- */
function toggleRoutes() {
  if (S.routePanel) { S.routePanel.remove(); S.routePanel = null; return; }
  const d = document.createElement('div');
  d.className = 'map-ui route-panel';
  const routes = S.routes || [];
  d.innerHTML = `<h4>${tt('routes')}</h4>` + (routes.length ? routes.map((r, i) => {
    const { len, climb } = routeStats(r.points);
    const mins = Math.max(1, Math.round(len / 75 + climb / 10)); // ~4.5 km/h + 1 min per 10 m climb
    return `<button class="r ${S.activeRoute === i ? 'on' : ''}" data-i="${i}"><b>${esc(L(r.name))}</b><br><small>${Math.round(len)} m · ↑${Math.round(climb)} m · ~${mins} ${tt('min')}</small></button>`;
  }).join('') : `<small>${tt('noRoutes')}</small>`);
  d.addEventListener('click', (e) => { const b = e.target.closest('button.r'); if (b) showRoute(+b.dataset.i, true); });
  S.wrap.appendChild(d); S.routePanel = d;
}
function routeStats(pts) {
  let len = 0, climb = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    len += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    climb += Math.max(0, b[1] - a[1]);
  }
  return { len, climb };
}
function routeMesh(pts, color = 0xe11d48) {
  if (pts.length < 2) return null;
  const v = pts.map((p) => new THREE.Vector3(p[0], p[1] + 1.5, p[2]));
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal', 0.2);
  const geo = new THREE.TubeGeometry(curve, Math.max(16, pts.length * 12), 1.6, 6, false);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
  m.renderOrder = 10;
  return m;
}
function showRoute(i, fly) {
  if (S.routeObj) { S.scene.remove(S.routeObj); S.routeObj = null; }
  S.activeRoute = S.activeRoute === i && fly ? null : i;
  S.routePanel?.querySelectorAll('button.r').forEach((b) => b.classList.toggle('on', +b.dataset.i === S.activeRoute));
  if (S.activeRoute == null) { setParam('route', null); return; }
  const r = S.routes[i];
  S.routeObj = routeMesh(r.points, new THREE.Color(r.color || '#e11d48'));
  if (S.routeObj) S.scene.add(S.routeObj);
  setParam('route', r.id);
  if (fly) {
    const box = new THREE.Box3().setFromPoints(r.points.map((p) => new THREE.Vector3(...p)));
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    flyTo(c.clone().add(new THREE.Vector3(0, size * 0.9 + 80, size * 0.7 + 60)), c);
  }
}
function addRoutePoint(p) {
  S.drawing.push([+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)]);
  redrawDraft();
}
function redrawDraft() {
  if (S.drawObj) S.scene.remove(S.drawObj);
  S.drawObj = routeMesh(S.drawing, 0x2563eb);
  if (S.drawObj) S.scene.add(S.drawObj);
  updateEditBar();
}

/* ---------------- edit mode ---------------- */
function setEdit(on) {
  S.edit = on;
  S.wrap.querySelector('[data-a="edit"]')?.classList.toggle('on', on);
  S.editBar?.remove(); S.editBar = null;
  if (!on) { S.drawing = null; if (S.drawObj) S.scene.remove(S.drawObj); S.drawObj = null; setParam('edit', null); if (S.selected) clearSelection(); return; }
  setParam('edit', '1');
  const d = document.createElement('div');
  d.className = 'map-ui map-edit-bar';
  S.wrap.appendChild(d); S.editBar = d;
  d.addEventListener('click', (e) => {
    const a = e.target.closest('[data-x]')?.dataset.x;
    if (a === 'export') download('places.json', JSON.stringify(S.places, null, 2));
    if (a === 'draw') { S.drawing = []; updateEditBar(); }
    if (a === 'undo') { S.drawing.pop(); redrawDraft(); }
    if (a === 'finish') {
      const { len } = routeStats(S.drawing);
      copy(JSON.stringify({ id: 'new-route', name: { en: 'New route', zh: '新路線' }, color: '#e11d48', length_m: Math.round(len), points: S.drawing }));
      S.drawing = null; if (S.drawObj) S.scene.remove(S.drawObj); S.drawObj = null; updateEditBar();
    }
  });
  updateEditBar();
}
function updateEditBar() {
  if (!S.editBar) return;
  if (S.drawing) {
    S.editBar.innerHTML = `<span>${tt('drawRoute')}: ${S.drawing.length} pts · ${Math.round(routeStats(S.drawing).len)} m</span><button class="btn" data-x="undo">${tt('undo')}</button><button class="btn" data-x="finish">${tt('finishRoute')}</button>`;
  } else {
    S.editBar.innerHTML = `<span>${tt('editBar')}</span><button class="btn" data-x="draw">${tt('drawRoute')}</button><button class="btn" data-x="export">${tt('exportPlaces')}${S.dirty ? ' •' : ''}</button>`;
  }
}

/* ---------------- helpers ---------------- */
function setParam(k, v) {
  const [base, qs] = location.hash.split('?');
  const p = new URLSearchParams(qs || '');
  v == null ? p.delete(k) : p.set(k, v);
  const nh = base + (p.toString() ? '?' + p : '');
  if (nh !== location.hash) history.replaceState(null, '', nh);
}
function applyParams() {
  const p = S.params;
  if (p.get('edit') === '1' && !S.edit) setEdit(true);
  const pl = p.get('place') && S.places.places.find((x) => x.id === p.get('place'));
  if (pl) selectPlace(pl, true);
  const r = p.get('route') && S.routes.findIndex((x) => x.id === p.get('route'));
  if (r != null && r >= 0) { toggleRoutes(); showRoute(r, true); }
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function copy(text) { navigator.clipboard?.writeText(text).then(() => toast(tt('copied')), () => prompt('Copy:', text)); }
function toast(msg) {
  const d = document.createElement('div');
  d.className = 'map-ui map-edit-bar'; d.style.top = 'auto'; d.style.bottom = '80px'; d.style.paddingRight = '16px';
  d.textContent = msg; S.wrap.appendChild(d); setTimeout(() => d.remove(), 2500);
}

/* ---------------- frame ---------------- */
function frame(now) {
  if (!S.running) return;
  if (S.anim) S.anim(now);
  S.controls.update();
  S.renderer.render(S.scene, S.camera);
  if (S.compass) S.compass.style.transform = `rotate(${(S.controls.getAzimuthalAngle() * 180) / Math.PI}deg)`;
  updatePins();
}
