"""Build the map overlay (roads, footpaths, gardens, woodland, water) from an
OpenStreetMap screenshot, warped into the 3D model's frame.

    python3 tools/build_overlay.py osm.png "<s>,<theta>,<tx>,<tz>"

The four numbers map an OSM image pixel (u, v) to the model frame:
    x = s*(cos t*u - sin t*v) + tx,   z = s*(sin t*u + cos t*v) + tz
(found by matching OSM building outlines against the model's footprints).

Writes assets/map/overlay-a.png (R minor road, G major road, B footpath,
A coverage) and assets/map/overlay-b.png (R park/garden, G woodland, B water),
plus assets/map/overlay.json with the covered model extent.
Map data © OpenStreetMap contributors (ODbL).
"""
import json, sys
import numpy as np
from PIL import Image, ImageFilter

RES = 0.5  # metres per overlay pixel

src = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
s, th, tx, tz = map(float, sys.argv[2].split(','))
H, W = src.shape[:2]

def near(c, tol=9):
    return np.abs(src - np.array(c)).max(2) <= tol

# OSM Carto colours -> classes
UNK, PAVED, MINOR, MAJOR, PATH, PARK, WOOD, WATER = -1, 0, 1, 2, 3, 4, 5, 6
lab = np.full((H, W), UNK, np.int8)
for c in [(255, 255, 229), (217, 208, 201), (224, 223, 223), (242, 239, 233), (238, 238, 238), (196, 182, 171), (221, 221, 232)]:
    lab[near(c)] = PAVED
lab[near((255, 255, 255), 3)] = MINOR
for c in [(247, 250, 191), (252, 214, 164)]:
    lab[near(c, 8)] = MAJOR
r, g, b = src[..., 0], src[..., 1], src[..., 2]
lab[(r > 215) & (g > 90) & (g < 175) & (b > 80) & (b < 165) & (r - g > 60)] = PATH
for c in [(200, 250, 204), (205, 235, 176), (136, 224, 190), (223, 252, 226)]:
    lab[near(c, 8)] = PARK
woodish = (g > r) & (g > b) & (g - b > 25) & (r < 190) & (g < 225)
lab[woodish & (lab == UNK)] = WOOD
lab[near((170, 211, 223), 8)] = WATER

# fill unknown pixels (text, icons, casings) from their neighbours
for _ in range(12):
    unk = lab == UNK
    if not unk.any():
        break
    for dy, dx in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
        nb = np.roll(np.roll(lab, dy, 0), dx, 1)
        take = unk & (nb != UNK) & (nb != PATH)
        lab[take] = nb[take]
        unk = lab == UNK
lab[lab == UNK] = PAVED

# model extent covered by the screenshot
c, si = np.cos(th), np.sin(th)
corners = np.array([[0, 0], [W, 0], [0, H], [W, H]], float)
xs = s * (c * corners[:, 0] - si * corners[:, 1]) + tx
zs = s * (si * corners[:, 0] + c * corners[:, 1]) + tz
X0, X1, Z0, Z1 = np.floor(xs.min()), np.ceil(xs.max()), np.floor(zs.min()), np.ceil(zs.max())
OW, OH = int((X1 - X0) / RES), int((Z1 - Z0) / RES)
yy, xx = np.mgrid[0:OH, 0:OW]
x = X0 + (xx + .5) * RES - tx
z = Z0 + (yy + .5) * RES - tz
u = (c * x + si * z) / s
v = (-si * x + c * z) / s
ui, vi = np.round(u).astype(int), np.round(v).astype(int)
ok = (ui >= 0) & (ui < W) & (vi >= 0) & (vi < H)
L = np.full((OH, OW), PAVED, np.int8)
L[ok] = lab[vi[ok], ui[ok]]

# coverage feathered over ~25 m at the screenshot border
edge = np.minimum.reduce([u, W - u, v, H - v]) * s
cov = np.clip(edge / 25.0, 0, 1) * ok

def mask(*cls):
    m = np.isin(L, cls).astype(np.uint8) * 255
    return Image.fromarray(m).filter(ImageFilter.GaussianBlur(0.7))

def path_mask():  # footways are 1-2 px dashes in the source: thicken to ~1.5 m
    m = Image.fromarray(np.isin(L, (PATH,)).astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3))
    return m.filter(ImageFilter.GaussianBlur(0.6))

a = Image.merge('RGBA', [mask(MINOR), mask(MAJOR), path_mask(), Image.fromarray((cov * 255).astype(np.uint8))])
bimg = Image.merge('RGB', [mask(PARK), mask(WOOD), mask(WATER)])
a.save('assets/map/overlay-a.png', optimize=True)
bimg.save('assets/map/overlay-b.png', optimize=True)
json.dump({'extent': [X0, X1, Z0, Z1], 'source': 'OpenStreetMap', 'attribution': '© OpenStreetMap contributors'},
          open('assets/map/overlay.json', 'w'))
print('overlay', OW, 'x', OH, 'extent', [X0, X1, Z0, Z1])
