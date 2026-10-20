"""Minimal reader for 3dmap.gov.hk glTF tiles: vertices in the site's model frame
(x = E - 832250, y = mPD, z = -(N - 815900)), per primitive."""
import json
import numpy as np

ORIGIN = np.array([832250.0, 0.0, -815900.0])

def read(path, uv=False):
    d = json.load(open(path, encoding='utf-8-sig'))
    base = path.rsplit('/', 1)[0]
    bufs = [open(base + '/' + b['uri'], 'rb').read() for b in d['buffers']]
    def acc(i):
        a = d['accessors'][i]; bv = d['bufferViews'][a['bufferView']]
        dt = {5126: np.float32, 5121: np.uint8, 5123: np.uint16, 5125: np.uint32}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        arr = np.frombuffer(bufs[bv.get('buffer', 0)], dtype=dt, count=a['count'] * n, offset=bv.get('byteOffset', 0) + a.get('byteOffset', 0))
        return arr.reshape(-1, n) if n > 1 else arr
    out = []
    roots = d['scenes'][d.get('scene', 0)]['nodes'] if d.get('scenes') else range(len(d['nodes']))
    for node in (d['nodes'][i] for i in roots):   # children are reached through their root (with its matrix)
        M = np.array(node.get('matrix', np.eye(4).ravel().tolist()), float).reshape(4, 4).T
        mesh = node.get('mesh')
        kids = [d['nodes'][c] for c in node.get('children', [])]
        meshes = [mesh] if mesh is not None else [k['mesh'] for k in kids if 'mesh' in k]
        for m in meshes:
            for p in d['meshes'][m]['primitives']:
                P = acc(p['attributes']['POSITION']).astype(float)
                P = (np.c_[P, np.ones(len(P))] @ M.T)[:, :3] - ORIGIN
                I = acc(p['indices']).astype(np.int64) if 'indices' in p else np.arange(len(P))
                item = dict(P=P, I=I.reshape(-1, 3), material=p.get('material'))
                if uv and 'TEXCOORD_0' in p['attributes']:
                    item['UV'] = acc(p['attributes']['TEXCOORD_0']).astype(float)
                out.append(item)
    return d, out
