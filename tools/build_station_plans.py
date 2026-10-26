"""MTR station floor plans for the map's indoor view (assets/indoor.js), from the Lands Department's 3D indoor maps
(IMDF: level, unit, opening, amenity, section, occupant; GeoJSON or shapefiles, read by tools/imdf.py).

    python3 tools/build_station_plans.py "<IMDF folder>" <plan id> [<IMDF folder> <plan id> ...]
      -> data/indoor/<plan id>.json, and data/indoor/index.json: the station's places in data/places.json
         (its 'mtr-<plan id>' place and its exits, each opening at its own exit's street level)

Each IMDF level is a floor at its own height (mPD): the platform, the concourse, and each exit's levels (named by the
exit: 'A1-G' is exit A1's ground level). Drawn as the other plans are: the paid area and the kinds of units in
colour (platforms, escalators and stairs, shops, toilets, staff rooms), the tracks and lift shafts dark, walls round
the rooms and the floor's edge with the doors (openings) left open, steps across stairs and escalators, the
platforms' and shops' names (English and Chinese), and symbols for the exits, gates, lifts, escalators, toilets,
customer service and defibrillators.
Needs: shapely, pyproj, pyshp
"""
import json, os, re, sys
from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString, Point, box
from shapely.ops import unary_union
from shapely import affinity
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import imdf

OUT = 'data/indoor'
R = lambda v: round(v, 2)

def poly(g):
    """IMDF polygon geometry -> shapely (Multi)Polygon in x, z"""
    ps = [Polygon([(c[0], c[1]) for c in P[0]], [[(c[0], c[1]) for c in h] for h in P[1:]]).buffer(0) for P in g['c']]
    u = unary_union([p for p in ps if not p.is_empty])
    return u
def flat_polys(geom):
    """shapely -> [[outer, hole, ...], ...] flat [x0, z0, x1, z1, ...]"""
    out = []
    for p in (geom.geoms if hasattr(geom, 'geoms') else [geom]):
        if p.is_empty or p.geom_type != 'Polygon' or p.area < 0.05: continue
        rings = [p.exterior] + list(p.interiors)
        out.append([[R(v) for xy in list(r.coords)[:-1] for v in xy] for r in rings])
    return out
def flat_lines(geom):
    out = []
    for l in (geom.geoms if hasattr(geom, 'geoms') else [geom]):
        if l.is_empty or l.geom_type != 'LineString' or l.length < 0.15: continue
        out.append([R(v) for xy in l.coords for v in xy])
    return out
def hatch(p, step=0.55):
    """steps across a stair / escalator: lines across its long axis, every step metres"""
    r = p.minimum_rotated_rectangle
    if r.geom_type != 'Polygon': return []
    c = list(r.exterior.coords)
    e1 = (c[1][0] - c[0][0], c[1][1] - c[0][1]); e2 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    L1, L2 = (e1[0] ** 2 + e1[1] ** 2) ** .5, (e2[0] ** 2 + e2[1] ** 2) ** .5
    (a, la), (b, lb) = ((e1, L1), (e2, L2)) if L1 >= L2 else ((e2, L2), (e1, L1))   # a: long axis
    if la < 1: return []
    ux, uz = a[0] / la, a[1] / la; vx, vz = b[0] / lb, b[1] / lb
    o = (c[0][0], c[0][1]) if L1 >= L2 else (c[1][0], c[1][1])
    lines = []
    n = int(la / step)
    for k in range(1, n):
        t = k * la / n
        s = LineString([(o[0] + ux * t, o[1] + uz * t), (o[0] + ux * t + vx * lb, o[1] + uz * t + vz * lb)]).intersection(p)
        lines += flat_lines(s)
    return lines
def name(o):
    return o if o and (o.get('en') or o.get('zh')) else None
EXIT_RE = re.compile(r'^Exit (.+?) (Upper Ground|Ground|Basement|Level|Elevator|Mezzanine)')
def level_key(p):
    en = (p.get('name') or {}).get('en', '')
    m = EXIT_RE.match(en)
    exits = re.findall(r'[A-Z]\d?', m.group(1)) if m else []
    short = (p.get('short_name') or {}).get('en') or str(p.get('ordinal'))
    return exits, short

ICON = {'restroom.male': 'wc-m', 'restroom.female': 'wc-f', 'restroom.wheelchair': 'wc-a', 'elevator': 'lift', 'escalator': 'escalator',
        'faregate': 'gate', 'defibrillator': 'aed', 'entry': 'mtr-exit'}
GENERIC = {'corridor', 'walkway', 'lobby', 'passage', 'stair', 'step', 'escalator', 'elevator', 'ramp', 'cuc', 'platform', 'room', 'smoke lobby'}

