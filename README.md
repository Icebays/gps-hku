# GPS-HKU

A 3D map, walking guide and floor plan guide to the University of Hong Kong.
香港大學 3D 地圖、步行及平面圖指南。

**Live site:** https://icebays.github.io/gps-hku/

HKU is built on a hillside: a building's "G/F" can sit far above or below the one next door, and buildings are joined
by bridges, podiums and lift towers. GPS-HKU shows the campus as it really is, in 3D, from the Lands Department's
survey data.

## Promo video

<a href="https://icebays.github.io/gps-hku/promo/gps-hku-promo-84s.mp4"><img src="promo/poster-84s.jpg" width="720" alt="GPS-HKU promo video (84 s)"></a>

Captured from the live site. The rainstorm and thunderstorm warnings in the weather shot are demo data, not a real
day's weather. Original music; sound effects from [Mixkit](https://mixkit.co/license/#sfxFree).

## What it does

- **3D map of HKU and the Western District**: the Main, Centennial, Sassoon Road and Pokfield campuses, the halls
  and the streets around them, streamed tile by tile like Google Earth (only what is on screen is loaded). HKU's
  buildings stand solid; the rest of the city is drawn see-through so the campus reads.
- **Three looks**: a clean map (relief, contours, roads and markings), the same map in dark mode (grey buildings on a
  dark ground), and a satellite view with the aerial photo, photo textured HKU buildings and 3D trees.
- **A real sky** in the satellite view: blue by day, then golden hour, sunset, blue hour and night, from the sun's
  real position over HKU; clouds and rain from the Hong Kong Observatory's current weather (none on a sunny day, more as
  it clouds over, grey rain clouds and rain as heavy as the past hour's rainfall). The sky's light falls on the
  buildings and the ground: warm at sunset, blue at dusk.
- **Places**: every building on HKU's official campus map, with icons by kind, the campuses and the groups of halls
  outlined and named, search, and pins that fold into round badges when the map is crowded.
- **Floor plans in 3D**: the Main Library, the Centennial Campus podium and the MTR stations (HKU, Sai Ying Pun,
  Kennedy Town). The building is cut open above the floor shown; a station's floors below ground are shown in an
  x-ray view through the faded map, with lift shafts standing through the levels.
- **MTR**: every exit with its exit code as on the MTR's signs, and the Island Line drawn at the depth of its tracks.
- **Eateries**: all of HKU Catering Services' restaurants, canteens and cafés on the map; a building's card lists
  them, and each has its photos, opening hours and online ordering (the restaurant's own order page). A table-QR
  scanner on the card reads the code on your table with the phone's camera and opens that table's order page.
- **Getting around**: walking routes on the 3D terrain, lifts and step-free routes, GPS, the real sun and shadows,
  and the weather and warnings from the Hong Kong Observatory.
- **Phones first**: Google / Apple Maps gestures (pan, pinch, twist, two-finger tilt, double-tap zoom), memory kept
  low for iPhones. English and 繁體中文.

## Run locally

A static site with no build step (three.js, no framework):

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

To publish on GitHub Pages: Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.

## Where things are

| | |
|---|---|
| `index.html`, `assets/` | the site: `app.js` (pages), `map.js` (3D map), `tiles.js` (tile streaming), `indoor.js` (floor plans), `sky.js` (the satellite view's sky), `roads.js`, `icons.js`, `weather.js` |
| `content/en`, `content/zh` | the guide pages (Markdown) |
| `data/places.json` | places: buildings, eateries, MTR exits, with their model building IDs |
| `data/campus.json` | campus and hall-group outlines, HKU's buildings |
| `data/indoor/` | floor plans |
| `data/eateries.json`, `data/mtr-lines.json`, `data/routes.json` | eateries' details, MTR lines, walking routes |
| `assets/tiles/`, `assets/model/` | the 3D tiles and models |
| `tools/` | how all of the above is built from the source data (see `tools/README.md`) |
| `vendor/` | three.js, marked, jsQR (the table-QR scanner where the browser has no QR reader of its own) |
| `promo/` | the promo videos |

The site is edited by its maintainers only; it has no public editing. When the site's modules change, bump the `?v=`
version in `index.html`'s import map so phones never mix new and old files.

## Data

- 3D Spatial Data and 3D indoor maps (IMDF) © Lands Department, HKSAR Government
- Buildings and places: HKU campus map (maps.hku.hk); eateries: HKU Catering Services (catering.hku.hk), photos
  linked from there
- MTR exits and lines, roads and paths: © OpenStreetMap contributors (ODbL)
- Weather and warnings: Hong Kong Observatory
- QR reading: [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0)

GPS-HKU is an unofficial student project and is not affiliated with The University of Hong Kong or the MTR Corporation.
