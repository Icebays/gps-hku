<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/banner-dark.jpg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/images/banner-light.jpg" />
    <img src="docs/images/banner-light.jpg" alt="GPS-HKU — the University of Hong Kong in 3D" width="1086" />
  </picture>
</p>

<h1 align="center">GPS-HKU</h1>

<p align="center">
  <strong>English</strong> |
  <a href="README.zh-HK.md">繁體中文</a>
</p>

<p align="center">
  <a href="https://icebays.github.io/gps-hku/"><img src="https://img.shields.io/badge/Live%20site-Open%20the%20map-0f4c3a?logo=googlemaps&logoColor=white" alt="Live site" /></a>
  <a href="https://github.com/icebays/gps-hku/discussions"><img src="https://img.shields.io/badge/Discussions-Join%20in-5865F2?logo=github&logoColor=white" alt="Discussions" /></a>
  <a href="https://github.com/icebays/gps-hku/wiki"><img src="https://img.shields.io/badge/Wiki-Read-6e7781?logo=github&logoColor=white" alt="Wiki" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/copyright-all%20rights%20reserved-c62828" alt="Copyright: all rights reserved" /></a>
  <a href="https://threejs.org/"><img src="https://img.shields.io/badge/three.js-3D-000000?logo=threedotjs&logoColor=white" alt="three.js" /></a>
  <img src="https://img.shields.io/badge/English%20%C2%B7%20%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87-1971c2" alt="English · 繁體中文" />
  <a href="https://github.com/icebays/gps-hku/commits/main"><img src="https://img.shields.io/github/last-commit/icebays/gps-hku" alt="Last commit" /></a>
</p>

<p align="center">
  <a href="https://icebays.github.io/gps-hku/"><img src="docs/images/button-open-en.png" alt="Open GPS-HKU" width="376" /></a>
</p>

GPS-HKU is a 3D map, walking guide and floor plan guide to the University of Hong Kong. It shows the hillside campus
as it really is, from the Lands Department's survey data, so you can see which floor is the ground, where a bridge
leads and which lift takes you up the hill.

It runs in any modern browser, on a phone or a computer, with no app and no sign-in, in English and 繁體中文.

## Quick start

Open **https://icebays.github.io/gps-hku/** and try:

1. **Find a building**: type `Main Library` or `總圖書館` in the search box (or press `/`); the map flies there and
   lights it up in gold.
2. **Look inside**: pick **2** in the floor selector on the left; the building is cut open at 2/F.
3. **See it for real**: open **Layers** and choose **Satellite**; the sky follows the real sun and the HKO's weather.
4. **Find yourself**: tap 🎯 to show where you are and which way you face.

To run it on your own computer (a static site, no build step):

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Promo video

https://github.com/user-attachments/assets/64d3104e-427e-4a7b-9d8e-738cbeb77997

<p align="center">
  <sub>Captured from the live site. The rainstorm and thunderstorm warnings in the weather shot are demo data, not a
  real day's weather. Original music; sound effects from <a href="https://mixkit.co/license/#sfxFree">Mixkit</a>.</sub>
</p>

## Showcase

<p align="center">
  <img src="docs/images/sky-sunset.jpg" alt="The satellite view at sunset" width="1200" />
</p>
<p align="center"><sub>The satellite view at sunset: the sky follows the sun's real position over HKU, and its light falls on the buildings and the ground.</sub></p>

<p align="center">
  <img src="docs/images/floor-plans.jpg" alt="The Main Library cut open at 2/F" width="1200" />
</p>
<p align="center"><sub>The Main Library cut open at 2/F, with its card and the floor selector.</sub></p>

<p align="center">
  <img src="docs/images/weather.jpg" alt="A rainstorm with the Hong Kong Observatory's warnings" width="1200" />
</p>
<p align="center"><sub>A rainstorm on the satellite map, with the Hong Kong Observatory's warnings in the weather widget (demo data).</sub></p>

<p align="center">
  <img src="docs/images/eatery.jpg" alt="CYM Canteen's card" width="1200" />
</p>
<p align="center"><sub>CYM Canteen's card: photos, opening hours, online ordering and the table-QR scanner.</sub></p>

<p align="center">
  <img src="docs/images/mtr-xray.jpg" alt="HKU Station's platform in an x-ray view" width="1200" />
</p>
<p align="center"><sub>HKU Station's platform deep under the hill, in an x-ray view through the dark map.</sub></p>

## Why GPS-HKU

HKU is built on a hillside. A building's "G/F" can sit far above or below the one next door, the old Main Campus and
Centennial Campus are joined by bridges, podiums, lift towers and the two-level University Street, and the MTR station
lies deep under the hill. A flat campus map cannot show any of that; GPS-HKU shows it in 3D, at true scale.

## What's on the map

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/treemap-dark.png" />
  <img src="docs/images/treemap-light.png" alt="Treemap of the 160 places on GPS-HKU by kind: campus life 67 (halls 31, food 26, amenities 10), study and culture 51 (teaching 43, libraries 4, museums 4), getting around and landmarks 42 (transport 17, other 14, landmarks 11)" width="100%" />
</picture>

<details>
<summary>The numbers as a table</summary>

