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
        if i not in used and curvy(p) and max(W(p['bbox']), H(p['bbox'])) * s < 1.6: used.add(i)
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
        if near(p['fill'], (1.0, 0.86, 0.67), 0.03) and 1.8 < W(b) / max(H(b), 1e-6) < 5 and W(b) > 8:
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
DROP_TEXT = re.compile(r'^(YOU ARE HERE|You Are Here|N|Last update.*|.*\bPLAN\.?$|G/F\s+MAIN LIBRARY)$', re.I)
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

# ---------- main ----------
place = CFG['place']; ext = CFG['extent']
floors_out = []
for fl in CFG['floors']:
    R_shelf, R_shelfG, R_table, R_chair, R_seat, R_counter, R_column, R_slab, R_wallfill = (Raster(ext) for _ in range(9))
    areas = {k: [] for k in ('areaY', 'areaG', 'areaC', 'areaN', 'areaP', 'void')}
    walls, doors, stairs, thin = [], [], [], []
    labels, icons = [], []
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
        keep = [i for i, p in enumerate(paths) if i not in drop and in_plan(p['bbox'])]
        kp = [paths[i] for i in keep]
        ic, used = find_icons(kp, s)
        for kind, cx, cy, size in ic:
            (x, z), = xf(M, [(cx, cy)]); icons.append([kind, r2(x), r2(z)])
        # zone legend (3/F): coloured squares outside the plan with their names beside them
        zone_names = {}
        sq = sorted([p for p in paths if (classify(p['fill']) or '').startswith('area') and not in_plan(p['bbox']) and (p['bbox'][2] - p['bbox'][0]) < 40],
                    key=lambda p: p['bbox'][1])
        for k, p in enumerate(sq):
            b = p['bbox']; y1 = sq[k + 1]['bbox'][1] - 2 if k + 1 < len(sq) else b[3] + 60
            lines = sorted([t for t in texts if b[2] < t['bbox'][0] < b[2] + 20 and b[1] - 6 <= t['bbox'][1] < y1], key=lambda t: t['bbox'][1])
            if lines: zone_names[classify(p['fill'])] = ' '.join(t['t'] for t in lines)
        # silhouette -> floor slab
        cs, _ = cv2.findContours(sil, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in cs:
            if cv2.contourArea(c) / sc / sc * s * s < 20: continue
            R_slab.fill(xf(M, c[:, 0, :] / sc))
        for k, p in enumerate(kp):
            if k in used: continue
            fcls, scls = classify(p['fill']), classify(p['stroke'])
            for poly, curve in p['polys']:
                P = xf(M, poly)
                if p['fill'] is not None and p['close'] and len(P) >= 3:
                    A = area(P)
                    b = p['bbox']; bw, bh = (b[2] - b[0]) * s, (b[3] - b[1]) * s
                    if fcls == 'shelf' and min(bw, bh) > 1.2 and max(bw, bh) / max(min(bw, bh), 1e-6) < 1.6:
                        areas['void'].append(P)                      # lift shafts and voids are drawn crossed on the plans
                    elif fcls == 'shelf': R_shelf.fill(P)
                    elif fcls == 'shelfG' or (fcls == 'areaG' and A < 20): R_shelfG.fill(P)
                    elif fcls in areas and fcls != 'void': areas[fcls].append(P)
                    elif fcls == 'wall': R_wallfill.fill(P)
                    elif fcls == 'column': R_column.fill(P)
                    elif fcls == 'table': R_table.fill(P)
                    elif fcls == 'chair': R_chair.fill(P)
                    elif fcls == 'seat': R_seat.fill(P)
                    elif fcls == 'counter': R_counter.fill(P)
                if p['stroke'] is not None and p['fill'] is None:
                    if scls == 'wall':
                        if curve: doors.append(P)
                        else:
                            for a_, b_ in zip(P[:-1], P[1:]):
                                if np.hypot(*(b_ - a_)) > 0.25: walls.append(np.array([a_, b_]))
                    elif scls == 'shelf': R_shelf.line(P, 0.05)
                    elif scls == 'shelfG': R_shelfG.line(P, 0.05)
                    elif scls == 'stairs': stairs.append(P)
                    elif scls in ('thin', 'chair'): thin.append(P)
                    elif scls == 'column': R_column.line(P, 0.05)
        # labels
        tk = [t for t in texts if in_plan(t['bbox']) and not any(inside(t['bbox'], lb, 4) for lb in legends) and not DROP_TEXT.match(t['t'])]
        for t in merge_lines(tk):
            b = t['bbox']; (x, z), = xf(M, [((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)])
            first = t['t'].split('\n')[0]
            kind = 'shelf' if CALLNO.match(first) and t['size'] < 7 else 'room'
            labels.append(dict(t=t['t'], x=r2(x), z=r2(z), h=r2(t['size'] * s), k=kind))
        for cls, name in zone_names.items():
            big = sorted(areas[cls], key=area, reverse=True)
            if big:
                P = big[0]; labels.append(dict(t=name, x=r2(P[:, 0].mean()), z=r2(P[:, 1].mean()), h=r2(0.9), k='zone'))
    for P in areas['void']:
        w_, h_ = np.ptp(P[:, 0]), np.ptp(P[:, 1])
        cx, cz = P[:, 0].mean(), P[:, 1].mean()
        if max(w_, h_) < 4 and not any(k == 'lift' and math.hypot(x - cx, z - cz) < 4 for k, x, z in icons): icons.append(['lift', r2(cx), r2(cz)])
    def lines_out(L, minlen=0.0): return [flat(P) for P in L if len(P) >= 2]
    out = dict(id=fl['id'], name=fl['name'], y=fl['y'], h=fl.get('h', 4.0), sources=[p['file'] for p in fl['plans']], updated=fl.get('updated'),
               slab=[[flat(r) for r in poly] for poly in R_slab.polygons(close=0.3, eps=0.08, min_area=5)],
               areas={k: [flat(P) for P in v if area(P) > 0.3] for k, v in areas.items() if v},
               blocks=dict(shelf=[[flat(r) for r in p] for p in R_shelf.polygons()],
                           shelfG=[[flat(r) for r in p] for p in R_shelfG.polygons()],
                           table=[[flat(r) for r in p] for p in R_table.polygons(close=0.05, min_area=0.05)],
                           chair=[[flat(r) for r in p] for p in R_chair.polygons(close=0.0, eps=0.03, min_area=0.02)],
                           seat=[[flat(r) for r in p] for p in R_seat.polygons(close=0.05)],
                           counter=[[flat(r) for r in p] for p in R_counter.polygons(close=0.05)],
                           column=[[flat(r) for r in p] for p in R_column.polygons(close=0.0, min_area=0.05)],
                           wall=[[flat(r) for r in p] for p in R_wallfill.polygons(close=0.05, eps=0.03, min_area=0.02)]),
               walls=[flat(P) for P in walls], doors=lines_out(doors), stairs=lines_out(stairs), thin=lines_out(thin),
               labels=labels, icons=icons)
    floors_out.append(out)
    print(fl['id'], {k: len(v) for k, v in out['blocks'].items()}, 'walls', len(walls), 'labels', len(labels), 'icons', len(icons))
res = dict(place=place, source=CFG['source'], cut=CFG.get('cut'), floors=floors_out)
os.makedirs(os.path.dirname(out_path), exist_ok=True)
json.dump(res, open(out_path, 'w'), ensure_ascii=False, separators=(',', ':'))
print('->', out_path, round(os.path.getsize(out_path) / 1e6, 2), 'MB')
