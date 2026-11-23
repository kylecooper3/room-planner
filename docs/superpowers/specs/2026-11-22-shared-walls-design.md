# Shared walls (derived from where rooms touch)

## Why
Rooms that share a wall are still clunky: each click along a neighbour's wall becomes a corner, the two rooms draw two overlapping walls, and moving one leaves the other behind. The app has no notion of a shared wall.

## Model (no data change)
Rooms stay polygons (inner outline) with walls extruded OUTWARD by `wallThickness`. A **shared stretch** is derived: an edge of room B that lies on room A's wall outer face (parallel within ~1°, within WALL_COINCIDE_TOL = 0.5 cm), over their overlapping interval along the wall. The room that comes first in `project.rooms` (drawn first) owns the stretch. Pure helper `sharedStretches(rooms)` in src/core/geometry.ts (next to `wallNearMisses`, reusing its parallel/face logic) returning `{ owner: {room, wall}, other: {room, wall}, from: number, to: number }` (interval along the owner wall), with unit tests.

## Behaviour
1. **Drawing along a neighbour.** In the draw tool, when the new point is wall-linked to the same neighbour wall (`SnapHit.link` room+wall) as the previous point AND the point before that, the previous point is replaced instead of adding a corner (the outline extends one straight wall). The preview shows that stretch as one segment. `mergeCollinear` at close stays as a safety net.
2. **Display.** In 2D (PlanEditor renderWalls), the non-owner room's wall band is not drawn over a shared stretch (split its wall polygon around the interval), so the shared wall shows once, at the owner's thickness. Applies at plan level and room level (at room level the other room is greyed anyway; the open room's shared stretch is drawn by the owner's band in the open room's colour if the open room is the non-owner — simplest acceptable: draw the owner band in the active style). 3D: optional — only if trivial; doors already cut both rooms' walls.
3. **Inspector.** A selected wall that has a shared stretch shows "Shared with <room name>" in the wall panel.
4. **Dragging a shared wall moves both.** The wall drag (gesture 'wall' in PlanEditor using `slideWall`) also slides every coincident edge of other rooms that shares a stretch with the dragged wall by the same distance along the normal (their edge's own normal is opposite, so slide by -d in their frame), in the same batch → one undo step. Snapping of the dragged wall onto third rooms still works.
5. **Openings on a shared wall.** An opening placed on a shared stretch is added to the owner's wall (place-opening tool prefers the owner wall when the hit is on a shared stretch) and is drawn over both rooms; the non-owner's 2D band is already absent there. No duplicate openings.

## Non-goals
A wall-graph data model; changing saved files; shared corners being draggable as one (corner drag stays per room); fixing rooms whose edges are off by more than the tolerance (the orange near-miss + Join walls covers those).
