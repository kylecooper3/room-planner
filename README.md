# Room Planner

Room Planner lets you lay out a room in 2D, check that the furniture fits (walkways, drawers, door swings) and look at the
result in 3D. It is free and runs entirely in your browser: no account, no API keys, no backend. Your project is saved in
the browser's own storage, and you can turn a photo of your own furniture into a simple 3D item at its real size.

![Plan view](docs/screenshots/plan.png)

## Setup

Requires Node.js and npm.

```sh
npm install          # also copies the ONNX Runtime WASM files to public/ort
npm run dev          # http://localhost:5173
```

Offline-capable build (the service worker only exists in the production build):

```sh
npm run build && npm run preview
```

Tests:

```sh
npm test                          # unit tests (Vitest)
npx playwright install chromium   # one-time, for the browser tests
npm run e2e                       # end-to-end tests (Playwright; starts the dev server itself)
```

The e2e run also regenerates the screenshots in `docs/screenshots/`. The two "live ML" photo tests download models from
huggingface.co and are skipped when it cannot be reached.

## Feature tour

### Set up a room (three ways)
The welcome card offers:
- **Enter dimensions**: type width, length and ceiling height; you get a rectangular room.
- **Draw a room**: click corners in the plan. Corners snap to right angles, to other rooms' corners and walls, and to
  dashed alignment guides through the corners you already placed (a small coloured marker says why the cursor jumped;
  hold Shift for no snapping). A hint bar above the plan says what to do next and shows the current wall length and
  area; click the green circle on the first corner or press Enter to finish, Backspace (↶ Undo point) removes the last
  corner, Esc cancels. Wheel zoom and drag / Space + drag / middle-drag panning keep working while drawing.
- **Import a floor plan**: opens the **Trace floor plan** panel, docked beside the plan (it never blocks it), with five
  numbered steps:
  1. *Add your plan*: drop an image (a listing screenshot is fine) onto the plan area or choose a file; set its opacity
     or hide it.
  2. *Set the scale*, one of three ways: **measure a known length** (click both ends of something you know and type its
     length; nothing labelled? an interior door is about 30–32 in / 80 cm wide), **I know the total area** (type the
     listed area, e.g. `531 sq ft` or `49 m²`; after tracing, the plan and every room are scaled together so the rooms
     you tick add up to it; listings usually measure to the outside of walls and leave out balconies, which start
     unticked), or **skip for now**. The panel shows the scale in plain words ("1 ft ≈ 19 px on your image").
  3. *Trace rooms*, one at a time: while tracing over the plan, corners also snap to the plan's wall lines (the edge
     between dark wall ink and paper), and a 3× magnifier follows the cursor. When a room closes the panel asks its
     name (Bedroom, Bathroom, Kitchen, Living room, Closet, Hallway, Balcony, or type one), then **Trace next room** or
     **Done tracing**. The list shows each room's area, the running total and, with a listed area, the difference in %.
     **Auto-detect rooms** proposes every enclosed room it finds (shown numbered on the plan) to keep or discard.
  4. *Doors & windows*: click a wall where the plan shows a gap.
  5. *Check & fix*: drag corners (they snap the same way), click a wall to type its exact length or split it, then
     **Finish**.

  The plan stays visible under the rooms while you work; it is never included in PNG exports. The toolbar's 🗺️ Floor plan
  button reopens the panel.

![Tracing a floor plan](docs/screenshots/floorplan.png)

![A traced apartment](docs/screenshots/floorplan-done.png)

Or load the **demo bedroom** to look around first. A project can hold several rooms (room picker and "+ New room" in the
toolbar).

### Openings and room details
Place doors, windows, outlets and radiators from the toolbar, then click one to edit it in the inspector: width, height,
sill height, offset along the wall, and for doors the hinge side and swing direction (in/out). Widths are kept between 5 cm
and the length of the wall, and the opening stays on its wall. The room inspector sets the name, ceiling height, wall
colour and floor (wood, carpet or tile) and shows the floor area.

### Units
The "ft/in" / "m/cm" toolbar button switches the display between imperial and metric. Everything is stored in centimetres,
so switching never changes the plan. Length fields accept things like `6' 2"`, `75in`, `190cm`, `1.9m`; plain numbers
mean feet/inches or centimetres depending on the field and unit system. Invalid input is flagged next to the field.

