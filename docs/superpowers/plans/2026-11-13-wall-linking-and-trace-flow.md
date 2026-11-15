# Wall linking and trace flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corners lock onto neighbouring walls (shared wall, no overlap) and tracing becomes trace → confirm → name.

**Architecture:** `snapPoint` in `src/editor2d/drawSnap.ts` gets other rooms' outer-face outlines (via the existing `wallOutline` used in `PlanEditor.tsx`) and wall thicknesses; the trace naming UI in `src/floorplan/TracePanel.tsx` becomes a small state machine (confirm → type → next) on the existing `useTrace.namingId`.

**Tech Stack:** React + TS strict, Zustand, SVG, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-wall-linking-and-trace-flow-design.md`

## Global Constraints
- Room types, in order: Bedroom, Bathroom, Kitchen, Living room, Dining room, Closet, Hallway, Laundry, Balcony, Other.
- Button copy: "Keep this room", "Redo", "Trace next room", "Done tracing", "Save".
- Alt/Shift held or snapping toggled off: no snapping (unchanged).
- Windows: use npm.cmd/npx.cmd; files are CRLF, keep them so; no new deps; do not commit.

## Review Focus
- Corner clicked inside the neighbour's wall band near its outer face vs. near its inner line: both land on the outer face. → unit test in Task 1.
- Right-angle lock + wall band: lands at the intersection, stays exactly horizontal/vertical. → unit test in Task 1.
- Wall band beats ink when both are within range. → unit test in Task 1.
- Redo must leave no room behind and undo history must not contain a half-room (one undo step for add+delete is fine, or no step). → e2e in Task 2.
- Closing the panel or pressing Esc while at Confirm keeps the room (it was already created) and clears the naming state. → e2e in Task 2.

---

### Task 1: Snap to neighbours' outer faces

**Files:** Modify `src/editor2d/drawSnap.ts`, `src/editor2d/PlanEditor.tsx` (where `rooms:` is passed to `snapPoint` for drawing and corner drags); Test `src/editor2d/drawSnap.test.ts`.

**Interfaces:** `SnapInput.rooms` becomes `{ inner: Vec2[]; outer: Vec2[] }[]` (outer = `wallOutline(points, wallThickness)`'s outer ring; reuse that helper — move it to `src/core/geometry.ts` if it lives in PlanEditor). New `SnapKind` value not needed: use `'wall'`.

- [ ] Tests: (a) drawing (prev set, no lock) with raw inside a neighbour's wall band → p on outer face, kind 'wall'; (b) prev set with horizontal lock, raw in band → p.y === prev.y and p on outer face; (c) ink candidate closer than band edge but raw inside band → wall wins; (d) outer-face corner attracts like a corner; (e) free → raw unchanged. Run, see fail.
- [ ] Implement: candidate when raw is within the band (distance to inner polygon edge ≤ thickness + t on the outside, or within t of the outer face) → projection on outer face; with lock, intersect the lock line with the nearest outer-face segment instead. Outer corners join corner candidates. Band/outer-face candidate wins over ink-only candidates.
- [ ] Update PlanEditor callers. `npx.cmd vitest run src/editor2d` PASS, `npx.cmd tsc --noEmit` clean.

### Task 2: Trace → confirm → name

**Files:** Modify `src/floorplan/TracePanel.tsx` (`NameRoom` → staged component), `src/floorplan/traceSession.ts` if a stage field is needed, `src/floorplan/fp-floorplan.css`, `src/editor2d/PlanEditor.tsx` (highlight the room being confirmed if not already active-highlighted); Tests `e2e/tracing.spec.ts`, `e2e/floorplan.spec.ts`.

- [ ] Stage 'confirm': lead "Room traced (<area>)." + Keep this room (primary, `floorplan-keep`) / Redo (`floorplan-redo`: deletes the room, clears namingId, restarts draw-room tool).
- [ ] Stage 'type': "What is this room?" + one list of type buttons (`floorplan-type`, data-type) in the order above; click → `updateRoom(name: uniqueName(type))` → stage 'next'. Other → text field (`floorplan-room-name`) + Save.
- [ ] Stage 'next': Trace next room (`floorplan-trace-next`) / Done tracing (`floorplan-done-tracing`).
- [ ] Update existing e2e that used `floorplan-name-chip`; add e2e: trace → Redo → no room; trace → Keep → Bedroom twice → "Bedroom" and "Bedroom 2"; Other → custom name.
- [ ] Full checks: `npx.cmd vitest run`, `npx.cmd tsc --noEmit`, `npx.cmd playwright test --workers=2` (rerun load-flaky 3D/photo/walk specs alone).
