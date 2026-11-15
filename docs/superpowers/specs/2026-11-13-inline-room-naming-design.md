# Inline room naming while tracing

## Why
The trace → confirm → type list → "Trace next / Done" panel feels clunky: too many stops between rooms, a chip selector the user dislikes, two competing buttons side by side, and the room list still allows renaming during naming (you can name a room twice).

## Design (approach A, picked)
- **Name on the plan.** When a room's outline closes (draw-room tool, at plan level, whether started from the tracing panel or the rail), a small popover appears anchored at the new room's centre on the canvas: title "Name this room", a text input already focused, and below it a suggestion list (combobox) filtered by what's typed.
  - Suggestions: Bedroom, Bathroom, Kitchen, Living room, Dining room, Closet, Hallway, Laundry, Balcony — each shown as the unique name it would produce ("Bedroom 2" if "Bedroom" is taken).
  - Enter saves the typed text (made unique) or the highlighted suggestion; ↑/↓ move through suggestions; clicking a suggestion saves it.
  - Escape, or clicking the canvas to start the next room, keeps the current default name ("Room N").
  - Empty input + Enter keeps the default name.
- **No confirm step.** A wrong trace is removed with Ctrl+Z (one undo step removes the room; the naming is a separate step, as renames are today).
- **Tracing stays on.** After naming, the draw-room tool remains active so the next click starts the next room. The bottom hint bar (DrawHud) reads "Click the first corner of the next room" and has one **Done** button (also Escape with no outline in progress) that ends tracing (tool → select). No "Trace next room" / "Done tracing" button pair anywhere.
- **Tracing panel step 3** keeps its explanatory text, a single "Trace rooms" button to (re)start tracing, the room list and totals. The old NameRoom staged component (keep/redo, type list, next/done) is removed.
- **One naming at a time.** While the popover is open, rename buttons/double-click in the tracing panel list and the sidebar rooms list are disabled for that room (or all rooms).
- Applies to drawing a room from the rail too (same popover), so naming works the same everywhere.

## Non-goals
Room types/icons, auto-detecting names, changing the room list rename UI otherwise.

## Approaches considered
- A. Popover on the plan (picked): fewest clicks, eyes stay on the drawing.
- B. Single combobox field in the side panel: eyes leave the plan.
- C. Trace all, then name in a list: you lose track of which "Room 3" is which.
