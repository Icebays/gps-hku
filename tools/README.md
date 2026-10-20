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

# Surveyed roads, road markings, land cover and trees (high-quality tiles)

`model/11-SW-7C.zip` and `model/11-SW-7D.zip` (Git LFS) are the high-quality release of the same tiles.

```bash
unzip model/11-SW-7C.zip -x 'BUILDING/*' -d work/7C
unzip model/11-SW-7D.zip -x 'BUILDING/*' -d work/7D
node tools/build_surfaces.mjs work/7C work/7D          # assets/model/roads.glb: road surfaces + bridges, geometry only
python3 tools/build_landcover.py work/7C work/7D       # data/landcover.json: vegetation + water polygons, trees
# top-down renders of the road surfaces / bridges with their photos, 100 m tiles at 0.1 m/px
# (magenta background), into road_tiles/ and bridge_tiles/ - then:
python3 tools/build_roadnet.py road_tiles/ bridge_tiles/   # data/roadnet.json: centre lines, widths, lanes
```

The surveyed road mesh is the grey road on the map. `assets/roads.js` paints the markings onto it from
`data/roadnet.json`: lane lines from the measured width (about 3.4 m per lane), HK double white centre
lines, double yellow kerb lines on main roads, edge lines, parking bays where there is spare width,
zebra crossings with 望右 LOOK RIGHT, 慢駛 before crossings on campus roads, bus bays with 巴士站
(crossings and bus stops from OpenStreetMap, snapped onto the surveyed roads), and street lamps.
Trees are instanced from `data/landcover.json` (canopy tops: position, height, crown radius).

# Map extent and adding tiles

`data/tiles.json` lists the loaded tiles and their extent in model coordinates. The map fades into the
background over `fade` metres at the outer edge of the union of these extents (shared edges between
adjacent tiles never fade). To add a tile (e.g. the northern neighbours 11-SW-5C / 5D): include it when
building `hku.glb` (`build_raw.py ... 7C,7D,5C`), rebuild the road / land-cover data with its folder,
and add `{ "id": "11-SW-5C", "extent": [x0, x1, z0, z1] }` to `data/tiles.json`.
Tile extent = the TERRAIN(TB) node position ± its half size: x = E − 832250, z = −(N − 815900).

# Satellite base map

```bash
unzip model/11-SW-7C.zip 'BUILDING/*' 'VEGETATION*' -d work/7C   # (and 7D)
python3 tools/build_satellite.py work/7C work/7D out/sat-raw.glb
node tools/optimize_satellite.mjs out/sat-raw.glb
python3 tools/build_canopy.py work/7C work/7D lod_work/7C lod_work/7D out/canopy-raw.glb   # lod_work: the 11-SW-7C.1 / 7D.1 tiles
node tools/optimize_canopy.mjs out/canopy-raw.glb assets/model/satellite-trees.glb
unzip model/11-SW-7C.zip 'INFRASTRUCTURE*' -d work/7C   # (and 7D)
python3 tools/build_roads_photo.py work/7C work/7D out/roads-photo-raw.glb   # env PAGES (page budget, 14), BLOCK, PAD
node tools/optimize_roads_photo.mjs out/roads-photo-raw.glb assets/model/roads-photo.glb
```

`satellite-buildings.glb`: HKU buildings only (same rule as the map), geometry exactly as surveyed (full
float positions, no simplification or quantization); their photos are cropped, scaled and packed into
2048 px atlas pages (WebP). `satellite-trees.glb`: the surveyed VEGETATION(TB) canopy resampled as a 1.5 m
height field with the terrain tile's UV mapping, so it wears the terrain's own aerial photo (no extra textures).
`roads-photo.glb`: the surveyed road surfaces and bridges with their photos at about 7 cm/px. Only the
used parts of the 4096 px source photos are kept (cut into bands and runs of used 64 px blocks, the triangles
split along the cuts, packed into 2048 px atlas pages with real neighbouring pixels as padding) and the pages
are KTX2 / Basis ETC1S, which stay compressed on the GPU (about 3 MB a page instead of 22 MB), so phones can
hold them; the site decodes them with three.js KTX2Loader (`vendor/three/addons/libs/basis`).
They load only when the layers menu picks "Classic + real buildings" (buildings) or "Satellite" (all).

# Indoor floor plans

```bash
python3 tools/build_indoor.py tools/indoor/main-library.json <folder with the PDFs> data/indoor/main-library.json
```

`tools/indoor/<place>.json` lists each floor (id, name, level in mPD) with its floor-plan PDF(s) and their
registration to the model frame (x = a·u − b·v + tx, z = b·u + a·v + tz; u, v in PDF points). The Main Library
PDFs are HKU Libraries' plans (https://lib.hku.hk/mainlib/floorplan.html, file names as published, not kept in
this repo). They were registered by matching each plan's outline to the surveyed footprints of the Old Wing,
New Wing and podium and the plans' common column grid. The script reads the vector drawing, classifies every
path by colour, merges shelves / tables / seats into blocks, keeps walls as lines, turns legend symbols into
icons and texts into labels, and writes `data/indoor/<place>.json`; `data/indoor/index.json` maps place ids to
these files. The map draws them with `assets/indoor.js`.
