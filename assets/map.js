import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { loadPlaces, loadRoutes, isPinned, L, href, esc, getLang, REPO } from './app.js';
import { heightIndex, buildRoads, loadLampGeometry } from './roads.js';
import { mountWeather } from './weather.js';
import { createIndoor, cutify } from './indoor.js';

/* Model frame: x = HK1980 Easting − 832250, z = −(Northing − 815900), y = height in mPD */
const ORIGIN = { E: 832250, N: 815900 };
const DECO_OPACITY = 0.18;
const T = {
  en: { loading: 'Loading 3D campus…', find: 'Find a building or place…', reset: 'Reset view', top: 'Top / 3D view', north: 'Face north',
        locate: 'My location (GPS)', layers: 'Change map layer', routes: 'Walking routes', edit: 'Edit mode', unnamed: 'Unlabelled building',
        height: 'Height', guide: 'Building guide', floorPlans: 'Floor plans', help: 'Know this building? Help label it',
        editBar: 'Edit mode — click a building to tag it', exportPlaces: 'Export places.json', drawRoute: 'Draw route', finishRoute: 'Copy route JSON',
        undo: 'Undo', assign: 'Assign this building to…', choose: '— choose a place —', remove: 'Remove from', copied: 'Copied to clipboard',
        outside: 'You appear to be outside the mapped area.', noGps: 'Location not available.', noRoutes: 'No routes yet. Use Edit mode › Draw route to create one.',
        min: 'min', notPinned: 'not on map yet', webgl: 'Your browser could not start 3D (WebGL).', you: 'You',
        guess: 'Approximate position, not yet confirmed. Know better? Fix it in Edit mode.', basemap: 'Map style', classic: 'Classic', hybrid: 'Classic + real buildings', real: 'Satellite', filter: 'Show / hide places' },
  zh: { loading: '正在載入 3D 校園…', find: '搜尋大樓或地點…', reset: '重設視角', top: '俯視 / 3D', north: '朝北',
        locate: '我的位置（GPS）', layers: '更換圖層', routes: '步行路線', edit: '編輯模式', unnamed: '未命名大樓',
        height: '高度', guide: '大樓指南', floorPlans: '平面圖', help: '認得這座大樓？幫手標示',
        editBar: '編輯模式 — 點選大樓以標示', exportPlaces: '匯出 places.json', drawRoute: '繪畫路線', finishRoute: '複製路線 JSON',
        undo: '復原', assign: '將此大樓標示為…', choose: '— 選擇地點 —', remove: '移除自', copied: '已複製',
        outside: '你似乎不在地圖範圍內。', noGps: '無法取得位置。', noRoutes: '暫未有路線。可用編輯模式 › 繪畫路線建立。',
        min: '分鐘', notPinned: '尚未標示', webgl: '你的瀏覽器無法啟動 3D（WebGL）。', you: '你',
        guess: '位置係估計，未經確認。如有錯漏，可用編輯模式修正。', basemap: '地圖樣式', classic: '經典', hybrid: '經典＋真實大樓', real: '衛星圖像', filter: '顯示／隱藏地點' },
};
const tt = (k) => T[getLang()][k] ?? k;
const ICON = {
  reset: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  top: '<b class="dim-label">2D</b>',
  north: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2l4 10h-8z" fill="#dc2626"/><path d="M12 22l-4-10h8z" fill="currentColor" opacity=".5"/></svg>',
  locate: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  filter: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/></svg>',
  layers: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
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
/* ---------------- map edge fade ----------------
   Every fogged material (all of them) fades into the fog / sky colour near the outer edge of the loaded
   tiles (data/tiles.json), via the shared fog shader chunks, so the map has no hard cut-off. Shared
   edges between adjacent tiles are pushed outwards so seams never fade: adding a tile to tiles.json
   (and the model) simply extends the map. */
function installEdgeFade(cfg) {
  const fade = cfg?.fade ?? 45, rects = (cfg?.tiles || []).map((t) => t.extent.slice());
  if (!rects.length) return;
  const touches = (a, b, axis, side) => {   // does rect b abut rect a on a's given edge?
    const eps = 2, [lo, hi] = axis === 'x' ? [2, 3] : [0, 1];
    const edge = axis === 'x' ? a[side ? 1 : 0] : a[side ? 3 : 2];
    const other = axis === 'x' ? b[side ? 0 : 1] : b[side ? 2 : 3];
    return Math.abs(edge - other) < eps && Math.min(a[hi], b[hi]) - Math.max(a[lo], b[lo]) > eps;
  };
  const grown = rects.map((a) => {
    const r = a.slice();
    rects.forEach((b) => {
      if (b === a) return;
      if (touches(a, b, 'x', 0)) r[0] -= fade * 2; if (touches(a, b, 'x', 1)) r[1] += fade * 2;
      if (touches(a, b, 'z', 0)) r[2] -= fade * 2; if (touches(a, b, 'z', 1)) r[3] += fade * 2;
    });
    return r;
  });
  const f = (v) => v.toFixed(2);
  const arr = grown.map((r) => `vec4(${f(r[0])}, ${f(r[1])}, ${f(r[2])}, ${f(r[3])})`).join(', ');
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex += `
#ifdef USE_FOG
varying vec3 vEdgeW;
#endif`;
  C.fog_vertex += `
#ifdef USE_FOG
{
  vec4 ew = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  ew = instanceMatrix * ew;
  #endif
  vEdgeW = (modelMatrix * ew).xyz;
}
#endif`;
  C.fog_pars_fragment += `
#ifdef USE_FOG
varying vec3 vEdgeW;
const vec4 EDGE_RECTS[${grown.length}] = vec4[](${arr});
float edgeDepth(vec2 p) {   // distance inside the union of tiles (negative outside)
  float d = -1e6;
  for (int i = 0; i < ${grown.length}; i++) {
    vec4 r = EDGE_RECTS[i];
    d = max(d, min(min(p.x - r.x, r.y - p.x), min(p.y - r.z, r.w - p.y)));
  }
  return d;
}
#endif`;
  C.fog_fragment += `
#ifdef USE_FOG
gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, smoothstep(0.0, ${f(fade)}, edgeDepth(vEdgeW.xz)));
#endif`;
}

async function init() {
  installEdgeFade(await fetch('data/tiles.json').then((r) => r.json()).catch(() => null));
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
  oneFingerZoom(renderer.domElement, camera, controls);
  controls.touches.TWO = null;   // two fingers: twoFingerGestures() below
  twoFingerGestures(wrap, s);
  // facing south, the way the HKU campus map is drawn (the hill behind, the harbour at your back)
  s.home = { pos: new THREE.Vector3(-90, 400, -400), target: new THREE.Vector3(-100, 80, -40) };
  if (innerWidth < innerHeight) s.home.pos = s.home.target.clone().add(s.home.pos.clone().sub(s.home.target).multiplyScalar(1.7));
  camera.position.copy(s.home.pos); controls.target.copy(s.home.target);

  s.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f7a, 1.6);
  s.sun = new THREE.DirectionalLight(0xffffff, 2.2);
  scene.add(s.hemi, s.sun, s.sun.target);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;   // re-rendered only when the view or the sun moves (fitShadow)
  s.sun.shadow.mapSize.set(2048, 2048);
  s.sun.shadow.bias = -0.0004; s.sun.shadow.normalBias = 0.4;
  updateSun(s);
  setInterval(() => updateSun(s), 60000);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshBasicMaterial({ color: 0x5d6b52 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2; scene.add(ground); s.ground = ground;
  setSky(s);
  window.addEventListener('gps-theme', () => setSky(s));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setSky(s));

  // indoor floor plans (floor selector, building cut open above the chosen floor)
  s.indoor = createIndoor(s);
  s.onIndoor = (fl) => {
    setParam('floor', fl ? fl.id : null);
    if (s.hl) s.hl.visible = !fl;   // the gold highlight would hide the plan
    (s.hlx || []).forEach((m) => (m.visible = !fl));
    // bring the floor into view (closer than the building overview), keeping the heading
    if (fl && fl._c) {
      const span = fl._c.size * (innerWidth < innerHeight ? 1.6 : 1), d = s.camera.position.distanceTo(s.controls.target);
      if (d > span * 2.4 || s.controls.target.distanceTo(fl._c.center) > span) flyTo(behind(fl._c.center, span * 1.25, span * 0.95), fl._c.center);
    }
  };

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
        o.material = shadowify(terrainMaterial(map), TERRAIN_SHADOW);
        o.material.polygonOffset = true; o.material.polygonOffsetFactor = 1; o.material.polygonOffsetUnits = 4; // roads draped on top win near-ties
        s.terrain = (s.terrain || []).concat(o);
      } else if (n.startsWith('buildings')) {
        o.material = cutify(new THREE.MeshLambertMaterial({ color: 0xf1eee8, flatShading: true }));
        o.castShadow = o.receiveShadow = true;
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
    s.deco = new THREE.Mesh(new THREE.BufferGeometry(), cutify(new THREE.MeshLambertMaterial({ color: 0xf1eee8, flatShading: true, transparent: true, opacity: DECO_OPACITY, depthWrite: false })));
    for (const k of ['position', 'normal', '_bid']) if (bg.attributes[k]) s.deco.geometry.setAttribute(k, bg.attributes[k]);
    s.deco.renderOrder = 1; s.deco.castShadow = true;
    s.buildings.add(s.deco);
    s.pickables.push(s.deco);
    scene.add(root);
    root.updateMatrixWorld(true);
    makeExtraBuildings(s, campus?.extraBuildings || []);
    s.shadowKey = null;   // redraw the shadow map with the buildings in it
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
  uSunDir: { value: new THREE.Vector3(-0.5, 0.8, -0.35).normalize() },   // relief shading follows the sun
  uReal: { value: 0 },   // real-imagery base map: photo everywhere, no drawn overlays
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
uniform vec3 uBase, uLine, uMist, uPaved, uSunDir;
uniform float uPhoto, uOvOn, uReal;
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
  float hill = uHillN > 2 && uReal < 0.5 ? smoothstep(0.0, 25.0, hillDist(vWorld.xz)) : 0.0;
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
    float shade = clamp(dot(n, uSunDir), 0.0, 1.0);
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
  diffuseColor.rgb = mix(diffuseColor.rgb, oa.rgb, oa.a * 0.85 * (1.0 - k) * (1.0 - uReal));
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
  s.indoor?.paint();
  INFRA_U.uDeck.value.set(dark ? 0x4d535b : 0xa7acb3); INFRA_U.uSide.value.set(dark ? 0x5a5e5c : 0xd6d1c7);
}

/* ---------------- sun ----------------
   The sun follows the real time at HKU: it lights the buildings and the relief from where it really is,
   and the buildings, bridges and trees cast small soft shadows. Near sunrise / sunset the light warms;
   at night it goes flat with no shadows. Clouds and rain (from the weather widget) soften the shadows.
   Unlit (MeshBasic) surfaces - drawn ground, roads, markings - get the shadow through shadowify(). */
const SHADOW_U = {
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uShadowDark: { value: 0.3 },
  uShadowTexel: { value: 1 / 2048 },
  uShadowCol: { value: new THREE.Color(0.62, 0.66, 0.76) },   // shade is a little blue
  uSunTint: { value: new THREE.Color(1, 1, 1) },
};
const TERRAIN_SHADOW = { value: 1 };
const ONE = { value: 1 };
function shadowify(m, k = ONE) {
  if (m.userData.shadowified) return m;
  m.userData.shadowified = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    Object.assign(sh.uniforms, SHADOW_U, { uShadowK: k });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 uShadowMatrix;\nvarying vec4 vShadowCoord;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
{ vec4 sw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  sw = instanceMatrix * sw;
#endif
  vShadowCoord = uShadowMatrix * (modelMatrix * sw); }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uShadowMap;
uniform float uShadowOn, uShadowDark, uShadowTexel, uShadowK;
uniform vec3 uShadowCol, uSunTint;
varying vec4 vShadowCoord;
float shDepth(vec2 uv) { return dot(texture2D(uShadowMap, uv), vec4(255.0 / 256.0 / vec3(1.0, 256.0, 65536.0), 1.0 / 16777216.0)); }
float sunLit() {
  vec3 c = vShadowCoord.xyz / vShadowCoord.w;
  if (uShadowOn < 0.5 || c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float z = c.z - 0.0003, lit = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) lit += step(z, shDepth(c.xy + vec2(float(i), float(j)) * uShadowTexel));
  vec2 e = min(c.xy, 1.0 - c.xy);
  return mix(1.0, lit / 9.0, smoothstep(0.0, 0.06, min(e.x, e.y)));   // fade out at the shadow map's edge
}`).replace('#include <opaque_fragment>', `#include <opaque_fragment>
gl_FragColor.rgb *= mix(vec3(1.0), mix(mix(vec3(1.0), uShadowCol, uShadowDark), uSunTint, sunLit()), uShadowK);`);
  };
  m.customProgramCacheKey = () => (prev ? prev.toString() : '') + '|shadow';
  m.needsUpdate = true;
  return m;
}
const HKU_LATLON = [22.283, 114.137];
// solar azimuth (from north, clockwise) and elevation, radians (low-precision almanac, ~0.1 degree)
export function sunPosition(date = new Date(), [lat, lon] = HKU_LATLON) {
  const rad = Math.PI / 180, d = date.getTime() / 86400000 - 10957.5;   // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, e = (23.439 - 3.6e-7 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const H = ((280.46061837 + 360.98564736629 * d + lon) % 360) * rad - ra, phi = lat * rad;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { az: (az + 2 * Math.PI) % (2 * Math.PI), el };
}
function updateSun(s) {
  const { az, el } = sunPosition(s.sunTime || new Date());
  const ss = THREE.MathUtils.smoothstep, deg = el / (Math.PI / 180);
  const day = ss(deg, -2, 8), low = 1 - ss(deg, 4, 30), clear = s.weatherClear ?? 1;
  const real = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  // light from at least 12 degrees up (long dawn shadows are mostly noise); at night a soft light from above
  const dir = deg > 12 ? real : new THREE.Vector3(real.x, 0, real.z).normalize().multiplyScalar(Math.cos(0.21)).setY(Math.sin(0.21));
  s.sunDir = day > 0 ? dir.lerp(new THREE.Vector3(-0.42, 0.83, 0.35).normalize(), 1 - day).normalize() : new THREE.Vector3(-0.42, 0.83, 0.35).normalize();
  s.sun.color.setRGB(1, 1 - 0.12 * low * day, 1 - 0.28 * low * day);
  s.sun.intensity = 1.2 + 1.2 * day * (0.6 + 0.4 * clear);
  s.hemi.intensity = 1.55 + 0.25 * (1 - clear * day);
  TERRAIN_U.uSunDir.value.copy(s.sunDir);
  const on = day > 0.05 && clear > 0.05;
  s.sun.castShadow = on;
  s.sun.shadow.intensity = 0.7 * day * clear;
  SHADOW_U.uShadowOn.value = on ? 1 : 0;
  SHADOW_U.uShadowDark.value = 0.8 * day * clear;
  SHADOW_U.uSunTint.value.setRGB(1, 1 - 0.05 * low * day, 1 - 0.13 * low * day);
  s.shadowKey = null;
}
// fit the sun's shadow camera around what is being looked at; redraw the shadow map only when it changes
function fitShadow(s) {
  if (!s.sun?.castShadow) return;
  const t = s.controls.target, dist = s.camera.position.distanceTo(t);
  const hs = 160 * Math.pow(2, Math.round(Math.log2(Math.min(1000, Math.max(160, dist * 1.15)) / 160) * 2) / 2);
  const snap = hs / 8, cx = Math.round(t.x / snap) * snap, cz = Math.round(t.z / snap) * snap;
  const key = `${cx},${cz},${hs}`;
  if (s.shadowKey === key && SHADOW_U.uShadowMap.value) return;
  s.shadowKey = key;
  const cam = s.sun.shadow.camera;
  s.sun.target.position.set(cx, 60, cz);
  s.sun.position.copy(s.sun.target.position).addScaledVector(s.sunDir, 1500);
  cam.left = cam.bottom = -hs; cam.right = cam.top = hs; cam.near = 500; cam.far = 2600;
  cam.updateProjectionMatrix();
  s.sun.updateMatrixWorld(); s.sun.target.updateMatrixWorld();
  s.renderer.shadowMap.needsUpdate = true;
  s.sun.shadow.updateMatrices(s.sun);
  SHADOW_U.uShadowMatrix.value.copy(s.sun.shadow.matrix);
  SHADOW_U.uShadowTexel.value = 1 / s.sun.shadow.mapSize.x;
  requestAnimationFrame(() => { SHADOW_U.uShadowMap.value = s.sun.shadow.map?.texture || null; });
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
  S.weather?.stop();
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
    <button data-a="layers" title="${tt('layers')}" class="${S.basemap && S.basemap !== 'classic' ? 'on' : ''}">${ICON.layers}</button>
    <button data-a="filter" title="${tt('filter')}">${ICON.filter}</button>
    <button data-a="edit" title="${tt('edit')}" class="${S.edit ? 'on' : ''}">${ICON.edit}</button>`);
  S.compass = tools.querySelector('.compass svg');
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    ({ north: faceNorth, reset: () => flyTo(S.home.pos, S.home.target), top: toggleTop, locate, routes: toggleRoutes, layers: cycleBasemap, filter: toggleLayers, edit: () => setEdit(!S.edit) })[b.dataset.a]();
  });

  const cats = S.places?.categories || {};
  S.hiddenCats = S.hiddenCats || new Set();
  S.legend = ui('map-legend', Object.entries(cats).map(([k, c]) => `<label><input type="checkbox" data-cat="${k}" ${S.hiddenCats.has(k) ? '' : 'checked'}><i class="dot" style="background:${c.color}"></i>${esc(L(c))}</label>`).join(''));
  S.legend.hidden = true;
  S.legend.addEventListener('change', (e) => {
    const k = e.target.dataset.cat; e.target.checked ? S.hiddenCats.delete(k) : S.hiddenCats.add(k); makePins(); });

  ui('map-credit', '3D Spatial Data © Lands Department, HKSAR · Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors');
  S.info = null; S.editBar = null; S.routePanel = null;
  // weather + HKO warnings (bottom left); cloud and rain soften the sun's shadows
  S.weather = mountWeather(S.wrap, { lang: getLang(), onSky: (clear) => { if (S.weatherClear !== clear) { S.weatherClear = clear; updateSun(S); } } });
  if (S.edit) setEdit(true);
}

