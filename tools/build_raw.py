"""Merge 3dmap.gov.hk tiles into one raw GLB (meters, local origin) + buildings.json."""
import json, glob, struct, sys, io
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

SRC = sys.argv[1]           # work dir with tile folders
OUT = sys.argv[2]           # output dir
TILES = sys.argv[3].split(',')
ORIGIN = np.array([832250.0, 0.0, -815900.0])  # HK1980 E, height, -N
TEX_W = 4096

def load(f):
    raw = open(f, 'rb').read()
    if not raw.strip(b'\x00').strip():
        return None
    d = json.loads(raw.decode('utf-8-sig'))
    b = open(f.rsplit('/', 1)[0] + '/' + d['buffers'][0]['uri'], 'rb').read()
    def acc(i):
        a = d['accessors'][i]; bv = d['bufferViews'][a['bufferView']]
        dt = {5126: np.float32, 5121: np.uint8, 5123: np.uint16, 5125: np.uint32}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
        return np.frombuffer(b, dtype=dt, count=a['count'] * n,
                             offset=bv['byteOffset'] + a.get('byteOffset', 0)).reshape(-1, n) if n > 1 else \
               np.frombuffer(b, dtype=dt, count=a['count'], offset=bv['byteOffset'] + a.get('byteOffset', 0))
    node = d['nodes'][0]
    M = np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
    prim = d['meshes'][0]['primitives'][0]
    P = acc(prim['attributes']['POSITION']).astype(np.float64)
    P = (np.c_[P, np.ones(len(P))] @ M.T)[:, :3] - ORIGIN
    R = M[:3, :3]; R = R / np.linalg.norm(R[:, 0])
    N = acc(prim['attributes']['NORMAL']).astype(np.float64) @ R.T
    out = dict(name=node['name'], P=P.astype(np.float32), N=N.astype(np.float32),
               I=acc(prim['indices']).astype(np.uint32), dir=f.rsplit('/', 1)[0], d=d)
    if 'TEXCOORD_0' in prim['attributes']:
        out['UV'] = acc(prim['attributes']['TEXCOORD_0']).astype(np.float32)
    return out

def merge(items, with_id):
    Ps, Ns, Is, IDs, meta = [], [], [], [], []
    off = 0
    for k, it in enumerate(items):
        Ps.append(it['P']); Ns.append(it['N']); Is.append(it['I'] + off)
        if with_id: IDs.append(np.full(len(it['P']), k, np.uint16))
        off += len(it['P'])
        p = it['P'].astype(np.float64)
        meta.append(dict(id=it['name'], i=k,
                         e=round(float(p[:, 0].mean() + ORIGIN[0]), 1),
                         n=round(float(-(p[:, 2].mean() + ORIGIN[2])), 1),
                         base=round(float(p[:, 1].min()), 1), top=round(float(p[:, 1].max()), 1),
                         x=round(float(p[:, 0].mean()), 1), z=round(float(p[:, 2].mean()), 1)))
    return (np.concatenate(Ps), np.concatenate(Ns), np.concatenate(Is),
            np.concatenate(IDs) if with_id else None, meta)

# ---- gather
buildings, infra, terrain = [], [], []
skipped = []
for t in TILES:
    for f in sorted(glob.glob(f'{SRC}/{t}/BUILDING/*/*.gltf')):
        r = load(f); (buildings.append(r) if r else skipped.append(f))
    for f in sorted(glob.glob(f'{SRC}/{t}/INFRASTRUCTURE/*/*.gltf')):
        r = load(f); (infra.append(r) if r else skipped.append(f))
    for f in sorted(glob.glob(f'{SRC}/{t}/TERRAIN(TB)/*/*.gltf')):
        terrain.append(load(f))
print('buildings', len(buildings), 'infra', len(infra), 'terrain', len(terrain), 'skipped', skipped)

# ---- GLB writer
bin_chunks = []; bufferViews = []; accessors = []
def add_bytes(data, target=None):
    off = sum(len(c) for c in bin_chunks)
    pad = (-len(data)) % 4
    bin_chunks.append(data + b'\x00' * pad)
    bv = dict(buffer=0, byteOffset=off, byteLength=len(data))
    if target: bv['target'] = target
    bufferViews.append(bv); return len(bufferViews) - 1
