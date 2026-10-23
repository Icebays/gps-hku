import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { loadPlaces, loadRoutes, isPinned, L, href, esc, getLang, REPO } from './app.js';
import { heightIndex, buildRoads, loadLampGeometry } from './roads.js';
import { mountWeather } from './weather.js';
import { createIndoor, cutify } from './indoor.js';
import { createTiles } from './tiles.js';

/* Model frame: x = HK1980 Easting − 832250, z = −(Northing − 815900), y = height in mPD */
const ORIGIN = { E: 832250, N: 815900 };
const DECO_OPACITY = 0.18;
const DECO_NEAR = 1100;   // m
const T = {
  en: { loading: 'Loading 3D campus…', find: 'Find a building or place…', reset: 'Reset view', top: 'Top / 3D view', north: 'Face north',
        locate: 'My location (GPS)', layers: 'Change map layer', routes: 'Walking routes', unnamed: 'Unlabelled building',
        height: 'Height', guide: 'Building guide', floorPlans: 'Floor plans',
        outside: 'You appear to be outside the mapped area.', noGps: 'Location not available.', noRoutes: 'No routes yet.',
        min: 'min', notPinned: 'not on map yet', webgl: 'Your browser could not start 3D (WebGL).', you: 'You',
        guess: 'Approximate position, not yet confirmed.', basemap: 'Map style', classic: 'Classic', hybrid: 'Classic + real buildings', real: 'Satellite', filter: 'Show / hide places' },
  zh: { loading: '正在載入 3D 校園…', find: '搜尋大樓或地點…', reset: '重設視角', top: '俯視 / 3D', north: '朝北',
        locate: '我的位置（GPS）', layers: '更換圖層', routes: '步行路線', unnamed: '未命名大樓',
        height: '高度', guide: '大樓指南', floorPlans: '平面圖',
        outside: '你似乎不在地圖範圍內。', noGps: '無法取得位置。', noRoutes: '暫未有路線。',
        min: '分鐘', notPinned: '尚未標示', webgl: '你的瀏覽器無法啟動 3D（WebGL）。', you: '你',
        guess: '位置係估計，未經確認。', basemap: '地圖樣式', classic: '經典', hybrid: '經典＋真實大樓', real: '衛星圖像', filter: '顯示／隱藏地點' },
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

// the drawn roads, land cover and street furniture cover these tiles: they are always loaded (tiles.js 'core')
const CORE_EXT = [-750, 750, -305, 305];
async function init() {
  const tilesCfg = await fetch('data/tiles.json').then((r) => r.json()).catch(() => null);
  installEdgeFade(tilesCfg);
  // (by the tile's centre: neighbours share a few metres of edge with it)
  const core = (tilesCfg?.tiles || []).filter(({ extent: e }) => { const x = (e[0] + e[1]) / 2, z = (e[2] + e[3]) / 2; return x > CORE_EXT[0] && x < CORE_EXT[1] && z > CORE_EXT[2] && z < CORE_EXT[3]; }).map((t) => t.id);
  const wrap = document.createElement('div');
  wrap.className = 'map-wrap';
  wrap.innerHTML = `<div class="map-loading"><div class="box"><b data-t="loading"></b><div class="bar"><i></i></div><small class="pct">0%</small></div></div><div class="labels area-labels"></div><div class="labels pin-labels"></div>`;
  const s = { wrap, labels: wrap.querySelector('.pin-labels'), areaLabels: wrap.querySelector('.area-labels'), pins: [], selected: null, terrain: [], pickables: [], bparts: [], infraMeshes: [], hl: [] };

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
    s.hlHidden = !!fl;   // the gold highlight would hide the plan
    s.hl.forEach((m) => (m.visible = !fl)); (s.hlx || []).forEach((m) => (m.visible = !fl));
    // bring the floor into view (closer than the building overview), keeping the heading
    if (fl && fl._c) {
      const span = fl._c.size * (innerWidth < innerHeight ? 1.6 : 1), d = s.camera.position.distanceTo(s.controls.target);
      if (d > span * 2.4 || s.controls.target.distanceTo(fl._c.center) > span) flyTo(behind(fl._c.center, span * 1.25, span * 0.95), fl._c.center);
    }
  };

  // the campus model streams in by tiles around the view (assets/tiles.js)
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const bar = wrap.querySelector('.bar i'), pct = wrap.querySelector('.pct');
  const drop = (arr, o) => { const i = arr.indexOf(o); if (i >= 0) arr.splice(i, 1); };
  s.coreTiles = core;
  s.tiles = createTiles({
    camera, renderer, loader, core,
    terrainMaterial: (tex, t) => {
      // the main campus tiles share the land cover overlay of data/landcover.json; other tiles have their own
      const m = cutify(shadowify(terrainMaterial(tex, core.includes(t.info.id) ? null : tileOverlay(t)), TERRAIN_SHADOW));   // cut too: floors below ground (CPD LG/F, G/F) show through
      m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 4;   // roads draped on top win near-ties
      return m;
    },
    onTerrain: (t, full, far, root) => {
      full.userData.tile = far.userData.tile = t.info.id;
      scene.add(root); s.terrain.push(full); s.pickables.push(full); s.shadowKey = null;
      if (t.info.land && !core.includes(t.info.id)) loadLand(t);
    },
    onTerrainDrop: (t, full, far, root) => { scene.remove(root); drop(s.terrain, full); drop(s.pickables, full); dropLand(t); dropBridges(t); },
    onObjects: (t, root) => {
      const meshes = []; root.traverse((o) => o.isMesh && meshes.push(o));   // (addPart adds children)
      meshes.forEach((o) => {
        if ((o.name || o.parent?.name || '').startsWith('buildings')) addPart(s, o, t.info.id);
        else {
          o.material = INFRA_MAT; o.userData.core = core.includes(t.info.id); o.userData.tile = t.info.id;
          o.visible = !(s.roads3d && o.userData.core);
          s.infraMeshes.push(o); s.pickables.push(o);
        }
      });
      tileBridges(s, t);
      scene.add(root); s.shadowKey = null;
      if ((t.info.land || t.info.roads) && !core.includes(t.info.id)) queueTileFeatures(s, t);
    },
    onLod: (t, root) => { addLod(s, t, root); tileBridges(s, t); scene.add(root); },
    onLodDrop: (t, root) => { scene.remove(root); t.lodParts = null; },
    onObjectsDrop: (t, root) => {
      dropTileFeatures(s, t);
      root.traverse((o) => {
        if (!o.isMesh) return;
        const part = o.userData.part;
        if (part && part.mesh === o) dropPart(s, part);
        else if (!part) { drop(s.infraMeshes, o); drop(s.pickables, o); }
      });
      scene.remove(root); s.shadowKey = null;
    },
  });
  const tick = setInterval(() => { const p = Math.round(s.tiles.progress() * 100); bar.style.width = p + '%'; pct.textContent = p + '%'; }, 150);
  s.ready = Promise.all([
    s.tiles.ready,
    fetch('assets/model/buildings.json').then((r) => r.json()),
    fetch('data/campus.json').then((r) => r.json()).catch(() => null),
    loadOverlay(),
  ]).then(([, bjson, campus]) => {
    clearInterval(tick);
    s.campus = campus;
    setHills(campus?.hills);
    s.bmeta = bjson.map(([id, x, z, base, top]) => ({ id, x, z, base, top, tile: s.tiles.tileAt(x, z, 50)?.info.id }));
    s.bparts.forEach((p) => splitPart(s, p));
    s.bidByCode = new Map(s.bmeta.map((b, i) => [b.id, i]));
    makeExtraBuildings(s, campus?.extraBuildings || []);
    s.shadowKey = null;   // redraw the shadow map with the buildings in it
    // the drawn roads lie on the main campus tiles: built once those are in (the map is open already)
    s.tiles.coreReady.then(() => setTimeout(() => makeRoads(s), 0));
    const ld = wrap.querySelector('.map-loading');
    ld.style.opacity = 0; setTimeout(() => ld.remove(), 450);
  }).catch((e) => { clearInterval(tick); console.error(e); pct.textContent = 'Error: ' + e.message; });

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
  uSea: { value: new THREE.Color(0xb9d3e0) },   // the sea (flat terrain at 1.3 mPD in the coastal tiles), as the ground plane beyond
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
  if (LAND) drawLand(LAND, TERRAIN_U, dark, 0.75, 1);   // kept small: large canvases crash mobile Safari
  for (const t of S?.tiles?.tiles.values() || []) if (t.land && t.overlay?.uOvOn.value && t.terrain) drawLand(t.land, t.overlay, dark, TILE_LAND_RES, TILE_LAND_RES);
}
// land cover L ({ext, green, water}) into its two canvases, and they into the overlay uniforms U
function drawLand(L, U, dark, RES, RB) {
  const [x0, x1, z0, z1] = L.ext;
  const mk = (r) => Object.assign(document.createElement('canvas'), { width: Math.ceil((x1 - x0) / r), height: Math.ceil((z1 - z0) / r) });
  const A = L.canvasA || (L.canvasA = mk(RES)), B = L.canvasB || (L.canvasB = mk(RB));
  const a = A.getContext('2d'), b = B.getContext('2d'), st = MAP_STYLE[dark ? 'dark' : 'light'];
  a.setTransform(1, 0, 0, 1, 0, 0); b.setTransform(1, 0, 0, 1, 0, 0);
  a.clearRect(0, 0, A.width, A.height); b.clearRect(0, 0, B.width, B.height);
  // draw in metres: canvas units = model metres
  a.setTransform(1 / RES, 0, 0, 1 / RES, -x0 / RES, -z0 / RES); b.setTransform(1 / RB, 0, 0, 1 / RB, -x0 / RB, -z0 / RB);
  const path = (ctx, pts) => pts.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](x, z));
  const poly = (ctx, ar) => { ctx.beginPath(); for (const ring of [ar.outer, ...ar.holes]) { path(ctx, ring); ctx.closePath(); } };
  // vegetation feeds the green base (relief + contours); water is filled on top
  b.fillStyle = '#ff0000';
  for (const ar of L.green) { poly(b, ar); b.fill('evenodd'); }
  for (const ar of L.water) {
    poly(a, ar); a.fillStyle = st.water; a.fill('evenodd');
    a.strokeStyle = st.waterEdge; a.lineWidth = 0.5; a.stroke();
  }
  for (const [k, c] of [['uOvA', A], ['uOvB', B]]) {
    const t = U[k].value || (U[k].value = new THREE.CanvasTexture(c));
    t.flipY = false; t.colorSpace = k === 'uOvA' ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.needsUpdate = true;
  }
  U.uOvExt.value.set(x0, x1, z0, z1); U.uOvOn.value = 1;
}
function setHills(pts) {
  pts = (pts || []).slice(0, MAX_HILL_PTS);
  pts.forEach(([x, z], i) => TERRAIN_U.uHill.value[i].set(x, z));
  TERRAIN_U.uHillN.value = pts.length;
}
function terrainMaterial(map, overlay = null) {
  const m = new THREE.MeshBasicMaterial({ map });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, TERRAIN_U, overlay);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorld;
