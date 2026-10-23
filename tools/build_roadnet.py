"""Road centre lines and widths from the surveyed road surfaces.

    python3 tools/build_roadnet.py road_tiles/ bridge_tiles/

road_tiles / bridge_tiles: top-down renders (t_<x>_<z>.png, 100 m at 0.1 m/px, magenta = nothing)
of INFRASTRUCTURE(TB) road surfaces and INFRASTRUCTURE bridges (tools/README.md). Carriageway
bridge decks (>= 7 m wide, asphalt) count as road. The road mask is skeletonised into centre lines;
the width at each line comes from the distance to the road edge. Crossings and bus stops from
data/mapfeatures.json (OpenStreetMap) are snapped onto the new lines. Writes data/roadnet.json:
  roads: [{pts: [[x, z], ...], width, lanes, class}]   marks: {crossings, slow, busStops, icons}
The site draws lanes, edge lines, crossings, bus bays, parking bays and road words on top of the
surveyed road surface from this.
Needs: numpy, pillow, opencv-python-headless, scikit-image
"""
import glob, json, os, re, sys
import numpy as np
import cv2
from PIL import Image
from skimage.morphology import skeletonize

TILE, SRC_RES, RES = 100, 0.1, 0.25

def mask_of(d, keep):
    files = glob.glob(os.path.join(d, 't_*.png'))
    coords = [tuple(map(int, re.findall(r'-?\d+', os.path.basename(f)))) for f in files]
    x0, z0 = min(c[0] for c in coords), min(c[1] for c in coords)
    x1, z1 = max(c[0] for c in coords) + TILE, max(c[1] for c in coords) + TILE
    n = int(TILE / RES)
    m = np.zeros((int((z1 - z0) / RES), int((x1 - x0) / RES)), np.uint8)
    for f, (x, z) in zip(files, coords):
        t = np.asarray(Image.open(f).convert('RGB').resize((n, n), Image.BILINEAR)).astype(np.int16)
        u, v = int((x - x0) / RES), int((z - z0) / RES)
        m[v:v + n, u:u + n] = keep(t) * 255
    return m, x0, z0

def centre_lines(road, deck, X0, Z0):
    """road / deck: masks at RES m/px with (X0, Z0) at the top-left corner -> [{pts, width, lanes, class}]"""
    dt = cv2.distanceTransform((deck > 0).astype(np.uint8), cv2.DIST_L2, 5) * RES
    deck = cv2.dilate((dt >= 3.0).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (33, 33))) & (deck > 0)
    m = ((road > 0) | (deck > 0)).astype(np.uint8)
    k = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k(4))          # bridge gaps / seams up to 2 m
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k(5))           # drop slivers narrower than ~2.5 m
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    m = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] * RES * RES > 150]).astype(np.uint8)
    dist = cv2.distanceTransform(m, cv2.DIST_L2, 5) * RES
    sm = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 3) > 0.5
    sk = skeletonize(sm)

    # ---- trace skeleton into polylines split at junctions
    ys, xs = np.nonzero(sk)
    on = set(zip(ys.tolist(), xs.tolist()))
    N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    nb = lambda p: [(p[0] + a, p[1] + b) for a, b in N8 if (p[0] + a, p[1] + b) in on]
    deg = {p: len(nb(p)) for p in on}
    nodes = {p for p, d in deg.items() if d != 2}
    used, lines = set(), []
    for s in nodes:
        for q in nb(s):
            if (s, q) in used:
                continue
            line = [s, q]; used |= {(s, q), (q, s)}; prev, cur = s, q
            while cur not in nodes:
                nx = [r for r in nb(cur) if r != prev and (cur, r) not in used]
                if not nx:
                    break
                used |= {(cur, nx[0]), (nx[0], cur)}; prev, cur = cur, nx[0]; line.append(cur)
            lines.append(np.array([[c, r] for r, c in line], float))

    def length(l):
        return np.hypot(*np.diff(l, axis=0).T).sum() * RES

    # ---- prune spurs shorter than the road is wide, then merge chains through degree-2 nodes
    key = lambda p: (int(round(p[0])), int(round(p[1])))
    for _ in range(4):
        dg = {}
        for l in lines:
            for e in (key(l[0]), key(l[-1])):
                dg[e] = dg.get(e, 0) + 1
        def spur(l):
            w = 2 * max(dist[int(l[0][1]), int(l[0][0])], dist[int(l[-1][1]), int(l[-1][0])])
            return (dg[key(l[0])] == 1 or dg[key(l[-1])] == 1) and length(l) < max(6, 1.2 * w)
        keep = [l for l in lines if not spur(l)]
        if len(keep) == len(lines):
            break
        lines = keep
    while True:
        ends = {}
        for i, l in enumerate(lines):
            for j, e in enumerate((key(l[0]), key(l[-1]))):
                ends.setdefault(e, []).append((i, j))
        pr = next((v for v in ends.values() if len(v) == 2 and v[0][0] != v[1][0]), None)
        if not pr:
            break
        (i, ei), (k_, ek) = pr
        a = lines[i] if ei == 1 else lines[i][::-1]
        b = lines[k_] if ek == 0 else lines[k_][::-1]
        lines = [l for n_, l in enumerate(lines) if n_ not in (i, k_)] + [np.vstack([a, b[1:]])]

    def resample(q, step):
        seg = np.hypot(*np.diff(q, axis=0).T); L = np.concatenate([[0], np.cumsum(seg)])
        t = np.linspace(0, L[-1], max(2, int(np.ceil(L[-1] / step)) + 1))
        return np.stack([np.interp(t, L, q[:, 0]), np.interp(t, L, q[:, 1])], 1)

    def smooth(q, sigma):
        if len(q) < 5:
            return q
        k_ = min(int(3 * sigma), len(q) - 2); g = np.exp(-0.5 * (np.arange(-k_, k_ + 1) / sigma) ** 2); g /= g.sum()
        pad = np.vstack([2 * q[0] - q[k_:0:-1], q, 2 * q[-1] - q[-2:-k_ - 2:-1]])
        return np.stack([np.convolve(pad[:, i], g, 'valid') for i in range(2)], 1)

    roads = []
    for l in lines:
        if length(l) < 5:
            continue
        q = smooth(resample(l, 1.0), 6)                       # pixel units, ~1.5 m sigma
        w = 2 * np.array([dist[min(int(y), dist.shape[0] - 1), min(int(x), dist.shape[1] - 1)] for x, y in q])
        width = float(np.median(w))
        if width < 3:
            continue
        lanes = max(1, int(round(width / 3.4)))
        a = cv2.approxPolyDP((q * RES + [X0, Z0]).astype(np.float32).reshape(-1, 1, 2), 0.15, False)[:, 0, :]
        roads.append({'pts': [[round(float(x), 2), round(float(z), 2)] for x, z in a], 'width': round(width, 1), 'lanes': lanes,
                      'class': 'major' if width >= 10 else 'minor'})
    return roads