def add_acc(arr, typ, ctype, target, minmax=False):
    bv = add_bytes(np.ascontiguousarray(arr).tobytes(), target)
    a = dict(bufferView=bv, componentType=ctype, count=len(arr), type=typ)
    if minmax:
        a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accessors.append(a); return len(accessors) - 1

meshes, nodes, materials, images, textures = [], [], [], [], []
materials.append(dict(name='building', pbrMetallicRoughness=dict(baseColorFactor=[0.92, 0.91, 0.88, 1], metallicFactor=0, roughnessFactor=0.9)))
materials.append(dict(name='infra', pbrMetallicRoughness=dict(baseColorFactor=[0.75, 0.74, 0.72, 1], metallicFactor=0, roughnessFactor=0.9)))

def add_mesh(name, P, N, I, mat, extra=None, uv=None):
    attrs = dict(POSITION=add_acc(P, 'VEC3', 5126, 34962, True), NORMAL=add_acc(N, 'VEC3', 5126, 34962))
    if uv is not None: attrs['TEXCOORD_0'] = add_acc(uv, 'VEC2', 5126, 34962)
    if extra is not None: attrs['_BID'] = add_acc(extra, 'SCALAR', 5123, 34962)
    ind = add_acc(I, 'SCALAR', 5125, 34963)
    meshes.append(dict(name=name, primitives=[dict(attributes=attrs, indices=ind, material=mat)]))
    nodes.append(dict(name=name, mesh=len(meshes) - 1))

P, N, I, BID, bmeta = merge(buildings, True)
add_mesh('buildings', P, N, I, 0, extra=BID)
P, N, I, _, _ = merge(infra, False)
add_mesh('infrastructure', P, N, I, 1)

for t in terrain:
    img = Image.open(t['dir'] + '/' + t['d']['images'][0]['uri']).convert('RGB')
    h = round(img.height * TEX_W / img.width)
    img = img.resize((TEX_W, h), Image.LANCZOS)
    bio = io.BytesIO(); img.save(bio, 'JPEG', quality=90)
    bv = add_bytes(bio.getvalue())
    images.append(dict(bufferView=bv, mimeType='image/jpeg'))
    textures.append(dict(source=len(images) - 1, sampler=0))
    materials.append(dict(name='terrain_' + t['name'], pbrMetallicRoughness=dict(
        baseColorTexture=dict(index=len(textures) - 1), metallicFactor=0, roughnessFactor=1)))
    add_mesh('terrain_' + t['name'], t['P'], t['N'], t['I'], len(materials) - 1, uv=t['UV'])

gltf = dict(asset=dict(version='2.0', generator='gps-hku build_raw',
                       copyright='3D Spatial Data © Lands Department, HKSAR Government'),
            scene=0, scenes=[dict(nodes=list(range(len(nodes))))], nodes=nodes, meshes=meshes,
            materials=materials, accessors=accessors, bufferViews=bufferViews,
            buffers=[dict(byteLength=sum(len(c) for c in bin_chunks))],
            images=images, textures=textures,
            samplers=[dict(magFilter=9729, minFilter=9987, wrapS=33071, wrapT=33071)],
            extras=dict(origin_hk1980=dict(E=ORIGIN[0], N=-ORIGIN[2])))
js = json.dumps(gltf, separators=(',', ':')).encode()
js += b' ' * ((-len(js)) % 4)
binb = b''.join(bin_chunks)
with open(f'{OUT}/raw.glb', 'wb') as fo:
    fo.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)))
    fo.write(struct.pack('<II', len(js), 0x4E4F534A)); fo.write(js)
    fo.write(struct.pack('<II', len(binb), 0x004E4942)); fo.write(binb)
json.dump(bmeta, open(f'{OUT}/buildings.json', 'w'), separators=(',', ':'))
print('done', len(binb) / 1e6, 'MB')
