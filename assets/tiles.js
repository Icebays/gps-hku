/* Streamed map tiles, Google Earth style (data from tools/build_tiles.mjs, assets/tiles/).
   Only the tiles around the view are loaded: a tile's terrain within TERRAIN_NEAR of the camera, its buildings and
   bridges within OBJECTS_NEAR, and both are dropped again further out. Each tile's aerial photo is a quadtree
   (levels 0-3: the whole tile at 512 px down to 8 x 8 pieces at the full 4096 px); a piece is fetched only when it is
   in view and drawn larger on screen than its own resolution, so the photo sharpens as you zoom in and only the
   pieces you look at are held. Until a piece arrives its parent stays in its place. A tile further than FULL_NEAR
   uses a simplified copy of its terrain (its edges match its neighbours, so tiles never crack apart). Photo pieces are kept within a memory budget
   (smaller on phones), the least recently seen going first. Building geometry is never simplified.
   createTiles() takes callbacks for what map.js does with the meshes (materials, picking, roads). */
import * as THREE from 'three';

const BASE = 'assets/tiles/';
const TERRAIN_NEAR = 4200, TERRAIN_FAR = 5000;      // m from the camera to the tile: load / drop
const MOBILE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const OBJECTS_NEAR = MOBILE ? 1400 : 1700, OBJECTS_FAR = OBJECTS_NEAR + 500;      // buildings beyond are far into the haze
const FULL_NEAR = 700;    // m: closer than this a tile's terrain is drawn in full, further out simplified
const REFINE = 1.15;      // refine a piece when it covers more than REFINE x its pixels on screen
const BUDGET = MOBILE ? 70 : 170;   // photo pieces held (about 1.1 MB of GPU memory each)
const PARALLEL = 6;