def build(folder, plan_id):
    F = imdf.load(folder)
    units = {f['p']['id']: f for f in F['unit']}
    occ = {}
    for o in F.get('occupant', []):
        u = o['p'].get('unit_id') or (o.get('raw') or {}).get('UNITID')
        nm = name(o['p'].get('name'))
        if u and nm: occ.setdefault(u, []).append(nm)
    levels = {f['p']['id']: f for f in F['level']}
    # floors: one per level, levels of the same exit and height (a lift's own level beside its street) merged
    floors = {}
    for lid, f in levels.items():
        p = f['p']; exits, short = level_key(p)
        y = f['g']['c'][0][0][0][2]
        key = ('+'.join(exits) + '-' if exits else '') + short
        fl = floors.get(key)
        if fl and abs(fl['y'] - y) > 0.3: key += f'@{y:g}'; fl = None
        if not fl:
            nm = name(p.get('name')) or {'en': key}
            fl = floors[key] = {'id': key, 'tag': '+'.join(exits), 'short': short, 'name': {'en': nm.get('en', key), 'zh': nm.get('zh') or nm.get('en', key)},
                                'y': y, 'levels': [], 'exits': exits}
        fl['levels'].append(lid)
    by_level = {}
    for k, fl in floors.items():
        for lid in fl['levels']: by_level[lid] = fl
    out = []
    for fl in sorted(floors.values(), key=lambda f: f['y']):
        L = set(fl['levels'])
        slab = unary_union([poly(levels[l]['g']) for l in L])
        us = [u for u in F['unit'] if u['p'].get('level_id') in L and u['g']]
        cat = lambda u: u['p'].get('category') or 'unspecified'
        A = {k: [] for k in ('areaY', 'areaC', 'areaG', 'areaN', 'areaP', 'areaR')}
        voids, hatches, wall_src, labels, icons = [], [], [slab.boundary], [], []
        for s in F.get('section', []):
            if s['p'].get('level_id') in L and s['p'].get('category') == 'paidarea' and s['g']: A['areaY'].append(poly(s['g']).intersection(slab))
        for u in us:
            c, g = cat(u), poly(u['g'])
            nm = name(u['p'].get('name')) or {}; alt = name(u['p'].get('alt_name'))
            shop = occ.get(u['p']['id'])
            if c == 'platform': A['areaC'].append(g)
            elif c in ('escalator', 'stairs', 'steps', 'movingwalkway', 'ramp'):
                A['areaG'].append(g)
                if c != 'ramp': hatches += hatch(g, 0.4 if c == 'steps' else 0.55)
            elif c == 'elevator': voids.append(g); wall_src.append(g.boundary)
            elif c.startswith('restroom'): A['areaR'].append(g); wall_src.append(g.boundary)
            elif c == 'unspecified' and 'track' in nm.get('en', '').lower(): voids.append(g); wall_src.append(g.boundary)
            elif shop or c in ('foodservice', 'retail') or 'customer service' in nm.get('en', '').lower(): A['areaP'].append(g); wall_src.append(g.boundary)
            elif c in ('room', 'unspecified'): A['areaN'].append(g); wall_src.append(g.boundary)
            # names: the tracks by their platform, the shops by their occupants, other named rooms
            pt = g.representative_point()
            if alt and 'track' in nm.get('en', '').lower():
                labels.append({'t': alt['en'], 'zh': alt.get('zh') or alt['en'], 'x': R(pt.x), 'z': R(pt.y), 'h': 1.6, 'k': 'zone'})
            elif shop:
                labels.append({'t': ' / '.join(s['en'] for s in shop), 'zh': ' / '.join(s.get('zh') or s['en'] for s in shop), 'x': R(pt.x), 'z': R(pt.y), 'h': 0.9, 'k': 'room', 'r': 1})
            elif nm.get('en') and not c.startswith('restroom') and nm['en'].strip().lower() not in GENERIC and not re.match(r'^[LESC]\d', nm['en']) and not nm['en'].startswith('HKU '):
                labels.append({'t': nm['en'], 'zh': nm.get('zh') or nm['en'], 'x': R(pt.x), 'z': R(pt.y), 'h': 0.8, 'k': 'room', 'r': 1 if c in ('room', 'foodservice') else 0})
        # walls, with the doors left open
        ops = [o for o in F['opening'] if o['p'].get('level_id') in L and o['g']]
        door_lines = [LineString([(c[0], c[1]) for c in o['g']['c']]) for o in ops if o['g']['t'] == 'line' and len(o['g']['c']) > 1]
        walls = unary_union(wall_src)
        if door_lines: walls = walls.difference(unary_union([d.buffer(0.35, cap_style=2) for d in door_lines]))
        walls = walls.simplify(0.05)
        # symbols and the exits' names, on this floor's units (or within its outline)
        for a in F['amenity']:
            c = a['p'].get('category'); ic = ICON.get(c)
            if not a['g']: continue
            x, z, y = a['g']['c']
            on = any(units.get(uid, {}).get('p', {}).get('level_id') in L for uid in (a['p'].get('unit_ids') or []))
            if not on and not (y is not None and abs(y - fl['y']) < 0.5 and slab.buffer(1).contains(Point(x, z))): continue
            nm = name(a['p'].get('name')) or {}
            if c == 'entry':
                m = re.search(r'Exit ([A-Z]\d?)', nm.get('en', ''))
                icons.append(['mtr-exit', R(x), R(z)])
                if m: labels.append({'t': 'Exit ' + m.group(1), 'zh': m.group(1) + ' 出口', 'x': R(x), 'z': R(z + 1.6), 'h': 1.2, 'k': 'zone'})
            elif c == 'information':
                icons.append(['info', R(x), R(z)])
                if 'customer' in nm.get('en', '').lower(): labels.append({'t': nm['en'], 'zh': nm.get('zh') or '客務中心', 'x': R(x), 'z': R(z + 1.2), 'h': 0.9, 'k': 'room', 'r': 1})
            elif c == 'vendingmachine' and 'ticket' in nm.get('en', '').lower(): icons.append(['ticket', R(x), R(z)])
            elif ic: icons.append([ic, R(x), R(z)])
        floor = {'id': fl['id'], 'tag': fl['tag'], 'short': fl['short'], 'name': fl['name'], 'y': R(fl['y']), 'h': 4,
                 'slab': flat_polys(slab), 'holes': [], 'voids': flat_polys(unary_union(voids)) if voids else [],
                 'areas': {k: flat_polys(unary_union(v).intersection(slab)) for k, v in A.items() if v},
                 'solids': {}, 'tables': [], 'chairs': [], 'walls': flat_lines(walls if walls.geom_type != 'GeometryCollection' else unary_union([g for g in walls.geoms if 'Line' in g.geom_type])),
                 'screens': [], 'doors': [l for d in door_lines for l in flat_lines(d)], 'stairs': hatches, 'thin': [], 'ink': [], 'steps': [],
                 'labels': labels, 'icons': icons, 'exits': fl['exits']}
        floor['walls'] = [w for w in floor['walls'] if len(w) >= 4]
        out.append(floor)
    venue = F['venue'][0]['p'] if F.get('venue') else {}
    vn = name(venue.get('name')) or {'en': plan_id}
    plat = next((f for f in out if f['short'] == 'P'), out[0])
    px = [v for p in plat['slab'] for v in p[0]]
    centre = [R(sum(px[0::2]) / len(px[0::2])), R(sum(px[1::2]) / len(px[1::2]))]
    d = {'place': plan_id, 'name': vn, 'centre': centre,
         'source': {'en': 'Floor plans: Lands Department, HKSAR - 3D indoor map of the station (IMDF)', 'zh': '平面圖：地政總署車站三維室內地圖（IMDF）', 'url': 'https://www.landsd.gov.hk/'},
         'default': next((f['id'] for f in out if f['short'] == 'C'), out[0]['id']), 'floors': out}
    json.dump(d, open(os.path.join(OUT, plan_id + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(plan_id, vn.get('en'), len(out), 'floors:', ', '.join(f"{f['id']} {f['y']:g}" for f in out),
          '|', os.path.getsize(os.path.join(OUT, plan_id + '.json')) // 1000, 'kB')
    return d

if __name__ == '__main__':
    args = sys.argv[1:]
    index = json.load(open(os.path.join(OUT, 'index.json')))
    places = json.load(open('data/places.json'))['places']
    for folder, plan_id in zip(args[0::2], args[1::2]):
        d = build(folder, plan_id)
        # the station's own place, and each of its exits opening at its street level (that exit's Ground Level)
        index['mtr-' + plan_id] = plan_id + '.json'
        station = re.sub(r' Station$', '', d['name']['en'])
        for p in places:
            if p.get('icon') != 'mtr' or station.lower() not in p['name']['en'].lower(): continue
            for code in p.get('exit', []):
                fs = [f for f in d['floors'] if code in f['exits']]
                if not fs: continue
                g = next((f for f in fs if re.search(r'(?<!Upper )Ground Level', f['name']['en'])), None) or next((f for f in fs if 'Ground' in f['name']['en']), None) \
                    or min(fs, key=lambda f: abs(f['y'] - 10))
                index[p['id']] = {'file': plan_id + '.json', 'floor': g['id']}
                break
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)
