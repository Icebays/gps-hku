"""Photo-textured HKU buildings for the satellite / real-buildings base maps.

    python3 tools/build_satellite.py work/7C work/7D out/sat-raw.glb
    node tools/optimize_satellite.mjs out/sat-raw.glb assets/model/satellite.glb
    (another high-quality tile: tools/README.md, "Features of the other tiles")

Also writes the ids of the buildings it covers (out/sat-raw-ids.json): the map keeps every other HKU building white.

Takes the high-quality tiles (model/11-SW-7C.zip, 11-SW-7D.zip unzipped with BUILDING):
- HKU buildings only (the same rule as the map: inside a campus area of data/campus.json, or tagged
  in data/places.json, plus 'include', minus 'exclude'); every other building stays white on the map.
The building photos are cropped to the part actually used, scaled to a pixel budget and packed into a few
2048 px atlas pages (one draw call and a small, fixed GPU memory cost per page). Faces whose texture
repeats (UV span > 1) get the photo's average colour. Coordinates: x = E - 832250, y = mPD, z = -(N - 815900).
Needs: numpy, pillow
"""
import glob, io, json, os, struct, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import hkgltf
Image.MAX_IMAGE_PIXELS = None

PAGE, PAD = 2048, 2
tiles, out = sys.argv[1:-1], sys.argv[-1]

# ---------- which buildings are HKU (same rule as assets/map.js splitBuildings) ----------
B = json.load(open('assets/model/buildings.json'))
C = json.load(open('data/campus.json'))
P = json.load(open('data/places.json'))
def inside(x, z, poly):
    r = False
    for i in range(len(poly)):
        (x1, z1), (x2, z2) = poly[i], poly[i - 1]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            r = not r
    return r
codes = set(C.get('include', [])) | {c for p in P['places'] if p.get('hku', True) is not False for c in p['buildings']}
ex = set(C.get('exclude', []))
hku = {b[0][:-2] for b in B if b[0] in codes or (b[0] not in ex and any(inside(b[1], b[2], a['boundary']) for a in C['areas']))}

def gather(paths):
    """-> list of (triangles positions (n,3,3), triangle uvs (n,3,2), image path) per textured primitive."""
    items = []
    for f in paths:
        d, prims = hkgltf.read(f, uv=True)
        base = os.path.dirname(f)
        for p in prims:
            if 'UV' not in p or p['material'] is None:
                continue
            m = d['materials'][p['material']]
            tex = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
            if not tex:
                continue
            img = os.path.join(base, d['images'][d['textures'][tex['index']]['source']]['uri'])
            items.append((p['P'][p['I']], p['UV'][p['I']], img))
    return items

def pack(groups, budget_px):
    """groups: list of (items, weight). Returns pages (PIL images) and per-item (tri positions, atlas uvs, page)."""
    # per image: used crop (from non-wrapping triangles), mean colour
    imgs = {}
    for items, w in groups:
        for T, UV, img in items:
            shifted = UV - np.floor(UV.min(1))[:, None, :]
            ok = (shifted.max(1) <= 1.001).all(1)
            e = imgs.setdefault(img, {'lo': np.array([1.0, 1.0]), 'hi': np.array([0.0, 0.0]), 'w': 0.0, 'area': 0.0})
            if ok.any():
                e['lo'] = np.minimum(e['lo'], shifted[ok].reshape(-1, 2).min(0))
                e['hi'] = np.maximum(e['hi'], shifted[ok].reshape(-1, 2).max(0))
            e['w'] = max(e['w'], w)
    for img, e in imgs.items():
        im = Image.open(img); W, H = im.size
        e['size'] = (W, H)
        lo, hi = np.clip(e['lo'], 0, 1), np.clip(e['hi'], 0, 1)
        if (hi <= lo).any():
            lo, hi = np.zeros(2), np.full(2, 1 / max(W, H))
        e['crop'] = (int(lo[0] * W), int(lo[1] * H), max(int(np.ceil(hi[0] * W)), int(lo[0] * W) + 1), max(int(np.ceil(hi[1] * H)), int(lo[1] * H) + 1))
        cw, ch = e['crop'][2] - e['crop'][0], e['crop'][3] - e['crop'][1]
        e['area'] = cw * ch * e['w']
    total = sum(e['area'] for e in imgs.values())
    k = np.sqrt(budget_px / max(total, 1))
    # shelf packing, largest first
    pages, shelves = [], []
    order = sorted(imgs, key=lambda i: -(imgs[i]['crop'][3] - imgs[i]['crop'][1]))
    def new_page():
        pages.append(Image.new('RGB', (PAGE, PAGE), (200, 200, 200))); shelves.append([0, 0, 0])  # y, x, shelf h
    new_page()
    for img in order:
        e = imgs[img]; cx0, cy0, cx1, cy1 = e['crop']
        s = k * np.sqrt(e['w'])
        tw = int(np.clip(round((cx1 - cx0) * s), 8, PAGE - 2 * PAD - 8)); th = int(np.clip(round((cy1 - cy0) * s), 8, PAGE - 2 * PAD - 8))
        sh = shelves[-1]
        if sh[1] + tw + 2 * PAD + 8 > PAGE:
            sh[0] += sh[2]; sh[1] = 0; sh[2] = 0
        if sh[0] + th + 2 * PAD > PAGE:
            new_page(); sh = shelves[-1]
        x, y = sh[1] + PAD, sh[0] + PAD
        src = Image.open(img).convert('RGB')
        part = src.crop(e['crop']).resize((tw, th), Image.LANCZOS)
        pg = pages[-1]
        # padding by edge extension so mipmaps do not bleed
        pg.paste(part.resize((tw + 2 * PAD, th + 2 * PAD), Image.NEAREST), (x - PAD, y - PAD)); pg.paste(part, (x, y))
        mean = tuple(int(c) for c in np.asarray(src.resize((16, 16))).reshape(-1, 3).mean(0))
        pg.paste(Image.new('RGB', (8, 8), mean), (x + tw + PAD, y))           # average-colour patch
        e['place'] = (len(pages) - 1, x, y, tw, th)
        e['mean_uv'] = ((x + tw + PAD + 4) / PAGE, (y + 4) / PAGE)
        sh[1] += tw + 2 * PAD + 8 + PAD; sh[2] = max(sh[2], th + 2 * PAD)
    # remap triangles
    out_items = []
    for items, _ in groups:
        res = []
        for T, UV, img in items:
            e = imgs[img]; pg, x, y, tw, th = e['place']; W, H = e['size']; cx0, cy0, cx1, cy1 = e['crop']
            shifted = UV - np.floor(UV.min(1))[:, None, :]
            ok = (shifted.max(1) <= 1.001).all(1)
            px = (np.clip(shifted[..., 0] * W, cx0, cx1) - cx0) / max(cx1 - cx0, 1) * tw + x
            py = (np.clip(shifted[..., 1] * H, cy0, cy1) - cy0) / max(cy1 - cy0, 1) * th + y
            nuv = np.stack([px / PAGE, py / PAGE], -1)
            nuv[~ok] = e['mean_uv']
            res.append((T, nuv, pg))
        out_items.append(res)
    return pages, out_items

