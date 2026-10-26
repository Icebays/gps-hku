# Rebuilding the 3D model

The site streams the campus model in tiles (`assets/tiles/`, see below), cut from one merged model built from the
original 3dmap.gov.hk tiles in `model/`.

```bash
# 1. unzip each tile into its own folder, e.g. work/7C, work/7D (the standard release: TERRAIN(TB), BUILDING,
#    INFRASTRUCTURE)
mkdir -p work/7C work/7D
unzip model/11-SW-7C.1.zip -d work/7C
unzip model/11-SW-7D.1.zip -d work/7D

# 2. merge tiles -> raw.glb + buildings.json  (needs: pip install numpy pillow)
python3 tools/build_raw.py work out 7C,7D

# 3. convert buildings.json to the compact form used by the site
python3 -c "import json;B=json.load(open('out/buildings.json'));json.dump([[b['id'],b['x'],b['z'],b['base'],b['top']] for b in B],open('assets/model/buildings.json','w'),separators=(',',':'))"

# 4. cut it into the streamed tiles (add each tile's extent to data/tiles.json first)
#    (needs: npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp)
node tools/build_tiles.mjs out/raw.glb
```

`build_tiles.mjs` welds the raw model, simplifies the terrain (edges locked) and stores every tile's terrain, and
every tile's buildings and bridges, as 16-bit integers over that tile's own box: about 1.2 cm steps, however many tiles
the map has. Building geometry is never simplified. (`tools/optimize.mjs` made the single-file `hku.glb` the site
used before it streamed tiles; `build_tiles.mjs` still takes such a file.)

### Streaming (assets/tiles.js)

`build_tiles.mjs` writes, per tile, `terrain.glb` (the terrain, plus a simplified copy with its edges locked),
`objects.glb` (buildings and bridges, never simplified) and the aerial photo as a quadtree of WebP pieces
(512 px for the whole tile down to 8 x 8 pieces at the full 4096 px), with `index.json` and a 10 m height grid
(`heights.bin`). The map loads the terrain of tiles within 4.2 km of the camera (3.3 km on phones), their full buildings within 1.7 km
(1.4 km on phones), and only the photo pieces that are in view and drawn larger than their own resolution, within a
memory budget. Tiles further than 700 m use the simplified terrain. The main campus tiles (11-SW-7C, 7D, whose centres
lie in the campus extent) always stay loaded.

```bash
node tools/build_lod.mjs               # lod.glb per tile (2 m), other buildings in objects.glb at 0.8 m, colours
node tools/build_bridge_photo.mjs      # bridges.webp + .json per tile: the photo under the bridges (satellite map)
node tools/build_tiles.mjs --index     # list them in index.json
```

The map opens as soon as `index.json` and `heights.bin` are in. Every tile within the terrain range shows its
simplified buildings (`lod.glb`, about 1 MB for all 35 tiles), so the skyline is there from afar and at once. Close
by, block by block (150 m blocks within 700 m, 500 m on phones), the full models replace them once `objects.glb` is in:
HKU's buildings exact, the others simplified to about 0.8 m (`build_lod.mjs`; half see-through, close by they look
much the same). The simplifying is for good: after marking more buildings as HKU's in `data/places.json`, put the
tiles' original `objects.glb` back (from git history) and run `build_lod.mjs` again, or they stay simplified. Buildings that are not HKU's are drawn plain and 45 % opaque (50 % in the satellite map). Every
building also carries a colour, the mean of the aerial photo under it: the satellite map draws HKU's buildings that
have no photo copy in it.
In the satellite map the bridges (the standard release has no photos on them) wear the tile's own orthophoto, looked
up by position: `build_bridge_photo.mjs` packs the 32 px photo blocks under the bridges into one small atlas per tile.

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

# Features of the other tiles

Tiles with a high-quality release get the same land cover, trees, surveyed roads with markings and lamps, photo roads
and bridges, and photo HKU buildings as the main campus, each in the tile's own folder, streamed with the tile:

```bash
mkdir -p work/7A && cd work/7A && unzip ../../11-SW-7A.zip 'TERRAIN(TB)/*' 'VEGETATION(TB)/*' 'WATERBODY/*' 'INFRASTRUCTURE(TB)/*' 'INFRASTRUCTURE/*' 'BUILDING/*'; cd ../..
python3 tools/build_tile_features.py work/7A 11-SW-7A assets/tiles/11-SW-7A        # land.json
node tools/build_surfaces.mjs --roads assets/tiles/11-SW-7A/roads.glb work/7A        # surveyed road surfaces
PAGES=7 python3 tools/build_roads_photo.py work/7A out/rp.glb                        # photo roads and bridges
node tools/optimize_roads_photo.mjs out/rp.glb assets/tiles/11-SW-7A/photo-roads.glb
SKIP=assets/model/satellite-buildings.json \
python3 tools/build_satellite.py work/7A out/hb.glb                                  # photo HKU buildings (+ out/hb-ids.json)
EXACT=1 node tools/optimize_roads_photo.mjs out/hb.glb assets/tiles/11-SW-7A/hku-photo.glb
cp out/hb-ids.json assets/tiles/11-SW-7A/hku-photo.json
node tools/build_tree_colours.mjs                                                    # trees' photo colours (all tiles)
node tools/build_tiles.mjs --index                                                   # list them in index.json
```