// layers button: switch the base map, classic <-> satellite
// layers button: small menu of base maps
function cycleBasemap() {
  let m = S.wrap.querySelector('.basemap-menu');
  if (m) { m.remove(); return; }
  m = document.createElement('div');
  m.className = 'map-ui basemap-menu';
  m.innerHTML = `<b class="legend-h">${tt('basemap')}</b>` + ['classic', 'hybrid', 'real'].map((k) =>
    `<button data-basemap="${k}" class="${(S.basemap || 'classic') === k ? 'on' : ''}"><i class="bm-swatch bm-${k}"></i>${tt(k)}</button>`).join('');
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-basemap]'); if (!b) return;
    setBasemap(S, b.dataset.basemap); m.remove();
  });
  S.wrap.appendChild(m);
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

/* One-finger zoom (phones), as in Google / Apple Maps: double-tap and hold, then drag up to zoom in
   and down to zoom out; a plain double-tap zooms in. Runs in the capture phase so the map controls
   never see the second touch. */
function oneFingerZoom(el, camera, controls) {
  const touches = new Set();
  let lastTap = null, drag = null;
  const dist = () => camera.position.distanceTo(controls.target);
  const setDist = (d) => {
    d = Math.min(controls.maxDistance, Math.max(controls.minDistance, d));
    const off = camera.position.clone().sub(controls.target).setLength(d);
    camera.position.copy(controls.target).add(off);
    controls.update();
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touches.add(e.pointerId);
    if (touches.size > 1) { drag = null; return; }
    const now = performance.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
      drag = { id: e.pointerId, y: e.clientY, d0: dist(), moved: false };
      e.stopImmediatePropagation(); e.preventDefault();
      controls.enabled = false;
      el.setPointerCapture?.(e.pointerId);
    }
  }, { capture: true });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 6) drag.moved = true;
    setDist(drag.d0 * Math.exp(dy * 0.008));   // up = closer (zoom in), down = farther (zoom out)
    e.stopImmediatePropagation();
  }, { capture: true });
  const end = (e) => {
    if (e.pointerType !== 'touch') return;
    touches.delete(e.pointerId);
    if (drag && e.pointerId === drag.id) {
      if (!drag.moved) setDist(drag.d0 * 0.5);   // double-tap without dragging: zoom in
      drag = null; lastTap = null; controls.enabled = true;
      e.stopImmediatePropagation();
      return;
    }
    lastTap = { t: performance.now(), x: e.clientX, y: e.clientY };
  };
  el.addEventListener('pointerup', end, { capture: true });
  el.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); if (drag) { drag = null; controls.enabled = true; } }, { capture: true });
}

