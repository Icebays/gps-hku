"""Photo-textured roads and bridges for the satellite base map, at the survey's own sharpness.

    python3 tools/build_roads_photo.py work/7C work/7D out/roads-photo-raw.glb
    node tools/optimize_roads_photo.mjs out/roads-photo-raw.glb assets/model/roads-photo.glb

The surveyed road photos come as 4096 px textures of which only about a third is used. Shrinking whole
textures to fit a phone makes the lane lines vanish, so instead only the used parts are kept: each texture
is cut into horizontal bands, every band into runs of used blocks (the triangles are split along the cuts),
and the runs are packed into a few 2048 px atlas pages with real neighbouring pixels as padding. One
texel density (px per metre, capped at the source's own) is chosen so that everything fits the page budget.
Small textures that repeat (UVs outside 0..1) are kept as they are, with repeat wrapping.
Meshes: roads_<page>, bridges_<page>, roads_rep<k>, bridges_rep<k> (geometry in the model frame).
Needs: numpy, pillow
"""
import glob, io, json, math, os, struct, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import hkgltf
Image.MAX_IMAGE_PIXELS = None

PAGE, PAD, B = 2048, int(os.environ.get("PAD", 4)), int(os.environ.get("BLOCK", 64))   # atlas page, padding (dest px), block (source px)
BUDGET = float(os.environ.get('PAGES', '14')) * PAGE * PAGE * 0.92
tiles, out = sys.argv[1:-1], sys.argv[-1]

def gather(sub):
    """-> {image path: [(positions (n,3,3), pixel uvs (n,3,2))]}, untextured triangles, image sizes"""
    by, plain = {}, []
    for f in sorted(g for t in tiles for g in glob.glob(f'{t}/{glob.escape(sub)}/*/*.gltf')):
        if os.path.getsize(f) < 10:
            continue
        d, prims = hkgltf.read(f, uv=True)
        for p in prims:
            T = p['P'][p['I']]
            tex = d['materials'][p['material']].get('pbrMetallicRoughness', {}).get('baseColorTexture') if p['material'] is not None else None
            if tex is None or 'UV' not in p:
                plain.append(T); continue
            img = os.path.join(os.path.dirname(f), d['images'][d['textures'][tex['index']]['source']]['uri'])
            by.setdefault(img, []).append((T, p['UV'][p['I']]))
    return by, plain

def clip(poly, axis, lo, hi):
    """Sutherland-Hodgman against lo <= v[axis] <= hi; vertices are rows (u, v, x, y, z)."""
    for keep, c in ((lambda q: q[axis] >= lo, lo), (lambda q: q[axis] <= hi, hi)):
        res = []
        for i in range(len(poly)):
            a, b = poly[i - 1], poly[i]
            ia, ib = keep(a), keep(b)
            if ia != ib:
                t = (c - a[axis]) / (b[axis] - a[axis]); res.append(a + (b - a) * t)
            if ib:
                res.append(b)
        poly = res
        if len(poly) < 3:
            return []
    return poly

def area(T):
    return np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1) / 2

def uvarea(U):
    a, b = U[:, 1] - U[:, 0], U[:, 2] - U[:, 0]
    return np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]) / 2