uniform vec2 uHill[${MAX_HILL_PTS}];
uniform int uHillN;
uniform vec3 uBase, uLine, uMist, uPaved, uSea, uSunDir;
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
    // the sea: flat at 1.3 mPD (its photo would read as noisy vegetation and its flatness as contour lines). By
    // height alone: the screen-space normal of its long thin triangles is too noisy on phone GPUs (white streaks)
    col = mix(col, uSea, 1.0 - smoothstep(0.08, 0.25, abs(vWorld.y - 1.3)));
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
  TERRAIN_U.uSea.value.set(dark ? 0x1d2b35 : 0xb9d3e0);
  TERRAIN_U.uLine.value.set(dark ? 0x8fb39a : 0x5d7a63);
  TERRAIN_U.uMist.value.copy(c);
  TERRAIN_U.uPaved.value.set(dark ? 0x3a3f3c : 0xf6f3ec);
  drawMapFeatures(dark);
  s.roads?.userData.setTheme(dark);
  for (const t of s.tiles?.tiles.values() || []) t.feat?.marks?.userData.setTheme(dark);
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
    <button data-a="filter" title="${tt('filter')}">${ICON.filter}</button>`);
  S.compass = tools.querySelector('.compass svg');
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    ({ north: faceNorth, reset: () => flyTo(S.home.pos, S.home.target), top: toggleTop, locate, routes: toggleRoutes, layers: cycleBasemap, filter: toggleLayers })[b.dataset.a]();
  });

  const cats = S.places?.categories || {};
  S.hiddenCats = S.hiddenCats || new Set();
  const zh = getLang() === 'zh', wm = S.indoor?.wallMode || 'cutaway';
  const walls = [['cutaway', zh ? '跟角度變透明（好似 The Sims）' : 'See-through facing you (like The Sims)'], ['full', zh ? '完整牆身' : 'Full walls'], ['low', zh ? '矮牆' : 'Low walls']];
  S.legend = ui('map-legend', Object.entries(cats).map(([k, c]) => `<label><input type="checkbox" data-cat="${k}" ${S.hiddenCats.has(k) ? '' : 'checked'}><i class="dot" style="background:${c.color}"></i>${esc(L(c))}</label>`).join('') +
    `<b class="legend-h">${zh ? '室內平面圖：牆' : 'Floor plans: walls'}</b>` +
    walls.map(([k, t]) => `<label><input type="radio" name="walls" value="${k}" ${wm === k ? 'checked' : ''}>${t}</label>`).join(''));
  S.legend.hidden = true;
  S.legend.addEventListener('change', (e) => {
    if (e.target.name === 'walls') { S.indoor?.setWallMode(e.target.value); return; }
    const k = e.target.dataset.cat; e.target.checked ? S.hiddenCats.delete(k) : S.hiddenCats.add(k); makePins(); });

  ui('map-credit', '3D Spatial Data © Lands Department, HKSAR · Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors');
  S.info = null; S.routePanel = null;
  // weather + HKO warnings (bottom left); cloud and rain soften the sun's shadows
  S.weather = mountWeather(S.wrap, { lang: getLang(), onSky: (clear) => { if (S.weatherClear !== clear) { S.weatherClear = clear; updateSun(S); } } });
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
const INFRA_MAT = infraMaterial();   // bridges of the 3D data (where the drawn roads don't cover them)

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
  s.infraMeshes.forEach((m) => (m.visible = !m.userData.core));
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
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      // the terrain tile under it: its photo (canopy.webp, the whole tile) and UV mapping
      o.geometry.computeBoundingBox(); const c = o.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(o.matrixWorld);
      const t = s.tiles.tileAt(c.x, c.z), tile = t?.terrain?.full;
      const fit = tile && t.info.canopy && terrainUVMap(tile);
      let map = null;
      if (fit) { map = new THREE.TextureLoader().load('assets/tiles/' + t.info.canopy); map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
      o.material = canopyMaterial(map, fit);
    });
    s.canopy = g.scene; s.scene.add(g.scene);
  })));
  await Promise.all(jobs);
  if (s.basemap !== mode) return;   // switched again while loading
  const showPhotoB = photoBuildings && !!s.satBuildings;
  if (s.satBuildings) s.satBuildings.visible = showPhotoB;
  // the white HKU buildings stay for picking / highlight, just not drawn; other buildings stay white
  BUILD_MAT.visible = !showPhotoB;
  if (s.canopy) s.canopy.visible = real;
  if (s.trees) s.trees.visible = !(real && s.canopy);
  for (const t of s.tiles.tiles.values()) { tileBasemap(s, t); tileBridges(s, t); }
  if (s.roadsPhoto) s.roadsPhoto.visible = real;
  if (s.roads3d) s.roads3d.visible = !(real && s.roadsPhoto);
  s.shadowKey = null;
  // painted markings belong to the drawn roads; lamps stay everywhere
  s.roads?.children.forEach((c) => { if (c.name !== 'streetlamps' && c.name !== 'lanterns') c.visible = !(real && s.roadsPhoto); });
}

// the canopy wears the terrain's aerial photo: its position in the photo from world x / z with the terrain
// tile's own (affine) UV mapping fit, then the texture's own transform (a crop of the photo)
function canopyMaterial(map, fit) {
  const m = new THREE.MeshBasicMaterial({ map: fit ? map : null, color: fit ? 0xffffff : 0x55704f, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  if (fit && map) m.onBeforeCompile = (sh) => {
    sh.uniforms.uUVMap = { value: fit };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 uUVMap;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n{ vec4 cw = modelMatrix * vec4(position, 1.0); vMapUv = (mapTransform * vec3(uUVMap.x * cw.x + uUVMap.y, uUVMap.z * cw.z + uUVMap.w, 1.0)).xy; }');
  };
  return m;
}

// per-tree colours are tints; the material colour sets the overall tone (night: darker, cooler)
function setTreeTheme(s, dark) {
  for (const g of [s.trees, ...[...(s.tiles?.tiles.values() || [])].map((t) => t.feat?.trees)]) {
    if (!g) continue;
    g.userData.mats.crown.color.set(dark ? 0x5d7c6a : 0xffffff);
    g.userData.mats.trunk.color.set(dark ? 0x4a4038 : 0x8a7462);
  }
}
/* Trees from the surveyed canopy (data/landcover.json, a tile's land.json): one instanced trunk + crown per tree. */
const CROWN_GEO = new THREE.IcosahedronGeometry(1, 0), TRUNK_GEO = new THREE.CylinderGeometry(0.12, 0.18, 1, 5, 1, true).translate(0, 0.5, 0);   // (ends hidden: in the ground and the crown)
function makeTrees(s) {
  if (!LAND?.trees?.length) return;
  s.trees = treeGroup(LAND.trees); s.scene.add(s.trees);
  setTreeTheme(s, isDark());
}
// in TREE_CELL blocks, so the renderer skips the blocks out of view (and the tiles' blocks further than FEATURE_NEAR)
const TREE_CELL = 250;
function treeGroup(list) {
  const cells = new Map();
  for (const t of list) {
    if (t[3] < 3) continue;
    const k = `${Math.floor(t[0] / TREE_CELL)},${Math.floor(t[1] / TREE_CELL)}`;
    if (!cells.has(k)) cells.set(k, []); cells.get(k).push(t);
  }
  const mats = { crown: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), trunk: new THREE.MeshLambertMaterial({ color: 0x8a7462 }) };
  const g = new THREE.Group(); g.userData.mats = mats;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), e = new THREE.Euler();
  for (const trees of cells.values()) {
    const crown = new THREE.InstancedMesh(CROWN_GEO, mats.crown, trees.length), trunk = new THREE.InstancedMesh(TRUNK_GEO, mats.trunk, trees.length);
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
    crown.computeBoundingSphere(); trunk.computeBoundingSphere();
    const cell = new THREE.Group(); cell.add(crown, trunk);
    cell.userData.center = crown.boundingSphere.center.clone(); cell.userData.radius = crown.boundingSphere.radius;
    g.add(cell);
  }
  return g;
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
    const coreTerrain = s.terrain.filter((m) => s.coreTiles.includes(m.userData.tile));
    const g0 = heightIndex(coreTerrain);
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
    const deckMeshes = bridges.length ? bridges : s.infraMeshes.filter((m) => m.userData.core);
    const ground = g0, deck = deckMeshes.length ? heightIndex(deckMeshes, { upOnly: true }) : () => NaN;
    const coreB = s.bparts.filter((p) => s.coreTiles.includes(p.tile)).flatMap((p) => [p.mesh, ...p.decos]);
    const bIdx = heightIndex(coreB);
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

/* ---------------- features of the other tiles ----------------
   Tiles with a high-quality release have what the main campus has (tools/build_tile_features.py): their land cover
   drawn into the terrain (land.json: vegetation, water), from as far as the terrain loads; and from as near as their
   buildings load, the surveyed road surfaces (roads.glb) with markings and street lamps from the measured centre
   lines, the trees, and in the satellite map the 3D canopy (canopy.glb) wearing the tile's own photo. */
const TILE_LAND_RES = 1.25;   // m per canvas pixel
// a tile's trees, markings and lamps are drawn within this distance (m) - further out they are specks in the haze
const FEATURE_NEAR = matchMedia('(pointer: coarse)').matches ? 650 : 950;
function tileOverlay(t) {
  return t.overlay || (t.overlay = { uOvA: { value: null }, uOvB: { value: null }, uOvExt: { value: new THREE.Vector4(0, 1, 0, 1) }, uOvOn: { value: 0 } });
}
const landOf = (t) => t.landP || (t.landP = fetch('assets/tiles/' + t.info.land).then((r) => r.json()).then((j) => (t.land = j)).catch((e) => (console.warn(t.info.land, e), (t.landP = null))));
async function loadLand(t) {
  const land = await landOf(t);
  if (land && t.terrain && !t.overlay?.uOvOn.value) drawLand(land, tileOverlay(t), isDark(), TILE_LAND_RES, TILE_LAND_RES);
}
function dropLand(t) {
  const U = t.overlay; if (!U) return;
  for (const k of ['uOvA', 'uOvB']) { U[k].value?.dispose(); U[k].value = null; }
  U.uOvOn.value = 0;
  if (t.land) t.land.canvasA = t.land.canvasB = null;
}
// one tile at a time, so moving across the map never stalls on several at once
function queueTileFeatures(s, t) {
  const root = t.objects.root;
  s.featQ = (s.featQ || Promise.resolve()).then(() => tileFeatures(s, t, root)).catch((e) => console.warn('tile features', t.info.id, e));
}
async function tileFeatures(s, t, root) {
  const alive = () => t.objects?.root === root;
  for (let i = 0; i < 300 && alive() && !t.terrain; i++) await new Promise((r) => setTimeout(r, 100));
  if (!alive() || !t.terrain || t.feat) return;
  const land = t.info.land ? await landOf(t) : null;
  const f = { group: new THREE.Group(), roadMeshes: [], trees: null, marks: null, canopy: null };
  f.group.name = 'tile-features';
  if (t.info.roads) {
    const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('assets/tiles/' + t.info.roads).catch((e) => (console.warn(t.info.roads, e), null));
    g?.scene.traverse((o) => { if (o.isMesh) { o.material = ROAD_MAT; o.renderOrder = 2; f.roadMeshes.push(o); } });
    if (g) f.group.add(g.scene);
  }
  if (!alive()) return disposeFeatures(f);
  if (land?.trees?.length) { f.trees = treeGroup(land.trees); f.group.add(f.trees); }
  if (land?.roads?.length && f.roadMeshes.length) {
    const lampGeo = await (s.lampGeoP || (s.lampGeoP = loadLampGeometry('assets/model/streetlamp.json').catch(() => null)));
    if (!alive() || !t.terrain) return disposeFeatures(f);
    f.group.updateMatrixWorld(true);
    const infra = s.infraMeshes.filter((m) => m.userData.tile === t.info.id);
    const parts = s.bparts.filter((p) => p.tile === t.info.id).flatMap((p) => [p.mesh, ...p.decos]);
    f.marks = buildRoads({
      FEAT: { roads: land.roads, marks: {}, paths: [] },
      ground: heightIndex([t.terrain.full]),
      deck: infra.length ? heightIndex(infra, { upOnly: true }) : () => NaN,
      building: parts.length ? heightIndex(parts) : () => NaN,
      surface: heightIndex(f.roadMeshes, { upOnly: true }),
      lampGeo, dark: isDark(),
    });
    f.marks.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.isMeshBasicMaterial && o.name !== 'lanterns') shadowify(o.material);
      if (o.name === 'streetlamps') o.castShadow = true;
    });
    f.group.add(f.marks);
  }
  t.feat = f; s.scene.add(f.group);
  setTreeTheme(s, isDark()); tileBasemap(s, t);
  s.shadowKey = null;
}
// satellite map: the photo shows the roads (no drawn surface or markings; lamps stay) and the 3D canopy replaces the trees
function tileBasemap(s, t) {
  const f = t.feat; if (!f) return;
  const real = s.basemap === 'real';
  if (real && t.info.canopyMesh && !f.canopyP) f.canopyP = loadTileCanopy(s, t, f);
  f.roadMeshes.forEach((m) => (m.visible = !real));
  f.marks?.children.forEach((c) => { if (c.name !== 'streetlamps' && c.name !== 'lanterns') c.visible = !real; });
  if (f.canopy) f.canopy.visible = real;
  f.treesOn = !(real && f.canopy);
  showTileFeatures(s, t);
}
function showTileFeatures(s, t) {
  const f = t.feat, near = s.tiles.distTo(t.info.id) < FEATURE_NEAR;
  if (f.trees) {
    f.trees.visible = near && f.treesOn;
    const cam = s.camera.position;
    if (near) for (const c of f.trees.children) c.visible = cam.distanceTo(c.userData.center) < FEATURE_NEAR + c.userData.radius;
  }
  if (f.marks) f.marks.visible = near;
}
async function loadTileCanopy(s, t, f) {
  const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('assets/tiles/' + t.info.canopyMesh).catch((e) => (console.warn(t.info.canopyMesh, e), null));
  if (!g || t.feat !== f || !t.terrain) return;
  // the tile's whole-photo piece (always held while its terrain is) and the terrain's UV mapping
  const map = t.pieces.get('0_0_0')?.tex, fit = terrainUVMap(t.terrain.full);
  g.scene.traverse((o) => { if (o.isMesh) o.material = canopyMaterial(map, fit); });
  f.canopy = g.scene; f.group.add(g.scene);
  tileBasemap(s, t); s.shadowKey = null;
}
function dropTileFeatures(s, t) {
  const f = t.feat; t.feat = null;
  if (!f) return;
  s.scene.remove(f.group); disposeFeatures(f);
  s.shadowKey = null;
}
function disposeFeatures(f) {
  f.group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry !== CROWN_GEO && o.geometry !== TRUNK_GEO && o.name !== 'streetlamps') o.geometry.dispose();   // (shared)
    if (o.material !== ROAD_MAT) { if (f.marks && o.material.map && o.parent === f.marks) o.material.map.dispose(); o.material.dispose(); }
    o.isInstancedMesh && o.dispose();
  });
}

/* Satellite map: bridges wear the tile's own orthophoto, looked up by world x / z (tools/build_bridge_photo.mjs: the
   32 px photo blocks under the bridges, packed into an atlas; an index texture gives each block's place in it).
   Everything else about the bridges stays: the full models close by, the simplified ones further out. */
function tileBridges(s, t) {
  const meshes = [...s.infraMeshes.filter((m) => m.userData.tile === t.info.id), ...(t.lodParts?.infra || [])];
  const want = s.basemap === 'real' && t.info.bridges;
  if (want && !t.bridgeMat && !t.bridgeP) t.bridgeP = loadBridges(t).then((m) => { if (!t.terrain) return m?.dispose(); t.bridgeMat = m; tileBridges(s, t); }).catch((e) => console.warn(t.info.bridges, e));
  const mat = want && t.bridgeMat ? t.bridgeMat : INFRA_MAT;
  meshes.forEach((m) => (m.material = mat));
}
async function loadBridges(t) {
  const base = 'assets/tiles/' + t.info.bridges.replace(/\.json$/, '');
  const [J, atlas] = await Promise.all([fetch(base + '.json').then((r) => r.json()), new THREE.TextureLoader().loadAsync(base + '.webp')]);
  atlas.flipY = false; atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4; atlas.needsUpdate = true;
  const BW = Math.ceil(J.photo[0] / J.src), BH = Math.ceil(J.photo[1] / J.src), data = new Uint8Array(BW * BH * 4);
  J.blocks.forEach(([bx, by], i) => { const o = (by * BW + bx) * 4; data[o] = (i + 1) & 255; data[o + 1] = (i + 1) >> 8; });
  const idx = new THREE.DataTexture(data, BW, BH); idx.needsUpdate = true;   // (nearest, no mipmaps)
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const U = {
    uAtlas: { value: atlas }, uIdx: { value: idx }, uFit: { value: new THREE.Vector4(...J.fit) }, uPhotoPx: { value: new THREE.Vector2(...J.photo) },
    uAtlasSize: { value: new THREE.Vector2(...J.size) }, uSrc: { value: J.src }, uDst: { value: J.dst }, uPad: { value: J.pad }, uCols: { value: J.cols },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWorld;
uniform sampler2D uAtlas, uIdx;
uniform vec4 uFit;
uniform vec2 uPhotoPx, uAtlasSize;
uniform float uSrc, uDst, uPad, uCols;`).replace('#include <map_fragment>', `#include <map_fragment>
{
  vec2 p = vec2(uFit.x * vWorld.x + uFit.y, uFit.z * vWorld.z + uFit.w) * uPhotoPx;   // photo pixel
  vec2 bq = p / uSrc; ivec2 blk = ivec2(floor(bq)), n = textureSize(uIdx, 0);
  vec3 col = vec3(0.32);
  if (blk.x >= 0 && blk.y >= 0 && blk.x < n.x && blk.y < n.y) {
    vec4 e = texelFetch(uIdx, blk, 0);
    float sl = floor(e.r * 255.0 + 0.5) + floor(e.g * 255.0 + 0.5) * 256.0 - 1.0;
    if (sl >= 0.0) {
      vec2 ap = vec2(mod(sl, uCols), floor(sl / uCols)) * (uDst + 2.0 * uPad) + uPad + fract(bq) * uDst;
      vec2 g = vec2(uDst / uSrc) / uAtlasSize;   // gradients of the continuous photo position: no seams at block edges
      col = textureGrad(uAtlas, ap / uAtlasSize, dFdx(p) * g, dFdy(p) * g).rgb;
    }
  }
  diffuseColor.rgb *= col;
}`);
  };
  m.userData.textures = [atlas, idx];
  return m;
}
function dropBridges(t) {
  t.bridgeMat?.userData.textures.forEach((x) => x.dispose()); t.bridgeMat?.dispose();
  t.bridgeMat = null; t.bridgeP = null;
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
  return hit ? hit.point.y : s.tiles?.heightAt(x, z) ?? null;
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
/* Buildings come in parts: one mesh per tile (and per source model) as the tiles stream in (assets/tiles.js). Each
   part's HKU buildings stay in the solid mesh; the rest go to see-through child meshes sharing its vertices, one per
   DECO_CELL block (by building centre) so the renderer skips the blocks out of view. Further than DECO_NEAR from a
   tile, and before its full models are in, its simplified buildings (lod.glb) stand in for them. */
const DECO_CELL = 150;
const BUILD_MAT = cutify(new THREE.MeshLambertMaterial({ color: 0xf1eee8, flatShading: true }));
const DECO_MAT = cutify(new THREE.MeshLambertMaterial({ color: 0xf1eee8, flatShading: true, transparent: true, opacity: DECO_OPACITY, depthWrite: false }));
function addPart(s, mesh, tile) {
  mesh.material = BUILD_MAT; mesh.castShadow = mesh.receiveShadow = true;
  const part = { mesh, tile, all: mesh.geometry.index, hl: new Map(), decos: [] };
  mesh.userData.part = part;
  s.bparts.push(part); s.pickables.push(mesh);
  splitPart(s, part);
  addHighlight(s, part);
}
// a tile's simplified buildings: HKU ones solid, the rest see-through (as the full models); bridges as the full ones
function addLod(s, t, root) {
  const meshes = []; root.traverse((o) => o.isMesh && meshes.push(o));
  t.lodParts = { hku: [], deco: [], infra: [] };
  for (const o of meshes) {
    if ((o.name || o.parent?.name || '').startsWith('buildings')) {
      o.material = DECO_MAT; o.renderOrder = 1; o.userData.all = o.geometry.index;
      const h = new THREE.Mesh(new THREE.BufferGeometry(), BUILD_MAT);
      for (const k of ['position', '_bid']) h.geometry.setAttribute(k, o.geometry.attributes[k]);
      h.geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(0), 1));
      o.add(h); t.lodParts.deco.push(o); t.lodParts.hku.push(h);
    } else { o.material = INFRA_MAT; t.lodParts.infra.push(o); }
  }
  splitLod(s, t);
}
function splitLod(s, t) {
  const set = s.hkuSet, L = t.lodParts; if (!L || !set || L.split === set) return;
  L.split = set;
  L.deco.forEach((o, i) => {
    const idx = o.userData.all.array, bid = o.geometry.attributes._bid, a = [], b = [];
    for (let k = 0; k < idx.length; k += 3) (set.has(bid.getX(idx[k])) ? a : b).push(idx[k], idx[k + 1], idx[k + 2]);
    o.geometry.setIndex(new THREE.BufferAttribute(new idx.constructor(b), 1)); indexBounds(o.geometry);
    const h = L.hku[i].geometry; h.setIndex(new THREE.BufferAttribute(new idx.constructor(a), 1));
    if (a.length) indexBounds(h);
  });
}
// full models or simplified ones, per tile (see DECO_NEAR)
function showLod(s, t) {
  const full = !!t.objects, near = full && s.tiles.distTo(t.info.id) < DECO_NEAR, L = t.lodParts;
  if (L) {
    L.deco.forEach((o) => (o.visible = !near));
    L.hku.forEach((o) => (o.visible = !full));
    L.infra.forEach((o) => (o.visible = !full));
  }
  if (full) for (const p of s.bparts) if (p.tile === t.info.id) p.decos.forEach((d) => (d.visible = near));
}
function dropPart(s, part) {
  for (const arr of [s.bparts, s.pickables]) for (const o of [part, part.mesh, ...part.decos]) { const i = arr.indexOf(o); if (i >= 0) arr.splice(i, 1); }
  s.hl = s.hl.filter((m) => m.parent !== part.mesh);
  part.decos.forEach((d) => d.geometry.dispose()); part.hl.forEach((g) => g.dispose());
}
// bounds of the triangles a geometry draws (three.js would take every vertex of the shared position buffer)
function indexBounds(g) {
  const pos = g.attributes.position, idx = g.index.array, b = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = 0; i < idx.length; i++) b.expandByPoint(v.fromBufferAttribute(pos, idx[i]));
  g.boundingBox = b; g.boundingSphere = b.getBoundingSphere(new THREE.Sphere());
}
function splitPart(s, part) {
  const set = s.hkuSet; if (!set || !s.bmeta || part.split === set) return;
  part.split = set;
  const g = part.mesh.geometry, bid = g.attributes._bid, idx = part.all.array;
  const cellOf = (b) => { const m = s.bmeta[b]; return m ? `${Math.floor(m.x / DECO_CELL)},${Math.floor(m.z / DECO_CELL)}` : '?'; };
  const counts = new Map(); let n = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const b = bid.getX(idx[i]);
    if (set.has(b)) n++; else { const c = cellOf(b); counts.set(c, (counts.get(c) || 0) + 1); }
  }
  const A = new idx.constructor(n * 3), cells = new Map();
  for (const [c, k] of counts) cells.set(c, { arr: new idx.constructor(k * 3), o: 0 });
  for (let i = 0, a = 0; i < idx.length; i += 3) {
    const b = bid.getX(idx[i]);
    let dst, o;
    if (set.has(b)) { dst = A; o = a; a += 3; } else { const c = cells.get(cellOf(b)); dst = c.arr; o = c.o; c.o += 3; }
    dst[o] = idx[i]; dst[o + 1] = idx[i + 1]; dst[o + 2] = idx[i + 2];
  }
  g.setIndex(new THREE.BufferAttribute(A, 1)); indexBounds(g);
  for (const d of part.decos) { part.mesh.remove(d); d.geometry.dispose(); const i = s.pickables.indexOf(d); if (i >= 0) s.pickables.splice(i, 1); }
  part.decos = [];
  for (const { arr } of cells.values()) {
    const d = new THREE.Mesh(new THREE.BufferGeometry(), DECO_MAT);
    for (const k of ['position', '_bid']) d.geometry.setAttribute(k, g.attributes[k]);
    d.geometry.setIndex(new THREE.BufferAttribute(arr, 1)); indexBounds(d.geometry);
    d.renderOrder = 1; d.castShadow = true; d.userData.deco = true; d.userData.part = part;
    d.userData.center = d.geometry.boundingSphere.center.clone().applyMatrix4(part.mesh.matrixWorld);
    part.mesh.add(d); part.decos.push(d); s.pickables.push(d);
  }
}
function splitBuildings() {
  if (!S.bmeta) return;
  const c = S.campus || {}, polys = (c.areas || []).map((a) => a.boundary), exclude = new Set(c.exclude || []);
  const codes = new Set([...(c.include || []), ...S.places.places.filter((p) => p.hku !== false).flatMap((p) => p.buildings)]);
  const set = new Set();
  S.bmeta.forEach((b, i) => { if (codes.has(b.id) || (!exclude.has(b.id) && polys.some((poly) => insidePoly(b.x, b.z, poly)))) set.add(i); });
  const key = [...set].join(',');
  if (S.hkuKey === key) return;
  S.hkuKey = key; S.hkuSet = set;
  S.bparts.forEach((p) => splitPart(S, p));
  for (const t of S.tiles?.tiles.values() || []) splitLod(S, t);
}
const HL_MAT = cutify(new THREE.MeshLambertMaterial({ color: 0xf5b82e, flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
function highlight(bids) {
  S.hl.forEach((m) => m.parent?.remove(m)); S.hl = [];
  (S.hlx || []).forEach((m) => S.scene.remove(m)); S.hlx = [];
  for (const b of bids || []) {
    const ex = S.bmeta[b]?.extra;
    if (ex) { const m = new THREE.Mesh(ex.geometry, HL_MAT); m.visible = !S.hlHidden; S.scene.add(m); S.hlx.push(m); }
  }
  S.hlBids = (bids || []).filter((b) => !S.bmeta[b]?.extra);
  S.bparts.forEach((p) => addHighlight(S, p));
}
// the highlighted buildings within one part (again when its tile streams back in)
function addHighlight(s, part) {
  const bids = s.hlBids; if (!bids?.length || !bids.some((b) => s.bmeta?.[b]?.tile === part.tile)) return;
  const key = bids.join(',');
  let geo = part.hl.get(key);
  if (!geo) {
    const bidAttr = part.mesh.geometry.attributes._bid, idx = part.all.array, set = new Set(bids);
    let n = 0; for (let i = 0; i < idx.length; i += 3) if (set.has(bidAttr.getX(idx[i]))) n++;
    const out = new idx.constructor(n * 3);
    for (let i = 0, k = 0; i < idx.length; i += 3) if (set.has(bidAttr.getX(idx[i]))) { out[k++] = idx[i]; out[k++] = idx[i + 1]; out[k++] = idx[i + 2]; }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', part.mesh.geometry.attributes.position);
    geo.setIndex(new THREE.BufferAttribute(out, 1)); if (out.length) indexBounds(geo);
    part.hl.set(key, geo);
  }
  if (!geo.index.count) return;
  const m = new THREE.Mesh(geo, HL_MAT); m.visible = !s.hlHidden;
  part.mesh.add(m); s.hl.push(m);
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
  if (p) return selectPlace(p, false);
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
  if (p) {
    html += `<h3>${esc(L(p.name))}</h3><div class="sub"><i class="dot" style="background:${cat?.color}"></i>${esc(L(cat))}${p.no ? ` · #${esc(p.no)}` : ''}${hgt ? ` · ${tt('height')} ≈ ${hgt} m` : ''}</div>
      ${L(p.desc) ? `<p>${esc(L(p.desc))}</p>` : '<p></p>'}${p.guess ? `<p class="guess">⚠︎ ${tt('guess')}</p>` : ''}
      <div class="acts"><a class="btn primary" href="${href('buildings', { b: p.id })}">${tt('guide')}</a>${p.floors?.length ? `<a class="btn" href="${href('buildings', { b: p.id })}">🗺 ${tt('floorPlans')} (${p.floors.length})</a>` : ''}</div>`;
  } else {
    const b = S.bmeta[sel.bid];
    html += `<h3>${tt('unnamed')}</h3><div class="sub">${tt('height')} ≈ ${hgt} m · ${Math.round(b.base)}–${Math.round(b.top)} mPD</div>`;
  }
  d.innerHTML = html;
  d.querySelector('.close').addEventListener('click', clearSelection);
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
  // decorative (non-HKU) buildings don't react, and clicks pass through them
  const hit = hits.find((h) => !h.object.userData.deco);
  const isB = (o) => o?.userData.part && !o.userData.deco;
  if (hits[0]?.object.userData.deco && !isB(hit?.object)) return;
  if (!hit) return clearSelection();
  if (isB(hit.object)) {
    const bid = hit.object.geometry.attributes._bid.getX(hit.face.a);
    selectBuilding(bid);
  } else if (hit.object.userData.bid != null) selectBuilding(hit.object.userData.bid);
  else clearSelection();
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
  return hit ? hit.point.y : S.tiles?.heightAt(x, z) ?? null;   // tiles not loaded: the 10 m height grid
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
  const pl = p.get('place') && S.places.places.find((x) => x.id === p.get('place'));
  if (pl) selectPlace(pl, true);
  const r = p.get('route') && S.routes.findIndex((x) => x.id === p.get('route'));
  if (r != null && r >= 0) { toggleRoutes(); showRoute(r, true); }
}
function toast(msg) {
  const d = document.createElement('div');
  d.className = 'map-ui map-toast';
  d.textContent = msg; S.wrap.appendChild(d); setTimeout(() => d.remove(), 2500);
}

/* ---------------- frame ---------------- */
function frame(now) {
  if (!S.running) return;
  if (S.anim) S.anim(now);
  S.controls.update();
  S.tiles?.update();
  // full or simplified buildings per tile; trees, markings and lamps close by
  for (const t of S.tiles?.tiles.values() || []) { showLod(S, t); if (t.feat) showTileFeatures(S, t); }
  fitShadow(S);
  S.indoor?.update();
  S.renderer.render(S.scene, S.camera);
  if (S.compass) S.compass.style.transform = `rotate(${(S.controls.getAzimuthalAngle() * 180) / Math.PI}deg)`;
  updatePins();
}