/* Two-finger gestures (phones), as in Google / Apple Maps: pinch zooms and twist rotates about the
   point between the fingers, and that point stays under them while they move (so they also pan); two
   fingers dragged up or down together tilt the view. Lifting one finger carries on as a one-finger pan.
   Every move is applied from the camera as it was when the gesture started (not step by step), so
   nothing drifts or shakes. Listens on the whole map (labels included) in the capture phase; while a
   two-finger gesture is on, the map controls never see the touches move. */
function twoFingerGestures(wrap, s) {
  const pts = new Map();
  let g = null, block = false;
  const Y = new THREE.Vector3(0, 1, 0), plane = new THREE.Plane(), ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  const cam = s.camera, c = s.controls;
  const aim = () => { cam.lookAt(c.target); cam.updateMatrixWorld(); };   // what controls.update() would do
  const at = (x, y, pick) => {
    const r = s.renderer.domElement.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    if (pick) { const h = ray.intersectObjects(s.pickables || [], false)[0]; if (h) return h.point.clone(); }
    return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null;
  };
  const two = () => {
    const [a, b] = [...pts.values()];
    return { a: { ...a }, b: { ...b }, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  };
  // ground point under the screen point (x, y); the gesture keeps it there
  const grab = (x, y) => {
    aim();
    plane.set(Y, -c.target.y);
    const P = at(x, y, true) || at(x, y, false) || c.target.clone();
    plane.set(Y, -P.y);
    return P;
  };
  const keepUnder = (P, x, y) => {
    aim();
    const Q = at(x, y, false);
    if (!Q || Q.distanceTo(P) > 3000) return;
    const dv = P.clone().sub(Q).setY(0);
    cam.position.add(dv); c.target.add(dv); aim();
  };
  const stopInertia = () => { c._sphericalDelta?.set(0, 0, 0); c._panOffset?.set(0, 0, 0); if ('_scale' in c) c._scale = 1; };
  const start = () => {
    stopInertia();
    const base = { pos0: cam.position.clone(), tgt0: c.target.clone() };
    if (pts.size === 2) {
      const t = two();
      g = { ...base, P: grab(t.mx, t.my), mode: null, t0: t, phi0: new THREE.Spherical().setFromVector3(cam.position.clone().sub(c.target)).phi };
    } else if (pts.size === 1 && block) {
      const [p] = pts.values();
      g = { ...base, P: grab(p.x, p.y), mode: 'pan' };
    } else g = null;
  };
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    if (e.isPrimary) { pts.clear(); block = false; g = null; }   // first finger of a new touch: forget any lost ones
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { block = true; start(); }
  }, { capture: true });
  wrap.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
    if (block) e.stopPropagation();
    const p = pts.get(e.pointerId);
    p.x = e.clientX; p.y = e.clientY;
    if (!g) return;
    if (g.mode === 'pan') { keepUnder(g.P, p.x, p.y); return; }
    const t = two(), t0 = g.t0;
    if (!g.mode) {
      const va = { x: t.a.x - t0.a.x, y: t.a.y - t0.a.y }, vb = { x: t.b.x - t0.b.x, y: t.b.y - t0.b.y };
      if (Math.max(Math.hypot(va.x, va.y), Math.hypot(vb.x, vb.y)) < 12) return;
      // tilt when the fingers move up / down together more than they spread or twist (all in px)
      let turn = t.ang - t0.ang;
      if (turn > Math.PI) turn -= 2 * Math.PI; else if (turn < -Math.PI) turn += 2 * Math.PI;
      const cy = (va.y + vb.y) / 2, cx = (va.x + vb.x) / 2;
      const tilt = Math.sign(va.y) === Math.sign(vb.y) && Math.abs(cy) > 1.5 * Math.abs(cx) &&
        Math.abs(cy) > 1.3 * Math.max(Math.abs(t.d - t0.d), (Math.abs(turn) * t0.d) / 2);
      g.mode = tilt ? 'tilt' : 'pinch';
    }
    if (g.mode === 'tilt') {
      const off = g.pos0.clone().sub(g.tgt0), sph = new THREE.Spherical().setFromVector3(off);
      sph.phi = Math.min(c.maxPolarAngle, Math.max(0.02, g.phi0 - (t.my - t0.my) * 0.005));   // up = tilt towards the horizon
      c.target.copy(g.tgt0); cam.position.copy(g.tgt0).add(off.setFromSpherical(sph)); aim();
      return;
    }
    // pinch: zoom and rotate about P from the starting camera, then put P back under the fingers
    const P = g.P, dist0 = g.pos0.distanceTo(g.tgt0);
    const k = Math.min(c.maxDistance, Math.max(c.minDistance, (dist0 * t0.d) / t.d)) / dist0;
    let da = t.ang - t0.ang;
    if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
    cam.position.copy(g.pos0).sub(P).multiplyScalar(k).applyAxisAngle(Y, da).add(P);
    c.target.copy(g.tgt0).sub(P).multiplyScalar(k).applyAxisAngle(Y, da).add(P);
    keepUnder(P, t.mx, t.my);
  }, { capture: true });
  const end = (e) => {
    if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0) { block = false; g = null; stopInertia(); } else start();
  };
  // on window: a finger may be lifted outside the map (over a panel or the header)
  window.addEventListener('pointerup', end, { capture: true });
  window.addEventListener('pointercancel', end, { capture: true });
  // the browser must never take a touch on the map as its own scroll / pinch-zoom (iOS Safari ignores
  // CSS touch-action and user-scalable=no for pinches); taps still work (touchstart is left alone)
  wrap.addEventListener('touchmove', (e) => { if (!e.target.closest?.('.map-ui')) e.preventDefault(); }, { passive: false });
  wrap.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
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
let FLYOVER_MAT = null;   // carriageway flyovers: tarmac deck, concrete sides (created on first use)
const ROAD_MAT = shadowify(new THREE.MeshBasicMaterial({ color: 0xa7acb3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
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
    o.castShadow = o.receiveShadow = bridge;
    s.roadMeshes.push(o);
  });
  s.roads3d = roads.scene;
  s.scene.add(s.roads3d);
  if (s.infra) s.infra.visible = false;
  s.scene.updateMatrixWorld(true);
}

