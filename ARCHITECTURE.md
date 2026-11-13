# Room Planner — Architecture

Browser-only app (no backend, no keys, no accounts). Vite + React 19 + TypeScript strict, Zustand, react-three-fiber + drei,
SVG 2D editor, Vitest, Playwright. `src/types.ts` is the contract: all shared types, conventions and helper signatures live there.

## Conventions (authoritative copy is the header of `src/types.ts`)
- Lengths are **cm** everywhere in state. Units (ft/in vs metric) are a display concern (`core/units.ts`).
- **Plan space**: x right, y down (SVG). Rotation in degrees, clockwise on screen.
- **Item local frame**: origin at centre, +x = width, +y = front. **3D**: metres, worldX = planX/100, worldZ = planY/100,
  `rotation.y = -deg·π/180`.
- A room is one closed polygon; wall *i* = `points[i] → points[i+1]`. Openings reference a wall index + centre offset.

## Module map and ownership
| Dir | Owner | Responsibility | May import |
|---|---|---|---|
| `src/types.ts`, `src/main.tsx`, `src/editor2d/planContext.ts`, config, `scripts/` | orchestrator | contract + scaffold | — |
| `src/core/` | agent 1 | pure geometry, units, snapping, collision/clearance (`findIssues`) | types |
| `src/store/` | agent 2 | Zustand store, undo/redo, selectors/hooks, blob store, IndexedDB autosave, `.roomplan` import/export, demo room | types, core, models/presets |
| `src/editor2d/` | agent 3 | SVG plan editor: items, walls, openings, corner editing, draw-room tool, guides, dimensions, PNG export | types, core, store, floorplan layers |
| `src/floorplan/` | agent 4 | underlay layer, calibration tool, wall-ink snapping mask, docked tracing panel | types, core, store, editor2d/planContext |
| `src/models/` | agent 5 | parametric generators, style schema, presets, PBR materials + procedural textures (`materials.tsx`), `ItemModelView` | types |
| `src/photo/` | agent 6 | photo pipeline (segmentation, palette, classification, material, part mapping), `ItemCreator` UI | types, core/units, store, models |
| `src/view3d/` | agent 7 | r3f scene: room shell, items, lighting, orbit + walk, cutaway, selection, clearance overlays, PNG export | types, core, store, models |
| `src/app/` | agent 8 | app shell: toolbar, library panel, inspector, layouts bar, room-setup dialog, shortcuts, help, compare/split layout | everything |

Rule: a module only edits files in its own directory. Cross-module calls go through the exports already present in the stub files.

## State shape (single source of truth)
`useStore` (`src/store/store.ts`) holds `AppState = { project, ui, canUndo, canRedo, hydrated } & Actions`.

```
Project { units, rooms[], activeRoomId, library[] (My stuff: shared list `room-planner/my-stuff` merged in on open, see store/floorPlans.ts), underlay }
  Room { points[], ceilingHeight, wallThickness, openings[], wallColor, floor, layouts[], activeLayoutId }
    Layout { name, items: PlacedItem[] }       PlacedItem { defId, x, y, rotation }
ItemDef { name, size{w,d,h}, model: ItemModel, clearances[], source, photoId? }   // presets live in code, user defs in project.library
UIState { view, tool, selection, toggles, dialog, ... }                            // never in undo history, never persisted
```
- Project state is immutable; every mutating action produces a new `project` and pushes one undo snapshot
  (`beginBatch/endBatch` collapse a drag into one step). History is capped (100).
- Binary data (photos, floor-plan image) is **not** in the project JSON; it lives in the blob store (IndexedDB) and is
  referenced by id (`ItemDef.photoId`, `Underlay.imageId`).

## Data flow
```
user input ──> action (store) ──> new project ──┬─> PlanEditor (SVG)     pure renderers of
                                                ├─> View3D (r3f)         (project, ui)
                                                ├─> useIssues() = findIssues(room, layout, getDef)  → red highlights in both views
                                                └─> persistence (debounced autosave to IndexedDB)
```
2D and 3D never talk to each other; selection (`ui.selection`) and layout are shared via the store. Compare view mounts two
renderers with different `layoutId` props (`readOnly` on the right-hand one).

Derived geometry is never stored: footprints, clearance polygons, door swings and issues are recomputed from state by `core/`.

### 2D editor extension points
`PlanEditor` provides `PlanViewContext` (`toPlan`, `pxPerCm`) and renders, inside its plan-space `<g>`:
`<UnderlayLayer/>` (bottom), its own layers, and `<CalibrateTool/>` (top, only when `ui.tool === 'calibrate'`).
Tracing a floor plan = the editor's own `draw-room` tool used over the underlay (one polygon tool, not two).

