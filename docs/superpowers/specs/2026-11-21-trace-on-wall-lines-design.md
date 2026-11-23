# Tracing: click on the wall line, room fits itself

## Why
Over a plan image, corners snap to the nearest ink/paper edge (inside OR outside edge of the black wall line). The clicked point becomes the room's inner outline and walls extrude outward at a fixed 12 cm, so a click near the outer edge draws the wall entirely outside the picture's wall. Inconsistent, and the user can't tell where to click.

## Design
1. **Snap to the middle of the wall line while drawing.** `InkSnap` gains band awareness: when the cursor is on a black band or within the snap radius of one (per axis, as today), the coordinate snaps to the band's centre line (midpoint of its two ink/paper edges), not to an edge. Bands wider than ~60 cm (real-world, via cmPerPx) are not walls (filled areas) — ignore them. Draw hint text (count 0 and next corners): "Click on the plan's wall lines at each corner".
2. **Fit on close.** When an outline closes with a visible plan image (draw-room `finishDraw`), for each wall of the new polygon measure the ink band it sits on (sample several points along the wall, perpendicular scan both ways) to get the band's inner edge (toward the polygon interior; orientation from signed area) and width. Move each wall line to its band's inner edge (intersect adjacent moved lines for corners, like an offset); set the room's `wallThickness` to the median band width (rounded to 0.5 cm, clamped 5–60 cm). Walls with no band found stay where they are; if fewer than half the walls find a band, don't fit at all. One undo step with the room creation (add the room with the fitted points/thickness directly).
3. **Priority unchanged otherwise.** Linking onto an existing room's wall (wall band → outer face) beats ink, during drawing; a wall that was linked to a neighbour while drawing is NOT moved by the fit (keep shared walls exact). Alt/Shift/snap-off: free, and no fit for points placed free? — keep simple: fit still runs on close; Alt only affects snapping.
4. Pure helpers with unit tests: band-centre lookup on an `InkMask`, and `fitToInk(points, bandAt)` (offset + thickness) on synthetic masks.

## Non-goals
Per-wall thickness; fitting rooms drawn earlier; changing snapping without an image.
