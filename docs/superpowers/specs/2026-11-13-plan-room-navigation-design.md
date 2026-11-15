# Floor plan → room drill-down navigation

## Why
Floor plans, rooms and layouts each live in a different corner of the screen with no sense of "where am I". The user wants to be inside one level at a time, see only what belongs to it, and back out one level with an obvious button.

## Goals
- Two levels inside a floor plan: **plan level** (the rooms) and **room level** (one room's furniture and layouts).
- A back button that always goes up exactly one level, and a breadcrumb `Floor plans › <plan> › <room>` that shows where you are; each crumb is clickable.
- Each level's sidebar shows only that level's things.

## Non-goals
- No data-model change: layouts stay per room, "My stuff" stays shared across plans.
- No change to the home screen (floor plan cards).

## Anti-goals
- Anything that makes furnishing a room take more clicks once you are in it.
- Losing work or undo history when moving between levels.

## Approaches
- **A. Drill down one level at a time (picked).** Plan level and room level are separate screens of the same editor. Matches "drill in, back out".
- B. One screen with a rooms/layouts tree and a back button. Smaller, but keeps everything visible at once, which is the clutter the user described.
- C. Breadcrumb dropdowns in the top bar, sidebar only furniture. Compact, but hides rooms in menus.

## Design
**State.** New UI-only flag `ui.roomOpen` (not saved, not in undo). Opening a floor plan always lands on plan level. `project.activeRoomId` keeps meaning "the room you're in / last in".

**Top bar.** `‹` back button, then breadcrumb `Floor plans › Apartment › Bedroom`. Back from room → plan level; back from plan → home. Plan and room names stay renameable from the breadcrumb.

**Plan level.**
- Sidebar: Rooms list (area, rename, delete, open) plus the existing "Add a room" options (draw, trace a floor plan image, rectangle). No furniture tabs.
- Canvas: the whole plan. Walls, corners and openings stay editable. Clicking inside a room, or its row, opens it. Furniture is drawn but cannot be selected.
- No layout tabs. The tracing panel works here as today.

**Room level.**
- Sidebar: Furniture / My stuff tabs (fixtures included), as today. No rooms list.
- Above the canvas: that room's layout tabs, as today.
- Canvas: the room in focus; other rooms greyed out and not clickable. Clicking a greyed room does nothing (back out to switch). Walls of the open room stay editable.
- 3D, split and compare work as today for the open room.

**Builder's calls.** Exact styling (reuse the design-system tokens), whether greyed rooms are dimmed in 3D, empty states ("No rooms yet — add one"), and e2e tests that rely on today's sidebar rows getting updated.