### The 2D editor
- Drag an item to move it; it snaps to walls and to other items (Alt while dragging, or the 🧲 toggle, turns snapping off).
  Distances to the walls are shown while dragging.
- Drag the rotate handle to rotate in 15° steps (Shift: free rotation).
- Every room of the project is shown: the active one normally, the others dimmed with their name and area; click a
  dimmed room to make it active. Door / window tools work on any room's walls.
- Drag a corner to reshape the room (it snaps like drawing); double-click a wall to add a corner; select a corner and
  press Delete to remove it. Click a wall to select it: the inspector shows its length, and typing a new length moves
  the wall's end corner along the wall (a rectangle stays a rectangle) as one undo step; **Split wall** adds a corner in
  its middle.
- Mouse wheel zooms; drag the background, middle-drag or Space + drag pans; "Fit" re-centres the room.
- The inspector shows the selected item's position and rotation and has Rotate 90°, Duplicate and Delete.

### Library and My stuff
The **Furniture** tab lists 25 parametric presets (beds, sofas, desks, dressers, rugs, lamps, plants, TV...) with their real
sizes; click one to place it. **My stuff** holds your own items: create one from a photo (see below) or without a photo,
then place, edit, rename or delete it. Deleting an item from My stuff also removes it from every room.

![Item creator](docs/screenshots/item-creator.png)

### Clearance checking
Items carry clearance zones (walkway beside a bed, drawer pull-out, chair push-back...) and doors have swing areas. The
**Fit check** in the inspector lists every problem: overlapping items, items crossing a wall, blocked clearances and blocked
door swings. Problem items are drawn red in both 2D and 3D, with the blocked zone in red; hover or select one to see why.
The clearances toggle (🟧, key C) hides only the neutral zones; real problems always stay visible.

### 3D view, walk mode, cutaway
The 3D view is a cartoon-style render of every room of the house (the active layout of each). It opens in **Overview**
mode: left-drag orbits, right-drag or Shift + drag pans, the wheel zooms, **Top view** looks straight down, and clicking an
item selects it. Double-click the floor to start walking right there. **Cutaway** (✂️) hides the walls between the camera
and the room.

**Walk mode** (🚶): click the view to capture the mouse and look around (drag to look if mouse capture is unavailable);
WASD or the arrow keys move, Shift sprints, Space jumps. You collide with walls and furniture and can walk through
doorways from room to room. The first Esc releases the mouse; a second Esc (or O) returns to Overview.

![The whole house in 3D](docs/screenshots/house-3d.png)

![Walk mode](docs/screenshots/walk.png)

![3D view](docs/screenshots/view3d.png)

**Split** shows the plan and 3D side by side; both edit the same layout.

![Split view](docs/screenshots/split.png)

### Layouts and compare
Each room can have several layouts (the bar above the plan): add, duplicate, rename, delete and switch between them.
**Compare** shows two layouts side by side, in 2D or 3D, with the right-hand one read-only.

![Compare view](docs/screenshots/compare.png)

### Undo, shortcuts, autosave
- Undo/redo covers every change to the project (up to 100 steps; a drag counts as one step).
- Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo, Delete/Backspace delete, Ctrl/Cmd+D duplicate,
  R / Shift+R rotate 15°, arrow keys nudge 1 cm (Shift: 10 cm), V select tool, G grid, S snapping, C clearances,
  1-4 Plan/3D/Split/Compare, Esc deselect, ? help (the help overlay lists all keys and mouse gestures).
- The project is autosaved to the browser's IndexedDB about half a second after each change and reloaded on the next visit.
  Clearing the site data deletes it, so export anything you want to keep.

### Export and import
- **File → Export project** saves a single `.roomplan` file (a zip of `project.json` plus your photos and floor-plan
  image). **Import project** opens one and replaces the current project.
- **File → Export 2D PNG** renders the plan (room plus every item, even ones outside the room; no grid, underlay or
  selection handles). **Export 3D PNG** saves the current 3D camera view.

## How photo → model works

Everything runs in the browser on the CPU (WebAssembly). Each stage has a fallback, so a failure never blocks you.

