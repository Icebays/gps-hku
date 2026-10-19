# local displacement field: OSM building mask (warped by global fit) vs model roof mask
import numpy as np, cv2, json, sys
from PIL import Image
sys.path.insert(0,'tools'); from osmwarp import warp
osm=np.asarray(Image.open('/root/.claude/uploads/05b9cc2f-2da8-552b-84c1-a95e3c9dd88f/1f576fda-image.png').convert('RGB')).astype(int)
EXT=(-770,760,-310,290); W,H=3060,1200; K=W/(EXT[1]-EXT[0])  # 2 px/m
w,ok=warp(osm.astype(np.uint8),W,H,EXT); w=w.astype(int)
ob=((np.abs(w-[217,208,201]).max(2)<=8)|(np.abs(w-[196,182,171]).max(2)<=8)).astype(np.float32)
mb=(np.asarray(Image.open('bmask.png').convert('L'))>128).astype(np.float32)
ob=cv2.GaussianBlur(ob,(0,0),2); mb=cv2.GaussianBlur(mb,(0,0),2)
win=int(90*K); step=int(30*K); R=int(14*K)
pts=[]
for cy in range(win//2, H-win//2, step):
    for cx in range(win//2, W-win//2, step):
        a=ob[cy-win//2:cy+win//2, cx-win//2:cx+win//2]
        if a.mean()<0.05 or not ok[cy,cx]: continue
        b=mb[cy-win//2-R:cy+win//2+R, cx-win//2-R:cx+win//2+R]
        if b.shape!=(win+2*R,win+2*R): continue
        res=cv2.matchTemplate(b,a,cv2.TM_CCOEFF_NORMED)
        _,mx,_,loc=cv2.minMaxLoc(res)
        if mx<0.45: continue
        dx,dy=(loc[0]-R)/K,(loc[1]-R)/K
        x=EXT[0]+cx/K; z=EXT[2]+cy/K
        pts.append([x,z,dx,dy,mx])
P=np.array(pts); print(len(P)); 
# robust: median filter displacement over neighbours within 70 m
out=[]
for p in P:
    d=np.hypot(P[:,0]-p[0],P[:,1]-p[1]); nb=P[d<70]
    out.append([p[0],p[1],float(np.median(nb[:,2])),float(np.median(nb[:,3]))])
json.dump(out,open('tools/flow.json','w'))
for o in out[::6]: print(np.round(o,1))