## Parametric model interface
```
ItemModel = ParametricModel { category, style, colors, material } | MeshModel { meshId }   // MeshModel = future photo-to-mesh
generateModel(model, size) -> ModelPart[]      // pure data: primitives with role/shape/size/position (cm)
<ItemModelView model size highlight/>          // r3f renderer of ModelPart[] with PBR materials; outline only when selected/error
STYLE_SCHEMA[category] -> StyleParamDef[]      // drives the editor UI generically
```
- Invariant: the union AABB of the parts is exactly `[-w/2,w/2]×[0,h]×[-d/2,d/2]` — models always match entered dimensions.
- Presets are just `ItemDef`s using the same generators. To add true photo-to-mesh later: produce a GLB, store it as a blob,
  save an `ItemDef` with `model: { kind: 'mesh', meshId }`, and teach `ItemModelView` to load it. Nothing else changes.

Required preset ids (the demo room and tests rely on them): `preset-bed-twin`, `preset-bed-full`, `preset-bed-queen`,
`preset-bed-king`, `preset-sofa-3seat`, `preset-loveseat`, `preset-armchair`, `preset-desk`, `preset-office-chair`,
`preset-dresser`, `preset-nightstand`, `preset-bookshelf`, `preset-tv-stand`, `preset-dining-table`, `preset-dining-chair`,
`preset-coffee-table`, `preset-side-table`, `preset-rug-small`, `preset-rug-large`, `preset-floor-lamp`, `preset-table-lamp`,
`preset-plant-floor`, `preset-plant-small`, `preset-wardrobe`, `preset-tv`.

## Photo pipeline (`analyzePhoto(photo, size, onProgress) -> PhotoAnalysis`)
All stages run in the browser; each has a fallback and reports `ok | fallback | skipped`. The pipeline never rejects on ML failure.

| # | Stage | Primary (pinned) | Fallback | Last resort |
|---|---|---|---|---|
| 1 | Background removal | `@huggingface/transformers@4.3.2`, model `BritishWerewolf/U-2-Netp` (Apache-2.0, ~5 MB, WASM/CPU) | classical: flood-fill from image border on colour similarity | no mask: whole photo |
| 2 | Palette | k-means (k≈5, k-means++ init) in CIELAB over masked pixels, downsampled | — (pure JS, cannot fail) | — |
| 3 | Category | zero-shot CLIP `Xenova/clip-vit-base-patch32` (MIT, quantized) over the 14 category prompts | heuristic from entered W×D×H proportions | empty suggestions → manual pick |
| 4 | Material | colour/texture statistics (saturation, lightness variance, edge energy, specular highlights) | — | `fabric` |
| 5 | Part mapping | rules per category: dominant → body, 2nd → cushion, darkest/wood-like → frame, most saturated minor → accent | — | default colours |

- Models download once from the Hugging Face hub and are cached by transformers.js in the Cache API; the ONNX Runtime WASM
  binaries are copied to `public/ort` at install (`scripts/copy-ort.mjs`) and precached by the service worker, so the whole
  pipeline works offline after first use. ML code is lazy-loaded (dynamic import) so it never slows app start.
- Output feeds the `ItemCreator` editing step: photo beside a live `ItemModelView` preview; user adjusts category, style
  params (from `STYLE_SCHEMA`), per-part colours (picker offering the extracted palette), material; saves with `saveDef`.

## Clearance checking
`findIssues` returns `Issue[]` (`overlap`, `outside-room`, `clearance-blocked`, `door-swing-blocked`), each with the item ids to
paint red and a one-line message. Both views read `useIssues()`; overlays are gated by `ui.showClearances`.

## Persistence and offline
- Autosave: project JSON + blobs in IndexedDB via `idb-keyval` (debounced). No localStorage.
- Export/import: one `.roomplan` file (zip via `fflate`): `project.json` + `blobs/<id>`.
- Offline: `vite-plugin-pwa` precaches the built app shell. Offline is a property of the production build
  (`npm run build && npm run preview`), not of the dev server.

## Future-friendly seams
Accounts/cloud sync → swap `store/floorPlans.ts` (floor-plan library + autosave; `persistence.ts` re-exports it). Photo-to-mesh → `MeshModel`. LiDAR/AR import → produce `Room.points`.
AI layout suggestions → pure function `(room, defs) -> PlacedItem[]` feeding `addLayout`.
