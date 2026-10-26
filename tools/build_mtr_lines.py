"""MTR lines on the map: their tracks from OpenStreetMap (the route relations' ways, in tunnel here), in the model
frame, clipped to the map's tiles, at the depth of the tracks: rail level (1 m below the platforms of the stations'
plans, data/indoor/*-station.json), straight between the stations.

    python3 tools/build_mtr_lines.py      -> data/mtr-lines.json
      { source, lines: [{ id, name: {en, zh}, colour, tracks: [[x0, z0, y0, x1, z1, y1, ...]] }] }

Data © OpenStreetMap contributors (ODbL). Needs: pyproj, shapely
"""
import glob, json, urllib.request
import xml.etree.ElementTree as ET
from pyproj import Transformer
from shapely.geometry import LineString, box

LINES = [  # (id, OSM route relations - one per direction, colour)
    ('island', [4432665, 4432666], '#007dc5'),
]
EXTENT = box(-2250, -1500, 750, 3900)   # the tiles (data/tiles.json)
UA = {'User-Agent': 'gps-hku-map/1.0 (https://github.com/Icebays/gps-hku)'}
to_grid = Transformer.from_crs(4326, 2326, always_xy=True)

def relation(rid):
    with urllib.request.urlopen(urllib.request.Request(f'https://api.openstreetmap.org/api/0.6/relation/{rid}/full', headers=UA), timeout=60) as r:
        return ET.fromstring(r.read())

# rail level by x along the line (it runs west - east here), from the stations' platforms
RAIL = []
for f in glob.glob('data/indoor/*-station.json'):
    d = json.load(open(f))
    plat = [fl for fl in d['floors'] if fl.get('short') == 'P']
    if plat: RAIL.append((d['centre'][0], min(fl['y'] for fl in plat) - 1.0))
RAIL.sort()
def rail(x):
    if not RAIL: return -15.0
    if x <= RAIL[0][0]: return RAIL[0][1]
    for (x0, y0), (x1, y1) in zip(RAIL, RAIL[1:]):
        if x <= x1: return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return RAIL[-1][1]

out = []
for lid, rels, colour in LINES:
    tracks, seen, name = [], set(), None
    for rid in rels:
        R = relation(rid)
        nodes = {n.get('id'): (float(n.get('lon')), float(n.get('lat'))) for n in R.iter('node')}
        ways = {w.get('id'): w for w in R.iter('way')}
        rel = next(x for x in R.iter('relation') if x.get('id') == str(rid))
        t = {x.get('k'): x.get('v') for x in rel.iter('tag')}
        name = name or {'en': t.get('name:en') or t.get('name'), 'zh': t.get('name:zh') or t.get('name')}
        for m in rel.iter('member'):
            if m.get('type') != 'way' or m.get('role') or m.get('ref') in seen: continue   # tracks only (not platforms)
            seen.add(m.get('ref')); w = ways[m.get('ref')]
            pts = []
            for nd in w.iter('nd'):
                E, N = to_grid.transform(*nodes[nd.get('ref')])
                pts.append((E - 832250, -(N - 815900)))
            clip = LineString(pts).intersection(EXTENT)
            for part in getattr(clip, 'geoms', [clip]):
                if part.is_empty or part.length < 5: continue
                tracks.append([round(v, 1) for x, z in part.simplify(0.5).coords for v in (x, z, rail(x))])
    out.append({'id': lid, 'name': name, 'colour': colour, 'tracks': tracks})
    print(lid, name, len(tracks), 'tracks', round(sum(LineString(list(zip(t[0::3], t[1::3]))).length for t in tracks)), 'm', 'rail', RAIL)
json.dump({'source': 'Map data © OpenStreetMap contributors (ODbL)', 'lines': out}, open('data/mtr-lines.json', 'w'), ensure_ascii=False, separators=(',', ':'))
