# GPS-HKU

A 3D map, walking guide and floor plan guide to the University of Hong Kong. 香港大學 3D 地圖、步行及平面圖指南。

**Live site:** https://icebays.github.io/gps-hku/

- Static site, no build step — hosted on GitHub Pages.
- 3D campus from Lands Department 3D Spatial Data (tiles 11-SW-7C, 11-SW-7D), optimised from ~120 MB to ~9 MB.
- Bilingual (English / 繁體中文) Markdown content in `content/`.
- Places, map pins and floor plans in `data/places.json`; walking routes in `data/routes.json`.

## Publish
Settings → Pages → Source: *Deploy from a branch* → Branch `main` / `(root)` → Save.

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Buildings are labelled in `data/places.json`, routes in `data/routes.json` and floor plans under `data/indoor/` (see `tools/README.md`). Editing is by the maintainers only; the site has no public editing.

3D Spatial Data © Lands Department, HKSAR Government. Unofficial project, not affiliated with HKU.
