# Map controls

| Action | Mouse | Touch |
|---|---|---|
| Move around | Left-drag | One-finger drag |
| Rotate / tilt | Right-drag (or Ctrl + drag) | Twist two fingers to rotate (around the point between them); push two fingers up or down together to tilt (3D angle) |
| Zoom | Scroll wheel | Pinch (zooms around the point between your fingers), or one finger: double-tap and hold, then drag up (in) or down (out). Double-tap zooms in. The page itself never zooms. |
| Select a building | Click | Tap |

## Buttons

| Button | What it does |
|---|---|
| 🧭 Compass | Turns the view so north is up; tap again to face south. The red tip always points north. |
| ↺ Reset | Goes back to the starting campus view, facing south like the HKU campus map (the hill behind the campus at the top). |
| ◇ Top / 3D | Switches between a top-down "floor plan" view and a tilted 3D view. |
| 🎯 Location | Shows your GPS position on the model. |
| ⤴ Routes | Lists walking routes. Tap one to draw it on the map. |
| Layers (stacked squares) | Map style: Classic (default) · Classic + real buildings (HKU buildings with their photos) · Satellite (aerial photo, photo roads and HKU buildings, 3D tree canopy). |
| Filter (sliders) | Shows or hides place categories. |
| ✎ Edit | Contributor mode for labelling buildings and drawing routes. See [Contribute & edit](contribute). |

## Floor plans (indoor)

Pick a building that has floor plans (now: the **Main Library**, Old & New Wing) and a floor selector appears on the left, as in Google or Apple Maps. Choose a floor (G–6) and the building is cut open above it so you see that floor drawn at its real height: study areas, bookshelves, tables, walls and stairs, room and collection names (call-number signs appear as you zoom in) and symbols for toilets, lifts, fire exits, printers, catalogue (OPAC) terminals and dictionary stands. The house button shows the building from outside again. Tables stand on legs with their chairs around them, bookshelves, sofas and stools are drawn to their real shapes, and open atria show the floor below through a glass balustrade. **Walls** (settings button, the sliders): *see-through facing you* (default, like The Sims: walls between you and the room drop to a low sill and turn to glass as you turn the view), *full walls* or *low walls*. The floor is kept in the page address (`&floor=3`), so a shared link opens the same floor. Plans are redrawn from [HKU Libraries' floor plans](https://lib.hku.hk/mainlib/floorplan.html); floor heights are estimated from the 3D model.

## Sun, shadows and weather

- **Sun and shadows**: the sun is placed where it really is at HKU right now. Buildings, bridges and trees cast soft shadows, the light warms near sunrise and sunset, and at night it goes flat with no shadows. Cloud and rain soften the shadows. In the Satellite style the photo already has its own shadows, so the ground gets none added.
- **Weather (bottom left)**: the current weather at HKU from the Hong Kong Observatory (HKO has no station on campus, so the temperature is from the nearest one, Hong Kong Park), with any warnings in force shown as icons: typhoon signals, rainstorm (amber, red, black), thunderstorm, very hot or cold weather, strong monsoon, fire danger, landslip, northern New Territories flooding, frost and tsunami. Tap it for humidity, local rainfall and the full warning names. It updates every 10 minutes and stays hidden if the Observatory can't be reached.

## Sharing a view

The page address updates as you go. Copy it to share a building, for example `#/en/map?place=main-building`, or a route, for example `?route=...`.

> [!TIP]
> On a slow connection, the first load downloads about 9 MB of 3D data. After that your browser caches it.
