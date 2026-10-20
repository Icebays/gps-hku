"""Indoor floor plans from SCANNED plan PDFs (the plans are pictures, not vector drawings) -> data/indoor/<place>.json,
the same format tools/build_indoor.py writes, so the map draws them the same way.

    python3 tools/build_indoor_raster.py tools/indoor/centennial-podium.json <plans.pdf> data/indoor/centennial-podium.json

tools/indoor/<place>.json lists each floor: its page in the PDF, its level (mPD) and the page's registration to the
model frame (x = a*u - b*v + tx, z = b*u + a*v + tz; u, v = pixels of the page rendered at `dpi`), plus `clip`: the
building's footprint from the surveyed model (the plans also draw roads and gardens round it).

Each page is rendered and read as ink:
- text (the PDF's own text layer: room numbers in red, titles and lists in black) is taken out first; red room
  numbers become the room labels, with their capacity from the page's list ("2.14 (50)");
- all the ink is traced into lines drawn on the floor (`ink`: walls, desks, seats, stairs, fittings), darker than
  the vector plans' minor lines since here they carry the whole plan;
- walls stand only where the plan is sure of them, round the numbered rooms (at this resolution other walls can't be
  told from rows of desks and seats); solid squares of about 1 m are columns;
- the floor is the drawing's closed outline inside the footprint, or the whole footprint for a floor that fills it
  (`"slab": "clip"`), with the atria (`holes` in the config) cut out;
- a room with a red number is the space round it, closed off by the thick strokes (door openings bridged), shaded as
  a classroom (innovative classrooms in their own colour); of the ways to close it off (thick strokes or all the ink,
  doors bridged by 0.6-2 m) the one whose area best fits the room's seats (about 1.9 m2 a seat) and is most nearly a
  rectangle is taken, and a room none of them fits is left as its label only, unless the config traces it by hand
  (`rooms`: name -> outline in rendered page pixels; e.g. LG.07-LG.10, one hall split by movable partitions).
Needs: pymupdf, opencv-python, numpy, scikit-image, shapely.
"""
import json, math, re, sys
import numpy as np, cv2, pymupdf
from skimage.morphology import skeletonize
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union

cfg_path, pdf_path, out_path = sys.argv[1:4]
CFG = json.load(open(cfg_path))
DPI = CFG.get('dpi', 216)
doc = pymupdf.open(pdf_path)
def r2(v): return round(float(v), 2)
def flat(P): return [r2(v) for xy in P for v in xy]

ROOM = re.compile(r'^(LG\.\d+|G\.\d+|\d\.\d+)$')
CAP = re.compile(r'(LG\.\d+|G\.\d+|\d\.\d+)\s*\((\d+)\)')

def page_text(page):
    """-> words [(text, colour, rect in rendered px)], capacities {room: seats}, innovative room set"""
    M = page.rotation_matrix * (DPI / 72)
    words, caps, innov = [], {}, set()
    raw = page.get_text('rawdict')
    lines = []
    for b in raw['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                chars = s['chars']; txt = ''.join(c['c'] for c in chars)
                lines.append((txt, s['color']))
                # split the span into words with their own boxes (one span can hold several room numbers)
                cur = []
                for c in chars + [None]:
                    if c is None or c['c'].isspace():
                        if cur:
                            r = pymupdf.Rect(cur[0]['bbox']) | pymupdf.Rect(cur[-1]['bbox'])
                            words.append((''.join(x['c'] for x in cur), s['color'], r * M)); cur = []
                    else: cur.append(c)
    flag = False
    for txt, col in lines:
        if 'nnovative' in txt: flag = True
        if txt.startswith('CPD-') or txt.startswith('Total'): flag = flag and not txt.startswith('Total')
        for room, n in CAP.findall(txt):
            caps[room] = int(n)
            if flag: innov.add(room)
    return words, caps, innov

def trace(skel):
    """skeleton pixels -> polylines (lists of (x, y)) between end points and junctions"""
    ys, xs = np.nonzero(skel); on = set(zip(xs.tolist(), ys.tolist()))
    nb = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]
    def ns(p): return [(p[0] + dx, p[1] + dy) for dx, dy in nb if (p[0] + dx, p[1] + dy) in on]
    deg = {p: len(ns(p)) for p in on}
    seen, out = set(), []
    def walk(a, b):
        line = [a, b]; seen.add((a, b)); seen.add((b, a)); prev, cur = a, b
        while deg[cur] == 2:
            nxt = [q for q in ns(cur) if q != prev]
            if not nxt or (cur, nxt[0]) in seen: break
            seen.add((cur, nxt[0])); seen.add((nxt[0], cur)); prev, cur = cur, nxt[0]; line.append(cur)
        return line
    for p in on:
        if deg[p] != 2:
            for q in ns(p):
                if (p, q) not in seen: out.append(walk(p, q))
    for p in on:      # loops with no ends
        for q in ns(p):
            if (p, q) not in seen: out.append(walk(p, q))
    return out