/* Base map: 'classic' (drawn map: plain roads with painted markings, contour hills, land cover) or
   'real' (aerial photo everywhere and the photo-textured surveyed roads and bridges, loaded on first use). */
const BASEMAP_KEY = 'gps-basemap';
// u = a*x + b, v = c*z + d of a terrain tile (its photo is a top-down orthophoto), fitted from its own
// world-space vertices; returns vec4(a, b, c, d) or null
function terrainUVMap(mesh) {
  const pos = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
  if (!pos || !uv) return null;
  mesh.updateMatrixWorld(true);
  const v = new THREE.Vector3(), step = Math.max(1, Math.floor(pos.count / 4000));
  let n = 0, sx = 0, su = 0, sxx = 0, sxu = 0, sz = 0, sv = 0, szz = 0, szv = 0;
  for (let i = 0; i < pos.count; i += step) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const u = uv.getX(i), w = uv.getY(i);
    n++; sx += v.x; su += u; sxx += v.x * v.x; sxu += v.x * u; sz += v.z; sv += w; szz += v.z * v.z; szv += v.z * w;
  }
  const a = (n * sxu - sx * su) / (n * sxx - sx * sx), b = (su - a * sx) / n;
  const c = (n * szv - sz * sv) / (n * szz - sz * sz), d = (sv - c * sz) / n;
  return [a, b, c, d].every(Number.isFinite) ? new THREE.Vector4(a, b, c, d) : null;
}

