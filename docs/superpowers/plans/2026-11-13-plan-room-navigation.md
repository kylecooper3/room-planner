# Floor plan → room drill-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the open floor plan into a plan level (rooms) and a room level (one room's furniture and layouts), with a back button and a full breadcrumb.

**Architecture:** One UI-only flag `ui.roomOpen` in the Zustand store decides the level. Toolbar, LibraryPanel, LayoutsBar, ToolRail, PlanEditor and View3D read it to show only that level's controls and to route canvas clicks. No project data or file format changes.

**Tech Stack:** React + TS strict, Zustand, SVG 2D editor, r3f 3D, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-plan-room-navigation-design.md`

## Global Constraints
- No change to `Project`, `.roomplan` files or IndexedDB keys; `ui.roomOpen` is never saved and never enters undo history.
- Opening a floor plan always lands on plan level.
- Back from room level → plan level; back from plan level → home (`closeFloorPlan`).
- Breadcrumb: `Floor plans › <plan> › <room>`; every crumb clickable; plan and room names renameable from it.
- Reuse the design-system classes in the comment block at the top of `src/app/styles.css` (32px rows, `.btn.ghost.icon`, etc.). No new dependencies.
- Files are CRLF; keep them so. No Co-Authored-By trailers. Do not commit — the user commits when they say so.

## Review Focus
- Deleting the room you are inside (sidebar not reachable then, but undo can remove it): must drop to plan level, not show an empty room level. → test in Task 1.
- Undo/redo that removes or re-adds the open room: same rule as above. → test in Task 1.
- Importing a `.roomplan` or switching plans while at room level: lands on plan level. → test in Task 1.
- A plan with zero rooms: plan level shows the empty state and "Add a room"; nothing to enter. → covered in Task 5 e2e.
- Finishing drawing/tracing a new room at plan level: stays at plan level with the new room in the list (does not jump in). → test in Task 1 (`addRoom` leaves `roomOpen` alone) and Task 5.

---

### Task 1: Level state in the store

**Files:**
- Modify: `src/types.ts` (`UIState`, `Actions`), `src/store/store.ts` (`defaultUI`, actions, `deleteRoom`, `replaceProject`/`reset`, undo/redo)
- Test: `src/store/store.test.ts` (or the existing store test file)

**Interfaces — Produces:**
- `UIState.roomOpen: boolean` (default `false`)
- `Actions.enterRoom(roomId: string): void` — sets `project.activeRoomId` (no undo step, like `setActiveRoom`), `ui.roomOpen = true`, clears selection, tool → `'select'`.
- `Actions.leaveRoom(): void` — `ui.roomOpen = false`, clears selection, tool → `'select'`.
- Invariant: whenever the active room stops existing (delete, undo, redo, replaceProject/newProject/loadDemo), `roomOpen` becomes `false`.

- [ ] Write failing tests: `enterRoom` sets activeRoomId + roomOpen; `leaveRoom` clears it; `deleteRoom(open room)` → roomOpen false; undo of the addRoom that created the open room → roomOpen false; `replaceProject` → roomOpen false; `addRoom` leaves roomOpen unchanged; `enterRoom` adds no undo step (`canUndo` unchanged).
- [ ] Run `npx.cmd vitest run src/store` — expect FAIL.
- [ ] Implement. Also make sure `openFloorPlan`/`loadIntoEditor` in `src/store/floorPlans.ts` end at roomOpen false (they go through replace/reset — verify).
- [ ] Run tests — PASS; `npx.cmd tsc --noEmit` clean.

### Task 2: Top bar — back button and full breadcrumb

**Files:** Modify `src/app/Toolbar.tsx` (`Breadcrumb`), `src/app/styles.css`.

**Consumes:** `ui.roomOpen`, `enterRoom`, `leaveRoom`, `useActiveRoom()` from `src/store/selectors`.

- [ ] Add a `‹` back button (`data-testid="nav-back"`, `ChevronLeft`, title "Back to <parent name>") before the crumbs: room level → `leaveRoom()`, plan level → `closeFloorPlan`.
- [ ] Crumbs: `Floor plans` (existing `nav-home`) › plan name (`plan-name`; at room level a click goes to plan level, rename moves to a pencil or double-click) › room name (`room-crumb`, room level only; double-click or pencil renames via `RenameInput` + `updateRoom`).
- [ ] Verify by e2e in Task 5.

### Task 3: Sidebar, layout tabs and tools per level

**Files:** Modify `src/app/LibraryPanel.tsx`, `src/app/App.tsx` (LayoutsBar mount), `src/app/ToolRail.tsx`, `src/app/Inspector.tsx` if it shows item/layout info at plan level, `src/app/HelpOverlay.tsx` (text).

- [ ] Plan level: `LibraryPanel` renders only `RoomsSection` (taller list; each row click → `enterRoom(r.id)`; empty state "No rooms yet — add one to start."). Room level: only the Furniture / My stuff tabs and their content.
- [ ] `LayoutsBar` renders only at room level.
- [ ] ToolRail: draw-room / trace / calibrate tools only at plan level; tools that act on furniture only at room level. Leaving a level resets the tool (Task 1 already does).
- [ ] Help text: describe the two levels and the back button.

### Task 4: Canvas behaviour per level

**Files:** Modify `src/editor2d/PlanEditor.tsx` (`onPointerDown`, rendering of items / other rooms), `src/view3d/View3D.tsx` (~line 183 room click), `src/view3d/RoomShell.tsx` only if needed for dimming.

- [ ] Plan level: every room is drawn normally with its furniture, furniture is not hit-testable (`pointer-events: none`), walls/corners/openings of the active room stay editable as today, and a click on any room's floor (point-in-polygon on `room.points`, or the `data-other-room` element) calls `enterRoom(id)`. Empty-space click deselects and pans as today.
- [ ] Room level: other rooms render greyed (lower opacity) and are not clickable (remove the `data-other-room` → `setActiveRoom` branch at this level). Active room behaves exactly as today.
- [ ] 3D: plan level click on a room → `enterRoom`; room level clicks on other rooms do nothing.
- [ ] Unit test for any new pure helper (e.g. `roomAt(rooms, p): Room | undefined`) in `src/editor2d/*.test.ts`.

### Task 5: End-to-end tests and docs

**Files:** Modify `e2e/fixtures.ts`, `e2e/editing.spec.ts`, `e2e/floorplan.spec.ts`, `e2e/layouts-persistence.spec.ts`, `e2e/library.spec.ts`, `e2e/tracing.spec.ts`, any other spec that breaks, `e2e-desktop/smoke.mjs`; Create `e2e/navigation.spec.ts`; Modify `README.md`, `ARCHITECTURE.md`.

- [ ] Add fixture `enterRoom(page, name?)` (clicks the room row) and have existing helpers that need furniture (e.g. `loadDemo`) call it, so old specs keep their meaning. Update specs that use `room-row` / `new-room` at room level.
- [ ] New `e2e/navigation.spec.ts`: open demo → plan level shows `rooms-list`, no `tab-furniture`, no `layout-tab`; click a room row → `room-crumb` shows its name, `tab-furniture` and `layout-tab` visible, `rooms-list` gone; `nav-back` → plan level; `nav-back` again → home (`home` testid); empty plan shows empty-state text; drawing a new room at plan level keeps plan level and adds a row.
- [ ] Run `npx.cmd vitest run`, `npx.cmd tsc --noEmit`, `npx.cmd playwright test --workers=2` — all pass (rerun load-flaky 3D/photo/walk specs alone before calling them broken).
- [ ] Update README/ARCHITECTURE wording for the two levels; refresh screenshots only if the existing screenshot script does it automatically.
