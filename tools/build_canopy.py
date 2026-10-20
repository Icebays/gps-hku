"""3D tree canopy for the satellite base map, from the surveyed VEGETATION(TB) layer.

    python3 tools/build_canopy.py work/7C work/7D lod_work/7C lod_work/7D out/canopy-raw.glb
    node tools/optimize_canopy.mjs out/canopy-raw.glb assets/model/satellite-trees.glb

The surveyed vegetation is a canopy surface draped over the hills. It is resampled as a 1.5 m height
field (canopy top where there is vegetation, sloping down to the ground at its edges) and given the
same UV mapping as the terrain tile it lies on (fitted from the LOD terrain used for hku.glb: lod_work),
so at runtime it reuses the terrain's aerial photo - the trees stand up in 3D wearing their own photo,
with no extra textures to download. One mesh per terrain tile, named canopy_<terrain id>.
Needs: numpy, opencv-python-headless
"""
import glob, json, os, struct, sys
import numpy as np
import cv2
sys.path.insert(0, os.path.dirname(__file__))
import hkgltf

hq, lod, out = sys.argv[1:3], sys.argv[3:5], sys.argv[5]
R = 1.5
X0, X1, Z0, Z1 = -752, 752, -302, 302
W, H = int((X1 - X0) / R), int((Z1 - Z0) / R)

def splat(prims, grid, cnt=None):
    for p in prims:
        P = p['P']; u = ((P[:, 0] - X0) / R).astype(int); v = ((P[:, 2] - Z0) / R).astype(int)
        ok = (u >= 0) & (u < W) & (v >= 0) & (v < H)
        np.maximum.at(grid, (v[ok], u[ok]), P[ok, 1])
        if cnt is not None:
            np.add.at(cnt, (v[ok], u[ok]), 1)

ground = np.full((H, W), -1e9); veg = np.full((H, W), -1e9); cnt = np.zeros((H, W), int)
for t in hq:
    for f in glob.glob(f'{t}/TERRAIN*/*/*.gltf'):
        splat(hkgltf.read(f)[1], ground)
    for f in glob.glob(f'{t}/VEGETATION*/*/*.gltf'):
        splat(hkgltf.read(f)[1], veg, cnt)
known = ground > -1e8
g = np.where(known, ground, 0).astype(np.float32)
for k in (3, 7, 15, 31):
    num = cv2.blur(g * known, (k, k)); den = cv2.blur(known.astype(np.float32), (k, k))
    fill = (~known) & (den > 0); g[fill] = num[fill] / den[fill]; known |= fill
ground = g
vm = (cnt > 0) & (veg - ground > 1.0)
vm = cv2.morphologyEx(vm.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)) > 0
top = np.where(vm, veg, ground).astype(np.float32)
top = np.where(vm, cv2.GaussianBlur(top, (0, 0), 0.8), ground)        # soften spikes in the canopy

# vertex heights on the cell corners: canopy where any touching cell is vegetated, else ground (+ lift)
pad = lambda a, v: np.pad(a, 1, constant_values=v)
tp, vp = pad(top, -1e9), pad(vm, False)
corner_v = np.zeros((H + 1, W + 1), bool); corner_h = np.full((H + 1, W + 1), -1e9, np.float32)
for dv in (0, 1):
    for du in (0, 1):
        c = vp[dv:dv + H + 1, du:du + W + 1]; h = tp[dv:dv + H + 1, du:du + W + 1]
        corner_v |= c; corner_h = np.where(c, np.maximum(corner_h, h), corner_h)