// Base maps: 'classic' (drawn map), 'hybrid' (drawn map + photo-textured HKU buildings),
// 'real' (satellite: aerial photo, photo roads, photo HKU buildings, 3D photo canopy instead of drawn trees).
// Assets load on first use; anything that fails to load leaves the classic layer in place.
// bump when the satellite / photo assets are rebuilt, so phones never mix new code with cached old files
const ASSET_V = '2026-10-20c';
const ktx2Loader = (s) => s.ktx2 || (s.ktx2 = new KTX2Loader().setTranscoderPath('vendor/three/addons/libs/basis/').detectSupport(s.renderer));
const once = (s, key, fn) => s[key] || (s[key] = fn().catch((e) => (console.warn(key, e), null)));
async function setBasemap(s, mode) {
  s.basemap = mode;
  s.wrap.querySelector('[data-a="layers"]')?.classList.toggle('on', mode !== 'classic');
  s.wrap.querySelectorAll('.basemap-menu [data-basemap]').forEach((b) => b.classList.toggle('on', b.dataset.basemap === mode));
  try { localStorage.setItem(BASEMAP_KEY, mode); } catch (e) {}
  const real = mode === 'real', photoBuildings = mode !== 'classic';
  TERRAIN_U.uReal.value = real ? 1 : 0;
  TERRAIN_SHADOW.value = real ? 0 : 1;   // the aerial photo has its own shadows
  TERRAIN_U.uPhoto.value = real ? 1 : 0;
  setSky(s);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const jobs = [];
  if (photoBuildings) jobs.push(once(s, 'satBuildingsP', () => loader.loadAsync(`assets/model/satellite-buildings.glb?v=${ASSET_V}`).then((g) => {
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const map = o.material.map;
      if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
      o.material = cutify(new THREE.MeshBasicMaterial({ map }));   // photo is already lit
      o.castShadow = true;
    });
    s.satBuildings = g.scene; s.scene.add(g.scene);
  })));
  // photo roads: KTX2 (Basis) atlas pages, kept GPU-compressed so phones can hold full sharpness
  if (real) jobs.push(once(s, 'roadsPhotoP', () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Loader(s)).loadAsync(`assets/model/roads-photo.glb?v=${ASSET_V}`).then((g) => {
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const map = o.material.map;
      if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
      const bridge = /bridge/i.test(o.name || o.parent?.name || '');
      o.material = new THREE.MeshBasicMaterial({ map, polygonOffset: !bridge, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      o.renderOrder = bridge ? 0 : 2;
    });
    s.roadsPhoto = g.scene; s.scene.add(g.scene);
  })));
  // canopy: surveyed tree canopy as a height field wearing the terrain's own aerial photo
  if (real) jobs.push(once(s, 'canopyP', () => loader.loadAsync(`assets/model/satellite-trees.glb?v=${ASSET_V}`).then((g) => {
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const id = (o.name || o.parent?.name || '').replace('canopy_', '');
      const tile = (s.terrain || []).find((t) => (t.name || t.parent?.name || '').endsWith(id));
      const fit = tile && terrainUVMap(tile);
      o.material = new THREE.MeshBasicMaterial({ map: fit ? tile.material.map : null, color: fit ? 0xffffff : 0x55704f, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      if (fit) o.material.onBeforeCompile = (sh) => {
        // photo position from world x / z, with the terrain tile's own (affine) UV mapping
        sh.uniforms.uUVMap = { value: fit };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 uUVMap;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n{ vec4 cw = modelMatrix * vec4(position, 1.0); vMapUv = vec2(uUVMap.x * cw.x + uUVMap.y, uUVMap.z * cw.z + uUVMap.w); }');
      };
    });
    s.canopy = g.scene; s.scene.add(g.scene);
  })));
  await Promise.all(jobs);
  if (s.basemap !== mode) return;   // switched again while loading
  const showPhotoB = photoBuildings && !!s.satBuildings;
  if (s.satBuildings) s.satBuildings.visible = showPhotoB;
  // the white HKU buildings stay for picking / highlight, just not drawn; other buildings stay white
  if (s.buildings) s.buildings.material.visible = !showPhotoB;
  if (s.canopy) s.canopy.visible = real;
  if (s.trees) s.trees.visible = !(real && s.canopy);
  if (s.roadsPhoto) s.roadsPhoto.visible = real;
  if (s.roads3d) s.roads3d.visible = !(real && s.roadsPhoto);
  s.shadowKey = null;
  // painted markings belong to the drawn roads; lamps stay everywhere
  s.roads?.children.forEach((c) => { if (c.name !== 'streetlamps' && c.name !== 'lanterns') c.visible = !(real && s.roadsPhoto); });
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
  crown.castShadow = trunk.castShadow = true;
  s.trees = new THREE.Group(); s.trees.add(crown, trunk); s.scene.add(s.trees);
  setTreeTheme(s, isDark());
}

