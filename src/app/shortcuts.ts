import type { AppState, PlacedItem, Room, ViewMode } from '../types';
import { deleteCorner as deleteRoomCorner } from '../editor2d/wallEdit';

/** The subset of KeyboardEvent the shortcut table reads (lets tests pass plain objects). */
export type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'target'>;

export interface Shortcut {
  /** Shown in the Help overlay. */
  keys: string;
  label: string;
  /** Also runs while a dialog is open. */
  inDialogs?: boolean;
  match(e: KeyInput): boolean;
  /** Returns false when the key was not used (so the browser default is kept). */
  run(s: AppState, e: KeyInput): boolean | void;
}

const mod = (e: KeyInput) => e.ctrlKey || e.metaKey;
const plain = (e: KeyInput, key: string) => !mod(e) && !e.altKey && e.key.toLowerCase() === key;

export const activeRoom = (s: AppState): Room | undefined => s.project.rooms.find((r) => r.id === s.project.activeRoomId);
export const selectedItem = (s: AppState): PlacedItem | undefined => {
  const sel = s.ui.selection;
  const room = activeRoom(s);
  if (sel?.type !== 'item' || !room) return undefined;
  return room.layouts.find((l) => l.id === room.activeLayoutId)?.items.find((i) => i.id === sel.id);
};
export const normDeg = (deg: number) => ((deg % 360) + 360) % 360;

/** Removes a room corner (only when more than 3 remain), re-indexing openings. Shared by the Delete key and the Inspector. */
export function deleteCorner(s: AppState, index: number): boolean {
  const room = activeRoom(s);
  return !!room && deleteRoomCorner(s, room, index);
}

/** Deletes the selected item / opening / corner (a selected wall: nothing). */
export function deleteSelection(s: AppState): boolean {
  const sel = s.ui.selection;
  if (!sel) return false;
  if (sel.type === 'corner') return deleteCorner(s, sel.index);
  if (sel.type === 'wall') return false; // walls are edited (length, split), never deleted
  if (sel.type === 'item') s.deleteItem(sel.id);
  else s.deleteOpening(sel.id);
  s.select(null);
  return true;
}

const rotate = (s: AppState, by: number) => {
  const item = selectedItem(s);
  if (!item) return false;
  s.updateItem(item.id, { rotation: normDeg(item.rotation + by) });
};
const VIEWS: ViewMode[] = ['plan', '3d', 'split', 'compare'];
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** THE shortcut table: drives both the key handler and the Help overlay. */
export const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl/Cmd + Z', label: 'Undo', match: (e) => mod(e) && !e.shiftKey && e.key.toLowerCase() === 'z', run: (s) => s.undo() },
  {
    keys: 'Ctrl/Cmd + Shift + Z  or  Ctrl/Cmd + Y', label: 'Redo',
    match: (e) => mod(e) && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y'),
    run: (s) => s.redo(),
  },
  {
    keys: 'Delete / Backspace', label: 'Delete the selected item, opening or corner',
    match: (e) => !mod(e) && (e.key === 'Delete' || e.key === 'Backspace'),
    // The draw-room tool uses Backspace to undo the last point.
    run: (s) => s.ui.tool !== 'draw-room' && deleteSelection(s),
  },
  {
    keys: 'Ctrl/Cmd + D', label: 'Duplicate the selected item',
    match: (e) => mod(e) && e.key.toLowerCase() === 'd',
    run: (s) => { const item = selectedItem(s); if (!item) return false; s.duplicateItem(item.id); },
  },
  { keys: 'R / Shift + R', label: 'Rotate the selected item 15° clockwise / counter-clockwise', match: (e) => plain(e, 'r'), run: (s, e) => rotate(s, e.shiftKey ? -15 : 15) },
  {
    keys: 'Arrow keys', label: 'Nudge the selected item 1 cm (Shift: 10 cm)',
    match: (e) => !mod(e) && e.key in ARROWS,
    run: (s, e) => {
      const item = selectedItem(s);
      if (!item || s.ui.walkMode) return false;
      const [dx, dy] = ARROWS[e.key];
      const step = e.shiftKey ? 10 : 1;
      s.updateItem(item.id, { x: item.x + dx * step, y: item.y + dy * step });
    },
  },
  {
    keys: 'Esc', label: 'Close help / deselect and go back to the Select tool', inDialogs: true,
    match: (e) => e.key === 'Escape',
    run: (s) => {
      if (s.ui.dialog === 'help' || s.ui.dialog === 'room-setup') return s.setUI({ dialog: 'none' });
      if (s.ui.dialog !== 'none' && s.ui.dialog !== 'floorplan') return false; // other dialogs handle Esc themselves
      s.select(null);
      s.setUI({ tool: 'select' });
    },
  },
  { keys: 'V', label: 'Select tool', match: (e) => plain(e, 'v'), run: (s) => s.setUI({ tool: 'select' }) },
  { keys: 'G', label: 'Toggle grid', match: (e) => plain(e, 'g'), run: (s) => s.setUI({ showGrid: !s.ui.showGrid }) },
  { keys: 'S', label: 'Toggle snapping', match: (e) => plain(e, 's'), run: (s) => s.setUI({ snap: !s.ui.snap }) },
  { keys: 'C', label: 'Toggle clearances', match: (e) => plain(e, 'c'), run: (s) => s.setUI({ showClearances: !s.ui.showClearances }) },
  {
    keys: '1 / 2 / 3 / 4', label: 'Plan / 3D / Split / Compare view',
    match: (e) => !mod(e) && !e.altKey && ['1', '2', '3', '4'].includes(e.key),
    run: (s, e) => s.setUI({ view: VIEWS[Number(e.key) - 1] }),
  },
  { keys: '?', label: 'Show this help', inDialogs: true, match: (e) => e.key === '?' && !mod(e), run: (s) => s.setUI({ dialog: s.ui.dialog === 'help' ? 'none' : 'help' }) },
];

