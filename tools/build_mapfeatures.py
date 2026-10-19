"""Vectorise roads, footpaths, gardens, woodland and water from an OpenStreetMap
screenshot into model-frame geometry (data/mapfeatures.json). The site redraws
these in its own style; nothing from the screenshot is shown directly.

    python3 tools/build_mapfeatures.py osm.png "<s>,<theta>,<tx>,<tz>" footprints.png

<s>,<theta>,<tx>,<tz> map a screenshot pixel (u, v) to the model frame:
    x = s*(cos t*u - sin t*v) + tx,   z = s*(sin t*u + cos t*v) + tz
footprints.png: top-down render of the model's buildings (white on black)
covering x -770..760, z -310..290; used to tell indoor from outdoor footpaths.

Needs: pip install numpy pillow opencv-python-headless scikit-image
Map data © OpenStreetMap contributors (ODbL).
"""
import json, sys
import numpy as np
import cv2
from PIL import Image
from skimage.morphology import skeletonize

src = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
S, TH, TX, TZ = map(float, sys.argv[2].split(','))
foot = np.asarray(Image.open(sys.argv[3]).convert('L')) > 128
FX0, FX1, FZ0, FZ1 = -770, 760, -310, 290
H, W = src.shape[:2]
C, SI = np.cos(TH), np.sin(TH)

def to_model(pts):
    pts = np.asarray(pts, float)
    x = S * (C * pts[:, 0] - SI * pts[:, 1]) + TX
    z = S * (SI * pts[:, 0] + C * pts[:, 1]) + TZ
    return np.stack([x, z], 1)

def near(c, tol=9):
    return np.abs(src - np.array(c)).max(2) <= tol

r, g, b = src[..., 0], src[..., 1], src[..., 2]
UNK, PAVED, MINOR, MAJOR, PATH, PARK, WOOD, WATER = -1, 0, 1, 2, 3, 4, 5, 6
lab = np.full((H, W), UNK, np.int8)
for c in [(255, 255, 229), (217, 208, 201), (224, 223, 223), (242, 239, 233), (238, 238, 238), (196, 182, 171), (221, 221, 232)]:
    lab[near(c)] = PAVED
lab[near((255, 255, 255), 3)] = MINOR
for c in [(247, 250, 191), (252, 214, 164)]:
    lab[near(c, 8)] = MAJOR
lab[(r > 220) & (r - g > 45) & (r - b > 45) & (g < 205) & (g > 80)] = PATH
for c in [(200, 250, 204), (205, 235, 176), (136, 224, 190), (223, 252, 226)]:
    lab[near(c, 8)] = PARK
lab[((g > r) & (g > b) & (g - b > 25) & (r < 190) & (g < 225)) & (lab == UNK)] = WOOD
lab[near((170, 211, 223), 8)] = WATER
for _ in range(12):  # fill text / icons / casings from neighbours
    unk = lab == UNK
    if not unk.any():
        break
    for dy, dx in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
        nb = np.roll(np.roll(lab, dy, 0), dx, 1)
        take = unk & (nb != UNK) & (nb != PATH)
        lab[take] = nb[take]
        unk = lab == UNK
lab[lab == UNK] = PAVED

