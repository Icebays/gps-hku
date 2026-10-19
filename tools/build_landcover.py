"""Vector land cover and trees from the high-quality 3dmap.gov.hk tiles.

    python3 tools/build_landcover.py work/7C work/7D

- green: footprint of the VEGETATION(TB) canopy meshes, as polygons
- water: WATERBODY meshes, as polygons
- trees: canopy tops (local maxima of canopy height above the TERRAIN(TB) ground),
  [x, z, ground y, height, crown radius]
Writes data/landcover.json (model frame: x = E - 832250, z = -(N - 815900)).
Needs: numpy, opencv-python-headless
"""
import glob, json, sys
import numpy as np
import cv2
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import hkgltf

X0, X1, Z0, Z1, R = -750, 750, -305, 305, 0.5
W, H = int((X1 - X0) / R), int((Z1 - Z0) / R)
tiles = sys.argv[1:]

def px(P):
    return ((P[:, 0] - X0) / R).astype(int), ((P[:, 2] - Z0) / R).astype(int)

def splat_max(prims, grid, cnt=None):
    for p in prims:
        u, v = px(p['P']); ok = (u >= 0) & (u < W) & (v >= 0) & (v < H)
        np.maximum.at(grid, (v[ok], u[ok]), p['P'][ok, 1].astype(np.float32))
        if cnt is not None:
            np.add.at(cnt, (v[ok], u[ok]), 1)

def fill_tris(prims, mask):
    for p in prims:
        P = p['P']; T = P[p['I']]
        pts = np.stack([(T[..., 0] - X0) / R, (T[..., 2] - Z0) / R], -1)
        cv2.fillPoly(mask, [np.round(t * 4).astype(np.int32) for t in pts], 255, shift=2)

def polygons(mask, min_area_m2, eps_m):
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if hier is None:
        return out
    def simp(c):
        a = cv2.approxPolyDP(c, eps_m / R, True)[:, 0, :].astype(float)
        return [[round(X0 + x * R, 1), round(Z0 + z * R, 1)] for x, z in a]
    for i, c in enumerate(cs):
        if hier[0][i][3] != -1 or cv2.contourArea(c) * R * R < min_area_m2:
            continue
        holes, j = [], hier[0][i][2]
        while j != -1:
            if cv2.contourArea(cs[j]) * R * R >= min_area_m2:
                holes.append(simp(cs[j]))
            j = hier[0][j][0]
        o = simp(c)
        if len(o) >= 3:
            out.append({'outer': o, 'holes': [h for h in holes if len(h) >= 3]})
    return out

# ---------- ground height (terrain) ----------
ground = np.full((H, W), -1e9, np.float32)
for t in tiles:
    for f in glob.glob(f'{t}/TERRAIN*/*/*.gltf'):
        splat_max(hkgltf.read(f)[1], ground)
known = ground > -1e8
g8 = np.where(known, ground, 0).astype(np.float32)
# fill empty cells from neighbours (normalised blur)
for k in (3, 7, 15, 31):
    num = cv2.blur(g8 * known, (k, k)); den = cv2.blur(known.astype(np.float32), (k, k))
    fill = (~known) & (den > 0)
    g8[fill] = num[fill] / den[fill]; known = known | fill
ground = g8

# ---------- vegetation ----------
veg = np.full((H, W), -1e9, np.float32); cnt = np.zeros((H, W), np.int32)
for t in tiles:
    for f in glob.glob(f'{t}/VEGETATION*/*/*.gltf'):
        splat_max(hkgltf.read(f)[1], veg, cnt)
vm = (cnt > 0).astype(np.uint8) * 255
vm = cv2.morphologyEx(vm, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
vm = cv2.morphologyEx(vm, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
green = polygons(vm, 12, 0.6)

# ---------- water ----------
wm = np.zeros((H, W), np.uint8)
for t in tiles:
    for f in glob.glob(f'{t}/WATERBODY/*/*.gltf'):
        try:
            fill_tris(hkgltf.read(f)[1], wm)
        except Exception as e:
            print('skip', f, e)
wm = cv2.morphologyEx(wm, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
water = polygons(wm, 2, 0.3)

# ---------- trees: canopy tops ----------
ch = np.where(cnt > 0, veg - ground, 0).astype(np.float32)
ch = cv2.GaussianBlur(ch, (0, 0), 1.2)
ch[vm == 0] = 0
peak = (ch == cv2.dilate(ch, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))) & (ch > 2.5)
dist = cv2.distanceTransform(vm, cv2.DIST_L2, 5) * R
vs, us = np.nonzero(peak)
order = np.argsort(-ch[vs, us])
taken = np.zeros((H, W), bool); trees = []
for k in order:
    v, u = vs[k], us[k]
    if taken[v, u]:
        continue
    h = float(ch[v, u]); r = float(np.clip(min(0.32 * h + 1.0, dist[v, u] + 1.0), 1.5, 6.5))
    rr = max(3, int(r * 0.8 / R))
    taken[max(0, v - rr):v + rr + 1, max(0, u - rr):u + rr + 1] = True
    x, z = X0 + (u + .5) * R, Z0 + (v + .5) * R
    trees.append([round(x, 1), round(z, 1), round(float(ground[v, u]), 1), round(min(h, 30), 1), round(r, 1)])

json.dump({'source': '3D Spatial Data © Lands Department, HKSAR', 'green': green, 'water': water, 'trees': trees},
          open('data/landcover.json', 'w'), separators=(',', ':'))
print('green', len(green), 'water', len(water), 'trees', len(trees))
