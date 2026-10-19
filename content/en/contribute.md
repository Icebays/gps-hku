# Contribute & edit

GPS-HKU is a static website hosted on GitHub Pages. Everything is in plain files, so you can edit it straight from github.com with no coding.

## Label a building on the map

1. Open the [3D map](map) and tap **✎ Edit**.
2. Tap the building you know (in Edit mode, see-through buildings can be tapped too). Its model ID appears, for example `B322421612701063C0`.
3. In **Assign this building to…**, pick the place. One place can have several buildings, like Centennial Campus.
4. Repeat for more buildings, then tap **Export places.json**.
5. On GitHub, open `data/places.json`, click ✎, paste in the exported file and commit.

A place missing from the list? Add a new entry to `data/places.json`:

```
{ "id": "my-place", "cat": "amenity",
  "name": { "en": "My Place", "zh": "我的地方" },
  "desc": { "en": "Short description", "zh": "簡短介紹" },
  "buildings": [], "floors": [] }
```

## Edit a guide page

Each page has a **✎ Edit this page on GitHub** link at the bottom. Pages are Markdown files in `content/en/` and `content/zh/`. The sidebar is set in `content/nav.json`.

## Repository layout

```
index.html            site shell
assets/               app.js (site), map.js (3D viewer), app.css
assets/model/         hku.glb (optimised 3D campus) + buildings.json
content/en, zh        guide pages (Markdown)
content/nav.json      sidebar chapters
data/places.json      places, map pins, floor plan lists
data/campus.json      Main / Centennial Campus outlines and names (buildings inside are solid, the rest see-through), contour-line hill zone
data/routes.json      walking routes
floorplans/           floor plan images
model/                original 3dmap.gov.hk downloads
tools/                scripts that rebuild hku.glb from model/
```

## Rebuild the 3D model

If you download more tiles from the Lands Department's 3D portal, put the zips in `model/` and run the scripts in `tools/`. See `tools/README.md`.
