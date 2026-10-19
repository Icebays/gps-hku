# Rebuilding the 3D model

`assets/model/hku.glb` is generated from the original 3dmap.gov.hk tiles in `model/`.

```bash
# 1. unzip each tile into its own folder, e.g. work/7C, work/7D
mkdir -p work/7C work/7D
unzip model/11-SW-7C.1.zip -d work/7C
unzip model/11-SW-7D.1.zip -d work/7D

# 2. merge tiles -> raw.glb + buildings.json  (needs: pip install numpy pillow)
python3 tools/build_raw.py work out 7C,7D

# 3. weld, simplify terrain, WebP textures, meshopt compression
#    (needs: npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp)
node tools/optimize.mjs out/raw.glb assets/model/hku.glb 0.4 4096 80

# 4. convert buildings.json to the compact form used by the site
python3 -c "import json;B=json.load(open('out/buildings.json'));json.dump([[b['id'],b['x'],b['z'],b['base'],b['top']] for b in B],open('assets/model/buildings.json','w'),separators=(',',':'))"
```

Model frame: `x = Easting − 832250`, `z = −(Northing − 815900)` (HK1980 Grid), `y = height in mPD`.
If you add tiles, building index numbers change but building IDs (`B3…`) stay the same, so `data/places.json` keeps working.
