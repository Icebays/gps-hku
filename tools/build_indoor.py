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
import json, math, os, re, sys
import numpy as np
import cv2
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
    """stair drawings (tread lines) -> flights of 3D steps. Parallel treads 0.6-3.2 m long, 0.15-0.45 m apart, make
    a flight; side-by-side flights (dog-leg stairs) rise one after the other to the next floor.
    Returns ([[x0, z0, x1, z1, x2, z2, x3, z3, top], ...], the lines that are not treads)."""
    segs = []
    for li, P in enumerate(lines):
        for a, b in zip(P[:-1], P[1:]):
            L = float(np.hypot(*(b - a)))
            if 0.6 <= L <= 3.2:
                u = (b - a) / L
                if u[0] < -1e-6 or (abs(u[0]) < 1e-6 and u[1] < 0): u = -u
                segs.append(dict(a=a, b=b, m=(a + b) / 2, u=u, L=L, li=li))
    n = len(segs); par = list(range(n))
    def f(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    for i in range(n):
        for j in range(i + 1, n):
            si, sj = segs[i], segs[j]
            if abs(si['u'][0] * sj['u'][1] - si['u'][1] * sj['u'][0]) > 0.07: continue
            d = sj['m'] - si['m']
            along, across = abs(np.dot(d, si['u'])), abs(si['u'][0] * d[1] - si['u'][1] * d[0])
            if along < 0.3 * min(si['L'], sj['L']) and 0.15 <= across <= 0.45 and abs(si['L'] - sj['L']) < 0.35 * max(si['L'], sj['L']): par[f(i)] = f(j)
    groups = {}
    for i in range(n): groups.setdefault(f(i), []).append(i)
    flights, used_lines = [], set()
    for g in groups.values():
        if len(g) < 4: continue
        u = segs[g[0]]['u']; nrm = np.array([-u[1], u[0]])
        o = segs[g[0]]['m']
        t = sorted(set(round(float(np.dot(segs[i]['m'] - o, nrm)), 3) for i in g))
        # treads are evenly spaced: drop strays far from the median spacing
        if len(t) < 4: continue
        W = float(np.median([segs[i]['L'] for i in g])); cu = float(np.mean([np.dot(segs[i]['m'], u) for i in g]))
        flights.append(dict(u=u, n=nrm, o=o, t=t, W=W, cu=cu, c=np.mean([segs[i]['m'] for i in g], 0)))
        used_lines.update(segs[i]['li'] for i in g)
    # dog-legs: pair parallel flights side by side; the second starts where the first ends
    out = []; done = set()
    for i, A in enumerate(flights):
        if i in done: continue
        pair = None
        for j, B in enumerate(flights):
            if j <= i or j in done: continue
            if abs(A['u'][0] * B['u'][1] - A['u'][1] * B['u'][0]) > 0.07: continue
            gap = abs(np.dot(B['c'] - A['c'], A['u']))
            if gap < (A['W'] + B['W']) / 2 + 1.0 and abs(np.dot(B['c'] - A['c'], A['n'])) < 2.0: pair = j; break
        seq = [(A, 1)] + ([(flights[pair], -1)] if pair is not None else [])
        done.add(i)
        if pair is not None: done.add(pair)
        total = sum(len(F['t']) - 1 for F, _ in seq)
        rise = min(0.18, floor_h / max(total, 1)); h = 0.0
        for F, sgn in seq:
            ts = F['t'] if sgn > 0 else F['t'][::-1]
            for a, b in zip(ts[:-1], ts[1:]):
                h += rise
                lo, hi = min(a, b), max(a, b)
                c0 = F['o'] + F['n'] * lo; c1 = F['o'] + F['n'] * hi
                base = F['u'] * (F['cu'] - np.dot(F['o'], F['u']))
                half = F['u'] * F['W'] / 2
                q = [c0 + base - half, c0 + base + half, c1 + base + half, c1 + base - half]
                out.append([r2(v) for pt in q for v in pt] + [r2(h)])
    rest = [P for li, P in enumerate(lines) if li not in used_lines]
    return out, rest

# ---------- main ----------
place = CFG['place']; ext = CFG['extent']
floors_out = []
for fl in CFG['floors']:
    R_slab = Raster(ext)
    areas = {k: [] for k in ('areaY', 'areaG', 'areaC', 'areaN', 'areaP')}
    voids, holes = [], []
    solids = {k: [] for k in ('shelf', 'shelfDark', 'shelfG', 'column', 'wallFill', 'counter', 'bench', 'stool', 'armchair', 'seat')}
    tables, chairs = [], []
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
            if re.search(r'WING', t['t']):
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
            P = xf(M, poly); c = P.mean(0); r = 0.5 * max(w, h) + 0.9
            if sum(1 for x, z, _, _ in chair_pts if math.hypot(x - c[0], z - c[1]) < r) >= 1:
                tables.append(P); chair_k.add(k)
        # chairs face the nearest table
        tcent = [(P.mean(0), P) for P in tables]
        for x, z, arc, (w, h) in chair_pts:
            best = None
            for c, P in tcent:
                d = np.hypot(*(P - [x, z]).T).min()
                if d < 1.2 and (best is None or d < best[0]): best = (d, c, P)
            if best:
                P = best[2]; q = P[np.argmin(np.hypot(*(P - [x, z]).T))]
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
            kind = 'shelf' if CALLNO.match(first) and t['size'] < 7 else 'room'
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
        thin += [P for P, k in zip(walls, keep) if not k]
        walls = [P for P, k in zip(walls, keep) if k]
    # extra floor areas from the model (e.g. the west building at 2/F, which the plans leave out)
    for ex in fl.get('extra', []):
        P = np.array(ex['poly']).reshape(-1, 2); R_slab.fill(P)
        if ex.get('kind'): areas.setdefault(ex['kind'], []).append(P)
        if ex.get('label'): labels.append(dict(t=ex['label'], x=r2(P[:, 0].mean()), z=r2(P[:, 1].mean()), h=0.9, k='zone'))
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
               walls=[flat(P) for P in walls], doors=lines_out(doors), stairs=lines_out(stairs), thin=lines_out(thin), steps=steps,
               labels=labels, icons=icons)
    floors_out.append(out)
    print(fl['id'], {k: len(v) for k, v in out['solids'].items()}, 'tables', len(tables), 'chairs', len(chairs), 'walls', len(walls), 'holes', len(holes), 'labels', len(labels), 'icons', len(icons))
res = dict(place=place, source=CFG['source'], floors=floors_out)
os.makedirs(os.path.dirname(out_path), exist_ok=True)
json.dump(res, open(out_path, 'w'), ensure_ascii=False, separators=(',', ':'))
print('->', out_path, round(os.path.getsize(out_path) / 1e6, 2), 'MB')