async function makeRoads(s) {
  if (!FEAT) return;
  try {
    await loadSurfaces(s);
    const t0 = performance.now();
    const NET = await fetch('data/roadnet.json').then((r) => r.json()).catch(() => null);
    const bridges = (s.roadMeshes || []).filter((m) => m.material === BRIDGE_MAT);
    // a bridge that carries at least 20 m of a measured road centre line is a vehicle flyover:
    // tarmac deck + markings; the rest (footbridges) stay concrete
    const g0 = heightIndex(s.terrain);
    for (const m of NET ? bridges : []) {
      const hb = heightIndex([m], { upOnly: true });
      let carried = 0;
      for (const r of NET.roads) {
        if (r.width < 6) continue;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const [a, b] = [r.pts[i], r.pts[i + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 2);
          for (let k = 0; k < n; k++) {
            const x = a[0] + ((b[0] - a[0]) * (k + 0.5)) / n, z = a[1] + ((b[1] - a[1]) * (k + 0.5)) / n;
            const hy = hb(x, z), gy = g0(x, z);
            if (Number.isFinite(hy) && Number.isFinite(gy) && hy - gy > 2.5) carried += L / n;
          }
        }
      }
      if (carried >= 20) { m.material = FLYOVER_MAT || (FLYOVER_MAT = infraMaterial()); m.userData.flyover = true; }
    }
    const deckMeshes = bridges.length ? bridges : s.infra ? [s.infra] : [];
    const ground = heightIndex(s.terrain), deck = deckMeshes.length ? heightIndex(deckMeshes, { upOnly: true }) : () => NaN;
    const bIdx = heightIndex([s.buildings]);
    const lampGeo = await loadLampGeometry('assets/model/streetlamp.json').catch(() => null);
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    makeTrees(s);
    // road surfaces and flyover decks - footbridges must never carry the markings of the road below
    const roadOnly = (s.roadMeshes || []).filter((m) => m.material === ROAD_MAT || m.userData.flyover);
    const surface = roadOnly.length ? heightIndex(roadOnly, { upOnly: true }) : null;
    const feat = NET && surface ? { ...FEAT, roads: NET.roads, marks: { ...NET.marks, icons: FEAT.marks?.icons || [] } } : FEAT;
    s.roads = buildRoads({ FEAT: feat, ground, deck, building: bIdx, lampGeo, dark, surface: NET ? surface : null });
    // painted markings lie in the same shadows as the road (lamps are lit materials: native shadows)
    s.roads.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.isMeshBasicMaterial && o.name !== 'lanterns') shadowify(o.material);
      if (o.name === 'streetlamps') o.castShadow = true;
    });
    s.scene.add(s.roads);
    let saved = 'classic';
    try { saved = localStorage.getItem(BASEMAP_KEY) || 'classic'; } catch (e) {}
    if (saved !== 'classic' || s.basemap) setBasemap(s, s.basemap || saved);
    s.shadowKey = null;
    console.info(`roads built in ${Math.round(performance.now() - t0)} ms, ${s.roads.userData.lampCount} street lamps`);
  } catch (e) { console.warn('roads not built', e); }
}