export function createTiles({ camera, renderer, loader, core = [], terrainMaterial, onTerrain, onTerrainDrop, onObjects, onObjectsDrop }) {
  const st = { index: null, tiles: new Map(), queue: [], active: 0, tick: 0, last: '', heights: null };
  const box = new THREE.Box3(), frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), v = new THREE.Vector2();
  const dist = (x0, x1, y0, y1, z0, z1) => {
    const p = camera.position;
    return Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(y0 - p.y, 0, p.y - y1), Math.max(z0 - p.z, 0, p.z - z1));
  };

  // ---- loading ----
  function enqueue(job) { st.queue.push(job); pump(); }
  function pump() {
    st.queue.sort((a, b) => a.pri - b.pri);
    while (st.active < PARALLEL && st.queue.length) {
      const job = st.queue.shift();
      if (job.cancelled?.()) continue;
      st.active++;
      job.run().catch((e) => console.warn('tile', e)).finally(() => { st.active--; pump(); });
    }
  }
  async function bitmap(url) {
    const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.blob(); });
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); } catch (e) { /* fall back */ }
    }
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode(); return img;
  }
  async function loadPiece(t, key, n) {
    const [L, i, j] = key.split('_').map(Number);
    const img = await bitmap(`${BASE}${t.info.id}/t${L}_${i}_${j}.webp`);
    if (!t.terrain) { img.close?.(); return; }
    const tex = new THREE.Texture(img);
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const [, , u0, v0, u1, v1] = n;
    tex.repeat.set(1 / (u1 - u0), 1 / (v1 - v0)); tex.offset.set(-u0 / (u1 - u0), -v0 / (v1 - v0));
    tex.onUpdate = () => { img.close?.(); };      // keep only the GPU copy
    tex.needsUpdate = true;
    const p = t.pieces.get(key); if (!p) { tex.dispose(); return; }
    p.mat = terrainMaterial(tex); p.tex = tex; p.ready = true;
    st.last = '';     // redraw the cut
  }
  async function loadTerrain(t) {
    const g = await loader.loadAsync(BASE + t.info.terrain);
    if (!t.wantTerrain) { dispose(g.scene); return; }
    const meshes = []; g.scene.traverse((o) => o.isMesh && meshes.push(o));
    const [full, far] = meshes;
    g.scene.updateMatrixWorld(true);
    t.terrain = { root: g.scene, full, far };
    full.visible = far.visible = false;
    onTerrain?.(t, full, far, g.scene);
    st.last = '';
  }
  async function loadObjects(t) {
    const g = await loader.loadAsync(BASE + t.info.objects);
    if (!t.wantObjects) { dispose(g.scene); return; }
    g.scene.updateMatrixWorld(true);
    t.objects = { root: g.scene };
    onObjects?.(t, g.scene);
  }
  function dispose(root) { root.traverse((o) => { o.geometry?.dispose(); }); }
  function dropPiece(t, key) {
    const p = t.pieces.get(key); if (!p) return;
    p.mat?.dispose(); p.tex?.dispose(); t.pieces.delete(key);
  }
  function dropTerrain(t) {
    if (t.terrain) { onTerrainDrop?.(t, t.terrain.full, t.terrain.far, t.terrain.root); dispose(t.terrain.root); }
    for (const k of [...t.pieces.keys()]) dropPiece(t, k);
    t.terrain = null; t.loadingTerrain = false;
  }
  function dropObjects(t) {
    if (t.objects) { onObjectsDrop?.(t, t.objects.root); dispose(t.objects.root); }
    t.objects = null; t.loadingObjects = false;
  }
  function want(t, key, n, pri) {
    let p = t.pieces.get(key);
    if (!p) {
      p = { seen: 0, ready: false }; t.pieces.set(key, p);
      enqueue({ pri, run: () => loadPiece(t, key, n), cancelled: () => !t.terrain || t.pieces.get(key) !== p });
    }
    p.seen = st.tick;
    return p;
  }

  // ---- level of detail ----
  function cut(t, pxPerRad) {
    const e = t.info.extent, [y0, y1] = t.info.y, nodes = t.info.nodes, D = nodes.length - 1, out = [];
    const walk = (L, i, j) => {
      const n = nodes[L][j * (1 << L) + i]; if (!n) return;
      const w = (e[1] - e[0]) / (1 << L), h = (e[3] - e[2]) / (1 << L);
      const x0 = e[0] + i * w, z0 = e[2] + j * h;
      const d = Math.max(1, dist(x0, x0 + w, y0, y1, z0, z0 + h));
      box.min.set(x0, y0, z0); box.max.set(x0 + w, y1, z0 + h);
      const seen = L === 0 || frustum.intersectsBox(box);
      // piece size on screen (px) against its own resolution (px)
      const res = Math.max((n[4] - n[2]) * t.info.photo[0], (n[5] - n[3]) * t.info.photo[1]) * 2 ** (L - D);
      if (seen && L < D && (Math.max(w, h) / d) * pxPerRad > res * REFINE) {
        for (let jj = 0; jj < 2; jj++) for (let ii = 0; ii < 2; ii++) walk(L + 1, i * 2 + ii, j * 2 + jj);
      } else out.push({ L, i, j, n, d, seen });
    };
    walk(0, 0, 0);
    return out;
  }
  const keyOf = (L, i, j) => `${L}_${i}_${j}`;
  function draw(t, pxPerRad) {
    const T = t.terrain, nodes = t.info.nodes;
    const root = want(t, '0_0_0', nodes[0][0], -1e9);    // the whole-tile picture comes first and stays
    const leaves = cut(t, pxPerRad);
    const chosen = new Map();
    for (const lf of leaves) {
      const p = want(t, keyOf(lf.L, lf.i, lf.j), lf.n, lf.L * 1e4 + lf.d + (lf.seen ? 0 : 1e5));
      // the nearest piece that is ready: this one, else its parent...
      let L = lf.L, i = lf.i, j = lf.j, q = p;
      while (!q?.ready && L > 0) { L--; i >>= 1; j >>= 1; q = t.pieces.get(keyOf(L, i, j)); if (q) q.seen = st.tick; }
      if (q?.ready) chosen.set(keyOf(L, i, j), [L, i, j, q]);
    }
    if (!root.ready) { T.full.visible = T.far.visible = false; return; }
    // drop pieces covered by a chosen parent
    const keys = [...chosen.keys()].filter((k) => {
      let [L, i, j] = k.split('_').map(Number);
      while (L > 0) { L--; i >>= 1; j >>= 1; if (chosen.has(keyOf(L, i, j))) return false; }
      return true;
    }).sort();
    const e = t.info.extent, [y0, y1] = t.info.y;
    const near = dist(e[0], e[1], y0, y1, e[2], e[3]) < FULL_NEAR;
    const [show, hide] = near ? [T.full, T.far] : [T.far, T.full];
    const sig = (near ? 'n' : 'f') + keys.join('|');
    if (T.sig !== sig) {
      T.sig = sig;
      const g = show.geometry; g.clearGroups();
      const mats = [];
      for (const k of keys) {
        const [L, i, j, q] = chosen.get(k), n = nodes[L][j * (1 << L) + i];
        const [a, c] = near ? [n[0], n[1]] : [n[6], n[7]];
        if (c) { g.addGroup(a * 3, c * 3, mats.length); mats.push(q.mat); }
      }
      show.material = mats;
      hide.geometry.clearGroups(); hide.material = root.mat;    // (the full mesh is also what clicks and heights hit)
    }
    show.visible = true; hide.visible = false;
  }
  function evict() {
    const all = [];
    for (const t of st.tiles.values()) for (const [k, p] of t.pieces) if (k !== '0_0_0' && p.seen < st.tick) all.push([p.seen, t, k]);
    let count = 0; for (const t of st.tiles.values()) count += t.pieces.size;
    all.sort((a, b) => a[0] - b[0]);
    for (const [, t, k] of all) { if (count <= BUDGET) break; dropPiece(t, k); count--; t.terrain && (t.terrain.sig = null); }
  }

  function update(force) {
    if (!st.index) return;
    st.tick++;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // screen pixels per radian of view (phones: at most 1.25 device pixels per CSS pixel, for memory)
    const pr = renderer.getPixelRatio(), h = (renderer.getDrawingBufferSize(v).y / pr) * Math.min(pr, MOBILE ? 1.25 : 2);
    const pxPerRad = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    for (const t of st.tiles.values()) {
      const e = t.info.extent, [y0, y1] = t.info.y;
      const d = dist(e[0], e[1], y0, y1 + 150, e[2], e[3]);
      const pinned = core.includes(t.info.id);
      t.wantTerrain = pinned || d < (t.terrain || t.loadingTerrain ? TERRAIN_FAR : TERRAIN_NEAR);
      t.wantObjects = !!t.info.objects && (pinned || d < (t.objects || t.loadingObjects ? OBJECTS_FAR : OBJECTS_NEAR));
      if (t.wantTerrain && !t.terrain && !t.loadingTerrain) { t.loadingTerrain = true; enqueue({ pri: -2e9 + d, run: () => loadTerrain(t).finally(() => (t.loadingTerrain = false)) }); }
      if (!t.wantTerrain && t.terrain) dropTerrain(t);
      if (t.wantObjects && !t.objects && !t.loadingObjects) { t.loadingObjects = true; enqueue({ pri: -1.5e9 + d, run: () => loadObjects(t).finally(() => (t.loadingObjects = false)) }); }
      if (!t.wantObjects && t.objects) dropObjects(t);
      if (t.terrain) draw(t, pxPerRad);
    }
    evict();
  }

  // ---- heights (pins and labels where the terrain is not loaded) ----
  function heightAt(x, z) {
    const H = st.heights; if (!H) return null;
    const fx = (x - H.x0) / H.cell - 0.5, fz = (z - H.z0) / H.cell - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
    let s = 0, w = 0;
    for (const [di, dj, k] of [[0, 0, (1 - a) * (1 - b)], [1, 0, a * (1 - b)], [0, 1, (1 - a) * b], [1, 1, a * b]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= H.cols || jj >= H.rows) continue;
      const h = H.data[jj * H.cols + ii]; if (h === H.none) continue;
      s += h * H.scale * k; w += k;
    }
    return w > 0 ? s / w : null;
  }
  function tileAt(x, z, slack = 0) {
    let best = null, bd = Infinity;
    for (const t of st.tiles.values()) {
      const e = t.info.extent;
      const d = Math.hypot(Math.max(e[0] - x, 0, x - e[1]), Math.max(e[2] - z, 0, z - e[3]));
      if (d === 0) return t;
      if (d < bd) { bd = d; best = t; }
    }
    return bd <= slack ? best : null;
  }

  // ---- start: index, heights, then the core tiles before the map is shown ----
  const ready = (async () => {
    st.index = await fetch(BASE + 'index.json').then((r) => r.json());
    for (const info of st.index.tiles) st.tiles.set(info.id, { info, pieces: new Map(), terrain: null, objects: null });
    const H = st.index.heights;
    st.heights = { ...H, data: new Int16Array(await fetch(BASE + H.file).then((r) => r.arrayBuffer())) };
    update();
    // the map opens once the core tiles stand, with their whole-tile pictures
    await new Promise((res) => {
      const check = () => {
        const ok = core.every((id) => { const t = st.tiles.get(id); return !t || (t.terrain && (!t.info.objects || t.objects) && t.pieces.get('0_0_0')?.ready); });
        if (ok) res(); else setTimeout(check, 50);
      };
      check();
    });
  })();
  const progress = () => {
    let want = 0, have = 0;
    for (const id of core) { const t = st.tiles.get(id); if (!t) continue; want += t.info.objects ? 3 : 2; have += !!t.terrain + !!t.objects + !!t.pieces.get('0_0_0')?.ready; }
    return want ? have / want : 0;
  };
  // distance from the camera to a tile (m)
  const distTo = (id) => { const t = st.tiles.get(id); if (!t) return Infinity; const e = t.info.extent, [y0, y1] = t.info.y; return dist(e[0], e[1], y0, y1 + 150, e[2], e[3]); };
  return { ready, update, heightAt, tileAt, distTo, progress, tiles: st.tiles, get index() { return st.index; } };
}
