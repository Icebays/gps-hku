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

# Rebuilding the map features (roads, footpaths, gardens)

`data/mapfeatures.json` holds road centre lines (class + width), footpaths (split into indoor / outdoor
runs against the model's building footprints), and garden / woodland / water polygons, all in model
coordinates. The site draws them in its own style. They are vectorised from an OpenStreetMap screenshot
of the campus (standard OSM style):

```bash
# needs: pip install numpy pillow opencv-python-headless scikit-image
python3 tools/build_aerial.py work/7C work/7D out/aerial.jpg          # orthophoto mosaic from the original tiles
python3 tools/osm_flow.py                                              # local OSM -> model corrections (flow.json)
python3 tools/build_mapfeatures.py osm-screenshot.png "<s>,<theta>,<tx>,<tz>" footprints.png flow.json out/aerial.jpg
python3 tools/extract_streetlamp.py work/7C/INFRASTRUCTURE/I320111610707063C0/I320111610707063C0.gltf
```

Road centre lines are smoothed, snapped at junctions, then shifted onto the asphalt seen in the
orthophoto, whose measured width becomes the road width. The site (`assets/roads.js`) drapes roads,
pavements, kerbs, markings, zebra crossings, 慢駛 / 巴士站 words and footpaths on the terrain as 3D
geometry, and places street lamps copied from the Hill Road flyover model along them.

`<s>,<theta>,<tx>,<tz>` map a screenshot pixel (u, v) to the model: `x = s(cos t·u − sin t·v) + tx`, `z = s(sin t·u + cos t·v) + tz`.
Find them by matching the screenshot's building outlines against the model footprints. `footprints.png` is a
top-down render of the model's buildings (white on black) covering x −770…760, z −310…290.
Map data © OpenStreetMap contributors (ODbL).

Buildings missing from the 3D data are listed in `data/campus.json` → `extraBuildings` (footprint in model
coordinates + height) and are extruded at runtime; use their ids in `data/places.json`.

# Surveyed road, bridge and ground surfaces (high-quality tiles)

`model/11-SW-7C.zip` and `model/11-SW-7D.zip` (Git LFS) are the photo-textured release of the same tiles.
Their road surfaces (`INFRASTRUCTURE(TB)`), flyovers / footbridges (`INFRASTRUCTURE`), ground surfaces
(`GENERIC`) and water (`WATERBODY`) become `assets/model/roads.glb` and `assets/model/ground.glb`:

```bash
unzip model/11-SW-7C.zip -x 'BUILDING/*' 'VEGETATION*' -d work/7C
unzip model/11-SW-7D.zip -x 'BUILDING/*' 'VEGETATION*' -d work/7D
node tools/build_surfaces.mjs work/7C work/7D
```

The map shows the road and bridge photos (with their real markings); ground surfaces show as flat
paving / water in map mode and as photos with the aerial-photo layer on. When `roads.glb` loads, the
drawn roads from `data/mapfeatures.json` are replaced and only street lamps and icons are added.
