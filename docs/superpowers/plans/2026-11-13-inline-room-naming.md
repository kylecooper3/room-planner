# Inline room naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the staged naming panel with a name popover on the canvas and continuous tracing with one Done button.

**Architecture:** A `namingRoomId: string | null` UI field (store `ui`, not saved, not in undo) set when draw-room closes an outline; a `RoomNamePopover` component rendered over the plan (HTML overlay positioned from the room's centroid via the plan view transform); DrawHud gets the Done button; TracePanel's `NameRoom` and `useTrace.namingId` usage removed.

**Tech Stack:** React + TS strict, Zustand, SVG, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-inline-room-naming-design.md`

## Global Constraints
- Suggestions, in order: Bedroom, Bathroom, Kitchen, Living room, Dining room, Closet, Hallway, Laundry, Balcony. Names are made unique with the existing `uniqueName` (move it to a shared module if needed).
- Copy: popover title "Name this room"; HUD text "Click the first corner of the next room"; button "Done".
- Accessible combobox: input `role="combobox"`, `aria-expanded`, `aria-controls` the `role="listbox"`, options `role="option"` with `aria-selected`.
- Windows: npm.cmd/npx.cmd; keep each file's existing line endings; no new deps; do not commit. Uncommitted earlier work in the tree stays intact.

## Review Focus
- Rename from the room lists while the popover is open → blocked (no double naming). → e2e Task 2.
- Clicking the canvas to start the next room while the popover is open → popover closes, default name kept, the click places the first corner. → e2e Task 2.
- Ctrl+Z right after closing a room (popover open) → room removed, popover closes. → e2e Task 2.
- Leaving plan level / switching view / deleting the room while popover open → popover closes, no crash. → unit test Task 1 (namingRoomId cleared when the room disappears or roomOpen changes).
- Typing a name that already exists ("Kitchen" twice) → saved as "Kitchen 2". → e2e Task 2.

---

### Task 1: Store + popover component

**Files:** Modify `src/types.ts`, `src/store/store.ts`, `src/store/store.test.ts`; Create `src/editor2d/RoomNamePopover.tsx`; Modify `src/editor2d/PlanEditor.tsx` (set `namingRoomId` when an outline closes; render popover), `src/app/styles.css` (popover uses `.app-float`/menu styles).

**Interfaces — Produces:** `UIState.namingRoomId: string | null` (default null; cleared by the same invariant that drops `roomOpen` when a room disappears, and by `leaveRoom`/`enterRoom`/tool change away from draw-room is NOT required — Done clears it). `Actions.setUI({ namingRoomId })` is enough; no new action unless needed.

- [ ] Unit tests: namingRoomId cleared when that room is deleted/undone or project replaced.
- [ ] Popover: focused input, filtered suggestions, ↑/↓/Enter/Escape, click suggestion; saves via `updateRoom(id, { name: uniqueName(...) })`; testids `room-name-popover`, `room-name-input`, `room-name-option`.
- [ ] `npx.cmd vitest run`, `npx.cmd tsc --noEmit` pass.

### Task 2: Continuous tracing, Done in the HUD, panel cleanup, lock renames

**Files:** Modify `src/editor2d/DrawAids.tsx` (DrawHud Done button `draw-done`, next-room text), `src/editor2d/PlanEditor.tsx` (stay in draw-room after closing; first canvas click with popover open closes it and starts next room; Escape with no points = Done), `src/floorplan/TracePanel.tsx` (remove NameRoom/staging/next-done pair; one "Trace rooms" button; disable rename while naming), `src/app/LibraryPanel.tsx` (disable rename while naming), `src/floorplan/traceSession.ts` (drop namingId if unused); Tests `e2e/floorplan.spec.ts`, `e2e/tracing.spec.ts`, `e2e/navigation.spec.ts` and any spec using `floorplan-keep`/`floorplan-type`/`floorplan-trace-next`/`floorplan-done-tracing`.

- [ ] e2e: trace room → popover focused → type "Kit" → Enter → "Kitchen"; trace again → type "Kitchen" → "Kitchen 2"; click canvas while popover open → default name kept and a corner placed; Ctrl+Z with popover open → room gone; rename buttons disabled while open; `draw-done` ends tracing.
- [ ] Full: `npx.cmd vitest run`, `npx.cmd tsc --noEmit`, `npx.cmd playwright test --workers=2` (rerun load-flaky 3D/photo/walk specs alone).
