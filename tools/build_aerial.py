"""Mosaic the original 3dmap.gov.hk terrain textures (orthophotos) into one image
in the model frame, used to fit roads to the real road surface.

    python3 tools/build_aerial.py work/7C work/7D out/aerial.jpg

Writes out/aerial.jpg plus out/aerial.json with its extent and resolution.
"""
import glob, json, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
RES = 0.2
X0, X1, Z0, Z1 = -650, 350, -400, 160
out = Image.new('RGB', (int((X1 - X0) / RES), int((Z1 - Z0) / RES)))
for d in sys.argv[1:-1]:
    gltf = glob.glob(f'{d}/TERRAIN*/*/*.gltf')[0]
    g = json.load(open(gltf))
    m = g['nodes'][0]['matrix']; acc = g['accessors'][0]
    sx = abs(m[0]); cx, cn = m[12], -m[14]
    hw, hh = acc['max'][0] * sx, acc['max'][1] * sx      # half extents in metres
    tx0, tz0 = cx - hw - 832250, -(cn + hh - 815900)      # tile top-left in model frame
    im = Image.open(glob.glob(f'{d}/TERRAIN*/*/*.jpg')[0])
    ax0, ax1, az0, az1 = max(X0, tx0), min(X1, tx0 + 2 * hw), max(Z0, tz0), min(Z1, tz0 + 2 * hh)
    if ax1 <= ax0 or az1 <= az0:
        continue
    iw, ih = im.size
    box = (int((ax0 - tx0) / (2 * hw) * iw), int((az0 - tz0) / (2 * hh) * ih), int((ax1 - tx0) / (2 * hw) * iw), int((az1 - tz0) / (2 * hh) * ih))
    out.paste(im.crop(box).resize((int((ax1 - ax0) / RES), int((az1 - az0) / RES)), Image.LANCZOS), (int((ax0 - X0) / RES), int((az0 - Z0) / RES)))
out.save(sys.argv[-1], quality=90)
json.dump({'extent': [X0, X1, Z0, Z1], 'res': RES}, open(sys.argv[-1].rsplit('.', 1)[0] + '.json', 'w'))
