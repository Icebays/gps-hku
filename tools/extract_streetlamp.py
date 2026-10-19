"""Cut one street lamp (pole + arm + lantern) out of the Hill Road flyover model
into assets/model/streetlamp.json, used as the template for lamps along roads.

    python3 tools/extract_streetlamp.py work/7C/INFRASTRUCTURE/I320111610707063C0/I320111610707063C0.gltf
"""
import json, numpy as np, sys
import sys
f=sys.argv[1].rsplit('.',1)[0]  # e.g. work/7C/INFRASTRUCTURE/I320111610707063C0/I320111610707063C0.gltf (Hill Road flyover)
g=json.load(open(f+'.gltf')); buf=open(f+'.bin','rb').read()
def acc(i, comps):
    a=g['accessors'][i]; bv=g['bufferViews'][a['bufferView']]
    dt={5126:np.float32,5123:np.uint16,5125:np.uint32}[a['componentType']]
    return np.frombuffer(buf,dt,count=a['count']*comps,offset=bv['byteOffset']+a.get('byteOffset',0)).reshape(-1,comps) if comps>1 else np.frombuffer(buf,dt,count=a['count'],offset=bv['byteOffset'])
P=acc(0,3).astype(float); N=acc(1,3); C=acc(2,3); I=acc(3,1)
print(len(P), len(I), 'colors', np.unique(np.round(C,2),axis=0)[:10])
# weld by position, union-find over triangles
key=np.round(P*200).astype(np.int64); _,wid=np.unique(key,axis=0,return_inverse=True); wid=wid.ravel()
par=np.arange(wid.max()+1)
def find(x):
    while par[x]!=x: par[x]=par[par[x]]; x=par[x]
    return x
T=I.reshape(-1,3)
for a,b,c in wid[T]:
    ra,rb,rc=find(a),find(b),find(c); par[rb]=ra; par[find(rc)]=ra
root=np.array([find(x) for x in range(len(par))])
comp=root[wid]
out=[]
for r in np.unique(comp):
    m=comp==r; Q=P[m]; lo,hi=Q.min(0),Q.max(0); ext=hi-lo
    out.append((r,m.sum(),ext,lo,hi))
# local coords: x, y (horizontal), z up
cands=[o for o in out if o[2][2]>6 and max(o[2][0],o[2][1])<5]
print('components',len(out),'lamp-like',len(cands))
for o in cands[:12]: print(o[1], np.round(o[2],2), np.round(o[3],1))

# pick one pole and gather nearby small parts (arm, lantern)
poles=[o for o in cands if o[1]==210]
r0,_,ext,lo,hi=poles[0]; cx,cy=(lo[:2]+hi[:2])/2
parts=[]
for o in out:
    olo,ohi=o[3],o[4]; oc=(olo[:2]+ohi[:2])/2
    if np.hypot(*(oc-[cx,cy]))<4 and olo[2]>lo[2]-0.5 and ohi[2]<hi[2]+2 and max(o[2][:2])<5:
        parts.append(o); print('part',o[1],np.round(o[2],2),np.round(olo,2))
m=np.isin(comp,[p[0] for p in parts])
idx=np.nonzero(m)[0]
Q=P[idx]-[cx,cy,lo[2]]
# triangles fully inside
tri=T[m[T].all(1)]
remap=-np.ones(len(P),int); remap[idx]=np.arange(len(idx))
tri=remap[tri]
# convert local (x east, y north, z up) -> model (x, y up, z = -north)
V=np.stack([Q[:,0],Q[:,2],-Q[:,1]],1)
json.dump({'positions':np.round(V,3).ravel().tolist(),'indices':tri.ravel().tolist()},open('assets/model/streetlamp.json','w'),separators=(',',':'))
print('lamp verts',len(V),'tris',len(tri),'bbox',np.round(V.min(0),2),np.round(V.max(0),2))