if __name__ == '__main__':
    nonmag = lambda t: ~((t[..., 0] > 200) & (t[..., 1] < 60) & (t[..., 2] > 200))
    road, X0, Z0 = mask_of(sys.argv[1], nonmag)
    def deck_keep(t):
        L = t @ np.array([0.3, 0.59, 0.11])
        return nonmag(t) & (cv2.blur(L.astype(np.float32), (13, 13)) < 150)   # dark asphalt decks, not footbridges
    deck, bx0, bz0 = mask_of(sys.argv[2], deck_keep)
    assert (bx0, bz0) == (X0, Z0)
    roads = centre_lines(road, deck, X0, Z0)

    # ---- snap OpenStreetMap crossings / bus stops onto the surveyed roads
    F = json.load(open('data/mapfeatures.json'))
    segs = [(np.array(r['pts'][i]), np.array(r['pts'][i + 1]), k_) for k_, r in enumerate(roads) for i in range(len(r['pts']) - 1)]
    A = np.array([s_[0] for s_ in segs]); B = np.array([s_[1] for s_ in segs]); RI = np.array([s_[2] for s_ in segs])
    def nearest(p):
        d = B - A; L2 = np.maximum((d ** 2).sum(1), 1e-9); t = np.clip(((p - A) * d).sum(1) / L2, 0, 1)
        pr = A + d * t[:, None]; dd = np.hypot(*(pr - p).T); k_ = int(np.argmin(dd))
        return pr[k_], d[k_] / np.sqrt(L2[k_]), RI[k_], dd[k_]
    M = F.get('marks', {}); out = {'crossings': [], 'slow': [], 'busStops': [], 'icons': M.get('icons', [])}
    for c in M.get('crossings', []):
        pr, u, ri, dd = nearest(np.array(c['p']))
        if dd < 6 and not any(np.hypot(*(np.array(o['p']) - pr)) < 12 for o in out['crossings']):
            w = roads[ri]['width']
            out['crossings'].append({'p': [round(pr[0], 2), round(pr[1], 2)], 'dir': [round(u[0], 3), round(u[1], 3)], 'width': w})
            if roads[ri]['class'] == 'minor':
                for sg in (-1, 1):
                    sp = pr + sg * u * 9
                    p2, _, r2, d2 = nearest(sp)
                    if d2 < 1 and r2 == ri:
                        out['slow'].append({'p': [round(p2[0], 2), round(p2[1], 2)], 'up': [round(-sg * u[0], 3), round(-sg * u[1], 3)], 'width': w})
    for b in M.get('busStops', []):
        pr, u, ri, dd = nearest(np.array(b['icon']))
        if dd < 20:
            n_ = np.array([-u[1], u[0]]); side = 1 if np.dot(np.array(b['icon']) - pr, n_) >= 0 else -1
            out['busStops'].append({'p': [round(pr[0], 2), round(pr[1], 2)], 'dir': [round(u[0], 3), round(u[1], 3)], 'side': side,
                                    'width': roads[ri]['width'], 'icon': b['icon']})
    json.dump({'source': 'centre lines from 3D Spatial Data road surfaces © Lands Department, HKSAR; crossings / bus stops © OpenStreetMap contributors',
               'roads': roads, 'marks': out}, open('data/roadnet.json', 'w'), separators=(',', ':'))
    print('roads', len(roads), 'crossings', len(out['crossings']), 'slow', len(out['slow']), 'bus', len(out['busStops']))
