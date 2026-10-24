"""Map features of one more tile from its high-quality 3dmap.gov.hk release: what the main campus
(11-SW-7C / 7D) has from tools/build_landcover.py and build_roadnet.py, for any tile.

    python3 tools/build_tile_features.py work/7A 11-SW-7A assets/tiles/11-SW-7A

work/7A: the high-quality zip unzipped (TERRAIN(TB), VEGETATION(TB), WATERBODY, INFRASTRUCTURE(TB),
INFRASTRUCTURE are used). The tile's extent comes from data/tiles.json; everything is clipped to it, so
neighbouring tiles never overlap. Writes into the tile's folder:
  land.json        {ext, green, water, trees, roads} - vegetation / water polygons, trees [x, z, ground y,
                   height, crown radius] and road centre lines [{pts, width, lanes, class}], model frame
The road centre lines come from the road surfaces drawn straight into a mask (no renders needed):
INFRASTRUCTURE(TB) roads plus the dark (asphalt) upward faces of INFRASTRUCTURE flyover decks.
Needs: numpy, pillow, opencv-python-headless, scikit-image
"""
import glob, json, os, sys
import numpy as np
import cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hkgltf
import build_roadnet
Image.MAX_IMAGE_PIXELS = None

src, tile_id, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
X0, X1, Z0, Z1 = next(t['extent'] for t in json.load(open('data/tiles.json'))['tiles'] if t['id'] == tile_id)
X0, Z0 = np.floor(X0), np.floor(Z0)

def files(sub):
    return [f for f in sorted(glob.glob(f'{src}/{glob.escape(sub)}/*/*.gltf')) if os.path.getsize(f) > 10]

def prims(sub, uv=False):
    for f in files(sub):
        try:
            d, ps = hkgltf.read(f, uv=uv)
        except Exception as e:
            print('skip', f, e); continue
        for p in ps:
            yield f, d, p

class Grid:
    def __init__(s, R):
        s.R, s.W, s.H = R, int(np.ceil((X1 - X0) / R)), int(np.ceil((Z1 - Z0) / R))
    def px(s, P):
        return ((P[:, 0] - X0) / s.R).astype(int), ((P[:, 2] - Z0) / s.R).astype(int)
    def splat_max(s, P, grid, cnt=None):
        u, v = s.px(P); ok = (u >= 0) & (u < s.W) & (v >= 0) & (v < s.H)
        np.maximum.at(grid, (v[ok], u[ok]), P[ok, 1].astype(grid.dtype))
        if cnt is not None:
            np.add.at(cnt, (v[ok], u[ok]), 1)
    def fill(s, T, mask):
        """T: triangles (n, 3, 3) in the model frame -> filled into mask"""
        if not len(T):
            return
        pts = np.stack([(T[..., 0] - X0) / s.R, (T[..., 2] - Z0) / s.R], -1)
        keep = (pts[..., 0].max(1) >= 0) & (pts[..., 0].min(1) < s.W) & (pts[..., 1].max(1) >= 0) & (pts[..., 1].min(1) < s.H)
        cv2.fillPoly(mask, list(np.round(pts[keep] * 4).astype(np.int32)), 255, shift=2)
    def ground(s):
        g = np.full((s.H, s.W), -1e9, np.float32)
        for _, _, p in prims('TERRAIN(TB)'):
            s.splat_max(p['P'], g)
        known = g > -1e8
        g = np.where(known, g, 0).astype(np.float32)
        for k in (3, 7, 15, 31, 63):        # fill empty cells from neighbours (normalised blur)
            num = cv2.blur(g * known, (k, k)); den = cv2.blur(known.astype(np.float32), (k, k))
            fill = (~known) & (den > 0)
            g[fill] = num[fill] / den[fill]; known = known | fill
        return g

def polygons(mask, R, min_area_m2, eps_m):
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

# ---------- land cover and trees (as tools/build_landcover.py) ----------
G = Grid(0.5)
ground = G.ground()
veg = np.full((G.H, G.W), -1e9, np.float32); cnt = np.zeros((G.H, G.W), np.int32)
for _, _, p in prims('VEGETATION(TB)'):
    G.splat_max(p['P'], veg, cnt)
