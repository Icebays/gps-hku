"""Indoor floor plans for the 3D map (floor selector, drawn floor inside the cut-open building).

    python3 tools/build_indoor.py tools/indoor/main-library.json <folder with the PDFs> data/indoor/main-library.json

The source plans are the HKU Libraries floor-plan PDFs (https://lib.hku.hk/mainlib/floorplan.html, not kept
in this repo). They are vector drawings, so nothing is traced by hand: every path is read from the PDF,
classified by its colour (walls, columns, shelves, study areas, tables, seats, stairs ...), moved into the
map's model frame with the plan's registration (tools/indoor/<place>.json: x = a*u - b*v + tx,
z = b*u + a*v + tz, u/v in PDF points; fitted against the surveyed building footprints and the column
grid) and simplified: shelves, tables and seats are merged into clean blocks, walls kept as lines.
Legend, title, north arrow and "You are here" marks are dropped; legend symbols found on the plan
(toilets, lifts, fire exits, printers, catalogues, dictionary stands) become typed icons and the texts
become labels. The site draws all of it in its own colours (assets/indoor.js).
Needs: pymupdf, numpy, opencv-python-headless, scipy
"""
import itertools, json, math, os, re, sys
import numpy as np
import cv2
from shapely.ops import unary_union
import pymupdf
from scipy import ndimage

cfg_path, pdf_dir, out_path = sys.argv[1:4]
CFG = json.load(open(cfg_path))

# ---------- PDF reading ----------
def flatten(items):
    """drawing items -> list of (points, is_curve)"""
    out, pts, curve = [], [], False
    def flush():
        nonlocal pts, curve
        if len(pts) >= 2: out.append((pts, curve))
        pts, curve = [], False
    for it in items:
        k = it[0]
        if k in ('l', 'c'):
            p0 = it[1]
            if not pts or abs(pts[-1][0] - p0.x) > 1e-3 or abs(pts[-1][1] - p0.y) > 1e-3:
                flush(); pts = [(p0.x, p0.y)]
            if k == 'l':
                pts.append((it[2].x, it[2].y))
            else:
                p1, p2, p3 = it[2:5]; curve = True
                for t in (0.2, 0.4, 0.6, 0.8, 1.0):
                    m = 1 - t
                    pts.append((m ** 3 * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t ** 3 * p3.x,
                                m ** 3 * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t ** 3 * p3.y))
        elif k == 're':
            flush(); r = it[1]; out.append(([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)], False))
        elif k == 'qu':
            flush(); q = it[1]; out.append(([(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y), (q.ul.x, q.ul.y)], False))
    flush()
    return out

def read_pdf(path):
    pg = pymupdf.open(path)[0]; W, H = pg.rect.width, pg.rect.height
    paths = []
    for d in pg.get_drawings():
        r = d['rect']
        if d.get('fill') and r.width * r.height > 0.8 * W * H: continue   # page background
        polys = flatten(d['items'])
        if not polys: continue
        paths.append(dict(fill=d.get('fill'), stroke=d.get('color') if d.get('color') is not None else None, w=d.get('width') or 0,
                          close=d.get('fill') is not None or bool(d.get('closePath')) or any(it[0] in ('re', 'qu') for it in d['items']),   # a fill is always closed
                          bbox=(r.x0, r.y0, r.x1, r.y1), polys=polys))
    texts = []
    for b in pg.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                t = s['text'].strip()
                if t: texts.append(dict(t=t, bbox=s['bbox'], size=s['size'], dir=l['dir'], color=s['color']))
    return W, H, paths, texts

# ---------- colours -> classes ----------
NAVY = [(0.18, 0.2, 0.56), (0.17, 0.22, 0.56), (0.18, 0.19, 0.57), (0.19, 0.21, 0.56), (0.18, 0.22, 0.55), (0.28, 0.37, 0.53)]
CLASSES = [
    ('wall', NAVY),
    ('column', [(0.6, 0.58, 0.78), (0.61, 0.58, 0.79), (0.78, 0.77, 0.88)]),
    ('shelf', [(0.62, 0.12, 0.38), (0.62, 0.0, 0.36), (0.61, 0.12, 0.38), (0.98, 0.84, 0.9), (0.98, 0.83, 0.9), (0.95, 0.68, 0.79),
               (0.98, 0.83, 0.89), (0.97, 0.83, 0.89), (0.92, 0.05, 0.55), (0.92, 0.03, 0.55), (0.91, 0.05, 0.55), (0.93, 0.0, 0.55),
               (0.91, 0.06, 0.55), (0.92, 0.0, 0.55), (0.91, 0.06, 0.54), (0.93, 0.17, 0.48)]),
    ('shelfG', [(0.0, 0.65, 0.32), (0.0, 0.45, 0.21), (0.55, 0.78, 0.25), (0.0, 0.31, 0.17), (0.55, 0.77, 0.25), (0.0, 0.41, 0.22)]),
    ('areaY', [(1.0, 0.91, 0.62), (0.99, 0.94, 0.44), (1.0, 0.95, 0.44)]),
    ('areaG', [(0.83, 0.89, 0.54), (0.82, 0.88, 0.53), (0.82, 0.89, 0.53)]),
    ('areaC', [(0.57, 0.9, 0.89), (0.8, 1.0, 1.0)]),
    ('areaN', [(0.9, 0.91, 0.91)]),
    ('areaP', [(0.98, 0.82, 0.75), (0.99, 0.83, 0.76), (0.99, 0.81, 0.62)]),
    ('table', [(0.78, 0.92, 0.98), (0.78, 0.91, 0.98), (0.64, 0.91, 1.0), (0.0, 0.68, 0.93), (1.0, 1.0, 1.0), (0.74, 0.74, 0.75)]),
    ('chair', [(0.13, 0.12, 0.12), (0.14, 0.12, 0.12), (0.11, 0.11, 0.11), (0.57, 0.58, 0.59), (0.56, 0.56, 0.56)]),
    ('seat', [(0.96, 0.57, 0.12), (0.98, 0.69, 0.25), (0.94, 0.35, 0.16), (0.95, 0.43, 0.14)]),
    ('counter', [(1.0, 0.85, 0.67), (1.0, 0.86, 0.67), (1.0, 0.77, 0.68), (1.0, 0.94, 0.0), (1.0, 0.95, 0.0), (0.77, 0.6, 0.42),
                 (0.38, 0.22, 0.09), (0.38, 0.22, 0.07), (0.66, 0.48, 0.31), (0.78, 0.67, 0.0)]),
    ('stairs', [(0.28, 0.65, 0.68), (0.28, 0.64, 0.68), (0.09, 0.38, 0.51)]),
    ('thin', [(0.5, 0.51, 0.52), (0.43, 0.43, 0.44)]),
    ('mark', [(0.93, 0.12, 0.15), (0.92, 0.12, 0.15), (0.92, 0.13, 0.16), (0.93, 0.11, 0.14), (0.93, 0.13, 0.15), (0.61, 0.11, 0.12),
              (0.62, 0.11, 0.12), (0.6, 0.14, 0.05)]),   # "you are here" and other red marks: dropped
]
def classify(c):
    if c is None: return None
    best, bd = None, 0.045
    for name, refs in CLASSES:
        for r in refs:
            d = max(abs(a - b) for a, b in zip(c, r))
            if d < bd: best, bd = name, d
    return best or 'misc'

def near(c, ref, tol=0.04): return c is not None and all(abs(a - b) <= tol for a, b in zip(c, ref))
is_navy = lambda c: any(near(c, r) for r in NAVY)

# ---------- legend, symbols ----------
def legend_boxes(paths, texts):
    boxes = []
    for t in texts:
        if t['t'] in ('Male Toilet', 'You Are Here', 'Fire Exit', 'Lift'):
            tb = t['bbox']
            cands = [p['bbox'] for p in paths if p['bbox'][0] <= tb[0] and p['bbox'][1] <= tb[1] and p['bbox'][2] >= tb[2] and p['bbox'][3] >= tb[3]
                     and (p['bbox'][2] - p['bbox'][0]) < 300 and (p['bbox'][3] - p['bbox'][1]) < 420]
            if cands: boxes.append(min(cands, key=lambda b: (b[2] - b[0]) * (b[3] - b[1])))
    return boxes

def inside(b, box, pad=0): return box[0] - pad <= (b[0] + b[2]) / 2 <= box[2] + pad and box[1] - pad <= (b[1] + b[3]) / 2 <= box[3] + pad
def contains(outer, b, pad=0.5): return outer[0] - pad <= b[0] and outer[1] - pad <= b[1] and outer[2] + pad >= b[2] and outer[3] + pad >= b[3]
def npts(p): return sum(len(q) for q, _ in p['polys'])