# ---------- polygons (gardens, woodland, water) ----------
def polygons(mask, min_area_m2, eps_m=1.2, close_px=5):
    m = mask.astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_px, close_px))
    m = cv2.morphologyEx(cv2.morphologyEx(m, cv2.MORPH_CLOSE, k), cv2.MORPH_OPEN, k)
    m = cv2.GaussianBlur(m, (5, 5), 0) > 127
    cs, hier = cv2.findContours(m.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if hier is None:
        return out
    for i, c in enumerate(cs):
        if hier[0][i][3] != -1:  # holes are attached to their parent below
            continue
        if cv2.contourArea(c) * S * S < min_area_m2:
            continue
        def simp(cc):
            a = cv2.approxPolyDP(cc, eps_m / S, True)[:, 0, :]
            return [[round(x, 1), round(z, 1)] for x, z in to_model(a)]
        holes = []
        j = hier[0][i][2]
        while j != -1:
            if cv2.contourArea(cs[j]) * S * S >= min_area_m2 / 4:
                holes.append(simp(cs[j]))
            j = hier[0][j][0]
        out.append({'outer': simp(c), 'holes': holes})
    return out

# ---------- centre lines (roads, footpaths) ----------
N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

def trace(skel):
    """Skeleton -> list of pixel polylines split at junctions."""
    ys, xs = np.nonzero(skel)
    on = set(zip(ys.tolist(), xs.tolist()))
    def nbrs(p):
        return [(p[0] + dy, p[1] + dx) for dy, dx in N8 if (p[0] + dy, p[1] + dx) in on]
    deg = {p: len(nbrs(p)) for p in on}
    nodes = {p for p, d in deg.items() if d != 2}
    used = set()
    lines = []
    def walk(a, b):
        line = [a, b]; prev, cur = a, b
        while cur not in nodes:
            nxt = [q for q in nbrs(cur) if q != prev and (cur, q) not in used]
            if not nxt:
                break
            used.add((cur, nxt[0])); used.add((nxt[0], cur))
            prev, cur = cur, nxt[0]; line.append(cur)
        return line
    for n in nodes:
        for q in nbrs(n):
            if (n, q) in used:
                continue
            used.add((n, q)); used.add((q, n))
            lines.append(walk(n, q))
    for p in on:  # closed loops without junctions
        if deg[p] == 2 and not any((p, q) in used for q in nbrs(p)):
            q = nbrs(p)[0]; used.add((p, q)); used.add((q, p))
            lines.append(walk(p, q) + [p])
    return [np.array([[x, y] for y, x in l], float) for l in lines]

def chaikin(p, n=2):
    for _ in range(n):
        if len(p) < 3:
            return p
        q = [p[0]]
        for a, b in zip(p[:-1], p[1:]):
            q += [0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b]
        q.append(p[-1]); p = np.array(q)
    return p

def plen(l):
    return np.hypot(*np.diff(l, axis=0).T).sum() * S

def key(p):
    return (int(round(p[0])), int(round(p[1])))

def prune_and_merge(lines, spur_m):
    """Drop short dangling spurs, then join chains through degree-2 nodes."""
    for _ in range(3):
        deg = {}
        for l in lines:
            for e in (key(l[0]), key(l[-1])):
                deg[e] = deg.get(e, 0) + 1
        keep = [l for l in lines if not (plen(l) < spur_m and (deg[key(l[0])] == 1 or deg[key(l[-1])] == 1))]
        if len(keep) == len(lines):
            break
        lines = keep
    while True:
        ends = {}
        for i, l in enumerate(lines):
            for j, e in enumerate((key(l[0]), key(l[-1]))):
                ends.setdefault(e, []).append((i, j))
        pair = next(((e, v) for e, v in ends.items() if len(v) == 2 and v[0][0] != v[1][0]), None)
        if not pair:
            return lines
        (i, ei), (k, ek) = pair[1]
        a = lines[i] if ei == 1 else lines[i][::-1]
        b = lines[k] if ek == 0 else lines[k][::-1]
        merged = np.vstack([a, b[1:]])
        lines = [l for n, l in enumerate(lines) if n not in (i, k)] + [merged]

def centrelines(mask, close_px, min_len_m, eps_m, spur_m, open_px=2):
    m = mask.astype(np.uint8) * 255
    if close_px:
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_px, close_px)))
    if open_px:
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((open_px, open_px), np.uint8))
    dist = cv2.distanceTransform((m > 0).astype(np.uint8), cv2.DIST_L2, 3)
    lines = prune_and_merge([l for l in trace(skeletonize(m > 0)) if len(l) >= 2], spur_m)
    out = []
    for l in lines:
        if plen(l) < min_len_m:
            continue
        a = cv2.approxPolyDP(l.astype(np.float32).reshape(-1, 1, 2), eps_m / S, False)[:, 0, :]
        out.append((l, chaikin(to_model(a)), dist))
    return out

def model_px(pt):
    x, z = pt
    return int((x - FX0) / (FX1 - FX0) * foot.shape[1]), int((z - FZ0) / (FZ1 - FZ0) * foot.shape[0])

def indoor(pt):
    px, py = model_px(pt)
    if not (0 <= px < foot.shape[1] and 0 <= py < foot.shape[0]):
        return False
    return bool(foot[py, px])