def simplify(line, eps):
    P = np.array(line, np.float32).reshape(-1, 1, 2)
    return cv2.approxPolyDP(P, eps, False)[:, 0, :]

clip = Polygon(CFG['clip']).buffer(2.0)
floors_out = []
for fl in CFG['floors']:
    page = doc[fl['page']]
    pix = page.get_pixmap(dpi=DPI)
    im = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
    a, b, tx, tz = fl['M']; s = math.hypot(a, b)                       # metres per pixel
    def xf(P): P = np.asarray(P, float).reshape(-1, 2); return np.c_[a * P[:, 0] - b * P[:, 1] + tx, b * P[:, 0] + a * P[:, 1] + tz]
    def px(m): return max(1, int(round(m / s)))
    r_, g_, b_ = im[:, :, 0], im[:, :, 1], im[:, :, 2]
    red = (r_ > 150) & (g_ < 120) & (b_ < 120)
    dark = (im.mean(2) < 160) & ~red
    words, caps, innov = page_text(page)
    for t, col, r in words:      # text is not ink of the drawing
        x0, y0, x1, y1 = (int(v) for v in (r.x0 - 2, r.y0 - 2, r.x1 + 2, r.y1 + 2))
        dark[max(y0, 0):y1, max(x0, 0):x1] = False
    n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(dark.astype(np.uint8), np.ones((25, 25), np.uint8)))
    dark &= lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    H, W = dark.shape
    # --- floor: the drawing's closed outline, inside the building's footprint ---
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px(1.6), px(1.6)))
    shut = cv2.morphologyEx(dark.astype(np.uint8), cv2.MORPH_CLOSE, k)
    ff = shut.copy(); mask = np.zeros((H + 2, W + 2), np.uint8); cv2.floodFill(ff, mask, (0, 0), 1)
    solid = (shut | (ff == 0)).astype(np.uint8)
    cs, _ = cv2.findContours(solid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    slab = unary_union([Polygon(xf(c[:, 0, :])).buffer(0) for c in cs if cv2.contourArea(c) * s * s > 30]).intersection(clip)
    slab = slab.simplify(0.15)
    if fl.get('slab') == 'clip':       # floors that fill the whole footprint (open streets and gardens leave the drawn outline open)
        slab = Polygon(CFG['clip'])
    # --- atria (from the config: the model's sections) ---
    holes = [np.array(Q, float) for Q in fl.get('holes', [])]
    if holes:
        slab = slab.difference(unary_union([Polygon(Q).buffer(0) for Q in holes]))
    # --- thick strokes (walls, columns, and furniture packed close) ---
    dk = dark.astype(np.uint8)
    dist = cv2.distanceTransform(dk, cv2.DIST_L2, 3)
    thick = cv2.dilate((dist >= 1.5).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (4, 4))) & dk
    n, lab, st, _ = cv2.connectedComponentsWithStats(thick)
    columns = []
    for c in range(1, n):
        w, h, A = st[c, 2] * s, st[c, 3] * s, st[c, 4]
        fill = A / max(st[c, 2] * st[c, 3], 1)
        if 0.7 <= min(w, h) and max(w, h) <= 1.3 and fill > 0.75 and max(w, h) / max(min(w, h), 1e-6) < 1.3:
            ys, xs = np.nonzero(lab == c); P = xf(np.c_[xs, ys]); x0, z0 = P.min(0); x1, z1 = P.max(0)
            columns.append([(x0, z0), (x1, z0), (x1, z1), (x0, z1)])
    # --- rooms with red numbers: the space round the number, closed off by the thick strokes (thin furniture and
    # seating lines inside a room don't cut it up); door openings are bridged by growing the strokes, the least
    # that closes the room ---
    labels, areas, rooms = [], {'areaY': [], 'areaC': []}, []
    # candidates: walls as the thick strokes, or as all the ink, grown by 0.6-2 m to bridge doors; the one whose area
    # best fits the room's seats (about 1.9 m2 a seat) and is most nearly a rectangle wins
    bars = {}
    for nm, base in (('thick', thick), ('ink', dk)):
        for m_ in (0.6, 0.9, 1.2, 1.6, 2.0):
            bars[(nm, m_)] = cv2.dilate(base, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px(m_), px(m_))))
    for t, col, r in words:
        if col != 0xff0000: continue
        if not (ROOM.match(t) or t == 'Grand'): continue
        name = 'Grand Hall' if t == 'Grand' else t
        seats = caps.get(name)
        want = 1200 if name == 'Grand Hall' else max(15.0, 1.9 * seats) if seats else 60.0
        cx, cy = int((r.x0 + r.x1) / 2), int((r.y0 + r.y1) / 2)
        best = None
        traced = fl.get('rooms', {}).get(name)
        for (nm, m_), seal in ([] if traced else bars.items()):
            R_ = px(1.5); win = seal[max(cy - R_, 0):cy + R_, max(cx - R_, 0):cx + R_]
            free = np.argwhere(win == 0)
            if not len(free): continue
            fy, fx = free[np.argmin(((free - [min(cy, R_), min(cx, R_)]) ** 2).sum(1))]
            ff = seal.copy(); mask = np.zeros((H + 2, W + 2), np.uint8)
            cv2.floodFill(ff, mask, (int(max(cx - R_, 0) + fx), int(max(cy - R_, 0) + fy)), 2)
            reg = (ff == 2).astype(np.uint8)
            if reg[0].any() or reg[-1].any() or reg[:, 0].any() or reg[:, -1].any(): continue
            reg = cv2.dilate(reg, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px(m_), px(m_))))
            reg = cv2.morphologyEx(reg, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px(1.5), px(1.5))))
            cs, _ = cv2.findContours(reg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            c = max(cs, key=cv2.contourArea); A = cv2.contourArea(c) * s * s
            if A < 8: continue
            (_, (rw, rh), _) = cv2.minAreaRect(c); rect = cv2.contourArea(c) / max(rw * rh, 1)
            score = abs(math.log(A / want)) + 2.0 * (1 - rect)
            if abs(math.log(A / want)) < math.log(2.8) and rect > 0.6 and (best is None or score < best[0]):
                best = (score, c)
        poly = xf(traced) if traced else xf(cv2.approxPolyDP(best[1], px(0.4), True)[:, 0, :]) if best else None
        (x, z), = xf([((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)])
        if poly is not None and len(poly) >= 3:
            areas['areaC' if name in innov else 'areaY'].append(poly); rooms.append(Polygon(poly).buffer(0))
            x, z = poly.mean(0)
        labels.append(dict(t=name + (f'\n{seats} seats' if seats else ''), x=r2(x), z=r2(z), h=0.9, k='room'))
    # --- walls: only where the plan is sure of them, the classrooms' outlines (at this scan's resolution the other
    # walls can't be told from rows of desks and seats, so they stay lines on the floor) ---
    walls = []
    for R_ in rooms:
        for g in getattr(R_, 'geoms', [R_]):
            P = np.array(g.exterior.simplify(0.3).coords); walls += [P[k:k + 2] for k in range(len(P) - 1)]
    # --- all the ink, as lines on the floor ---
    thin = []
    for line in trace(skeletonize(dark)):
        if len(line) * s < 0.35: continue
        P = simplify(line, 1.0)
        if len(P) >= 2: thin.append(xf(P))
    slab_polys = [g for g in getattr(slab, 'geoms', [slab]) if g.area > 20]
    out = dict(id=fl['id'], name=fl['name'], y=fl['y'], h=fl.get('h', 4.5), sources=[CFG['source_file']], updated=CFG.get('updated'),
               slab=[[flat(np.array(g.exterior.coords)[:-1])] + [flat(np.array(i.coords)[:-1]) for i in g.interiors] for g in slab_polys],
               holes=[flat(Q) for Q in holes], voids=[],
               areas={k: [flat(P) for P in v] for k, v in areas.items() if v},
               solids={'column': [flat(P) for P in columns]} if columns else {},
               tables=[], chairs=[], walls=[flat(P) for P in walls], screens=[], doors=[], stairs=[],
               thin=[], ink=[flat(P) for P in thin], steps=[], labels=labels, icons=[])
    floors_out.append(out)
    print(fl['id'], 'slab', round(sum(g.area for g in slab_polys)), 'm2 holes', len(holes), 'walls', len(walls), 'thin', len(thin),
          'columns', len(columns), 'rooms', sum(len(v) for v in areas.values()), '/', len(labels))
res = dict(place=CFG['place'], source=CFG['source'], default=CFG.get('default'), floors=floors_out)
json.dump(res, open(out_path, 'w'), ensure_ascii=False, separators=(',', ':'))
import os; print('->', out_path, round(os.path.getsize(out_path) / 1e6, 2), 'MB')
