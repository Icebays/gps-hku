# About floor plans

Each building in the [directory](buildings) can have floor plans. Viewers can drag to pan, scroll or pinch to zoom, and double-click to fit.

## Add a floor plan

1. Export each floor as an image (PNG, JPG or WebP). About 2000 px wide is plenty. For a PDF, export each page as an image.
2. Upload the images to `floorplans/<place-id>/`, for example `floorplans/main-building/GF.png`.
3. Add them to the building's `floors` list in `data/places.json`:

```
"floors": [
  { "label": "LG1", "src": "floorplans/main-building/LG1.png" },
  { "label": "G/F", "src": "floorplans/main-building/GF.png" },
  { "label": { "en": "1/F", "zh": "一樓" }, "src": "floorplans/main-building/1F.png" }
]
```

Floors appear as tabs in the order you list them.

> [!WARNING]
> Only upload floor plans you're allowed to share, such as plans you drew yourself or ones published for public use. Don't upload internal or security-sensitive drawings.
