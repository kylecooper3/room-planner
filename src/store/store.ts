import { create } from 'zustand';
import type { AppState, Layout, Opening, Project, Room, Selection, UIState } from '../types';
import { polygonCentroid } from '../core/geometry';
import { buildDemoProject } from './demo';

export const emptyProject = (): Project => ({
  version: 1, name: 'My home', units: 'imperial', rooms: [], activeRoomId: null, library: [], underlay: null,
});
export const defaultUI = (): UIState => ({
  view: 'plan', tool: 'select', openingKind: 'door', selection: null, showGrid: true, showClearances: true,
  snap: true, cutaway: true, walkMode: false, compareLayoutId: null, dialog: 'none', editingDefId: null, roomOpen: false, namingRoomId: null,
});

const HISTORY_CAP = 100;
const DUPLICATE_OFFSET = 30;
const uid = (): string => crypto.randomUUID();

/** "Bedroom", or "Bedroom 2" when that name is taken by another room. */
export function uniqueName(name: string, rooms: Room[], self: string) {
  const taken = new Set(rooms.filter((r) => r.id !== self).map((r) => r.name));
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name} ${i}`)) i++;
  return `${name} ${i}`;
}

/** The project without def `defId` and every placed copy of it (same object when it has neither). */
export const withoutDef = (p: Project, defId: string): Project => (!p.library.some((d) => d.id === defId)
  && !p.rooms.some((r) => r.layouts.some((l) => l.items.some((i) => i.defId === defId))) ? p : {
  ...p,
  library: p.library.filter((d) => d.id !== defId),
  rooms: p.rooms.map((r) => ({ ...r, layouts: r.layouts.map((l) => ({ ...l, items: l.items.filter((i) => i.defId !== defId) })) })),
});

const activeRoom = (p: Project): Room | undefined => p.rooms.find((r) => r.id === p.activeRoomId);
const activeLayout = (r: Room): Layout | undefined => r.layouts.find((l) => l.id === r.activeLayoutId);

const mapRoom = (p: Project, roomId: string, fn: (r: Room) => Room): Project =>
  ({ ...p, rooms: p.rooms.map((r) => (r.id === roomId ? fn(r) : r)) });
const mapActiveRoom = (p: Project, fn: (r: Room) => Room): Project =>
  (activeRoom(p) ? mapRoom(p, p.activeRoomId!, fn) : p);
const mapActiveLayout = (p: Project, fn: (l: Layout) => Layout): Project =>
  mapActiveRoom(p, (r) => ({ ...r, layouts: r.layouts.map((l) => (l.id === r.activeLayoutId ? fn(l) : l)) }));

const wallLen = (points: Room['points'], i: number) => {
  const a = points[i], b = points[(i + 1) % points.length];
  return Math.hypot(b.x - a.x, b.y - a.y);
};
/**
 * Drops openings whose wall vanished; clamps offsets to the wall length. Open gaps ('open') also stay within their wall,
 * and one spanning its whole wall keeps spanning it when the walls only move (same corner count as `prev`).
 */
const fitOpenings = (openings: Opening[], points: Room['points'], prev?: Room['points']): Opening[] => {
  const n = points.length;
  return openings
    .filter((o) => o.wall >= 0 && o.wall < n)
    .map((o) => {
      const len = wallLen(points, o.wall);
      if (o.kind === 'open') {
        const full = prev?.length === n && o.width >= wallLen(prev, o.wall) - 0.5;
        const width = full ? len : Math.min(o.width, len);
        const offset = full ? len / 2 : Math.min(Math.max(o.offset, width / 2), len - width / 2);
        return width === o.width && offset === o.offset ? o : { ...o, width, offset };
      }
      const offset = Math.min(Math.max(o.offset, 0), len);
      return offset === o.offset ? o : { ...o, offset };
    });
};

/** Null when the selection points at something that no longer exists in the active room/layout. */
const validSelection = (p: Project, sel: Selection | null): Selection | null => {
  if (!sel) return null;
  const room = activeRoom(p);
  if (!room) return null;
  if (sel.type === 'item') return activeLayout(room)?.items.some((i) => i.id === sel.id) ? sel : null;
  if (sel.type === 'opening') return room.openings.some((o) => o.id === sel.id) ? sel : null;
  return sel.index < room.points.length ? sel : null;
};

/** Room level survives a change only while the same room stays active and exists. */
const stillOpen = (before: Project, next: Project, roomOpen: boolean): boolean =>
  roomOpen && next.activeRoomId === before.activeRoomId && next.rooms.some((r) => r.id === next.activeRoomId);
/** The name popover closes when its room is gone (deleted, undone). */
const stillNaming = (p: Project, id: string | null): string | null => (id && p.rooms.some((r) => r.id === id) ? id : null);

export const useStore = create<AppState>((set, get) => {
  let past: Project[] = [];
  let future: Project[] = [];
  let batchDepth = 0;
  let batchStart: Project | null = null;

  const flags = () => ({ canUndo: past.length > 0, canRedo: future.length > 0 });
  const push = (p: Project) => {
    past.push(p);
    if (past.length > HISTORY_CAP) past.shift();
    future = [];
  };

  /** Applies a project change as one undo step (or as part of the open batch). */
  const commit = (fn: (p: Project) => Project, ui?: Partial<UIState>) => {
    const { project, ui: curUI } = get();
    const next = fn(project);
    if (next === project && !ui) return;
    if (next !== project && batchDepth === 0) push(project);
    const merged = { ...curUI, ...ui };
    set({
      project: next,
      ui: { ...merged, selection: validSelection(next, merged.selection), roomOpen: stillOpen(project, next, merged.roomOpen), namingRoomId: stillNaming(next, merged.namingRoomId) },
      ...flags(),
    });
  };

  const reset = (project: Project) => {
    past = []; future = []; batchDepth = 0; batchStart = null;
    set({ project, ui: { ...get().ui, selection: null, compareLayoutId: null, roomOpen: false, namingRoomId: null }, canUndo: false, canRedo: false });
  };

  const travel = (from: Project[], to: Project[]) => {
    const popped = from.pop();
    if (!popped) return;
    const { project, ui } = get();
    to.push(project);
    // Inside a room, undo/redo never switches rooms; it only leaves when the room itself is gone.
    const keep = ui.roomOpen && popped.rooms.some((r) => r.id === project.activeRoomId);
    const prev = keep && popped.activeRoomId !== project.activeRoomId ? { ...popped, activeRoomId: project.activeRoomId } : popped;
    set({ project: prev, ui: { ...ui, selection: validSelection(prev, ui.selection), roomOpen: keep, namingRoomId: stillNaming(prev, ui.namingRoomId) }, ...flags() });
  };

  return {
    project: emptyProject(), ui: defaultUI(), canUndo: false, canRedo: false, hydrated: false,

    newProject: () => reset(emptyProject()),
    loadDemo: () => reset(buildDemoProject()),
    replaceProject: (p) => reset(p),
    setUnits: (units) => commit((p) => (p.units === units ? p : { ...p, units })),
    setProjectName: (name) => commit((p) => (p.name === name ? p : { ...p, name })),

    addRoom: ({ points, ceilingHeight = 243.84, name }) => {
      const id = uid(), layoutId = uid();
      commit((p) => ({
        ...p,
        activeRoomId: id,
        rooms: [...p.rooms, {
          id, name: name ?? `Room ${p.rooms.length + 1}`, points, ceilingHeight, wallThickness: 12, openings: [],
          wallColor: '#f2f0ec', floor: 'wood', layouts: [{ id: layoutId, name: 'Layout 1', items: [] }], activeLayoutId: layoutId,
        }],
      }), { selection: null });
      return id;
    },
    // Every rename path goes through here, so room names stay unique ("Bedroom 2").
    updateRoom: (roomId, patch) => commit((p) => mapRoom(p, roomId, (r) => ({
      ...r, ...patch, ...(patch.name !== undefined && { name: uniqueName(patch.name, p.rooms, roomId) }), openings: patch.points ? fitOpenings(r.openings, patch.points, r.points) : r.openings,
    }))),
    deleteRoom: (roomId) => commit((p) => {
      if (!p.rooms.some((r) => r.id === roomId)) return p;
      const rooms = p.rooms.filter((r) => r.id !== roomId);
      const activeRoomId = p.activeRoomId === roomId ? (rooms[0]?.id ?? null) : p.activeRoomId;
      return { ...p, rooms, activeRoomId };
    }),
    setActiveRoom: (roomId) => commit((p) =>
      (p.activeRoomId === roomId || !p.rooms.some((r) => r.id === roomId) ? p : { ...p, activeRoomId: roomId })),
    enterRoom: (roomId) => set((st) => (!st.project.rooms.some((r) => r.id === roomId) ? st : {
      project: st.project.activeRoomId === roomId ? st.project : { ...st.project, activeRoomId: roomId },
      ui: { ...st.ui, roomOpen: true, namingRoomId: null, selection: null, tool: 'select', dialog: st.ui.dialog === 'floorplan' ? 'none' : st.ui.dialog },
    })),
    focusRoom: (roomId) => set((st) => (!st.project.rooms.some((r) => r.id === roomId) ? st : {
      project: st.project.activeRoomId === roomId ? st.project : { ...st.project, activeRoomId: roomId },
      ui: { ...st.ui, selection: null },
    })),
    leaveRoom: () => set((st) => ({ ui: { ...st.ui, roomOpen: false, namingRoomId: null, selection: null, tool: 'select' } })),

    addOpening: (o) => {
      if (!activeRoom(get().project)) return '';
      const id = uid();
      commit((p) => mapActiveRoom(p, (r) => ({ ...r, openings: [...r.openings, { ...o, id }] })));
      return id;
    },
    updateOpening: (id, patch) => commit((p) => mapActiveRoom(p, (r) =>
      ({ ...r, openings: r.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) }))),
    deleteOpening: (id) => commit((p) => mapActiveRoom(p, (r) =>
      (r.openings.some((o) => o.id === id) ? { ...r, openings: r.openings.filter((o) => o.id !== id) } : r))),

    addLayout: (name) => {
      if (!activeRoom(get().project)) return '';
      const id = uid();
      commit((p) => mapActiveRoom(p, (r) => ({
        ...r, activeLayoutId: id, layouts: [...r.layouts, { id, name: name ?? `Layout ${r.layouts.length + 1}`, items: [] }],
      })));
      return id;
    },
    duplicateLayout: (layoutId) => {
      const src = activeRoom(get().project)?.layouts.find((l) => l.id === layoutId);
      if (!src) return '';
      const id = uid();
      const copy: Layout = { id, name: `${src.name} copy`, items: src.items.map((i) => ({ ...i, id: uid() })) };
      commit((p) => mapActiveRoom(p, (r) => ({ ...r, activeLayoutId: id, layouts: [...r.layouts, copy] })));
      return id;
    },
    renameLayout: (layoutId, name) => commit((p) => mapActiveRoom(p, (r) =>
      ({ ...r, layouts: r.layouts.map((l) => (l.id === layoutId ? { ...l, name } : l)) }))),
    deleteLayout: (layoutId) => {
      const room = activeRoom(get().project);
      if (!room || room.layouts.length <= 1 || !room.layouts.some((l) => l.id === layoutId)) return;
      const layouts = room.layouts.filter((l) => l.id !== layoutId);
      const activeLayoutId = room.activeLayoutId === layoutId ? layouts[0].id : room.activeLayoutId;
      const { compareLayoutId } = get().ui;
      commit((p) => mapActiveRoom(p, (r) => ({ ...r, layouts, activeLayoutId })),
        compareLayoutId === layoutId ? { compareLayoutId: null } : undefined);
    },
    setActiveLayout: (layoutId) => commit((p) => mapActiveRoom(p, (r) =>
      (r.activeLayoutId === layoutId || !r.layouts.some((l) => l.id === layoutId) ? r : { ...r, activeLayoutId: layoutId }))),

    placeItem: (defId, pos) => {
      const room = activeRoom(get().project);
      if (!room) return '';
      const id = uid();
      const { x, y } = pos ?? polygonCentroid(room.points);
      commit((p) => mapActiveLayout(p, (l) => ({ ...l, items: [...l.items, { id, defId, x, y, rotation: 0 }] })),
        { selection: { type: 'item', id } });
      return id;
    },
    updateItem: (id, patch) => commit((p) => mapActiveLayout(p, (l) =>
      ({ ...l, items: l.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))),
    deleteItem: (id) => commit((p) => mapActiveLayout(p, (l) =>
      (l.items.some((i) => i.id === id) ? { ...l, items: l.items.filter((i) => i.id !== id) } : l))),
    duplicateItem: (id) => {
      const room = activeRoom(get().project);
      const src = room && activeLayout(room)?.items.find((i) => i.id === id);
      if (!src) return '';
      const copy = { ...src, id: uid(), x: src.x + DUPLICATE_OFFSET, y: src.y + DUPLICATE_OFFSET };
      commit((p) => mapActiveLayout(p, (l) => ({ ...l, items: [...l.items, copy] })), { selection: { type: 'item', id: copy.id } });
      return copy.id;
    },

    saveDef: (def) => commit((p) => ({
      ...p,
      library: p.library.some((d) => d.id === def.id) ? p.library.map((d) => (d.id === def.id ? def : d)) : [...p.library, def],
    })),
    deleteDef: (defId) => commit((p) => withoutDef(p, defId)),

    setUnderlay: (underlay) => commit((p) => ({ ...p, underlay })),
    updateUnderlay: (patch) => commit((p) => (p.underlay ? { ...p, underlay: { ...p.underlay, ...patch } } : p)),

    undo: () => travel(past, future),
    redo: () => travel(future, past),
    beginBatch: () => {
      if (batchDepth++ === 0) batchStart = get().project;
    },
    endBatch: () => {
      if (batchDepth === 0 || --batchDepth > 0) return;
      if (batchStart && batchStart !== get().project) push(batchStart);
      batchStart = null;
      set(flags());
    },

    setUI: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
    select: (selection) => set((s) => ({ ui: { ...s.ui, selection } })),
  };
});