gc = cv2.resize(ground, (W + 1, H + 1), interpolation=cv2.INTER_LINEAR)
corner_h = np.where(corner_v, corner_h, gc) + 0.25
# quads: vegetated cells plus a one-cell ring that slopes back to the ground
ring = cv2.dilate(vm.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0

# terrain tiles: extent + UV fit (u = a*x + b, v = c*z + d) from the LOD terrain
tiles = []
for t in lod:
    for f in glob.glob(f'{t}/TERRAIN*/*/*.gltf'):
        d, prims = hkgltf.read(f, uv=True)
        P = np.concatenate([p['P'] for p in prims]); UV = np.concatenate([p['UV'] for p in prims])
        au = np.polyfit(P[:, 0], UV[:, 0], 1); av = np.polyfit(P[:, 2], UV[:, 1], 1)
        res = np.abs(np.polyval(au, P[:, 0]) - UV[:, 0]).max(), np.abs(np.polyval(av, P[:, 2]) - UV[:, 1]).max()
        name = d['nodes'][0]['name']
        tiles.append(dict(name=name, x0=P[:, 0].min(), x1=P[:, 0].max(), au=au, av=av))
        print(name, 'uv fit residual', np.round(res, 5))

chunks, views, accs, meshes, nodes = [], [], [], [], []
def add(a, typ, ctype, target, mm=False):
    a = np.ascontiguousarray(a); off = sum(len(c) for c in chunks); chunks.append(a.tobytes() + b'\0' * ((-a.nbytes) % 4))
    views.append(dict(buffer=0, byteOffset=off, byteLength=a.nbytes, target=target))
    d = dict(bufferView=len(views) - 1, componentType=ctype, count=len(a), type=typ)
    if mm: d['min'] = a.min(0).tolist(); d['max'] = a.max(0).tolist()
    accs.append(d); return len(accs) - 1
vid = -np.ones((H + 1, W + 1), np.int64)
for tl in tiles:
    cx = X0 + (np.arange(W) + 0.5) * R
    cells = ring & ((cx >= tl['x0']) & (cx < tl['x1']))[None, :]
    vs, us = np.nonzero(cells)
    used = np.zeros((H + 1, W + 1), bool)
    for dv in (0, 1):
        for du in (0, 1):
            used[vs + dv, us + du] = True
    cv, cu = np.nonzero(used)
    vid[:] = -1; vid[cv, cu] = np.arange(len(cv))
    xs, zs = X0 + cu * R, Z0 + cv * R
    pos = np.stack([xs, corner_h[cv, cu], zs], 1).astype(np.float32)
    uv = np.stack([np.polyval(tl['au'], xs), np.polyval(tl['av'], zs)], 1).astype(np.float32)
    a, b, c, d_ = vid[vs, us], vid[vs, us + 1], vid[vs + 1, us], vid[vs + 1, us + 1]
    idx = np.stack([a, c, b, b, c, d_], 1).reshape(-1).astype(np.uint32)   # CCW seen from above (y up, z south)
    meshes.append(dict(name='canopy_' + tl['name'], primitives=[dict(attributes=dict(POSITION=add(pos, 'VEC3', 5126, 34962, True), TEXCOORD_0=add(uv, 'VEC2', 5126, 34962)),
                                                                   indices=add(idx, 'SCALAR', 5125, 34963))]))
    nodes.append(dict(name='canopy_' + tl['name'], mesh=len(meshes) - 1))
    print(tl['name'], len(pos), 'vertices', len(idx) // 3, 'triangles')
gl = dict(asset=dict(version='2.0', copyright='3D Spatial Data © Lands Department, HKSAR Government'), scene=0, scenes=[dict(nodes=list(range(len(nodes))))],
          nodes=nodes, meshes=meshes, accessors=accs, bufferViews=views, buffers=[dict(byteLength=sum(len(c) for c in chunks))])
js = json.dumps(gl, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4); bb = b''.join(chunks)
with open(out, 'wb') as fo:
    fo.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bb)))
    fo.write(struct.pack('<II', len(js), 0x4E4F534A)); fo.write(js)
    fo.write(struct.pack('<II', len(bb), 0x004E4942)); fo.write(bb)
print('->', out, round(os.path.getsize(out) / 1e6, 1), 'MB')
