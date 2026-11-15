# Easier, visible wall attaching; drawn walls stand out over the plan image

## Why
Attaching a new room's wall to an existing one still feels clunky: walls attract only within the same 10 screen-px as every other snap, and the only feedback is a tiny marker. While tracing, the user's own walls are faded (other rooms at 45% opacity at plan level) and the same near-black as the image's walls, so they can't tell drawn walls from the picture.

## Design
1. **Stronger wall magnet.** In `snapPoint` (src/editor2d/drawSnap.ts), wall-band / outer-face linking uses `WALL_SNAP_PX = 25` screen px (other snaps stay at `SNAP_PX = 10`). A wall hit within its radius beats alignment and ink (as today) and also beats an outer corner unless the corner is within SNAP_PX. Alt / Shift / snapping off: unchanged (free).
2. **Attached feedback while drawing (and corner drags).** `SnapHit` reports which neighbour wall it linked to (room id + wall index). The editor highlights that neighbour wall segment in green (`THEME`'s existing OK green) and shows a small "Attached" tag next to the cursor. The segment of the in-progress outline (and the live segment) that lies along a neighbour's outer face is drawn green.
3. **Near-miss marks.** At plan level, where a room's wall runs parallel to a neighbour's wall face within 2–40 cm (a gap) or overlaps into it (an overlap) without coinciding (tolerance 0.5 cm), that stretch is marked orange (the existing issue/warning colour), testid `plan-wall-gap`. Pure helper in core geometry with unit tests. Dragging a corner onto the face (now easy, see 1) removes the mark.
4. **Contrast over the image.** When `project.underlay` exists and is visible, at plan level: every room is drawn at full opacity (no 0.45 fade), walls use `THEME.accent` instead of `planWall`, floors are a light accent tint at ~0.25 opacity so the image shows through. With no visible image: unchanged. Room level: other rooms stay greyed as now.

## Non-goals
Shared-wall data model; auto-fixing existing near-misses; changing 3D.