bdirs = [d for t in tiles for d in glob.glob(f'{t}/BUILDING/*') if os.path.basename(d)[:-2] in hku]
bitems = gather([os.path.join(d, os.path.basename(d) + '.gltf') for d in bdirs])
print('HKU buildings', len(bdirs), 'textured prims', len(bitems))
found = {os.path.basename(d)[:-2] for d in bdirs}
json.dump(sorted(b[0] for b in B if b[0][:-2] in found), open(os.path.splitext(out)[0] + '-ids.json', 'w'))
if not bitems:
    sys.exit(0)
bpages, (bres,) = pack([(bitems, 1.0)], 2 * len(tiles) * PAGE * PAGE * 0.8)   # 2 atlas pages a tile


# ---------- GLB writer ----------
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
def add_page(pg):
    bio = io.BytesIO(); pg.save(bio, 'JPEG', quality=92)
    images.append(dict(bufferView=add_bytes(bio.getvalue()), mimeType='image/jpeg')); textures.append(dict(source=len(images) - 1, sampler=0))
    mats.append(dict(pbrMetallicRoughness=dict(baseColorTexture=dict(index=len(textures) - 1), metallicFactor=0, roughnessFactor=1)))
    return len(mats) - 1
def emit(name, res, pages):
    mids = [add_page(p) for p in pages]
    for k in range(len(pages)):
        sel = [(T, U) for T, U, pg in res if pg == k]
        if not sel:
            continue
        Pn = np.concatenate([T.reshape(-1, 3) for T, _ in sel]).astype(np.float32)
        Un = np.concatenate([U.reshape(-1, 2) for _, U in sel]).astype(np.float32)
        I = np.arange(len(Pn), dtype=np.uint32)
        meshes.append(dict(name=f'{name}_{k}', primitives=[dict(attributes=dict(POSITION=add_acc(Pn, 'VEC3', 5126, 34962, True), TEXCOORD_0=add_acc(Un, 'VEC2', 5126, 34962)),
                                                              indices=add_acc(I, 'SCALAR', 5125, 34963), material=mids[k])]))
        nodes.append(dict(name=f'{name}_{k}', mesh=len(meshes) - 1))
emit('hku_buildings', bres, bpages)

g = dict(asset=dict(version='2.0', copyright='3D Spatial Data © Lands Department, HKSAR Government'), scene=0, scenes=[dict(nodes=list(range(len(nodes))))],
         nodes=nodes, meshes=meshes, materials=mats, images=images, textures=textures, accessors=accs, bufferViews=views,
         samplers=[dict(magFilter=9729, minFilter=9987, wrapS=33071, wrapT=33071)], buffers=[dict(byteLength=sum(len(c) for c in chunks))])
js = json.dumps(g, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4); bb = b''.join(chunks)
os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
with open(out, 'wb') as fo:
    fo.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bb)))
    fo.write(struct.pack('<II', len(js), 0x4E4F534A)); fo.write(js)
    fo.write(struct.pack('<II', len(bb), 0x004E4942)); fo.write(bb)
print('pages: buildings', len(bpages), '->', out, round(os.path.getsize(out) / 1e6, 1), 'MB')
