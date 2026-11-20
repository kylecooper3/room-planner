# Wall editing, clearer colours, room exit

## Why
Fixing laid-out walls is clunky (no wall drag; corners one at a time), the 2D colours aren't explained, the walls jump from blue to black when you open a room, and the way out of a room is a small arrow in the corner.

## Design
1. **Drag a wall to slide it.** Pressing on a wall segment of the active room and dragging moves that wall along its normal (perpendicular only); its two endpoints move, so the neighbouring walls of the same room stretch/shrink. One undo step per drag. While dragging, the wall's outer face snaps onto a parallel neighbour wall face (other rooms) within WALL_SNAP_PX (25 screen px) with the same green highlight + "Attached" tag as drawing; Alt/Shift/snap-off = free. A click without movement still selects the wall (inspector) as today. Openings stay fitted (existing fitOpenings).
2. **Join walls.** At plan level an orange near-miss mark is clickable: it selects that wall and shows a **Join walls** button (in the inspector's wall panel, and as a small floating button at the mark) that slides the wall flush with the neighbour face (one undo step). Uses the same slide math as 1.
3. **One wall colour per context.** "Contrast" (accent walls, tinted floor) applies whenever a plan image is visible, at plan level AND room level, for the active room. Other rooms at room level stay greyed as now. Without an image: dark walls everywhere (unchanged).
4. **Hover + selection clarity.** The wall/corner under the cursor (select tool, editable) gets a light highlight and a native tooltip: walls "Drag to move · click for length", corners "Drag to move corner". A selected wall is shown with a thicker outline in the selection colour plus its two corner handles (not a fill-colour swap). 
5. **Legend.** A small floating key bottom-left of the plan, shown only while green or orange marks are on screen: "● Attached" (green), "● Not joined — click to fix" (orange). testid `plan-legend`.
6. **Leave a room.** At room level, a **← Back to floor plan** button at the left end of the layouts bar (testid `layouts-back`) calls `leaveRoom()`. Escape at room level with no selection, select tool, no dialog, and focus not in a text field also leaves the room.
7. **Zoom to the room.** Entering a room (double-click, Open buttons, sidebar) fits the 2D view to that room (same padding as the Fit button); leaving it (back button, breadcrumb, Escape) fits the whole floor plan again. Reuses the existing fit; a jump, no animation.

## Non-goals
Shared-wall data model; moving walls of rooms other than the active one; dragging a wall at an angle.