def find_icons(paths, s):
    """legend symbols on the plan -> [(kind, cx, cy, size)], consuming their paths (s = metres per point)"""
    icons, used = [], set()
    W = lambda b: b[2] - b[0]; H = lambda b: b[3] - b[1]
    # framed symbols (toilets, lifts): navy rounded-square outline with navy figures inside
    for i, p in enumerate(paths):
        b = p['bbox']
        if p['fill'] is None and is_navy(p['stroke']) and len(p['polys']) == 1 and 18 <= npts(p) <= 40 and 6 < W(b) < 40 and 0.75 < W(b) / max(H(b), 1e-6) < 1.33:
            inner = [j for j, q in enumerate(paths) if j != i and contains(b, q['bbox']) and (is_navy(q['fill']) or is_navy(q['stroke']))]
            figs = [j for j in inner if paths[j]['fill'] is not None and npts(paths[j]) > 60]
            if not figs: continue
            if len(figs) >= 2: kind = 'lift'
            else:
                fb = paths[figs[0]]['bbox']; kind = 'wc-m' if W(fb) / max(H(fb), 1e-6) < 0.36 else 'wc-f'
            icons.append((kind, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, W(b))); used.update([i] + inner)
    for i, p in enumerate(paths):
        if i in used: continue
        b = p['bbox']
        # fire exit: one navy filled square symbol made of several sub-paths (running figure + frame)
        if is_navy(p['fill']) and len(p['polys']) >= 4 and npts(p) > 120 and 0.8 < W(b) / max(H(b), 1e-6) < 1.25 and 6 < W(b) < 40:
            icons.append(('exit', (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, W(b))); used.add(i)
    # unframed figures (navy, curved, tall): two alike side by side = lift sign, one = toilet sign
    curvy = lambda p: is_navy(p['fill']) and len(p['polys']) <= 2 and any(c for _, c in p['polys'])
    figs = [i for i, p in enumerate(paths) if i not in used and curvy(p) and npts(p) > 40 and 0.22 < W(p['bbox']) / max(H(p['bbox']), 1e-6) < 0.5 and H(p['bbox']) * s >= 0.62]
    paired = set()
    for i in figs:
        if i in paired: continue
        bi = paths[i]['bbox']; ai = W(bi) / H(bi)
        for j in figs:
            if j == i or j in paired: continue
            bj = paths[j]['bbox']; aj = W(bj) / H(bj)
            if abs(H(bi) - H(bj)) < 0.15 * H(bi) and abs(ai - aj) < 0.05 and abs(bi[1] - bj[1]) < 0.3 * H(bi) and abs(bi[0] - bj[0]) < 2.6 * W(bi):
                box = (min(bi[0], bj[0]) - W(bi), min(bi[1], bj[1]) - 0.6 * H(bi), max(bi[2], bj[2]) + W(bi), max(bi[3], bj[3]) + 0.2 * H(bi))
                icons.append(('lift', (box[0] + box[2]) / 2, (box[1] + box[3]) / 2, W(box)))
                paired.update([i, j]); used.update(k for k, q in enumerate(paths) if is_navy(q['fill']) and contains(box, q['bbox']))
                break
    for i in figs:
        if i in paired: continue
        b = paths[i]['bbox']
        icons.append(('wc-m' if W(b) / H(b) < 0.36 else 'wc-f', (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, H(b))); used.add(i)
    # remaining small navy curved fills are outlined lettering (MALE, LIFT ...): not walls
    for i, p in enumerate(paths):
        if i not in used and curvy(p) and max(W(p['bbox']), H(p['bbox'])) * s < 1.6 and not (len(p['polys']) == 1 and min(W(p['bbox']), H(p['bbox'])) / max(W(p['bbox']), H(p['bbox']), 1e-6) < 0.4 and max(W(p['bbox']), H(p['bbox'])) * s < 0.75): used.add(i)
    # printers: clusters of green outline strokes
    gi = [i for i, p in enumerate(paths) if i not in used and p['fill'] is None and near(p['stroke'], (0.0, 0.65, 0.31), 0.03)]
    for i in gi:
        b = paths[i]['bbox']
        if 1.6 < W(b) / max(H(b), 1e-6) < 2.6 and W(b) > 8 and i not in used:
            grp = [j for j in gi if contains((b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2), paths[j]['bbox'])]
            icons.append(('printer', (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, W(b))); used.update(grp)
    # catalogues (OPAC): pale orange bar with an orange outline and navy lettering
    for i, p in enumerate(paths):
        if i in used: continue
        b = p['bbox']
        if near(p['fill'], (1.0, 0.86, 0.67), 0.03) and 1.8 < W(b) / max(H(b), 1e-6) < 12 and W(b) > 8:
            grp = [j for j, q in enumerate(paths) if j not in used and contains((b[0] - 1, b[1] - 3, b[2] + 1, b[3] + 3), q['bbox'])]
            if any(is_navy(paths[j]['fill']) for j in grp):
                icons.append(('opac', (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, W(b))); used.update(grp)
    # dictionary stands: brown square
    for i, p in enumerate(paths):
        if i in used: continue
        b = p['bbox']
        if near(p['fill'], (0.38, 0.22, 0.09), 0.03) and 0.7 < W(b) / max(H(b), 1e-6) < 1.4:
            grp = [j for j, q in enumerate(paths) if contains((b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1), q['bbox'])]
            icons.append(('dict', (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, W(b))); used.update(grp)
    return icons, used

# ---------- plan silhouette (drops titles, north arrow, legends outside the building) ----------
def silhouette(W, H, paths, drop, sc=2.0):
    m = np.zeros((int(H * sc), int(W * sc)), np.uint8)
    for i, p in enumerate(paths):
        if i in drop: continue
        for poly, _ in p['polys']:
            a = np.round(np.array(poly) * sc).astype(np.int32)
            if p['fill'] is not None and p['close'] and len(a) > 2: cv2.fillPoly(m, [a], 1)
            cv2.polylines(m, [a], False, 1, 2)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    m = ndimage.binary_fill_holes(m).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    keep = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 0.08 * st[big, cv2.CC_STAT_AREA]]).astype(np.uint8)
    return keep, sc

# ---------- geometry helpers ----------
def xf(M, pts):
    a, b, tx, tz = M; p = np.asarray(pts, float)
    return np.stack([a * p[:, 0] - b * p[:, 1] + tx, b * p[:, 0] + a * p[:, 1] + tz], 1)

class Raster:
    """model-space mask for merging many small shapes into clean blocks"""
    def __init__(self, ext, res=0.05):
        self.x0, self.z0, self.res = ext[0], ext[2], res
        self.m = np.zeros((int((ext[3] - ext[2]) / res) + 1, int((ext[1] - ext[0]) / res) + 1), np.uint8)
    def px(self, P): return np.round(np.stack([(P[:, 0] - self.x0) / self.res, (P[:, 1] - self.z0) / self.res], 1)).astype(np.int32)
    def fill(self, P): cv2.fillPoly(self.m, [self.px(P)], 1)
    def line(self, P, w): cv2.polylines(self.m, [self.px(P)], False, 1, max(1, int(round(w / self.res))))
    def polygons(self, close=0.1, eps=0.04, min_area=0.03):
        k = max(1, int(round(close / self.res)))
        m = cv2.morphologyEx(self.m, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8)) if k > 1 else self.m
        cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        out = []
        if hier is None: return out
        for i, c in enumerate(cs):
            if hier[0][i][3] != -1: continue   # holes are attached to their outer ring
            if cv2.contourArea(c) * self.res ** 2 < min_area: continue
            rings = [c] + [cs[j] for j in range(len(cs)) if hier[0][j][3] == i and cv2.contourArea(cs[j]) * self.res ** 2 > min_area]
            out.append([[[(float(q[0][0]) * self.res + self.x0), (float(q[0][1]) * self.res + self.z0)] for q in cv2.approxPolyDP(r, eps / self.res, True)] for r in rings])
        return [p for p in out if len(p[0]) >= 3]

def area(P): P = np.asarray(P); return 0.5 * abs(np.dot(P[:, 0], np.roll(P[:, 1], 1)) - np.dot(P[:, 1], np.roll(P[:, 0], 1)))
def r2(v): return round(float(v), 2)
def flat(P): return [r2(v) for xy in P for v in xy]

# ---------- labels ----------
ROOM_NAME = re.compile(r'\b(ROOMS?|LAB|LABORATORY|OFFICES?|STUDIO|CENTRE|STORE|PANTRY)\b', re.I)
DROP_TEXT = re.compile(r'^(YOU ARE HERE|You Are Here|N|Last update.*|.*\bPLAN\.?$|G/F\s+MAIN LIBRARY|(OLD|NEW)\s*WING\.?)$', re.I)
def merge_lines(texts):
    """join the lines of multi-line labels"""
    T = sorted(texts, key=lambda t: (round(t['dir'][0], 2), round(t['dir'][1], 2), t['bbox'][1]))
    groups = []
    for t in T:
        b = t['bbox']; cx = (b[0] + b[2]) / 2
        for g in groups:
            lb = g[-1]['bbox']; lcx = (lb[0] + lb[2]) / 2
            if g[-1]['dir'] == t['dir'] and t['dir'][0] > 0.99 and abs(g[-1]['size'] - t['size']) < 0.6 and -0.4 * t['size'] <= b[1] - lb[3] < 0.7 * t['size'] \
               and abs(cx - lcx) < 0.35 * max(lb[2] - lb[0], b[2] - b[0]) and g[-1]['color'] == t['color']:
                g.append(t); break
        else:
            groups.append([t])
    out = []
    for g in groups:
        x0 = min(t['bbox'][0] for t in g); y0 = min(t['bbox'][1] for t in g); x1 = max(t['bbox'][2] for t in g); y1 = max(t['bbox'][3] for t in g)
        out.append(dict(t='\n'.join(t['t'] for t in g), bbox=(x0, y0, x1, y1), size=max(t['size'] for t in g), dir=g[0]['dir']))
    return out
CALLNO = re.compile(r'^(\[.*\]|期|BOOKS|JOURNALS|REFERENCE|LS?\d|S\d|LB\d|\d{3}|Books)', re.I)

# ---------- furniture from outlines ----------
def bbox_m(b, s): return (b[2] - b[0]) * s, (b[3] - b[1]) * s
def touch(a, b, g): return a[0] - g <= b[2] and b[0] - g <= a[2] and a[1] - g <= b[3] and b[1] - g <= a[3]
def cluster(boxes, gap):
    """union-find on boxes that touch (gap in the boxes' units)"""
    par = list(range(len(boxes)))
    def f(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    order = sorted(range(len(boxes)), key=lambda i: boxes[i][0])
    for k, i in enumerate(order):
        for j in order[k + 1:]:
            if boxes[j][0] > boxes[i][2] + gap: break
            if touch(boxes[i], boxes[j], gap): par[f(i)] = f(j)
    groups = {}
    for i in range(len(boxes)): groups.setdefault(f(i), []).append(i)
    return list(groups.values())
def is_crescent(p, s):
    """a chair drawn as a thin curved sliver (its back) beside a table"""
    if p['fill'] is None or len(p['polys']) != 1 or not p['polys'][0][1]: return False
    w, h = bbox_m(p['bbox'], s)
    return 0.22 <= max(w, h) <= 0.75 and min(w, h) / max(w, h) < 0.4
def is_glyph(p, s):
    """outlined lettering (room numbers, OPAC, MALE ...): curved fills made of several small sub-paths"""
    if p['fill'] is None or not any(c for _, c in p['polys']) or is_crescent(p, s): return False
    w, h = bbox_m(p['bbox'], s)
    if classify(p['fill']) not in ('wall', 'chair'): return False
    return (max(w, h) < 1.4 and (len(p['polys']) >= 2 or npts(p) > 14)) or (min(w, h) < 0.55 and len(p['polys']) >= 3)

# ---------- stairs ----------
def stair_steps(lines, floor_h):
    """stair drawings (tread lines) -> 3D steps. Parallel treads 0.5-3.2 m long, 0.15-0.45 m apart, make a flight;
    flights near each other make one staircase, read as
      U (dog-leg): two flights side by side; the first rises from this floor to a half landing at the end the stair's
        outline runs past the treads, the second climbs back from the landing to the floor above (floating treads);
      L: two flights at right angles meeting at a corner landing;
      straight: one flight (a break mark, the zigzag where the plan is cut, lies on its upper part).
    Returns ([[x0, z0, x1, z1, x2, z2, x3, z3, top, bottom], ...], the lines that are not treads)."""
    segs = []
    for li, P in enumerate(lines):
        for a, b in zip(P[:-1], P[1:]):
            L = float(np.hypot(*(b - a)))
            if L > 0.05:
                u = (b - a) / L
                if u[0] < -1e-6 or (abs(u[0]) < 1e-6 and u[1] < 0): u = -u
                segs.append(dict(a=a, b=b, m=(a + b) / 2, u=u, L=L, li=li))
    cand = [i for i, s_ in enumerate(segs) if 0.5 <= s_['L'] <= 3.2]
    par = {i: i for i in cand}
    def f(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    for x, i in enumerate(cand):
        for j in cand[x + 1:]:
            si, sj = segs[i], segs[j]
            if abs(si['u'][0] * sj['u'][1] - si['u'][1] * sj['u'][0]) > 0.07: continue
            d = sj['m'] - si['m']
            along, across = abs(np.dot(d, si['u'])), abs(si['u'][0] * d[1] - si['u'][1] * d[0])
            if along < 0.3 * min(si['L'], sj['L']) and 0.12 <= across <= 0.45 and abs(si['L'] - sj['L']) < 0.35 * max(si['L'], sj['L']): par[f(i)] = f(j)
    groups = {}
    for i in cand: groups.setdefault(f(i), []).append(i)
    flights, tread = [], set()
    for g in groups.values():
        if len(g) < 3: continue
        u = segs[g[0]]['u']; n = np.array([-u[1], u[0]])
        ts = sorted(float(np.dot(segs[i]['m'], n)) for i in g)
        t = [ts[0]]
        for v in ts[1:]:
            if v - t[-1] > 0.08: t.append(v)
        if len(t) < 3: continue
        W = float(np.median([segs[i]['L'] for i in g])); cu = float(np.median([np.dot(segs[i]['m'], u) for i in g]))
        flights.append(dict(u=u, n=n, t=t, W=W, cu=cu, d=float(np.median(np.diff(t)))))
        tread.update(g)
    # treads drawn in two halves (split by the walking line down the middle of the flight): one flight
    merged = True
    while merged:
        merged = False
        for i, A in enumerate(flights):
            for j, B in enumerate(flights):
                if j <= i or abs(A['u'][0] * B['u'][1] - A['u'][1] * B['u'][0]) > 0.07: continue
                gap = abs(A['cu'] - B['cu']) - (A['W'] + B['W']) / 2
                same = np.median([min(abs(v - w) for w in B['t']) for v in A['t']]) < 0.06
                if abs(gap) < 0.1 and same:
                    l0 = min(A['cu'] - A['W'] / 2, B['cu'] - B['W'] / 2); l1 = max(A['cu'] + A['W'] / 2, B['cu'] + B['W'] / 2)
                    A.update(cu=(l0 + l1) / 2, W=l1 - l0, t=A['t'] if len(A['t']) >= len(B['t']) else B['t'])
                    flights.pop(j); merged = True; break
            if merged: break
    # one flight cut in two by a break mark: same band, a gap of a tread or two
    merged = True
    while merged:
        merged = False
        for i, A in enumerate(flights):
            for j, B in enumerate(flights):
                if j <= i or abs(A['u'][0] * B['u'][1] - A['u'][1] * B['u'][0]) > 0.07: continue
                if abs(A['cu'] - B['cu']) > 0.35 or abs(A['W'] - B['W']) > 0.6: continue
                d = min(A['d'], B['d']); lo, hi = (A, B) if A['t'][0] < B['t'][0] else (B, A)
                gap = hi['t'][0] - lo['t'][-1]
                if -0.05 < gap < 2.6 * d + 0.05:
                    k = max(int(round(gap / d)), 1)
                    fill = [lo['t'][-1] + gap * q / k for q in range(1, k)]
                    A.update(t=lo['t'] + fill + hi['t'], W=max(A['W'], B['W']), d=d)
                    flights.pop(j); merged = True; break
            if merged: break
    # a wide flight with a (double) line down its middle: two flights side by side whose treads were drawn across both
    others = [s_ for i, s_ in enumerate(segs) if i not in tread]
    for F in [F for F in flights]:
        if F['W'] < 1.8: continue
        run = F['t'][-1] - F['t'][0]
        mids = [float(np.dot(s_['m'], F['u'])) for s_ in others if abs(np.dot(s_['u'], F['u'])) < 0.1 and s_['L'] > 0.6 * run
                and abs(np.dot(s_['m'], F['u']) - F['cu']) < 0.2 * F['W'] and F['t'][0] - 0.3 < np.dot(s_['m'], F['n']) < F['t'][-1] + 0.3]
        if mids:
            c = float(np.mean(mids)); l0, l1 = F['cu'] - F['W'] / 2, F['cu'] + F['W'] / 2
            flights[:] = [G for G in flights if G is not F]
            for a, b in ((l0, c - 0.08), (c + 0.08, l1)): flights.append(dict(F, cu=(a + b) / 2, W=b - a))
    def corners(F, t0, t1, l0=None, l1=None):
        l0 = F['cu'] - F['W'] / 2 if l0 is None else l0; l1 = F['cu'] + F['W'] / 2 if l1 is None else l1
        return [F['u'] * l + F['n'] * t for l, t in ((l0, t0), (l1, t0), (l1, t1), (l0, t1))]
    for F in flights:
        F['poly'] = np.array(corners(F, F['t'][0], F['t'][-1]))
    # the other stair lines: outline / handrail (where it runs past the treads is the landing) and break marks
    def near(F, p, r):
        return cv2.pointPolygonTest(F['poly'].astype(np.float32).reshape(-1, 1, 2), (float(p[0]), float(p[1])), True) > -r
    def has_break(F):
        for s_ in others:
            c = abs(np.dot(s_['u'], F['u']))
            if 0.3 < c < 0.94 and s_['L'] < 1.6 and near(F, s_['m'], 0.2): return True
        return False
    # staircases: flights within 1.2 m of each other
    nF = len(flights); up = list(range(nF))
    def fu(i):
        while up[i] != i: up[i] = up[up[i]]; i = up[i]
        return i
    for i in range(nF):
        for j in range(i + 1, nF):
            if min(min(-cv2.pointPolygonTest(flights[j]['poly'].astype(np.float32).reshape(-1, 1, 2), (float(x), float(z)), True) for x, z in flights[i]['poly']),
                   min(-cv2.pointPolygonTest(flights[i]['poly'].astype(np.float32).reshape(-1, 1, 2), (float(x), float(z)), True) for x, z in flights[j]['poly'])) < 1.2:
                up[fu(i)] = fu(j)
            A, B = flights[i], flights[j]
            if abs(A['u'][0] * B['u'][1] - A['u'][1] * B['u'][0]) < 0.07 and abs(A['cu'] - B['cu']) < 0.4 and \
                    max(B['t'][0] - A['t'][-1], A['t'][0] - B['t'][-1]) < 3.5: up[fu(i)] = fu(j)      # in line, across a landing
    units = {}
    for i in range(nF): units.setdefault(fu(i), []).append(flights[i])
    out = []
    def emit(F, ts, h0, rise, floating):
        """treads between consecutive lines of ts (already in climbing order), the first one rise above h0"""
        for q, (a, b) in enumerate(zip(ts[:-1], ts[1:])):
            top = h0 + (q + 1) * rise
            out.append([r2(v) for pt in corners(F, a, b) for v in pt] + [r2(top), r2(max(top - 0.35, 0) if floating else 0)])
    def rise_for(k): return min(max(floor_h / max(k, 1), 0.13), 0.19)
    def par_(A, B): return abs(A['u'][0] * B['u'][1] - A['u'][1] * B['u'][0]) < 0.1
    def side_by_side(A, B): return par_(A, B) and abs(A['cu'] - B['cu']) > 0.4 * (A['W'] + B['W'])
    def landing_hi(A, B):
        """side-by-side flights: is the landing at their high-t end? (the stair's outline runs on past the treads there)"""
        lat0 = min(A['cu'] - A['W'] / 2, B['cu'] - B['W'] / 2); lat1 = max(A['cu'] + A['W'] / 2, B['cu'] + B['W'] / 2)
        tv = [float(np.dot(p, A['n'])) for s_ in others for p in (s_['a'], s_['b'])
              if lat0 - 0.4 <= np.dot(p, A['u']) <= lat1 + 0.4 and (near(A, p, 3.0) or near(B, p, 3.0))]
        t_lo, t_hi = min(A['t'][0], B['t'][0]), max(A['t'][-1], B['t'][-1])
        ext_hi = (max(tv) - t_hi) if tv else 0; ext_lo = (t_lo - min(tv)) if tv else 0
        return ext_hi >= ext_lo, max(ext_hi, ext_lo)
    def tip(F, t): return F['u'] * F['cu'] + F['n'] * t
    def chain(cf):
        """the order and direction of the flights that joins them end to end best: one climb from floor to floor
        (U: back along the other side; L / round a lift shaft: round the corner; in line: across a landing)"""
        best = None
        for perm in itertools.permutations(range(len(cf))):
            if perm[0] > perm[-1]: continue     # each path once (the reverse is the same chain climbed the other way)
            for dirs in itertools.product((1, -1), repeat=len(perm)):
                cost, ok = 0.0, True
                for (i, di), (j, dj) in zip(zip(perm, dirs), list(zip(perm, dirs))[1:]):
                    A, B = cf[i], cf[j]
                    xa = A['t'][-1] if di > 0 else A['t'][0]; eb = B['t'][0] if dj > 0 else B['t'][-1]
                    d = float(np.hypot(*(tip(A, xa) - tip(B, eb))))
                    if par_(A, B):
                        same = np.dot(A['n'], B['n']) * di * dj > 0
                        if side_by_side(A, B):
                            if same: ok = False; break      # a U turns back
                            hi, _ = landing_hi(A, B)
                            if (di > 0) != hi: d += 1.0
                        elif not same: ok = False; break
                    if d > 4.5: ok = False; break
                    cost += d
                if ok and (best is None or cost < best[0] - 1e-6): best = (cost, [(cf[i], d) for i, d in zip(perm, dirs)])
        return best
    for fs in units.values():
        fs = sorted(fs, key=lambda F: -len(F['t'])); extra = fs[8:]; fs = fs[:8]
        # split the flights into staircases: the cheapest set of chains (a flight left on its own costs 3 m),
        # e.g. a stair wound round a lift shaft next to a U stair, not one chain wandering from one to the other
        n = len(fs); cands = {}
        for k in range(2, min(n, 4) + 1):
            for sub in itertools.combinations(range(n), k):
                c = chain([fs[i] for i in sub])
                if c: cands[sum(1 << i for i in sub)] = c
        dp = {0: (0.0, [])}
        for mask in range(1, 1 << n):
            low = mask & -mask; opts = [(dp[mask ^ low][0] + 3.0, dp[mask ^ low][1] + [None])]
            sub = mask
            while sub:
                if sub & low and sub in cands: opts.append((dp[mask ^ sub][0] + cands[sub][0], dp[mask ^ sub][1] + [cands[sub][1]]))
                sub = (sub - 1) & mask
            dp[mask] = min(opts, key=lambda o: o[0])
        chains = [c for c in dp[(1 << n) - 1][1] if c]
        in_chain = {id(F) for c in chains for F, _ in c}
        for ci in range(len(chains) + 1):
            best = (0, chains[ci]) if ci < len(chains) else None
            rest = [F for F in fs if id(F) not in in_chain] + extra if best is None else []
            if best:
                seq = best[1]
                # the plan is cut on the way up: the break mark lies on the first flight, not the last
                if has_break(seq[-1][0]) and not has_break(seq[0][0]): seq = [(F, -d) for F, d in seq[::-1]]
                rise = rise_for(sum(len(F['t']) for F, _ in seq)); h = 0.0; floating = False
                for k, (F, d) in enumerate(seq):
                    ts = F['t'] if d > 0 else F['t'][::-1]
                    emit(F, ts, h, rise, floating)
                    h += len(ts) * rise
                    if k + 1 == len(seq): break
                    G, dg = seq[k + 1]; tg = G['t'] if dg > 0 else G['t'][::-1]
                    if side_by_side(F, G):
                        _, ext = landing_hi(F, G)
                        depth = ext if 0.7 <= ext <= 2.6 else (F['W'] + G['W']) / 2
                        eg = float(np.dot(tip(G, tg[0]), F['n']))
                        start = min(ts[-1], eg) if d > 0 else max(ts[-1], eg)
                        far = (max(ts[-1], eg) + depth) if d > 0 else (min(ts[-1], eg) - depth)
                        lat = [float(np.dot(tip(G, tg[0]), F['u'])) + v for v in (-G['W'] / 2, G['W'] / 2)] + [F['cu'] - F['W'] / 2, F['cu'] + F['W'] / 2]
                        q = corners(F, start, far, min(lat), max(lat)); floating = True
                    elif par_(F, G):
                        q = corners(F, ts[-1], float(np.dot(tip(G, tg[0]), F['n'])))
                    else:
                        # corner landing: from the end of this flight out to the far side of the next, and along to where it starts
                        sp = [float(np.dot(p, F['n'])) for p in G['poly']]
                        far = max(sp) if d > 0 else min(sp)
                        gl = [float(np.dot(p, F['u'])) for p in corners(G, tg[0], tg[0])[:2]]
                        q = corners(F, ts[-1], far, min(gl + [F['cu'] - F['W'] / 2]), max(gl + [F['cu'] + F['W'] / 2])); floating = True
                    out.append([r2(v) for pt in q for v in pt] + [r2(h), r2(h - 0.25 if floating else 0)])
            for F in rest:
                # straight: climbs towards its break mark (the plan is cut on the way up)
                ts = F['t']
                bs = [float(np.dot(s_['m'], F['n'])) for s_ in others if 0.3 < abs(np.dot(s_['u'], F['u'])) < 0.94 and s_['L'] < 1.6 and near(F, s_['m'], 0.2)]
                if bs and np.mean(bs) < (ts[0] + ts[-1]) / 2: ts = ts[::-1]
                emit(F, ts, 0, rise_for(len(ts)), False)
    used_lines = {segs[i]['li'] for i in tread}
    rest_lines = [P for li, P in enumerate(lines) if li not in used_lines]
    return out, rest_lines

# ---------- furniture ----------
def furniture(walls, doors, outlines, solids, chair_all, tables, screens, thin, shafts, holes, rooms):
    """Navy outlines are walls only when they belong to the building: a group of touching lines that reaches the
    plan's outline (the external walls), a column or a lift shaft, runs on for more than 15 m, or closes round a
    room's name (small rooms with thin walls: group viewing rooms, CC rooms, editing rooms). Free-standing groups are
    furniture:
      - the small faces they enclose are chairs (0.3-0.75 m), larger ones desk and table tops;
      - a block of a dozen or more cells with no seat near it is compact shelving;
      - long thin faces are arrows on the floor (under 0.25 m wide) or railings (under 0.35 m); big boxes with no seat
        near them (over 3 m²) are outlines drawn round shelving or plant, not tables;
      - lines left over are low screens (desk partitions), or floor markings when shorter than 1.2 m all told or
        when the whole group is a long thin strip (direction arrows).
    Returns the walls and door swings that remain; adds to tables, chair_all, screens, thin and solids."""
    from shapely.geometry import LineString, Polygon, MultiLineString, Point
    from shapely.ops import unary_union, polygonize
    from shapely.strtree import STRtree
    items = [('w', P) for P in walls] + [('d', P) for P in doors]
    if not items: return walls, doors
    geo = [LineString(P) for _, P in items]
    tree = STRtree(geo); n = len(geo); par = list(range(n))
    def f(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    for i, g in enumerate(geo):
        for j in tree.query(g, predicate='dwithin', distance=0.05):
            if j > i: par[f(i)] = f(int(j))
    comps = {}
    for i in range(n): comps.setdefault(f(i), []).append(i)
    edge = MultiLineString([c.reshape(-1, 2).tolist() + [c.reshape(-1, 2)[0].tolist()] for cs in outlines for c in cs])
    cols = [Polygon(P) for P in solids.get('column', []) if len(P) >= 3]
    cols += [Polygon(P) for P in solids.get('wallFill', []) if len(P) >= 3 and area(P) > 0.3]
    cols = [c.buffer(0) for c in cols]
    ctree = STRtree(cols) if cols else None
    sh_ = [Polygon(P).buffer(0) for P in shafts if len(P) >= 3]      # lift shafts: the core round them is building
    vtree = STRtree(sh_) if sh_ else None
    rtree = STRtree([Point(x, z) for x, z in rooms]) if rooms else None
    rim = unary_union([Polygon(P).exterior for P in holes if len(P) >= 3]).buffer(0.6) if holes else None
    seats = [Point(x, z) for x, z, _, _ in chair_all]
    stree = STRtree(seats) if seats else None
    def sides(g):
        r = g.minimum_rotated_rectangle
        if r.geom_type != 'Polygon': return [0.0, g.length]
        xs, zs = r.exterior.coords.xy
        return sorted([math.hypot(xs[1] - xs[0], zs[1] - zs[0]), math.hypot(xs[2] - xs[1], zs[2] - zs[1])])
    keep_w, keep_d, new_tops, new_scr = [], [], [], []
    for ids in comps.values():
        U = unary_union([geo[i] for i in ids])
        x0, z0, x1, z1 = U.bounds
        strip = sides(U)[0] < 0.4
        structural = U.distance(edge) < 0.3 or (math.hypot(x1 - x0, z1 - z0) > 15 and not strip) or \
            (ctree is not None and len(ctree.query(U, predicate='dwithin', distance=0.12)) > 0) or \
            (vtree is not None and len(vtree.query(U, predicate='dwithin', distance=0.6)) > 0) or \
            (rtree is not None and len(rtree.query(U.convex_hull, predicate='contains')) > 0)
        if structural:
            for i in ids:
                if rim is not None and items[i][0] == 'w' and geo[i].within(rim): screens.append(items[i][1]); continue     # atrium balustrade
                if items[i][0] == 'w' and geo[i].length < 2.0 and stree is not None and \
                        len(stree.query(geo[i].interpolate(0.5, normalized=True).buffer(0.6), predicate='intersects')) > 0:
                    screens.append(items[i][1]); continue       # a desk pushed against the wall: its edge, by a seat
                (keep_w if items[i][0] == 'w' else keep_d).append(items[i][1])
            continue
        faces = [fc for fc in polygonize(U) if fc.area > 0.03]
        def seats_near(g, r): return stree is not None and len(stree.query(g.buffer(r), predicate='intersects')) > 0
        near_seat = seats_near(U, 1.0)
        tops, seat_f, marks, rails, used_f = [], [], [], [], []
        for fc in faces:
            if ctree is not None and any(fc.intersection(cols[k]).area > 0.3 * min(fc.area, cols[k].area) for k in ctree.query(fc)):
                used_f.append(fc); continue                     # a casing drawn round a column
            e = sides(fc)
            if rim is not None and fc.within(rim): continue      # posts of an atrium balustrade
            if e[0] < 0.25: marks.append(fc); continue           # arrows and lines drawn double on the floor
            if e[0] < 0.35 and e[1] > 2: rails.append(fc); continue
            if 0.3 <= e[1] <= 0.75 and fc.area < 0.45: seat_f.append(fc)
            elif fc.area > 3 and not seats_near(fc, 1.2): marks.append(fc)
            elif fc.area <= 10: tops.append(fc)
        cells = tops + seat_f
        if len(cells) >= 12 and not near_seat and unary_union(cells).area > 0.75 * unary_union(cells).minimum_rotated_rectangle.area:
            # compact shelving: the cells make one block of shelves
            blk = unary_union(cells).buffer(0.02).buffer(-0.02)
            for g in getattr(blk, 'geoms', [blk]):
                if g.area > 0.3: solids['shelfDark'].append(np.array(g.exterior.coords)[:-1])
            continue
        if len(seat_f) > 0 and not tops and len(seat_f) <= 1 and not near_seat:
            tops, seat_f = seat_f, []                          # a lone small box (a cabinet, a bin), not a chair
        for fc in seat_f:
            c = fc.centroid; chair_all.append((c.x, c.y, False, (0.45, 0.45)))
        new_tops += tops
        cover = unary_union([fc.boundary for fc in tops + seat_f + used_f]).buffer(0.03) if (tops or seat_f or used_f) else None
        mk = unary_union([fc.boundary for fc in marks]).buffer(0.03) if marks else None
        total = sum(geo[i].length for i in ids)
        for i in ids:
            g = geo[i]
            if mk is not None and g.difference(mk).length < 0.1: thin.append(items[i][1]); continue
            if cover is not None and g.difference(cover).length < 0.1: continue
            if items[i][0] == 'd' or total < 1.2 or (strip and not tops): thin.append(items[i][1])
            else: new_scr.append((g, items[i][1]))
    # compact shelving drawn as separate boxes: a dozen or more packed together (gaps under 0.2 m), or four or more
    # long narrow ones (shelving units), with no seat near
    blobs = unary_union([fc.buffer(0.1) for fc in new_tops]) if new_tops else None
    shelving = []
    for b in (getattr(blobs, 'geoms', [blobs]) if blobs is not None else []):
        mem = [fc for fc in new_tops if fc.representative_point().within(b)]
        long_ = len(mem) >= 4 and np.median([(lambda e: e[1] / max(e[0], 1e-6))(sides(fc)) for fc in mem]) >= 3.5
        if (len(mem) >= 12 or long_) and not (stree is not None and len(stree.query(b.buffer(0.4), predicate='intersects')) > 1) and \
                b.area > 0.7 * b.minimum_rotated_rectangle.area:
            blk = b.buffer(-0.1)
            for g in getattr(blk, 'geoms', [blk]):
                if g.area > 0.3: solids['shelfDark'].append(np.array(g.exterior.coords)[:-1])
            shelving.append(b)
    sh = unary_union(shelving).buffer(0.1) if shelving else None
    for fc in new_tops:
        if sh is None or not fc.within(sh): tables.append(np.array(fc.exterior.simplify(0.02).coords)[:-1])
    for g, P in new_scr:
        if sh is None or g.difference(sh).length > 0.1: screens.append(P)
    return keep_w, keep_d

# ---------- rooms ----------
SIGN = re.compile(r'OPAC|SELF[- ]?CHECK|KIOSK|GUARD|SCANNER|DROPBOX|PRINTING|CHARGING|SIGN IN|COUNTER|ENTRANCE|NEWSPAPER|'
                  r'RESHELVING|HOLD BOOKS|SELF-SERVICE|PRINTERS|TERMINAL|SERIALS|待上架|新書', re.I)
BIG_ROOM = re.compile(r'AREA|COLLECTION|CENTRE|ARCHIVES|LIBRARY|HALL|ZONE', re.I)
def tidy_labels(labels):
    """drop the scraps of signs drawn over the plan (lift numbers, floor areas) and send call-number and
    shelf-sign fragments to the shelf labels"""
    out = []
    for l in labels:
        lines = [x for x in l['t'].split('\n') if not re.fullmatch(r'\s*(\d+(\.\d+)?\s*)?m²\s*', x)]
        if not lines: continue
        l = dict(l, t='\n'.join(lines)); t = ' '.join(l['t'].split())
        if l['k'] == 'room':
            if re.fullmatch(r'\d+\.\d+|LI|F|T\s*\d\.?|LIFT\s*\d\.?', t): continue
            if re.search(r'[\[\]]', t) or re.fullmatch(r'[\u3400-\u9fff]{1,5}', t) or re.fullmatch(r'[A-Z][A-Z-]{0,2}', t) or \
                    re.fullmatch(r'([A-Z]{1,2}\s*\d{2,}\s*-?\s*)+|(PL\s*)+', t):
                l = dict(l, k='shelf')
        out.append(l)
    return out

def find_rooms(fl, walls, solids, voids, holes, R_slab, labels, areas, res=0.1):
    """a named room is the space round its name closed off by walls (with screens and door swings, which close the
    doorways), columns and the floor's edge; other openings are bridged by growing the walls (0-0.55 m), the least
    that closes the room. Found rooms are shaded (areaR) and their
    names marked (r) so the map shows them as rooms, not as words on the floor"""
    k = int(round(res / R_slab.res))
    floor = cv2.resize(R_slab.m, (R_slab.m.shape[1] // k, R_slab.m.shape[0] // k), interpolation=cv2.INTER_AREA) > 0
    H, W = floor.shape
    def px(P): return np.round((np.asarray(P, float) - [R_slab.x0, R_slab.z0]) / res).astype(np.int32)
    bar = np.zeros((H, W), np.uint8)
    for P in walls: cv2.polylines(bar, [px(P)], False, 1, 2)
    for key in ('wallFill', 'column'):
        for P in solids.get(key, []): cv2.fillPoly(bar, [px(P)], 1)
    for P in list(voids) + list(holes): cv2.fillPoly(bar, [px(P)], 1)
    if os.environ.get('DBG_RIMG') == fl['id']:
        im = np.dstack([np.where(floor, 235, 255)] * 3).astype(np.uint8); im[bar > 0] = (0, 0, 200)
        for l in labels:
            q = px([[l['x'], l['z']]])[0]; cv2.putText(im, ' '.join(l['t'].split())[:12], (int(q[0]), int(q[1])), 0, 0.35, (200, 0, 0), 1)
        cv2.imwrite(os.environ['DBG_OUT'], im)
    names = [l for l in labels if l['k'] == 'room' and not SIGN.search(l['t'])]
    found = []
    for l in names:
        if l.get('r'): continue
        given = fl.get('rooms', {}).get(' '.join(l['t'].split()))
        if given:
            found.append(np.array(given, float).reshape(-1, 2)); l['r'] = 1; continue
        t1 = ' '.join(l['t'].split())
        # how big a room of this name can be: numbered study rooms are small, named rooms and offices middling, and
        # open zones (… AREA, … COLLECTION) are marked only when a wall closes them off small
        amax = 40 if re.fullmatch(r'\d{1,2}', t1) else 250 if ROOM_NAME.search(t1) or re.search(r'TOILET|LAB\b', t1, re.I) else \
            150 if BIG_ROOM.search(t1) else 120
        c = px([[l['x'], l['z']]])[0]
        if not (0 <= c[0] < W and 0 <= c[1] < H): continue
        why = []
        for d in (0.0, 0.25, 0.4, 0.55) + ((0.7, 0.85) if amax <= 40 else ()):
            r = int(round(d / res))
            b = cv2.dilate(bar, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) if r else bar.copy()
            b[~floor] = 1
            win = 6
            y0, x0 = max(c[1] - win, 0), max(c[0] - win, 0)
            free = np.argwhere(b[y0:c[1] + win + 1, x0:c[0] + win + 1] == 0)
            if not len(free): continue
            fy, fx = free[np.argmin(((free + [y0, x0] - [c[1], c[0]]) ** 2).sum(1))]
            ff = b.copy(); mask = np.zeros((H + 2, W + 2), np.uint8)
            n = cv2.floodFill(ff, mask, (int(x0 + fx), int(y0 + fy)), 2)[0]
            A = n * res * res
            cap = amax if amax <= 40 or d > 0 else 600        # closed off by the walls as drawn: a room however big
            if A > cap * 1.3: why.append((d, round(A))); continue
            reg = (ff == 2).astype(np.uint8)
            if r: reg = cv2.dilate(reg, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
            reg &= floor.astype(np.uint8)
            A = reg.sum() * res * res
            if not 4.0 <= A <= cap: why.append((d, round(A))); continue
            if d > 0.4 and A > 60: why.append((d, 'leaky', round(A))); continue    # closed only by growing the walls a lot: an open area
            inside = [m for m in names if m is not l and 0 <= px([[m['x'], m['z']]])[0][1] < H and 0 <= px([[m['x'], m['z']]])[0][0] < W
                      and reg[px([[m['x'], m['z']]])[0][1], px([[m['x'], m['z']]])[0][0]]]
            if len(inside) > 2: why.append((d, 'names', len(inside))); continue     # an open area with several names in it
            cs, _ = cv2.findContours(reg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cc = max(cs, key=cv2.contourArea)
            P = cv2.approxPolyDP(cc, 0.12 / res, True)[:, 0, :] * res + [R_slab.x0, R_slab.z0]
            if any(np.allclose(P.mean(0), q.mean(0), atol=0.3) and abs(area(P) - area(q)) < 1 for q in found):
                l['r'] = 1; break
            found.append(P); l['r'] = 1
            if os.environ.get('DBG_R'): print('  room+', fl['id'], ' '.join(l['t'].split())[:40], round(area(P)), 'd', d)
            break
        if not l.get('r'):
            # the name sits on a wall or in a pocket: try round it (0.8-1.5 m away) and take the smallest room found
            best = None
            for r, rad in ((int(round(dd / res)), rr) for dd in (0.25, 0.4) for rr in (0.8, 1.5)):
                b = cv2.dilate(bar, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))); b[~floor] = 1
                for ang in np.linspace(0, 2 * np.pi, 12, endpoint=False):
                    q = (c + np.round([rad / res * np.cos(ang), rad / res * np.sin(ang)])).astype(int)
                    if not (0 <= q[0] < W and 0 <= q[1] < H) or b[q[1], q[0]]: continue
                    ff = b.copy(); mask = np.zeros((H + 2, W + 2), np.uint8)
                    n = cv2.floodFill(ff, mask, (int(q[0]), int(q[1])), 2)[0]
                    if not 4 <= n * res * res <= amax: continue
                    if best is None or n < best[0]: best = (n, (ff == 2).astype(np.uint8), r)
                if best: break
            if best:
                r = best[2]
                reg = cv2.dilate(best[1], cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) & floor.astype(np.uint8)
                cs, _ = cv2.findContours(reg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                P = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 0.12 / res, True)[:, 0, :] * res + [R_slab.x0, R_slab.z0]
                found.append(P); l['r'] = 1
        if os.environ.get('DBG_R') and not l.get('r'): print('  room?', fl['id'], ' '.join(l['t'].split()), why)
    areas.setdefault('areaR', []).extend(found)
    return found

# ---------- main ----------
place = CFG['place']; ext = CFG['extent']
floors_out = []
for fl in CFG['floors']:
    R_slab = Raster(ext)
    areas = {k: [] for k in ('areaY', 'areaG', 'areaC', 'areaN', 'areaP')}
    voids, holes = [], []
    solids = {k: [] for k in ('shelf', 'shelfDark', 'shelfG', 'column', 'wallFill', 'counter', 'bench', 'stool', 'armchair', 'seat')}
    tables, chairs, chair_all, screens = [], [], [], []
    walls, doors, stairs, thin = [], [], [], []
    labels, icons = [], []
    claimed = []    # earlier plans' outlines on this floor (model frame): later plans don't redraw what is inside
    outlines, wall_src = [], []
    for part in fl['plans']:
        W, H, paths, texts = read_pdf(os.path.join(pdf_dir, part['file']))
        M = part['M']; s = math.hypot(M[0], M[1])     # metres per PDF point
        legends = legend_boxes(paths, texts)
        drop = {i for i, p in enumerate(paths) if any(inside(p['bbox'], lb, 4) for lb in legends)}
        sil, sc = silhouette(W, H, paths, drop)
        sil_d = cv2.dilate(sil, np.ones((7, 7), np.uint8))
        def in_plan(b):
            cx, cy = int((b[0] + b[2]) / 2 * sc), int((b[1] + b[3]) / 2 * sc)
            return 0 <= cy < sil_d.shape[0] and 0 <= cx < sil_d.shape[1] and sil_d[cy, cx] > 0
        def on_seam(P, tol=0.9):
            """a line that lies (mostly) along or inside an earlier plan's outline: that plan already draws it"""
            if not claimed: return False
            pts = [P[0] + (P[-1] - P[0]) * t for t in np.linspace(0, 1, 9)] if len(P) == 2 else list(P)
            near_ = [max(cv2.pointPolygonTest(c, (float(x), float(z)), True) for c in claimed) > -tol for x, z in pts]
            return sum(near_) >= 0.8 * len(near_)
        def mine(b):    # not already drawn by an earlier plan of this floor
            (x, z), = xf(M, [((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)])
            return not any(cv2.pointPolygonTest(c, (float(x), float(z)), True) > 0.4 for c in claimed)
        kp_idx = [i for i, p in enumerate(paths) if i not in drop and in_plan(p['bbox']) and mine(p['bbox'])]
        kp = [paths[i] for i in kp_idx]
        ic, used = find_icons(kp, s)
        # arrows (direction signs, call-number ranges along the shelves): heads and shafts are not walls
        heads = []
        for k, p in enumerate(kp):
            if k in used: continue
            for poly, curve in p['polys']:
                if curve: continue
                Q = np.array(poly)
                if p['fill'] is None and len(Q) == 3:
                    l1, l2 = np.hypot(*(Q[0] - Q[1])) * s, np.hypot(*(Q[2] - Q[1])) * s
                    v1, v2 = Q[0] - Q[1], Q[2] - Q[1]
                    ang = math.degrees(math.acos(np.clip(np.dot(v1, v2) / max(np.linalg.norm(v1) * np.linalg.norm(v2), 1e-9), -1, 1)))
                    if 0.1 < l1 < 0.8 and 0.1 < l2 < 0.8 and 25 < ang < 110: heads.append((Q[1], k))
                elif p['fill'] is not None and is_navy(p['fill']) and 3 <= len(Q) <= 5 and area(Q * s) < 0.2 and max(np.ptp(Q, 0)) * s < 0.8:
                    heads.append((Q.mean(0), k))
        arrow_k = {k for _, k in heads}
        if heads:
            hp = np.array([h for h, _ in heads])
            for k, p in enumerate(kp):
                if k in used or p['fill'] is not None or len(p['polys']) != 1 or p['polys'][0][1]: continue
                Q = np.array(p['polys'][0][0])
                if len(Q) == 2 and np.hypot(*(Q[1] - Q[0])) * s < 14 and min(np.hypot(*(hp - Q[0]).T).min(), np.hypot(*(hp - Q[1]).T).min()) * s < 0.35:
                    arrow_k.add(k)
        for k in arrow_k:
            for poly, _ in kp[k]['polys']: thin.append(xf(M, poly))
        used.update(arrow_k)
        # direction arrows beside the OLD WING / NEW WING signs are not walls
        for t in texts:
            if re.search(r'\b(OLD|NEW)\s*WING\b', t['t']):
                b = t['bbox']; cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2; r = 3.5 / s
                for k, p in enumerate(kp):
                    q = p['bbox']
                    if p['fill'] is None and classify(p['stroke']) == 'wall' and max(q[2] - q[0], q[3] - q[1]) * s < 3 and abs((q[0] + q[2]) / 2 - cx) < r and abs((q[1] + q[3]) / 2 - cy) < r:
                        used.add(k)
        for kind, cx, cy, size in ic:
            # the symbol's frame (and any box drawn round it) is not a wall
            for k, p in enumerate(kp):
                q = p['bbox']
                if k not in used and p['fill'] is None and q[0] <= cx <= q[2] and q[1] <= cy <= q[3] and max(q[2] - q[0], q[3] - q[1]) * s < 1.6: used.add(k)
            if kind == 'lift': continue      # lift signs stand beside the lifts: the markers go on the shafts themselves
            (x, z), = xf(M, [(cx, cy)]); icons.append([kind, r2(x), r2(z)])
        # this plan's outline without symbols, lettering and arrows (they would bulge it past its real edge)
        extra_drop = {kp_idx[k] for k in used} | {kp_idx[k] for k, p in enumerate(kp) if is_glyph(p, s)}
        sil_o, _ = silhouette(W, H, paths, drop | extra_drop)
        # zone legend (3/F): coloured squares outside the plan with their names beside them
        zone_names = {}
        sq = sorted([p for p in paths if (classify(p['fill']) or '').startswith('area') and not in_plan(p['bbox']) and (p['bbox'][2] - p['bbox'][0]) < 40],
                    key=lambda p: p['bbox'][1])
        for k, p in enumerate(sq):
            b = p['bbox']; y1 = sq[k + 1]['bbox'][1] - 2 if k + 1 < len(sq) else b[3] + 60
            lines = sorted([t for t in texts if b[2] < t['bbox'][0] < b[2] + 20 and b[1] - 6 <= t['bbox'][1] < y1], key=lambda t: t['bbox'][1])
            if lines: zone_names[classify(p['fill'])] = ' '.join(t['t'] for t in lines)
        # silhouette -> floor slab (and this plan's claim on the floor)
        cs, _ = cv2.findContours(sil_o, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        new_claims = []
        for c in cs:
            if cv2.contourArea(c) / sc / sc * s * s < 20: continue
            P = xf(M, c[:, 0, :] / sc); R_slab.fill(P); new_claims.append(P.astype(np.float32).reshape(-1, 1, 2))
        # --- fills ---
        tbl_boxes = [p['bbox'] for k, p in enumerate(kp) if k not in used and p['fill'] is not None and classify(p['fill']) == 'table']
        crescents, tbl_fill = [], []
        # diagonals drawn across squares (voids, glazing, shafts) are not walls
        sqs = [p['bbox'] for p in kp if p['close'] and min(bbox_m(p['bbox'], s)) > 1.0 and max(bbox_m(p['bbox'], s)) / max(min(bbox_m(p['bbox'], s)), 1e-6) < 1.7]
        for k, p in enumerate(kp):
            if k in used or p['fill'] is not None or len(p['polys']) != 1: continue
            Q = np.array(p['polys'][0][0])
            if len(Q) != 2: continue
            for b in sqs:
                corners = np.array([(b[0], b[1]), (b[2], b[3]), (b[2], b[1]), (b[0], b[3])])
                d0 = np.hypot(*(corners - Q[0]).T); d1 = np.hypot(*(corners - Q[1]).T)
                tol = 0.12 * max(b[2] - b[0], b[3] - b[1])
                if (d0.min() < tol and d1.min() < tol and d0.argmin() // 2 == d1.argmin() // 2 and d0.argmin() != d1.argmin()):
                    used.add(k); break
        # crossed squares drawn as outlines (atria, lift shafts): pink rectangle + diagonals
        for k, p in enumerate(kp):
            if k in used or p['fill'] is not None or classify(p['stroke']) != 'shelf': continue
            w, h = bbox_m(p['bbox'], s)
            if min(w, h) > 1.2 and max(w, h) / min(w, h) < 1.6 and p['close']:
                P = xf(M, p['polys'][0][0]); (holes if max(w, h) > 4 else voids).append(P); used.add(k)
                b = p['bbox']; used.update(j for j, q in enumerate(kp) if q['fill'] is None and classify(q['stroke']) == 'shelf' and contains(b, q['bbox'], 1))
        for k, p in enumerate(kp):
            if k in used or p['fill'] is None or not p['close']: continue
            if is_navy(p['fill']) and is_crescent(p, s): crescents.append(k); used.add(k); continue
            if is_glyph(p, s): used.add(k); continue
            fcls = classify(p['fill']); w, h = bbox_m(p['bbox'], s)
            for poly, curve in p['polys']:
                if len(poly) < 3: continue
                P = xf(M, poly); A = area(P)
                if A < 0.004: continue
                if fcls == 'shelf' and min(w, h) > 1.2 and max(w, h) / max(min(w, h), 1e-6) < 1.6:
                    (holes if max(w, h) > 4 else voids).append(P)    # crossed squares: lift shafts / atrium voids
                elif fcls == 'shelf': solids['shelfDark' if p['fill'][1] < 0.3 else 'shelf'].append(P)
                elif fcls == 'shelfG' or (fcls == 'areaG' and A < 20): solids['shelfG'].append(P)
                elif fcls in areas: areas[fcls].append(P)
                elif fcls == 'wall': solids['wallFill'].append(P)
                elif fcls == 'column': solids['column'].append(P)
                elif fcls == 'counter': solids['counter'].append(P)
                elif fcls == 'table':
                    if p['fill'][0] > 0.95 and p['fill'][1] > 0.95 and A < 0.05: continue      # white specks inside symbols
                    tbl_fill.append((p['bbox'], P))
                elif fcls == 'seat': solids['armchair'].append(P)
                elif fcls == 'chair':
                    rnd = len(poly) > 12 and abs(w - h) < 0.15 * max(w, h)
                    if p['fill'][0] < 0.3:      # black: drop shadows behind tables (or dark seats)
                        b = p['bbox']
                        if any(touch(b, t, 0) and (min(b[2], t[2]) - max(b[0], t[0])) * (min(b[3], t[3]) - max(b[1], t[1])) > 0.3 * (b[2] - b[0]) * (b[3] - b[1]) for t in tbl_boxes): continue
                    solids['stool' if rnd else 'bench'].append(P)
        # study tables are drawn as grids of cells: touching cells that fill their box make one table
        for g in cluster([b for b, _ in tbl_fill], 0.03 / s):
            boxes = [tbl_fill[i][0] for i in g]
            b = (min(q[0] for q in boxes), min(q[1] for q in boxes), max(q[2] for q in boxes), max(q[3] for q in boxes))
            filled = sum((q[2] - q[0]) * (q[3] - q[1]) for q in boxes) / max((b[2] - b[0]) * (b[3] - b[1]), 1e-9)
            if len(g) > 1 and filled > 0.8:
                tables.append(xf(M, [(b[0], b[1]), (b[2], b[1]), (b[2], b[3]), (b[0], b[3])]))
            else:
                tables.extend(tbl_fill[i][1] for i in g)
        # second pass for shadows drawn before their table
        def shadowed(b): return any(touch(b, t, 0) and (min(b[2], t[2]) - max(b[0], t[0])) * (min(b[3], t[3]) - max(b[1], t[1])) > 0.3 * (b[2] - b[0]) * (b[3] - b[1]) for t in tbl_boxes)
        # --- navy outlines: chairs, tables, walls, doors ---
        navy_k = [k for k, p in enumerate(kp) if k not in used and p['fill'] is None and classify(p['stroke']) == 'wall']
        small = [k for k in navy_k if max(bbox_m(kp[k]['bbox'], s)) < 0.75]
        groups = cluster([kp[k]['bbox'] for k in small], 0.04 / s)
        chair_pts, chair_k = [], set()
        for k in crescents:
            b = kp[k]['bbox']; (x, z), = xf(M, [((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)])
            chair_pts.append((x, z, True, bbox_m(b, s)))
        for g in groups:
            ks = [small[i] for i in g]
            b = (min(kp[k]['bbox'][0] for k in ks), min(kp[k]['bbox'][1] for k in ks), max(kp[k]['bbox'][2] for k in ks), max(kp[k]['bbox'][3] for k in ks))
            w, h = bbox_m(b, s); big_, sm_ = max(w, h), min(w, h)
            arc = len(ks) <= 2 and all(any(c for _, c in kp[k]['polys']) for k in ks) and 0.25 <= big_ <= 0.75 and sm_ / big_ < 0.45
            if (0.3 <= big_ <= 0.9 and sm_ >= 0.25 and len(ks) >= 2) or arc:
                (x, z), = xf(M, [((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)])
                chair_pts.append((x, z, arc, (w, h))); chair_k.update(ks)
        # outline tables: closed outlines 0.7-4.5 m with chairs beside them
        for k in navy_k:
            if k in chair_k: continue
            p = kp[k]; w, h = bbox_m(p['bbox'], s)
            if not (0.6 <= max(w, h) <= 4.5 and min(w, h) >= 0.45) or len(p['polys']) != 1: continue
            poly, curve = p['polys'][0]
            if not p['close'] and math.dist(poly[0], poly[-1]) > 0.5: continue
            P = xf(M, poly); Pc = P.astype(np.float32).reshape(-1, 1, 2)
            if any(cv2.pointPolygonTest(Pc, (float(x), float(z)), True) > -0.9 for x, z, _, _ in chair_pts):
                tables.append(P); chair_k.add(k)
        chair_all += chair_pts
        # remaining navy outlines
        for k in navy_k:
            if k in chair_k: continue
            for poly, curve in kp[k]['polys']:
                P = xf(M, poly)
                if curve:
                    if not on_seam(P): doors.append(P)
                else:
                    for a_, b_ in zip(P[:-1], P[1:]):
                        if np.hypot(*(b_ - a_)) > 0.12 and not on_seam(np.array([a_, b_])): walls.append(np.array([a_, b_])); wall_src.append(len(outlines))
        for k, p in enumerate(kp):
            if k in used or p['fill'] is not None or p['stroke'] is None: continue
            scls = classify(p['stroke'])
            for poly, curve in p['polys']:
                P = xf(M, poly)
                if scls == 'stairs': stairs.append(P)
                elif scls in ('thin', 'chair'): thin.append(P)
        # labels
        tk = [t for t in texts if in_plan(t['bbox']) and mine(t['bbox']) and not any(inside(t['bbox'], lb, 4) for lb in legends) and not DROP_TEXT.match(t['t'])]
        for t in merge_lines(tk):
            b = t['bbox']; (x, z), = xf(M, [((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)])
            first = t['t'].split('\n')[0]
            kind = 'shelf' if CALLNO.match(first) and t['size'] < 7 and not ROOM_NAME.search(t['t']) else 'room'
            labels.append(dict(t=t['t'], x=r2(x), z=r2(z), h=r2(t['size'] * s), k=kind))
        for cls, name in zone_names.items():
            big = sorted(areas[cls], key=area, reverse=True)
            if big:
                P = big[0]; labels.append(dict(t=name, x=r2(P[:, 0].mean()), z=r2(P[:, 1].mean()), h=r2(0.9), k='zone'))
        claimed += new_claims; outlines.append(new_claims)
    if len(outlines) > 1:
        def depth(cs, x, z): return max((cv2.pointPolygonTest(c, (float(x), float(z)), True) for c in cs), default=-1e9)
        keep = []
        for P, src in zip(walls, wall_src):
            edge = all(abs(depth(outlines[src], x, z)) < 0.6 for x, z in P)
            m = P.mean(0)
            later = any(depth(outlines[j], m[0], m[1]) > 1.0 for j in range(src + 1, len(outlines)))
            keep.append(not (edge and later))
        walls = [P for P, k in zip(walls, keep) if k]
    # crossed squares in among the shelving are shelf units drawn crossed, not lift shafts; the dark bars beside a
    # lift shaft are its symbol's drop shadow
    def bb(P): return (*P.min(0), *P.max(0))
    shb = [(k, i, bb(P)) for k in ('shelf', 'shelfDark') for i, P in enumerate(solids[k])]
    real, drop_sh = [], set()
    for P in voids:
        b = bb(P); nb = [(k, i, q) for k, i, q in shb if touch(b, q, 0.15)]
        if len(nb) >= 5: solids['shelf'].append(P); continue
        real.append(P)
        drop_sh.update((k, i) for k, i, q in nb if min(q[2] - q[0], q[3] - q[1]) < 0.5 and max(q[2] - q[0], q[3] - q[1]) < 1.7)
    voids[:] = real
    for k in ('shelf', 'shelfDark'): solids[k] = [P for i, P in enumerate(solids[k]) if (k, i) not in drop_sh]
    rooms = [(l['x'], l['z']) for l in labels if l['k'] != 'zone' and ROOM_NAME.search(l['t'])]
    pre = walls + doors
    walls, doors = furniture(walls, doors, outlines, solids, chair_all, tables, screens, thin, voids, holes, rooms)
    # movable partitions are drawn dashed, as rows of short separate strokes: furniture() takes each for a scrap;
    # strokes in line with another (gap under 0.8 m) are partitions, shown as screens and closing rooms off
    kept = {id(P) for P in walls + doors + screens}
    short = [P for P in pre if id(P) not in kept and len(P) == 2 and 0.25 < np.hypot(*(P[1] - P[0])) < 1.6]
    # loose strokes only: a stroke whose end meets another line (a desk's or shelf's outline turning a corner) is not a dash
    ends = np.array([e for P in pre for e in (P[0], P[-1])]) if pre else np.zeros((0, 2))
    def loose(P):
        for e in (P[0], P[-1]):
            d = np.hypot(*(ends - e).T)
            if ((d < 0.06).sum()) > 1: return False
        return True
    short = [P for P in short if loose(P)]
    par = list(range(len(short)))
    def fd(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    for i, P in enumerate(short):
        u = (P[1] - P[0]) / np.hypot(*(P[1] - P[0]))
        for j in range(i + 1, len(short)):
            Q = short[j]; v = (Q[1] - Q[0]) / np.hypot(*(Q[1] - Q[0]))
            if abs(u[0] * v[1] - u[1] * v[0]) > 0.08: continue
            off = abs(u[0] * (Q[0][1] - P[0][1]) - u[1] * (Q[0][0] - P[0][0]))
            gap = min(np.hypot(*(a_ - b_)) for a_ in P for b_ in Q)
            if off < 0.08 and 0.05 < gap < 0.8: par[fd(i)] = fd(j)
    chains = {}
    for i in range(len(short)): chains.setdefault(fd(i), []).append(i)
    dash = set()
    for g in chains.values():
        if len(g) < 3: continue
        pts = np.concatenate([short[i] for i in g])
        span = np.hypot(*(pts[:, None] - pts[None]).T).max()
        if span >= 2.5: dash.update(g)
    partitions = [short[i] for i in sorted(dash)]
    if partitions:
        pid = {id(P) for P in partitions}
        thin[:] = [P for P in thin if id(P) not in pid]
        screens += partitions
    # small dark marks standing free of the walls (lift call arrows, signs) are not walls
    if solids['wallFill'] and walls:
        from shapely.geometry import LineString, Polygon
        from shapely.strtree import STRtree
        wt = STRtree([LineString(P) for P in walls])
        solids['wallFill'] = [P for P in solids['wallFill'] if not (max(np.ptp(P, 0)) < 0.8 and area(P) < 0.25 and
                              len(wt.query(Polygon(P).buffer(0), predicate='dwithin', distance=0.05)) == 0)]
    # archive shelving is drawn as a grid of orange cells (a counter is one box): eight or more touching cells are shelves
    if solids['counter']:
        grp = cluster([(*P.min(0), *P.max(0)) for P in solids['counter']], 0.05)
        big = {i for g in grp if len(g) >= 8 for i in g}
        solids['shelf'] += [P for i, P in enumerate(solids['counter']) if i in big]
        solids['counter'] = [P for i, P in enumerate(solids['counter']) if i not in big]
    # chairs face the nearest table
    tcent = [(P.mean(0), P) for P in tables]
    for x, z, arc, (w, h) in chair_all:
        best = None
        for c, P in tcent:
            d = np.hypot(*(P - [x, z]).T).min()
            if d < 1.2 and (best is None or d < best[0]): best = (d, c, P)
        if best:
            P = best[2]
            # direction to the closest point of the table's outline (edges, not just corners)
            dmin, tgt = 1e9, best[1]
            for a_, b_ in zip(P, np.roll(P, -1, 0)):
                ab = b_ - a_; t = np.clip(np.dot([x, z] - a_, ab) / max(np.dot(ab, ab), 1e-9), 0, 1); pt = a_ + ab * t
                d = math.hypot(pt[0] - x, pt[1] - z)
                if d < dmin: dmin, tgt = d, pt
            ang = math.atan2(tgt[1] - z, tgt[0] - x)
            if arc:     # the arc is the chair's back: move the seat towards the table
                x, z = x + 0.18 * math.cos(ang), z + 0.18 * math.sin(ang)
        else:
            ang = 0.0
        chairs.append([r2(x), r2(z), round(ang, 2)])
    # walls are drawn as two faces; a long line with no parallel partner is a joint, edge or marking on the floor
    if walls:
        W = np.array([np.concatenate([P[0], P[-1]]) for P in walls]); A, B = W[:, :2], W[:, 2:]
        L = np.hypot(*(B - A).T); U = (B - A) / np.maximum(L, 1e-9)[:, None]
        keep = np.ones(len(W), bool)
        for i in np.nonzero(L >= 2.0)[0]:
            par = np.abs(U[:, 0] * U[i, 1] - U[:, 1] * U[i, 0]) < 0.06
            across = np.abs(U[i, 0] * (A[:, 1] - A[i, 1]) - U[i, 1] * (A[:, 0] - A[i, 0]))
            t0, t1 = (A - A[i]) @ U[i], (B - A[i]) @ U[i]
            ov = (np.minimum(np.maximum(t0, t1), L[i]) - np.maximum(np.minimum(t0, t1), 0)) > 0.3 * L[i]
            ok = par & (across > 0.06) & (across < 0.6) & ov; ok[i] = False
            if not ok.any(): keep[i] = False
        singles = [P for P, k in zip(walls, keep) if not k]
        walls = [P for P, k in zip(walls, keep) if k]
    else:
        singles = []
    # extra floor areas from the model (e.g. the west building at 2/F, which the plans leave out)
    for ex in fl.get('extra', []):
        P = np.array(ex['poly']).reshape(-1, 2); R_slab.fill(P)
        if ex.get('kind'): areas.setdefault(ex['kind'], []).append(P)
        if ex.get('label'): labels.append(dict(t=ex['label'], x=r2(P[:, 0].mean()), z=r2(P[:, 1].mean()), h=0.9, k='zone'))
    labels = tidy_labels(labels)
    found = find_rooms(fl, walls + screens + doors + singles, solids, voids, holes, R_slab, labels, areas)
    # a second try for the rest without the short screens (desk partitions inside a small room cut it up)
    pid = {id(P) for P in partitions}
    found += find_rooms(fl, walls + [P for P in screens if id(P) in pid or np.hypot(*(P[-1] - P[0])) >= 2.0] + doors + singles,
                        solids, voids, holes, R_slab, labels, areas)
    # single lines along a room's edge are its partitions (glazed fronts drawn as one line): walls; the rest were
    # joints and markings on the floor
    if found and singles:
        from shapely.geometry import LineString, Polygon
        edge = unary_union([Polygon(P).buffer(0).exterior for P in found]).buffer(0.35)
        part = [edge.contains(LineString(P)) or LineString(P).intersection(edge).length > 0.8 * LineString(P).length for P in singles]
        walls += [P for P, k in zip(singles, part) if k]; singles = [P for P, k in zip(singles, part) if not k]
    thin += singles
    for P in voids:
        cx, cz = P[:, 0].mean(), P[:, 1].mean()
        if not any(k == 'lift' and math.hypot(x - cx, z - cz) < 1.0 for k, x, z in icons): icons.append(['lift', r2(cx), r2(cz)])
    for P in holes: cv2.fillPoly(R_slab.m, [R_slab.px(P)], 0)     # atria: open to the floor below
    steps, stairs = stair_steps(stairs, fl.get('h', 4.0))
    lines_out = lambda L: [flat(P) for P in L if len(P) >= 2]
    out = dict(id=fl['id'], name=fl['name'], y=fl['y'], h=fl.get('h', 4.0), sources=[p['file'] for p in fl['plans']], updated=fl.get('updated'),
               slab=[[flat(r) for r in poly] for poly in R_slab.polygons(close=0.2, eps=0.05, min_area=2)],
               holes=[flat(P) for P in holes], voids=[flat(P) for P in voids],
               areas={k: [flat(P) for P in v if area(P) > 0.3] for k, v in areas.items() if v},
               solids={k: [flat(P) for P in v] for k, v in solids.items() if v},
               tables=[flat(P) for P in tables], chairs=chairs,
               walls=[flat(P) for P in walls], screens=lines_out(screens), doors=lines_out(doors), stairs=lines_out(stairs), thin=lines_out(thin), steps=steps,
               labels=labels, icons=icons)
    floors_out.append(out)
    print(fl['id'], {k: len(v) for k, v in out['solids'].items()}, 'tables', len(tables), 'chairs', len(chairs), 'walls', len(walls), 'screens', len(screens), 'holes', len(holes), 'labels', len(labels), 'icons', len(icons))
res = dict(place=place, source=CFG['source'], floors=floors_out)
os.makedirs(os.path.dirname(out_path), exist_ok=True)
json.dump(res, open(out_path, 'w'), ensure_ascii=False, separators=(',', ':'))
print('->', out_path, round(os.path.getsize(out_path) / 1e6, 2), 'MB')
