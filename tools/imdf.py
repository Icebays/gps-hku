"""IMDF indoor maps (the Lands Department 3D indoor maps: GeoJSON in WGS84, or shapefiles in HK1980 Grid) -> features in
the model frame (x = E - 832250, z = -(N - 815900), y = mPD). Used by tools/build_station_plans.py. Needs: pyproj, pyshp."""
import json, os, glob
from pyproj import Transformer
_w2g = Transformer.from_crs(4326, 2326, always_xy=True)
FIELDS = {  # shapefile column -> IMDF property
    'ID': 'id', 'CATEGORY': 'category', 'RES': 'restriction', 'ORDINAL': 'ordinal', 'LEVELID': 'level_id', 'UNITIDS': 'unit_ids',
    'UNITID': 'unit_id', 'ACC': 'accessibility', 'TYPE': 'door_type', 'OUTDOOR': 'outdoor', 'ANCHORID': 'anchor_id', 'BUIIDS': 'building_ids'}
def _xz(E, N): return (round(E - 832250, 3), round(-(N - 815900), 3))
def load(folder):
    gj = glob.glob(os.path.join(folder, '*.geojson'))
    out = {}
    if gj:
        for f in gj:
            n = os.path.basename(f)[:-8]; feats = []
            for ft in json.load(open(f))['features']:
                p = dict(ft['properties']); p['id'] = ft.get('id') or p.get('id')
                feats.append({'p': p, 'g': _geom(ft['geometry'], wgs=True)})
            out[n] = feats
        return out
    import shapefile
    for f in glob.glob(os.path.join(folder, '*.dbf')):
        n = os.path.basename(f)[:-4]; base = f[:-4]
        has_shp = os.path.exists(base + '.shp')
        r = shapefile.Reader(dbf=open(f, 'rb'), shp=open(base + '.shp', 'rb') if has_shp else None, shx=open(base + '.shx', 'rb') if has_shp and os.path.exists(base + '.shx') else None, encoding='utf-8')
        feats = []
        for i in range(len(r)):
            rec = r.record(i).as_dict(); p = {}
            for k, v in rec.items():
                if k in FIELDS: p[FIELDS[k]] = v
            nm = {'en': rec.get('ENGNAME') or rec.get('ENGDISFLNM') or rec.get('ENGNM') or '', 'zh': rec.get('CHINAME') or rec.get('CHIDISFLNM') or rec.get('CHINM') or ''}
            p['name'] = nm if (nm['en'] or nm['zh']) else None
            alt = {'en': rec.get('ENGALTNM') or '', 'zh': rec.get('CHIALTNM') or ''}
            p['alt_name'] = alt if (alt['en'] or alt['zh']) else None
            if rec.get('ENGSHONM'): p['short_name'] = {'en': rec['ENGSHONM']}
            if 'unit_ids' in p and isinstance(p['unit_ids'], str): p['unit_ids'] = [u for u in p['unit_ids'].split(',') if u]
            if 'building_ids' in p and isinstance(p['building_ids'], str): p['building_ids'] = [u for u in p['building_ids'].split(',') if u]
            if p.get('accessibility') == '': p['accessibility'] = None
            g = None
            if has_shp:
                s = r.shape(i); g = _shp(s)
            feats.append({'p': p, 'g': g, 'raw': rec})
        out[n] = feats
    return out
def _pt(c, wgs):
    if wgs: E, N = _w2g.transform(c[0], c[1])
    else: E, N = c[0], c[1]
    x, z = _xz(E, N); return [x, z, round(c[2], 3) if len(c) > 2 else None]
def _geom(g, wgs):
    if not g: return None
    t, C = g['type'], g['coordinates']
    if t == 'Point': return {'t': 'point', 'c': _pt(C, wgs)}
    if t == 'LineString': return {'t': 'line', 'c': [_pt(c, wgs) for c in C]}
    if t == 'MultiLineString': return {'t': 'lines', 'c': [[_pt(c, wgs) for c in l] for l in C]}
    if t == 'Polygon': return {'t': 'poly', 'c': [[[_pt(c, wgs) for c in r] for r in C]]}
    if t == 'MultiPolygon': return {'t': 'poly', 'c': [[[_pt(c, wgs) for c in r] for r in P] for P in C]}
    raise ValueError(t)
def _shp(s):
    pts = s.points; z = list(getattr(s, 'z', []) or [None] * len(pts))
    P = [[*_xz(*pts[i]), round(z[i], 3) if z[i] is not None else None] for i in range(len(pts))]
    parts = list(s.parts) + [len(pts)]
    rings = [P[parts[k]:parts[k + 1]] for k in range(len(parts) - 1)]
    if s.shapeType in (1, 11, 21): return {'t': 'point', 'c': P[0]}
    if s.shapeType in (3, 13, 23): return {'t': 'line', 'c': rings[0]} if len(rings) == 1 else {'t': 'lines', 'c': rings}
    # polygons: outer rings clockwise in shapefiles; group holes (counter-clockwise) with the outer before them
    def area(r): return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2
    polys = []
    for r in rings:
        # model z = -N flips orientation: shapefile outer (clockwise in E,N) is counter-clockwise in x,z -> area > 0
        if area(r) > 0 or not polys: polys.append([r])
        else: polys[-1].append(r)
    return {'t': 'poly', 'c': polys}