def split_indoor(line, step=1.5):
    """Resample a polyline and split it into indoor / outdoor runs."""
    seg = np.hypot(*np.diff(line, axis=0).T); L = np.concatenate([[0], np.cumsum(seg)])
    if L[-1] < step:
        return [(indoor(line.mean(0)), line)]
    t = np.arange(0, L[-1] + 1e-6, step)
    pts = np.stack([np.interp(t, L, line[:, 0]), np.interp(t, L, line[:, 1])], 1)
    flags = np.array([indoor(p) for p in pts])
    # ignore very short flips (footprint edges, bridges over gaps)
    for i in range(1, len(flags) - 1):
        if flags[i] != flags[i - 1] and flags[i] != flags[i + 1]:
            flags[i] = flags[i - 1]
    runs, start = [], 0
    for i in range(1, len(flags) + 1):
        if i == len(flags) or flags[i] != flags[start]:
            run = pts[max(start - 1, 0):i + 1] if i < len(flags) else pts[max(start - 1, 0):]
            if len(run) >= 2:
                runs.append((bool(flags[start]), run))
            start = i
    return runs

def simplify(pts, eps=0.6):
    a = cv2.approxPolyDP(np.asarray(pts, np.float32).reshape(-1, 1, 2), eps, False)[:, 0, :]
    return [[round(float(x), 1), round(float(z), 1)] for x, z in a]

feats = {'attribution': '© OpenStreetMap contributors', 'roads': [], 'paths': [], 'areas': []}
road_any = (lab == MINOR) | (lab == MAJOR)
major_d = cv2.dilate((lab == MAJOR).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
for px, line, dist in centrelines(road_any, 5, 6, 1.0, 10):
    ix, iy = px[:, 0].astype(int), px[:, 1].astype(int)
    name = 'major' if major_d[iy, ix].mean() > 0.5 else 'minor'
    w = float(np.median(dist[iy, ix])) * 2 * S
    w = max(9.0, min(w, 18.0)) if name == 'major' else max(3.5, min(w, 8.0))
    feats['roads'].append({'class': name, 'width': round(w, 1), 'pts': simplify(line)})
def bridge(lines, gap=7.0, cos_min=0.6):
    """Join polyline ends that face each other across a small gap (dashed lines)."""
    lines = [np.asarray(l, float) for l in lines]
    while True:
        P, D, owner = [], [], []
        for n, l in enumerate(lines):
            for at_start in (True, False):
                p, q = (l[0], l[min(3, len(l) - 1)]) if at_start else (l[-1], l[max(-4, -len(l))])
                d = p - q; d = d / max(np.hypot(*d), 1e-6)
                P.append(p); D.append(d); owner.append((n, at_start))
        P, D = np.array(P), np.array(D)
        V = P[None, :, :] - P[:, None, :]
        dist = np.hypot(V[..., 0], V[..., 1]); U = V / np.maximum(dist, 1e-6)[..., None]
        ok = (dist < gap) & (dist > 1e-6) & ((U * D[:, None, :]).sum(-1) > cos_min) & ((-U * D[None, :, :]).sum(-1) > cos_min)
        own = np.array([o[0] for o in owner]); ok &= own[:, None] != own[None, :]
        ii, jj = np.nonzero(np.triu(ok))
        if not len(ii):
            return lines
        used_end, used_line, merges = set(), set(), []
        for k in np.argsort(dist[ii, jj]):
            a, b = ii[k], jj[k]
            la, lb = owner[a][0], owner[b][0]
            if a in used_end or b in used_end or la in used_line or lb in used_line:
                continue
            used_end |= {a, b}; used_line |= {la, lb}; merges.append((a, b))
        new, gone = [], set()
        for a, b in merges:
            (la, sa), (lb, sb) = owner[a], owner[b]
            A = lines[la][::-1] if sa else lines[la]
            B = lines[lb] if sb else lines[lb][::-1]
            new.append(np.vstack([A, B])); gone |= {la, lb}
        lines = [l for n, l in enumerate(lines) if n not in gone] + new

path_lines = bridge([line for _, line, _ in centrelines(lab == PATH, 7, 2, 0.8, 4, open_px=0)])
for line in path_lines:
    if np.hypot(*np.diff(line, axis=0).T).sum() < 8:
        continue
    for ind, run in split_indoor(line):
        feats['paths'].append({'indoor': ind, 'pts': simplify(run, 0.5)})
for cls, kind, amin in [(WOOD, 'wood', 400), (PARK, 'garden', 60), (WATER, 'water', 20)]:
    for p in polygons(lab == cls, amin):
        feats['areas'].append({'kind': kind, **p})

json.dump(feats, open('data/mapfeatures.json', 'w'), separators=(',', ':'))
n_in = sum(p['indoor'] for p in feats['paths'])
print(f"roads {len(feats['roads'])}  paths {len(feats['paths'])} ({n_in} indoor)  areas " +
      str({k: sum(a['kind'] == k for a in feats['areas']) for k in ('wood', 'garden', 'water')}))