layers = {}
for name, sub in (('roads', 'INFRASTRUCTURE(TB)'), ('bridges', 'INFRASTRUCTURE')):
    by, plain = gather(sub)
    layers[name] = dict(plain=plain, atlas={}, rep={})
    for img, parts in by.items():
        W, H = Image.open(img).size
        T = np.concatenate([p[0] for p in parts]); U = np.concatenate([p[1] for p in parts]) * [W, H]
        wraps = (U.min() < -0.02 * max(W, H)) or (U[..., 0].max() > W * 1.02) or (U[..., 1].max() > H * 1.02)
        if wraps or max(W, H) <= 512:
            layers[name]['rep'][img] = (T, U / [W, H]); continue
        U = np.clip(U, 0, [W, H])
        # split along the band lines (most triangles lie inside one band)
        k0, k1 = np.floor(U[..., 1].min(1) / B).astype(int), np.floor(np.nextafter(U[..., 1].max(1), -1) / B).astype(int)
        V5 = np.concatenate([U, T], 2)                       # (n, 3, 5): u, v, x, y, z
        pieces = [(k, V5[i]) for i, k in zip(np.nonzero(k0 == k1)[0], k0[k0 == k1])]
        for i in np.nonzero(k0 != k1)[0]:
            for k in range(k0[i], k1[i] + 1):
                pg = clip(list(V5[i]), 1, k * B, (k + 1) * B)
                if pg:
                    pieces.append((k, np.array(pg)))
        cols = {}
        for k, pg in pieces:
            c0, c1 = int(pg[:, 0].min() // B), int(min(np.nextafter(pg[:, 0].max(), -1), W - 1) // B)
            cols.setdefault(k, set()).update(range(max(c0, 0), c1 + 1))
        dens = math.sqrt(uvarea(U).sum() / max(area(T).sum(), 1e-6))
        layers[name]['atlas'][img] = dict(W=W, H=H, pieces=pieces, cols=cols, dens=dens)
        print(name, os.path.basename(img), W, H, 'density %.1f px/m' % dens, 'blocks', sum(len(c) for c in cols.values()), 'of', math.ceil(W / B) * math.ceil(H / B))

def runs_of(e, s):
    """horizontal runs of used blocks per band, short enough for a page at scale s"""
    maxc = max(1, int((PAGE - 2 * PAD) / (B * s)))
    out = []
    for k, cs in e['cols'].items():
        cs = sorted(cs); start = prev = cs[0]
        for c in cs[1:]:
            if c == prev + 1 and c - start < maxc:
                prev = c
            else:
                out.append((k, start, prev)); start = prev = c
        out.append((k, start, prev))
    return out

def scale(e, D):
    return min(1.0, D / e['dens'])

def need(D):
    tot = 0
    for L in layers.values():
        for e in L['atlas'].values():
            s = scale(e, D)
            for k, c0, c1 in runs_of(e, s):
                tot += (math.ceil(min((c1 + 1) * B, e['W']) * s) - math.floor(c0 * B * s) + 2 * PAD) * (math.ceil(min((k + 1) * B, e['H']) * s) - math.floor(k * B * s) + 2 * PAD)
    return tot

lo, hi = 1.0, 200.0
for _ in range(30):
    mid = (lo + hi) / 2
    lo, hi = (mid, hi) if need(mid) <= BUDGET else (lo, mid)
D = lo
print('texel density %.1f px/m (%.1f cm/px), atlas area %.1f MP' % (D, 100 / D, need(D) / 1e6))

# ---------- pack ----------
rects = []   # (h, w, layer, img, k, c0, c1)
for name, L in layers.items():
    for img, e in L['atlas'].items():
        s = scale(e, D); e['s'] = s
        for k, c0, c1 in runs_of(e, s):
            x0, x1 = math.floor(c0 * B * s), math.ceil(min((c1 + 1) * B, e['W']) * s)
            y0, y1 = math.floor(k * B * s), math.ceil(min((k + 1) * B, e['H']) * s)
            rects.append(dict(w=x1 - x0 + 2 * PAD, h=y1 - y0 + 2 * PAD, x0=x0, y0=y0, layer=name, img=img, k=k, c0=c0, c1=c1))
rects.sort(key=lambda r: (-r['h'], -r['w']))
pages, sh = [], None
for r in rects:
    if sh is None or sh['x'] + r['w'] > PAGE:
        if sh is not None and sh['y'] + sh['h'] + r['h'] <= PAGE:
            sh = dict(p=sh['p'], y=sh['y'] + sh['h'], x=0, h=r['h'])
        else:
            pages.append(None); sh = dict(p=len(pages) - 1, y=0, x=0, h=r['h'])
    r['page'], r['px'], r['py'] = sh['p'], sh['x'], sh['y']
    sh['x'] += r['w']; sh['h'] = max(sh['h'], r['h'])
used_h = [max(r['py'] + r['h'] for r in rects if r['page'] == p) for p in range(len(pages))]
pages = [Image.new('RGB', (PAGE, PAGE if h > PAGE // 2 else PAGE // 2), (120, 120, 120)) for h in used_h]
print('pages', [p.size for p in pages])
for img in {r['img'] for r in rects}:
    e = next(L['atlas'][img] for L in layers.values() if img in L['atlas'])
    src = Image.open(img).convert('RGB')
    sw, shh = max(1, round(e['W'] * e['s'])), max(1, round(e['H'] * e['s']))
    a = np.asarray(src.resize((sw, shh), Image.LANCZOS) if e['s'] < 1 else src)
    a = np.pad(a, ((PAD + 2, PAD + 2), (PAD + 2, PAD + 2), (0, 0)), mode='edge')
    e['sx'], e['sy'] = sw / e['W'], shh / e['H']     # actual scale after rounding
    for r in rects:
        if r['img'] != img:
            continue
        x0, y0 = r['x0'] - PAD + PAD + 2, r['y0'] - PAD + PAD + 2
        part = a[y0:y0 + r['h'], x0:x0 + r['w']]
        pages[r['page']].paste(Image.fromarray(part), (r['px'], r['py']))

# ---------- remap the pieces into their runs (split where a run was cut short) ----------
geo = {}   # (layer, page) -> list of (n,3,5) triangles with atlas uv
for name, L in layers.items():
    for img, e in L['atlas'].items():
        mine = {}
        for r in rects:
            if r['img'] == img:
                mine.setdefault(r['k'], []).append(r)
        for k, pg in e['pieces']:
            todo = [pg]
            while todo:
                q = todo.pop()
                c = int(q[:, 0].min() // B)
                r = next((r for r in mine[k] if r['c0'] <= c <= r['c1']), None)
                if r is None:
                    continue
                xe = (r['c1'] + 1) * B
                if q[:, 0].max() > xe + 1e-6:
                    a_ = clip(list(q), 0, -1e9, xe); b_ = clip(list(q), 0, xe, 1e9)
                    todo += [np.array(t) for t in (a_, b_) if t]; continue
                u = (q[:, 0] * e['sx'] - r['x0'] + PAD + r['px']) / PAGE
                ph = pages[r['page']].size[1]
                v = (q[:, 1] * e['sy'] - r['y0'] + PAD + r['py']) / ph
                fan = np.array([[0, i, i + 1] for i in range(1, len(q) - 1)])
                tri = np.concatenate([q[:, 2:5], np.c_[u, v]], 1)[fan]
                geo.setdefault((name, r['page']), []).append(tri)

# ---------- GLB ----------
chunks, views, accs, meshes, nodes, mats, images, textures = [], [], [], [], [], [], [], []
def add_bytes(data, target=None):
    off = sum(len(c) for c in chunks); chunks.append(data + b'\0' * ((-len(data)) % 4))
    v = dict(buffer=0, byteOffset=off, byteLength=len(data))
    if target: v['target'] = target
    views.append(v); return len(views) - 1
def add_acc(a, typ, ctype, target, mm=False):
    a = np.ascontiguousarray(a); d = dict(bufferView=add_bytes(a.tobytes(), target), componentType=ctype, count=len(a), type=typ)
    if mm: d['min'] = a.min(0).tolist(); d['max'] = a.max(0).tolist()
    accs.append(d); return len(accs) - 1
def add_image(im, sampler):
    bio = io.BytesIO(); im.save(bio, 'JPEG', quality=93)
    images.append(dict(bufferView=add_bytes(bio.getvalue()), mimeType='image/jpeg')); textures.append(dict(source=len(images) - 1, sampler=sampler))
    mats.append(dict(pbrMetallicRoughness=dict(baseColorTexture=dict(index=len(textures) - 1), metallicFactor=0, roughnessFactor=1)))
    return len(mats) - 1
def add_mesh(name, P, UV, mat):
    attrs = dict(POSITION=add_acc(P.astype(np.float32), 'VEC3', 5126, 34962, True))
    if UV is not None: attrs['TEXCOORD_0'] = add_acc(UV.astype(np.float32), 'VEC2', 5126, 34962)
    I = np.arange(len(P), dtype=np.uint32)
    prim = dict(attributes=attrs, indices=add_acc(I, 'SCALAR', 5125, 34963))
    if mat is not None: prim['material'] = mat
    meshes.append(dict(name=name, primitives=[prim])); nodes.append(dict(name=name, mesh=len(meshes) - 1))
page_mat = [add_image(p, 0) for p in pages]
ntri = 0
for (name, p), tris in sorted(geo.items()):
    A = np.concatenate(tris); ntri += len(A)
    add_mesh(f'{name}_{p}', A[..., :3].reshape(-1, 3), A[..., 3:].reshape(-1, 2), page_mat[p])
for name, L in layers.items():
    for i, (img, (T, UV)) in enumerate(sorted(L['rep'].items())):
        im = Image.open(img).convert('RGB'); im.thumbnail((512, 512), Image.LANCZOS)
        add_mesh(f'{name}_rep{i}', T.reshape(-1, 3), UV.reshape(-1, 2), add_image(im, 1)); ntri += len(T)
    if L['plain']:
        T = np.concatenate(L['plain']); ntri += len(T)
        mats.append(dict(pbrMetallicRoughness=dict(baseColorFactor=[0.6, 0.6, 0.6, 1], metallicFactor=0, roughnessFactor=1)))
        add_mesh(f'{name}_plain', T.reshape(-1, 3), None, len(mats) - 1)
g = dict(asset=dict(version='2.0', copyright='3D Spatial Data © Lands Department, HKSAR Government'), scene=0, scenes=[dict(nodes=list(range(len(nodes))))],
         nodes=nodes, meshes=meshes, materials=mats, images=images, textures=textures, accessors=accs, bufferViews=views,
         samplers=[dict(magFilter=9729, minFilter=9987, wrapS=33071, wrapT=33071), dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)],
         buffers=[dict(byteLength=sum(len(c) for c in chunks))])
js = json.dumps(g, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4); bb = b''.join(chunks)
os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
with open(out, 'wb') as fo:
    fo.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bb)))
    fo.write(struct.pack('<II', len(js), 0x4E4F534A)); fo.write(js)
    fo.write(struct.pack('<II', len(bb), 0x004E4942)); fo.write(bb)
print(ntri, 'triangles ->', out, round(os.path.getsize(out) / 1e6, 1), 'MB')