| Group | Kind | Places |
|---|---|---:|
| Campus life | Halls & Colleges | 31 |
| Campus life | Food & Drink | 26 |
| Campus life | Amenities | 10 |
| Study & culture | Teaching & Faculty | 43 |
| Study & culture | Libraries & Study | 4 |
| Study & culture | Museum & Culture | 4 |
| Getting around & landmarks | Transport | 17 |
| Getting around & landmarks | Other | 14 |
| Getting around & landmarks | Landmarks | 11 |
| | **Total** | **160** |

</details>

## What you can do

| | |
|---|---|
| **3D campus** | The Main, Centennial and Sassoon Road campuses, the Pokfield Campus (under construction), the halls and the streets around them, streamed tile by tile like Google Earth. HKU's buildings stand solid; the rest of the city is see-through. Heights in metres above Principal Datum (mPD). |
| **Three looks** | A clean **map** (relief, 10 m contours, roads, footpaths, road markings), **dark mode** (grey buildings on a dark ground) and **satellite** (the aerial photo, photo-textured HKU buildings, photo roads, a 3D tree canopy). |
| **A real sky** | In the satellite view: blue by day, golden hour, sunset, blue hour and night, from the sun's real position; clouds and rain from the Hong Kong Observatory's current weather, rain as heavy as the past hour's rainfall. The sky's light falls on the buildings and the ground. |
| **Sun and weather** | Real-time sun and soft shadows. The weather widget shows the temperature, humidity, local rainfall and every HKO warning in force (typhoon signals, rainstorm, thunderstorm, very hot or cold weather, monsoon, fire danger, landslip, flooding, frost, tsunami), refreshed every 10 minutes. |
| **160 places** | Every building on HKU's official campus map, plus libraries, halls, eateries, MTR exits and landmarks. Campuses and hall groups outlined and named. Search in English or Chinese, or by campus-map number. |
| **3D floor plans** | The **Main Library** (G/F–6/F), the **Centennial Campus** podium (CPD LG/F–4/F, every classroom's number and seats) and the MTR stations **HKU**, **Sai Ying Pun** and **Kennedy Town**. Pick a floor and the building is cut open above it; stations are shown in x-ray through the faded map. |
| **MTR** | Every exit with its code as on the MTR's signs; the Island Line drawn at the depth of its tracks. |
| **26 eateries** | HKU Catering Services' restaurants, canteens and cafés with photos, food, opening hours and details. 14 take online orders (the restaurant's own order page); **Scan table QR** opens your table's order page with the phone's camera. |
| **You on the map** | Your GPS position as a blue dot on the ground, with a beam that turns with the way you face. Your location never leaves your phone. |
| **Guides** | Getting to HKU, Upper & Lower University Street, lifts and step-free routes, the building directory, floor plans, walking routes and map controls, in English and Chinese. |
| **Share a view** | The address follows what you look at (`#/en/map?place=main-library&floor=2`): a shared link opens the same place and floor. |
| **Phones first** | Google / Apple Maps gestures (pan, pinch, twist, two-finger tilt, double-tap zoom); memory kept low for iPhones. |

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

## How it is built

GPS-HKU is a static site: plain JavaScript modules and [three.js](https://threejs.org/), no framework and no build
step, published with GitHub Pages. The 3D campus is cut into tiles that stream in around the view; the tiles, the photo
models and the map data are built offline from the source data by the scripts in `tools/`.

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
| `docs/`, `promo/` | the README's images, the promo videos |

When the site's modules change, bump the `?v=` version in `index.html`'s import map so phones never mix new and old
files.

## Data sources

- 3D Spatial Data and 3D indoor maps (IMDF) © Lands Department, HKSAR Government
- Buildings and places: HKU campus map (maps.hku.hk); eateries: HKU Catering Services (catering.hku.hk), photos
  linked from there
- Floor plans: redrawn from HKU Libraries' floor plans and the HKU Examinations Office's CPD classroom plans
- MTR exits and lines, roads and paths: © OpenStreetMap contributors (ODbL)
- Weather and warnings: Hong Kong Observatory
- QR reading: [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0)

## Project scope

- GPS-HKU is an unofficial student project, not affiliated with The University of Hong Kong or the MTR Corporation.
  Check official sources for anything that matters (opening hours, accessibility, closures).
- The site is edited by its maintainers only; it has no public editing.
- Walking routes are added after walking them; none are published yet.
- Online ordering opens each restaurant's own order page; GPS-HKU takes no orders or payments itself.
- Some places are marked ⚠︎ approximate until their position is confirmed.

## Community

- Questions, ideas and corrections: [Discussions](https://github.com/icebays/gps-hku/discussions)
- More documentation: [Wiki](https://github.com/icebays/gps-hku/wiki)
- To ask permission to use any part of GPS-HKU: open an [issue](https://github.com/icebays/gps-hku/issues)

## Star history

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=icebays/gps-hku&type=Date&theme=dark" />
  <img alt="Star history of icebays/gps-hku" src="https://api.star-history.com/svg?repos=icebays/gps-hku&type=Date" width="100%" />
</picture>

## Copyright

© 2026 icebays. All rights reserved. GPS-HKU is not open source: no part of it may be copied, modified, shared or
used without my prior written permission, and commercial use is not permitted. Ask first by opening an
[issue](https://github.com/icebays/gps-hku/issues). Third-party material keeps its own terms. See [LICENSE](LICENSE).