| # | Stage | How | Fallback |
|---|---|---|---|
| 1 | Background removal | U-2-Netp (`BritishWerewolf/U-2-Netp`, Apache-2.0, fp32, ~4.6 MB) via transformers.js 4.3.2 | colour-based flood fill from the photo border; else the whole photo |
| 2 | Colour palette | k-means (k = 5) in CIELAB over the cut-out pixels | none needed (plain JS) |
| 3 | Category | zero-shot CLIP (`Xenova/clip-vit-base-patch32`, MIT, 8-bit quantized `q8`) over 14 category prompts, re-weighted by the dimensions you entered | a guess from the entered width/depth/height; else you pick |
| 4 | Material | rules on colour and texture statistics (warm brown → wood, grey/silver or shiny → metal, dark and shiny → leather, bright saturated and uniform → plastic, otherwise fabric) | fabric |
| 5 | Part colours | per-category rules: dominant colour → body, lighter colour of the same hue → cushions, darkest / wood-like → frame, most saturated leftover → accent | default colours |

- The models are downloaded once from the Hugging Face hub the first time you analyse a photo (about 160 MB in total; the
  CLIP files are about 150 MB) and are then kept in the browser's Cache API. The item creator shows the download progress
  in % and MB. A slow download is fine: it only gives up after 30 s without any progress (or 10 minutes overall). If
  the network is blocked it falls back straight away.
- **Skip — I'll pick the type myself** (shown during analysis) goes straight to the editing step with the fallbacks;
  the download carries on in the background for next time.
- After the first successful download, analysis also works offline in the production build (the ONNX Runtime WASM files
  are served by the app itself and precached by the service worker).
- The result is a **parametric cartoon model** of the chosen category, built at exactly the dimensions you entered and
  coloured from the photo. You can change the category, style options, each part's colour and the material before saving.
  It is not a 3D scan of your furniture.

## Project structure

| Directory | Contents |
|---|---|
| `src/types.ts` | shared types and conventions (cm, plan coordinates, rotation) |
| `src/core/` | pure geometry, units, snapping, collision and clearance checks |
| `src/store/` | Zustand store, undo/redo, IndexedDB autosave and blob store, `.roomplan` import/export, demo room |
| `src/editor2d/` | SVG plan editor and 2D PNG export |
| `src/floorplan/` | floor-plan underlay, calibration, wall-ink snapping, room auto-detection, the docked tracing panel |
| `src/models/` | parametric furniture generators, presets, toon rendering |
| `src/photo/` | photo pipeline and the item creator dialog |
| `src/view3d/` | react-three-fiber scene: room, items, orbit and walk cameras, cutaway, overlays, 3D PNG export |
| `src/app/` | app shell: toolbar, library, inspector, layouts bar, dialogs, shortcuts |
| `e2e/` | Playwright tests (and the screenshot generator) |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data flow and module boundaries.

## Known limitations

- One polygon per room: no interior walls, columns, stairs or multiple floors in a room. Openings are placed on the room's
  own walls only.
- Auto-detect rooms is approximate: it proposes every enclosed room-sized area of the image, which works on clean plans
  but can miss rooms or add false ones on textured plans with furniture and text drawn in. Check each proposal.
- Snapping to the plan's walls needs dark (black or dark grey) wall lines; pale walls are not recognised.
- The listed-area figure, the tracing step and auto-detect proposals are remembered only until the page is reloaded
  (the rooms and the plan image are saved as usual). Matching a listed area does not move doors already placed.
- The first photo analysis needs a one-time download of about 160 MB, and recognition runs on the CPU, so it can take a
  while on slow machines.
- Category and material guesses are heuristics and can be wrong; both are always editable before saving.
- Offline use requires the production build (`npm run build && npm run preview`, or a deployed build) and one online visit
  first; the dev server does not work offline. Photo recognition offline also needs one earlier successful analysis.
- Data lives only in this browser: no accounts, no sync between devices; use export/import to move a project.
- No AR, LiDAR import or photo-to-mesh; photo items are parametric approximations.
- Items are boxes for collision and clearance purposes (their footprint rectangle), and heights are not considered when
  checking overlaps (e.g. a chair under a table counts as overlapping). Rugs are the only items that may be overlapped.
- Performance has only been checked on the development machine.
- Below about 700 px wide the side panels move below the view and the page scrolls; there is no dedicated touch UI.
