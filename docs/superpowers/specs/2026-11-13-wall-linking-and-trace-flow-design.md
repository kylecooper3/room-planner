# Wall linking and trace → confirm → name

## Why
Rooms drawn next to each other overlap or leave slivers: once a room has a first corner, other rooms' walls no longer attract the cursor, and walls are drawn outward from the clicked outline, so a corner "on" a neighbour's wall lands a bit inside or short of it. Tracing also shows chips, a text field and two buttons at once right after closing an outline, which the user found confusing.

## Goals
1. **Wall linking.** A click anywhere across another room's wall band (between its inner line and its outer face, plus the normal SNAP_PX tolerance) snaps to that wall's **outer face**, so the new room's outward wall coincides with the existing one: one shared wall, no gap, no double wall. Applies to every corner while drawing (not only the first), and to corner drags. With the right-angle lock active, the snapped point is where the locked line crosses that outer face. Outer-face corners attract like corners do. A wall/outer-face hit beats plan-ink snapping. Alt / snapping off still places freely.
2. **Trace flow.** After an outline closes during tracing: (a) **Confirm** — the new outline highlighted with its area, buttons **Keep this room** / **Redo** (Redo deletes it and restarts drawing); (b) **What is it?** — one list of room types: Bedroom, Bathroom, Kitchen, Living room, Dining room, Closet, Hallway, Laundry, Balcony, Other. One click names it (unique: "Bedroom 2"); Other reveals a name field with Save; (c) then **Trace next room** / **Done tracing**.

## Non-goals
- No automatic repair of rooms already drawn.
- No change to wall thickness model (walls still extrude outward from the outline).
- Renaming in the room list stays as is.

## Approaches
- **Snap to the neighbour's outer face (picked).** Fits the existing outward-wall model; tiny change in `snapPoint`.
- Shared-wall data model (rooms reference one wall). Correct in the long run but a big rewrite of 2D/3D/walls; not needed for the user's problem.
- Snap to the neighbour's inner line. Would put the two rooms' walls side by side (double wall) — the bug itself.