`land.json` holds the vegetation and water polygons and the trees (as `data/landcover.json`) and the road centre
lines (as `data/roadnet.json`, here found from the road surfaces drawn straight into a mask: INFRASTRUCTURE(TB)
roads plus the dark, upward faces of INFRASTRUCTURE flyover decks). There are no crossings or bus stops outside the
main campus (those come from OpenStreetMap there). The map draws a tile's land cover into its terrain as soon as the
terrain loads, and builds its road surface, markings, street lamps and trees when its buildings load (one tile at a
time). In the satellite map its surveyed photo roads and bridges (`photo-roads.glb`, 7 KTX2 pages, about 10 cm/px)
load within 950 m (1.25 km on computers), and with the photo buildings its HKU buildings in their own photos
(`hku-photo.glb`; `SKIP` leaves out the buildings the main campus's copy has already, so none is drawn twice - a
building near a tile's edge can come in its neighbour's release); the other HKU buildings stay white. Only the nearest tiles hold them (phones: 2 with photo roads,
3 with photo buildings; the main campus's photo roads only near the campus), and they are dropped as the view moves
on: iOS Safari reloads the page when it runs out of memory. Tiles without a high-quality release paint their bridge decks
with their orthophoto (`bridges.json`, see above) and keep plain concrete sides.

The satellite map stands the trees up in 3D in the colours of the photo under each crown (a 6th value per tree,
`tools/build_tree_colours.mjs`), so trees spreading over a road stand over it instead of lying flat in the photo.

The sea (flat terrain at 1.3 mPD in the coastal tiles) is drawn in the colour of the ground plane beyond the map.

# Map extent and adding tiles

`data/tiles.json` lists the loaded tiles and their extent in model coordinates. The map fades into the
background over `fade` metres at the outer edge of the union of these extents (shared edges between
adjacent tiles never fade). To add a tile (e.g. the northern neighbours 11-SW-5C / 5D): include it when
building `hku.glb` (`build_raw.py ... 7C,7D,5C`), rebuild the road / land-cover data with its folder,
and add `{ "id": "11-SW-5C", "extent": [x0, x1, z0, z1] }` to `data/tiles.json`.
Tile extent = the TERRAIN(TB) node position ± its half size: x = E − 832250, z = −(N − 815900).

# Satellite base map

```bash
unzip model/11-SW-7C.zip 'BUILDING/*' -d work/7C   # (and 7D)
python3 tools/build_satellite.py work/7C work/7D out/sat-raw.glb
EXACT=1 node tools/optimize_roads_photo.mjs out/sat-raw.glb assets/model/satellite-buildings.glb
cp out/sat-raw-ids.json assets/model/satellite-buildings.json
unzip model/11-SW-7C.zip 'INFRASTRUCTURE*' -d work/7C   # (and 7D)
python3 tools/build_roads_photo.py work/7C work/7D out/roads-photo-raw.glb   # env PAGES (page budget, 14), BLOCK, PAD
node tools/optimize_roads_photo.mjs out/roads-photo-raw.glb assets/model/roads-photo.glb
```

`satellite-buildings.glb`: HKU buildings only (same rule as the map), geometry exactly as surveyed (full
float positions, no simplification or quantization); their photos are cropped, scaled and packed into
2048 px atlas pages (KTX2); `satellite-buildings.json` lists them, and the map keeps every other HKU building white.
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
these files. The map draws them with `assets/indoor.js`. Needs `pymupdf`, `opencv-python`, `numpy`, `scipy` and
`shapely`.

- Stairs: the tread lines make flights, and the flights near each other make one staircase. The script chains
  them end to end (the cheapest way to join them), so it reads U stairs, stairs wound round a lift shaft, L stairs
  and straight runs with a landing. The first flight climbs from the floor and the later ones float, with a landing
  between each pair. A U stair's landing is at the end where the stair's outline runs on past the treads, and the
  break mark (where the plan is cut) lies on the first flight.
- Walls vs furniture: navy lines are walls only when their group of touching lines reaches the plan's outline, a
  column or a lift shaft, or runs on for more than 15 m. Free-standing groups are furniture: the faces they enclose
  become chairs and desk tops, and blocks of packed boxes with no seats become compact shelving. Long thin faces are
  floor arrows or railings, and the lines left over become low screens. Small marks free of the walls are dropped
  (e.g. the lift call arrows).

```bash
python3 tools/build_indoor_raster.py tools/indoor/centennial-podium.json <CPDFloorPlan.pdf> data/indoor/centennial-podium.json
```

Scanned plans (the Centennial Campus podium, CPD LG/F–4/F: the Examinations Office's classroom plans, one page a
floor) go through `tools/build_indoor_raster.py`, which writes the same format. Each page is registered to the
model: 2/F to the surveyed sections of the podium and towers, the others to 2/F through the columns, cores and atria
they share. The ink is traced into floor lines. Walls stand only round the classrooms, found from their red numbers
and matched to their seat counts. The atria and the footprint come from the model. Needs `scikit-image` as well.

The MTR stations (HKU, Sai Ying Pun, Kennedy Town) come from the Lands Department's 3D indoor maps (IMDF: levels,
units, openings, amenities, sections, occupants; GeoJSON or shapefiles, read by `tools/imdf.py`):

```bash
python3 tools/build_station_plans.py "<HKU Station folder>" hku-station "<Sai Ying Pun Station folder>" sai-ying-pun-station \
  "<Kennedy Town Station folder>" kennedy-town-station      # data/indoor/<id>.json + index.json entries
python3 tools/build_mtr_lines.py                           # data/mtr-lines.json: the Island Line's tracks (OpenStreetMap)
```

Each IMDF level is drawn at its own height (mPD); an exit's levels are named by the exit (`A1-G`: exit A1's ground
level), and the levels of one storey (the IMDF ordinal: all the exits' ground levels, say) are one floor of the
selector (`groups`), shown together. The lifts stand as glass shafts from their lowest level to their highest
(`shafts`: lift units one above the other). Every plan opens at its top floor. A floor below ground is shown in the
x-ray view (`map.js`): the whole map faded to 19 % and the plan drawn over it; above ground the buildings, roads and
trees are cut away above the floor. The MTR lines are drawn on the ground above their tunnels, in the line's colour.
Needs `shapely`, `pyproj` and `pyshp`.