/* ---------------- extra buildings ----------------
   Buildings missing from the 3D data (campus.json 'extraBuildings', footprints
   from OpenStreetMap) are extruded from the ground and get bids after the model's. */
function makeExtraBuildings(s, list) {
  s.extras = [];
  const mat = cutify(new THREE.MeshLambertMaterial({ color: 0xf1eee8, flatShading: true }));
  for (const e of list) {
    const ground = Math.min(...e.footprint.map(([x, z]) => groundHeightIn(s, x, z) ?? 80));
    const shape = new THREE.Shape(e.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: e.height + 3, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); geo.translate(0, ground - 3, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
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
const HL_MAT = cutify(new THREE.MeshLambertMaterial({ color: 0xf5b82e, flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
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
      if (!isFinite(dir.x)) dir.set(0, 0, -1);
      const pos = target.clone().add(dir.multiplyScalar(span * 2.6)).add(new THREE.Vector3(0, span * 2.0, 0));
      flyTo(pos, target);
    }
  }
  setParam('place', p.id);
  // floor plans: selector + the chosen floor (from ?floor= when shared)
  const want = S.params?.get('floor');
  S.indoor.open(p.id, want).then((ok) => { if (!ok && S.indoor.place) S.indoor.close(); });
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
  S.indoor?.close(); setParam('floor', null);
  S.selected = null; highlight(null);
  S.pins.forEach((q) => q.el.classList.remove('active'));
  S.info?.remove(); S.info = null;
  S.wrap.classList.remove('info-open');
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
  S.wrap.classList.add('info-open');
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
// compass: turn to face north; tapped again (already facing north), turn back to face south
function faceNorth() {
  const tg = S.controls.target, off = S.camera.position.clone().sub(tg);
  const horiz = Math.hypot(off.x, off.z), north = Math.abs(S.controls.getAzimuthalAngle()) < 0.05;
  flyTo(new THREE.Vector3(tg.x, S.camera.position.y, tg.z + (north ? -horiz : horiz)), tg.clone(), 700);
}
// a camera position looking at tg from the current heading: `back` metres behind, `up` metres above
function behind(tg, up, back) {
  const dir = S.camera.position.clone().sub(S.controls.target).setY(0).normalize();
  if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0, 0, -1);
  return tg.clone().addScaledVector(dir, back).add(new THREE.Vector3(0, up, 0));
}
function toggleTop() {
  const tg = S.controls.target.clone(), dist = S.camera.position.distanceTo(tg);
  const isTop = S.controls.getPolarAngle() < 0.2;
  const lbl = S.wrap.querySelector('[data-a="top"] .dim-label');
  if (lbl) lbl.textContent = isTop ? '2D' : '3D';   // label = the view the next tap switches to
  if (isTop) {
    const az = S.controls.getAzimuthalAngle(), pol = 0.9;
    flyTo(new THREE.Vector3(tg.x + dist * Math.sin(pol) * Math.sin(az), tg.y + dist * Math.cos(pol), tg.z + dist * Math.sin(pol) * Math.cos(az)), tg, 800);
  } else {
    const az = S.controls.getAzimuthalAngle();   // keep the heading (south stays up)
    flyTo(new THREE.Vector3(tg.x + 0.01 * Math.sin(az), tg.y + dist, tg.z + 0.01 * Math.cos(az)), tg, 800);
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
    flyTo(behind(tg, 220, 200), tg);
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
    flyTo(behind(c, size * 0.9 + 80, size * 0.7 + 60), c);
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
  fitShadow(S);
  S.indoor?.update();
  S.renderer.render(S.scene, S.camera);
  if (S.compass) S.compass.style.transform = `rotate(${(S.controls.getAzimuthalAngle() * 180) / Math.PI}deg)`;
  updatePins();
}