/** Mouse gestures owned by the editors (listed in Help only). */
export const MOUSE_GESTURES: [string, string][] = [
  ['Drag an item', 'Move it (snaps to walls and other items)'],
  ['Drag the rotate handle', 'Rotate in 15° steps (Shift: free rotation)'],
  ['Hold Alt while dragging or drawing', 'No snapping (snaps only within ~10 px of the cursor, at any zoom)'],
  ['Mouse wheel', 'Zoom'],
  ['Drag the background / Space + drag / middle-drag', 'Pan (also while drawing a room)'],
  ['Draw room: click', 'Add a corner: snaps to right angles, other rooms, alignment guides and the plan’s walls (Alt or Shift: no snapping)'],
  ['Draw room: click the green circle / Enter', 'Finish the room'],
  ['Draw room: Backspace / Esc', 'Undo the last point / cancel'],
  ['Click a wall', 'Select it: type its exact length, split it, or open it (no wall) in the inspector'],
  ['Drag a corner', 'Reshape the room (snaps like drawing; Alt or Shift: no snapping)'],
  ['Click another room', 'Make it the active room'],
  ['3D overview: left-drag / right-drag or Shift + drag / wheel', 'Orbit / pan / zoom (Top view button looks straight down)'],
  ['3D overview: double-click the floor', 'Start walking there'],
  ['Walk mode: click, then move the mouse', 'Capture the mouse and look around (drag to look if capture is unavailable)'],
  ['Walk mode: W A S D / arrows, Shift, Space', 'Walk (through doorways between rooms), sprint, jump; walls and furniture stop you'],
  ['Walk mode: Esc, then Esc or O', 'Release the mouse, then return to Overview'],
];

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable === true);
};

/** Runs the first matching shortcut. Returns true when the key was handled (caller should preventDefault). */
export function handleShortcut(e: KeyInput, s: AppState): boolean {
  // The floor-plan panel is docked, not modal: shortcuts keep working while tracing.
  const dialogOpen = s.ui.dialog !== 'none' && s.ui.dialog !== 'floorplan';
  // Esc still closes help/room-setup from inside their inputs.
  if (isEditable(e.target) && !(e.key === 'Escape' && dialogOpen)) return false;
  const sc = SHORTCUTS.find((x) => x.match(e));
  if (!sc || (dialogOpen && !sc.inDialogs)) return false;
  return sc.run(s, e) !== false;
}
