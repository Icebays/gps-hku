# GPS-HKU

[![Live site](https://img.shields.io/badge/live-icebays.github.io%2Fgps--hku-0f4c3a?style=for-the-badge&logo=googlemaps&logoColor=white)](https://icebays.github.io/gps-hku/)
[![Copyright: all rights reserved](https://img.shields.io/badge/copyright-all%20rights%20reserved-c62828?style=for-the-badge)](LICENSE)
[![three.js](https://img.shields.io/badge/three.js-3D-000000?style=for-the-badge&logo=threedotjs&logoColor=white)](https://threejs.org/)
[![English · 繁體中文](https://img.shields.io/badge/English%20%C2%B7%20%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87-1971c2?style=for-the-badge)](https://icebays.github.io/gps-hku/)
[![Last commit](https://img.shields.io/github/last-commit/icebays/gps-hku?style=for-the-badge)](https://github.com/icebays/gps-hku/commits/main)

**English** · [繁體中文](README.zh-HK.md)

A 3D map, walking guide and floor plan guide to the University of Hong Kong.

**Live site:** https://icebays.github.io/gps-hku/

## Promo video

https://github.com/user-attachments/assets/64d3104e-427e-4a7b-9d8e-738cbeb77997

Captured from the live site. The rainstorm and thunderstorm warnings in the weather shot are demo data, not a real
day's weather. Original music; sound effects from [Mixkit](https://mixkit.co/license/#sfxFree).

## Why GPS-HKU

HKU is built on a hillside. A building's "G/F" can sit far above or below the one next door, the old Main Campus and
Centennial Campus are joined by bridges, podiums, lift towers and the two-level University Street, and the MTR station
lies deep under the hill. A flat campus map cannot show any of that. GPS-HKU shows the campus as it really is, in 3D,
built from the Lands Department's survey data, so you can see which floor is the ground, where a bridge leads, and
which lift takes you up the hill.

## What you can do

**Explore HKU in 3D**
- The Main, Centennial and Sassoon Road campuses, the Pokfield Campus (under construction), the halls and the streets
  around them, streamed tile by tile like Google Earth: only what is on screen is downloaded.
- HKU's buildings stand solid; the rest of the city is drawn see-through, so the campus reads at a glance.
- Heights are shown in metres above Principal Datum (mPD), Hong Kong's height reference, so you can compare how high
  up the hill two buildings sit.

**Three looks**
- **Map**: a clean map with relief, 10 m contour lines, roads, footpaths and road markings.
- **Dark mode**: the same map at night, with grey buildings on a dark ground.
- **Satellite**: the aerial photo, photo-textured HKU buildings, photo roads and a 3D tree canopy.

**A real sky (satellite view)**
- The sky follows the sun's real position over HKU: blue by day, then golden hour, sunset, blue hour and night.
- Clouds and rain follow the Hong Kong Observatory's current weather: none on a sunny day, more cloud as it clouds
  over, grey rain clouds and rain as heavy as the past hour's rainfall in Central & Western (or a rainstorm warning).
- The sky's light falls on the buildings and the ground: warm at sunset, blue at dusk, dark at night.

**Sun, shadows and weather**
- The sun stands where it really is right now; buildings, bridges and trees cast soft shadows, and cloud and rain
  soften them.
- The weather widget (bottom left) shows the temperature, humidity and local rainfall, and every warning in force:
  typhoon signals, rainstorm (amber, red, black), thunderstorm, very hot or cold weather, strong monsoon, fire danger,
  landslip, flooding, frost and tsunami. It refreshes every 10 minutes.

**Find places**
- 160 places: every building on HKU's official campus map, plus libraries, halls, eateries, MTR exits and landmarks,
  with icons by kind.
- The campuses and the groups of halls (the Jockey Club Student Villages, the Sassoon Road Halls, the Pokfulam Road
  Residences and more) are outlined and named on the ground.
- Search by English or Chinese name, or by the number on HKU's campus map; the map flies to the place and lights it
  up in gold. Press `/` to jump to the search box.
- Pins fold into round badges when the map is crowded, and categories can be shown or hidden.

**Floor plans in 3D**
- The **Main Library** (Old & New Wing, G/F–6/F), the **Centennial Campus** podium (CPD LG/F–4/F, with every
  classroom's number and seats), and the MTR stations **HKU**, **Sai Ying Pun** and **Kennedy Town**.
- Pick a floor and the building is cut open above it: study areas, bookshelves, tables, stairs, toilets, lifts, fire
  exits and printers are drawn at their real height.
- A station's floors below ground are shown in an x-ray view through the faded map, with the platform, concourse,
  fare gates, escalators, exits and lift shafts.

**MTR**
- Every exit of HKU, Sai Ying Pun and Kennedy Town stations with its exit code as on the MTR's signs, and the Island
  Line drawn at the depth of its tracks.

**Eateries**
- All 26 of HKU Catering Services' restaurants, canteens and cafés on the map; a building's card lists the ones in it.
- Each has its photos, mode of service, food, opening hours and a link to its details.
- **Order online**: 14 of them take online orders; the button opens the restaurant's own order page.
- **Scan table QR**: sitting at a table? Tap *Scan table QR* on the card, point the camera at the QR code on your
  table, and open that table's order page.

**You on the map**
- 🎯 shows your GPS position as a blue dot lying on the ground, with a beam that turns with the way you face.
  Your location never leaves your phone.

**Guides**
- Handbook pages in English and Chinese: getting to HKU, Upper & Lower University Street, lifts and step-free routes,
  the building directory, floor plans, walking routes and map controls.
- Walking routes are drawn on the 3D terrain with distance, climb and walking time. They are added by the maintainers
  after walking them; none are published yet.

**Share and use anywhere**
- The page address follows what you look at (`#/en/map?place=main-library&floor=2`), so a shared link opens the same
  place and floor.
- Phones first: Google / Apple Maps gestures (pan, pinch, twist, two-finger tilt, double-tap zoom), memory kept low
  for iPhones. English and 繁體中文, light and dark.

## Map controls

| Action | Mouse | Touch |
|---|---|---|
| Move around | Left-drag | One-finger drag |
| Rotate / tilt | Right-drag (or Ctrl + drag) | Twist two fingers to rotate; push two fingers up or down to tilt |
| Zoom | Scroll wheel | Pinch, or double-tap and hold then drag; double-tap zooms in |
| Select a building | Click | Tap |

| Button | What it does |
|---|---|
| 🧭 Compass | North up; tap again to face south |
| ↺ Reset | Back to the starting view, facing south like HKU's campus map |
| ◇ Top / 3D | Top-down "floor plan" view or tilted 3D view |
| 🎯 Location | Your GPS position and heading |
| ⤴ Routes | Walking routes |
| Layers | Map, map with real buildings, or satellite |
| Filter | Show or hide place categories |
| ☾ (top bar) | Light or dark mode |

## Run locally

A static site with no build step (three.js, no framework):

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

It is published with GitHub Pages (Settings → Pages → *Deploy from a branch* → `main` / `(root)`).

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

## Data sources

- 3D Spatial Data and 3D indoor maps (IMDF) © Lands Department, HKSAR Government
- Buildings and places: HKU campus map (maps.hku.hk); eateries: HKU Catering Services (catering.hku.hk), photos
  linked from there
- Floor plans: redrawn from HKU Libraries' floor plans and the HKU Examinations Office's CPD classroom plans
- MTR exits and lines, roads and paths: © OpenStreetMap contributors (ODbL)
- Weather and warnings: Hong Kong Observatory
- QR reading: [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0)

GPS-HKU is an unofficial student project and is not affiliated with The University of Hong Kong or the MTR Corporation.

## Copyright

© 2026 icebays. All rights reserved. GPS-HKU is not open source: no part of it may be copied, modified, shared or
used without my prior written permission, and commercial use is not permitted. Ask first by opening an
[issue](https://github.com/icebays/gps-hku/issues). Third-party material keeps its own terms. See [LICENSE](LICENSE).
