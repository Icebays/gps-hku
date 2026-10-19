"""Vectorise roads, footpaths, gardens, woodland and water from an OpenStreetMap
screenshot into model-frame geometry (data/mapfeatures.json). The site redraws
these in its own style; nothing from the screenshot is shown directly.

    python3 tools/build_mapfeatures.py osm.png "<s>,<theta>,<tx>,<tz>" footprints.png flow.json aerial.jpg

<s>,<theta>,<tx>,<tz> map a screenshot pixel (u, v) to the model frame:
    x = s*(cos t*u - sin t*v) + tx,   z = s*(sin t*u + cos t*v) + tz
footprints.png: top-down render of the model's buildings (white on black)
covering x -770..760, z -310..290; used to tell indoor from outdoor footpaths.
flow.json: local corrections [[x, z, dx, dz], ...] (tools/osm_flow.py) that snap
the screenshot onto the model, which shares its survey with the aerial photo.
aerial.jpg: orthophoto mosaic (tools/build_aerial.py); road widths are measured
on it, and centre lines are nudged onto the real road surface.

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
FLOW = np.array(json.load(open(sys.argv[4])), float)
AER = np.asarray(Image.open(sys.argv[5]).convert('RGB')).astype(np.float32)
AMETA = json.load(open(sys.argv[5].rsplit('.', 1)[0] + '.json'))
FX0, FX1, FZ0, FZ1 = -770, 760, -310, 290
H, W = src.shape[:2]
C, SI = np.cos(TH), np.sin(TH)

def flow_at(xz):
    """Smooth local correction (inverse-distance weighted, 60 m scale)."""
    d2 = (FLOW[None, :, 0] - xz[:, None, 0]) ** 2 + (FLOW[None, :, 1] - xz[:, None, 1]) ** 2
    w = 1.0 / (d2 + 30.0 ** 2) ** 1.5
    return (w[..., None] * FLOW[None, :, 2:4]).sum(1) / w.sum(1)[:, None]

def to_model(pts):
    pts = np.asarray(pts, float)
    x = S * (C * pts[:, 0] - SI * pts[:, 1]) + TX
    z = S * (SI * pts[:, 0] + C * pts[:, 1]) + TZ
    xz = np.stack([x, z], 1)
    return xz + flow_at(xz)

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

# ---------- aerial: asphalt likelihood ----------
AX0, AX1, AZ0, AZ1 = AMETA['extent']; ARES = AMETA['res']
mx, mn = AER.max(2), AER.min(2)
sat = (mx - mn) / np.maximum(mx, 1)
asphalt = ((sat < 0.2) & (mx > 28) & (mx < 185) & ~((AER[..., 1] > AER[..., 0] + 6) & (AER[..., 1] > AER[..., 2] + 6))).astype(np.float32)
asphalt = cv2.GaussianBlur(asphalt, (0, 0), 0.6 / ARES)

def aer_sample(pts):
    u = ((pts[:, 0] - AX0) / ARES).astype(int); v = ((pts[:, 1] - AZ0) / ARES).astype(int)
    ok = (u >= 0) & (u < asphalt.shape[1]) & (v >= 0) & (v < asphalt.shape[0])
    out = np.full(len(pts), np.nan); out[ok] = asphalt[v[ok], u[ok]]
    return out

def resample(line, step):
    seg = np.hypot(*np.diff(line, axis=0).T); L = np.concatenate([[0], np.cumsum(seg)])
    n = max(2, int(np.ceil(L[-1] / step)) + 1); t = np.linspace(0, L[-1], n)
    return np.stack([np.interp(t, L, line[:, 0]), np.interp(t, L, line[:, 1])], 1)

def smooth(line, sigma_m, step=1.0):
    """Gaussian-smooth a polyline with its end points held fixed."""
    q = resample(line, step)
    if len(q) < 5:
        return q
    k = min(int(3 * sigma_m / step), len(q) - 2); g = np.exp(-0.5 * (np.arange(-k, k + 1) * step / sigma_m) ** 2)
    pad = np.vstack([2 * q[0] - q[k:0:-1], q, 2 * q[-1] - q[-2:-k - 2:-1]])  # point reflection keeps ends fixed
    sm = np.stack([np.convolve(pad[:, i], g / g.sum(), 'valid') for i in range(2)], 1)
    return sm

def normals(q):
    d = np.gradient(q, axis=0); d /= np.maximum(np.hypot(*d.T), 1e-9)[:, None]
    return np.stack([-d[:, 1], d[:, 0]], 1)

def fit_to_aerial(q, w0, wmin, wmax):
    """Shift the centre line onto the asphalt band and measure its width."""
    n = normals(q); offs = np.arange(-wmax, wmax + 0.01, 0.4)
    prof = np.stack([aer_sample(q + n * o) for o in offs], 1)        # (points, offsets)
    shifts, widths = [], []
    for i in range(len(q)):
        p = prof[i]
        if np.isnan(p).mean() > 0.3:
            shifts.append(np.nan); widths.append(np.nan); continue
        on = np.nan_to_num(p) > 0.5
        c = len(offs) // 2
        # contiguous asphalt run nearest the current centre
        idx = np.nonzero(on)[0]
        if not len(idx):
            shifts.append(np.nan); widths.append(np.nan); continue
        j = idx[np.argmin(np.abs(idx - c))]
        a = j
        while a > 0 and on[a - 1]: a -= 1
        b = j
        while b < len(on) - 1 and on[b + 1]: b += 1
        wd = offs[b] - offs[a]
        if wd < wmin * 0.7 or wd > wmax * 1.3 or abs(offs[j]) > w0:
            shifts.append(np.nan); widths.append(np.nan); continue
        shifts.append((offs[a] + offs[b]) / 2); widths.append(wd)
    shifts, widths = np.array(shifts), np.array(widths)
    good = ~np.isnan(shifts)
    if good.mean() < 0.35:
        return q, w0
    # robust smooth of the shift along the line (trees hide the road in places)
    sh = np.interp(np.arange(len(q)), np.nonzero(good)[0], shifts[good])
    k = 15; sh = np.array([np.median(sh[max(0, i - k):i + k + 1]) for i in range(len(sh))])
    sh = np.clip(sh, -3.0, 3.0)
    sh[:6] *= np.linspace(0, 1, min(6, len(sh))); sh[-6:] *= np.linspace(1, 0, min(6, len(sh)))  # keep junction ends
    return q + n * sh[:, None], float(np.clip(np.median(widths[good]), wmin, wmax))

def junction_snap(lines, radius=7.0):
    """Merge line ends that meet near one point into a single node; drop tiny loops/stubs."""
    ends = np.array([l[i] for l in lines for i in (0, -1)])
    lab_ = -np.ones(len(ends), int); nid = 0
    for i in range(len(ends)):
        if lab_[i] >= 0: continue
        grp = np.nonzero((np.hypot(*(ends - ends[i]).T) < radius) & (lab_ < 0))[0]
        lab_[grp] = nid; nid += 1
    cen = np.array([ends[lab_ == k].mean(0) for k in range(nid)])
    out = []
    for n_, l in enumerate(lines):
        a, b = lab_[2 * n_], lab_[2 * n_ + 1]
        L = np.hypot(*np.diff(l, axis=0).T).sum()
        if a == b and L < 40:  # small loop at a junction
            continue
        l = l.copy(); l[0] = cen[a]; l[-1] = cen[b]
        out.append((l, a, b, n_))
    deg = np.bincount([e for _, a, b, _ in out for e in (a, b)], minlength=nid)
    return [(l, n_) for l, a, b, n_ in out if not (np.hypot(*np.diff(l, axis=0).T).sum() < 12 and (deg[a] == 1 or deg[b] == 1))]

feats = {'attribution': '© OpenStreetMap contributors', 'roads': [], 'paths': [], 'areas': []}
road_any = (lab == MINOR) | (lab == MAJOR)
major_d = cv2.dilate((lab == MAJOR).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
raw = []
for px, line, dist in centrelines(road_any, 5, 6, 1.0, 10):
    ix, iy = px[:, 0].astype(int), px[:, 1].astype(int)
    major = major_d[iy, ix].mean() > 0.5
    osm_w = float(np.median(dist[iy, ix])) * 2 * S   # OSM pixel width: ~4 m residential, ~2 m service
    raw.append((to_model(px), major, osm_w))
for l, i_ in junction_snap([r[0] for r in raw]):
    _, major, osm_w = raw[i_]
    if major:
        w0, wmin, wmax = 11.0, 8.0, 16.0
    elif osm_w >= 3.0:
        w0, wmin, wmax = 6.5, 5.0, 9.0
    else:
        w0, wmin, wmax = 4.5, 3.0, 6.5
    q = smooth(l, 5.0)
    q, w = fit_to_aerial(q, w0, wmin, wmax)
    q = smooth(q, 3.0)
    feats['roads'].append({'class': 'major' if major else 'minor', 'width': round(w, 1), 'pts': simplify(q, 0.15)})
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
    for ind, run in split_indoor(smooth(line, 1.5, 0.5)):
        feats['paths'].append({'indoor': ind, 'pts': simplify(run, 0.2)})
for cls, kind, amin in [(WOOD, 'wood', 400), (PARK, 'garden', 60), (WATER, 'water', 20)]:
    for p in polygons(lab == cls, amin):
        feats['areas'].append({'kind': kind, **p})

# ---------- icons (bus stops, lifts, taxi stands) ----------
import os
blue = ((b > 170) & (r < 110) & (g > 100) & (g < 190)).astype(np.float32)
icons = []
for kind in ('bus', 'lift', 'taxi'):
    t = np.asarray(Image.open(os.path.join(os.path.dirname(__file__), 'osm-icons', kind + '.png'))).astype(np.float32) / 255
    res = cv2.matchTemplate(blue, t, cv2.TM_CCOEFF_NORMED)
    found = []
    for y, x in sorted(zip(*np.nonzero(res > 0.8)), key=lambda q: -res[q]):
        c = (x + t.shape[1] / 2, y + t.shape[0] / 2)
        if all(np.hypot(c[0] - q[0], c[1] - q[1]) > 10 for q in found):
            found.append(c)
    icons += [(kind, to_model([c])[0]) for c in found]

# ---------- road markings: crossings, 慢駛, bus bays ----------
road_segs = []  # (a, b, road index)
for i, rd in enumerate(feats['roads']):
    q = np.array(rd['pts'])
    road_segs += [(q[k], q[k + 1], i) for k in range(len(q) - 1)]
RA = np.array([s_[0] for s_ in road_segs]); RB = np.array([s_[1] for s_ in road_segs]); RI = np.array([s_[2] for s_ in road_segs])

def nearest_road(pt):
    d = RB - RA; L2 = np.maximum((d ** 2).sum(1), 1e-9)
    t = np.clip(((pt - RA) * d).sum(1) / L2, 0, 1)
    proj = RA + d * t[:, None]; dist = np.hypot(*(proj - pt).T)
    k = int(np.argmin(dist)); u = d[k] / np.sqrt(L2[k])
    return proj[k], u, RI[k], dist[k]

def seg_x(p1, p2, q1, q2):
    d1, d2 = p2 - p1, q2 - q1
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-9:
        return None
    w = q1 - p1
    t = (w[0] * d2[1] - w[1] * d2[0]) / den; u = (w[0] * d1[1] - w[1] * d1[0]) / den
    return p1 + t * d1 if 0 <= t <= 1 and 0 <= u <= 1 else None

marks = {'crossings': [], 'slow': [], 'busStops': [], 'icons': []}
for pth in feats['paths']:
    if pth['indoor']:
        continue
    q = np.array(pth['pts'])
    segs = [(q[k], q[k + 1]) for k in range(len(q) - 1)]
    for e0, e1 in ((q[0], q[1]), (q[-1], q[-2])):  # paths often stop at the kerb: extend their ends by 8 m
        d = e0 - e1; n_ = np.hypot(*d)
        if n_ > 1e-6:
            segs.append((e0, e0 + d / n_ * 8.0))
    for a_, b_ in segs:
        pd = (b_ - a_) / max(np.hypot(*(b_ - a_)), 1e-9)
        lo, hi = np.minimum(a_, b_) - 1, np.maximum(a_, b_) + 1
        cand = np.nonzero((np.minimum(RA, RB) <= hi).all(1) & (np.maximum(RA, RB) >= lo).all(1))[0]
        for j in cand:
            x = seg_x(a_, b_, RA[j], RB[j])
            if x is None:
                continue
            rd = RB[j] - RA[j]; rd = rd / max(np.hypot(*rd), 1e-9)
            if abs(np.dot(rd, pd)) > 0.6:  # running alongside, not crossing
                continue
            if any(np.hypot(*(np.array(c['p']) - x)) < 10 for c in marks['crossings']):
                continue
            road = feats['roads'][RI[j]]
            marks['crossings'].append({'p': [round(x[0], 1), round(x[1], 1)], 'dir': [round(rd[0], 3), round(rd[1], 3)], 'width': road['width']})
            if road['class'] == 'minor':
                for sgn in (-1, 1):  # 慢駛 on both approaches, readable by the approaching driver
                    sp = x + sgn * rd * 8.5
                    _, _, ri, dd = nearest_road(sp)
                    if dd < 1.0:
                        marks['slow'].append({'p': [round(sp[0], 1), round(sp[1], 1)], 'up': [round(-sgn * rd[0], 3), round(-sgn * rd[1], 3)], 'width': road['width']})
for kind, c in icons:
    if kind == 'bus':
        pr, u, ri, dd = nearest_road(c)
        if dd > 25:
            continue
        n = np.array([-u[1], u[0]]); side = 1 if np.dot(c - pr, n) >= 0 else -1
        marks['busStops'].append({'p': [round(pr[0], 1), round(pr[1], 1)], 'dir': [round(u[0], 3), round(u[1], 3)],
                                  'side': side, 'width': feats['roads'][ri]['width'], 'icon': [round(c[0], 1), round(c[1], 1)]})
    else:
        marks['icons'].append({'kind': kind, 'p': [round(c[0], 1), round(c[1], 1)]})
feats['marks'] = marks
print('crossings', len(marks['crossings']), 'slow', len(marks['slow']), 'bus', len(marks['busStops']), 'icons', len(marks['icons']))

json.dump(feats, open('data/mapfeatures.json', 'w'), separators=(',', ':'))
n_in = sum(p['indoor'] for p in feats['paths'])
print(f"roads {len(feats['roads'])}  paths {len(feats['paths'])} ({n_in} indoor)  areas " +
      str({k: sum(a['kind'] == k for a in feats['areas']) for k in ('wood', 'garden', 'water')}))