vm = (cnt > 0).astype(np.uint8) * 255
vm = cv2.morphologyEx(vm, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
vm = cv2.morphologyEx(vm, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
green = polygons(vm, G.R, 12, 0.6)
wm = np.zeros((G.H, G.W), np.uint8)
for _, _, p in prims('WATERBODY'):
    G.fill(p['P'][p['I']], wm)
wm = cv2.morphologyEx(wm, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
water = polygons(wm, G.R, 2, 0.3)

ch = np.where(cnt > 0, veg - ground, 0).astype(np.float32)
ch = cv2.GaussianBlur(ch, (0, 0), 1.2)
ch[vm == 0] = 0
peak = (ch == cv2.dilate(ch, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))) & (ch > 2.5)
dist = cv2.distanceTransform(vm, cv2.DIST_L2, 5) * G.R
vs, us = np.nonzero(peak)
taken = np.zeros((G.H, G.W), bool); trees = []
for k in np.argsort(-ch[vs, us]):
    v, u = vs[k], us[k]
    if taken[v, u]:
        continue
    h = float(ch[v, u]); r = float(np.clip(min(0.32 * h + 1.0, dist[v, u] + 1.0), 1.5, 6.5))
    rr = max(3, int(r * 0.8 / G.R))
    taken[max(0, v - rr):v + rr + 1, max(0, u - rr):u + rr + 1] = True
    trees.append([round(X0 + (u + .5) * G.R, 1), round(Z0 + (v + .5) * G.R, 1), round(float(ground[v, u]), 1), round(min(h, 30), 1), round(r, 1)])
print('green', len(green), 'water', len(water), 'trees', len(trees))

# ---------- road centre lines (as tools/build_roadnet.py, from the geometry itself) ----------
RG = Grid(build_roadnet.RES)
road = np.zeros((RG.H, RG.W), np.uint8); deck = np.zeros((RG.H, RG.W), np.uint8)
for _, _, p in prims('INFRASTRUCTURE(TB)'):
    T = p['P'][p['I']]
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); ny = np.abs(n[:, 1]) / np.maximum(np.linalg.norm(n, axis=1), 1e-9)
    RG.fill(T[ny > 0.5], road)
small = {}
def texture(f, d, mi):
    """the material's photo, shrunk (for the mean colour under a triangle)"""
    tex = d['materials'][mi].get('pbrMetallicRoughness', {}).get('baseColorTexture') if mi is not None else None
    if tex is None:
        return None
    path = os.path.join(os.path.dirname(f), d['images'][d['textures'][tex['index']]['source']]['uri'])
    if path not in small:
        im = Image.open(path).convert('L'); im.draft('L', (512, 512))
        small[path] = np.asarray(im.resize((256, 256), Image.BILINEAR), np.float32)
    return small[path]
for f, d, p in prims('INFRASTRUCTURE', uv=True):
    T = p['P'][p['I']]
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); ny = n[:, 1] / np.maximum(np.linalg.norm(n, axis=1), 1e-9)
    up = ny > 0.85
    im = texture(f, d, p['material']) if 'UV' in p else None
    if im is not None:
        c = p['UV'][p['I']].mean(1) % 1.0
        L = im[np.clip((c[:, 1] * 256).astype(int), 0, 255), np.clip((c[:, 0] * 256).astype(int), 0, 255)]
        up &= L < 150                       # dark asphalt decks, not concrete footbridges
    RG.fill(T[up], deck)
roads = build_roadnet.centre_lines(road, deck, X0, Z0)
print('roads', len(roads))

json.dump({'source': '3D Spatial Data © Lands Department, HKSAR', 'ext': [float(X0), float(X1), float(Z0), float(Z1)],
           'green': green, 'water': water, 'trees': trees, 'roads': roads},
          open(os.path.join(out, 'land.json'), 'w'), separators=(',', ':'))
