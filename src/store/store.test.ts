import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ItemDef, Vec2 } from '../types';

vi.mock('../core/geometry', () => ({
  rectRoomPoints: (w: number, l: number) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: l }, { x: 0, y: l }],
  polygonCentroid: (pts: Vec2[]) => ({
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  }),
}));
vi.mock('../core/collision', () => ({ findIssues: () => [] }));
vi.mock('../models/presets', () => ({ PRESETS: [] }));

import { useStore } from './store';
import { selectActiveRoom, selectLayout } from './selectors';
import { buildDemoProject } from './demo';

const s = () => useStore.getState();
const sq = (n = 400): Vec2[] => [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }];
const layout = () => selectLayout(s())!;
const room = () => selectActiveRoom(s())!;

beforeEach(() => s().newProject());

describe('rooms', () => {
  test('addRoom defaults, activation, selection reset', () => {
    s().select({ type: 'corner', index: 0 });
    const id = s().addRoom({ points: sq() });
    expect(s().project.activeRoomId).toBe(id);
    expect(room()).toMatchObject({ name: 'Room 1', ceilingHeight: 243.84, wallThickness: 12, wallColor: '#f3ead9', floor: 'wood' });
    expect(room().layouts.map((l) => l.name)).toEqual(['Layout 1']);
    expect(s().ui.selection).toBeNull();
    expect(s().addRoom({ points: sq(), name: 'X' }) && room().name).toBe('X');
  });

  test('updateRoom points drops and clamps openings', () => {
    s().addRoom({ points: sq(400) });
    s().addOpening({ kind: 'door', wall: 3, offset: 300, width: 80, height: 200, sill: 0 });
    s().addOpening({ kind: 'window', wall: 1, offset: 350, width: 80, height: 100, sill: 90 });
    s().updateRoom(room().id, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 200 }] });
    expect(room().openings).toHaveLength(1);
    expect(room().openings[0]).toMatchObject({ wall: 1, offset: Math.hypot(200, 200) });
  });

  test('deleteRoom activates another room or null', () => {
    const a = s().addRoom({ points: sq() });
    const b = s().addRoom({ points: sq() });
    s().deleteRoom(b);
    expect(s().project.activeRoomId).toBe(a);
    s().deleteRoom(a);
    expect(s().project.activeRoomId).toBeNull();
    expect(s().placeItem('x')).toBe('');
    expect(s().addLayout()).toBe('');
  });
});

describe('layouts', () => {
  test('duplicate, delete guards, compareLayoutId fix', () => {
    s().addRoom({ points: sq() });
    const first = room().activeLayoutId;
    const item = s().placeItem('d1');
    const dup = s().duplicateLayout(first);
    expect(room().activeLayoutId).toBe(dup);
    expect(layout().name).toBe('Layout 1 copy');
    expect(layout().items[0].id).not.toBe(item);
    expect(layout().items[0].defId).toBe('d1');
    s().setUI({ compareLayoutId: first });
    s().deleteLayout(first);
    expect(room().layouts.map((l) => l.id)).toEqual([dup]);
    expect(s().ui.compareLayoutId).toBeNull();
    s().deleteLayout(dup);
    expect(room().layouts).toHaveLength(1);
    const added = s().addLayout();
    expect(layout().name).toBe('Layout 2');
    s().deleteLayout(added);
    expect(room().activeLayoutId).toBe(dup);
    s().renameLayout(dup, 'Cozy');
    expect(layout().name).toBe('Cozy');
  });
});

describe('items', () => {
  beforeEach(() => { s().addRoom({ points: sq(400) }); });

  test('placeItem at centroid and selects; duplicate offsets; delete clears selection', () => {
    const id = s().placeItem('d1');
    expect(layout().items[0]).toMatchObject({ id, x: 200, y: 200, rotation: 0 });
    expect(s().ui.selection).toEqual({ type: 'item', id });
    const copy = s().duplicateItem(id);
    expect(layout().items[1]).toMatchObject({ x: 230, y: 230 });
    expect(s().ui.selection).toEqual({ type: 'item', id: copy });
    s().deleteItem(copy);
    expect(s().ui.selection).toBeNull();
    s().updateItem(id, { rotation: 90 });
    expect(layout().items[0].rotation).toBe(90);
  });

  test('deleteOpening clears selection', () => {
    const o = s().addOpening({ kind: 'outlet', wall: 0, offset: 10, width: 8, height: 12, sill: 30 });
    s().select({ type: 'opening', id: o });
    s().updateOpening(o, { offset: 50 });
    expect(room().openings[0].offset).toBe(50);
    s().deleteOpening(o);
    expect(room().openings).toHaveLength(0);
    expect(s().ui.selection).toBeNull();
  });

  test('deleteDef cascades across rooms and layouts', () => {
    const def: ItemDef = { id: 'u1', name: 'Mine', size: { w: 1, d: 1, h: 1 }, model: { kind: 'mesh', meshId: 'm' }, clearances: [], source: 'user' };
    s().saveDef(def);
    s().saveDef({ ...def, name: 'Renamed' });
    expect(s().project.library).toEqual([{ ...def, name: 'Renamed' }]);
    s().placeItem('u1');
    s().placeItem('keep');
    s().addLayout();
    s().placeItem('u1');
    s().addRoom({ points: sq() });
    s().placeItem('u1');
    s().deleteDef('u1');
    expect(s().project.library).toEqual([]);
    const all = s().project.rooms.flatMap((r) => r.layouts.flatMap((l) => l.items.map((i) => i.defId)));
    expect(all).toEqual(['keep']);
  });
});

describe('history', () => {
  test('undo/redo restore exact projects; UI actions untouched', () => {
    const p0 = s().project;
    s().addRoom({ points: sq() });
    const p1 = s().project;
    s().placeItem('d1');
    const p2 = s().project;
    s().setUI({ showGrid: false });
    expect(s().canUndo).toBe(true);
    s().undo();
    expect(s().project).toBe(p1);
    expect(s().ui.selection).toBeNull(); // the placed item no longer exists
    expect(s().ui.showGrid).toBe(false);
    s().undo();
    expect(s().project).toBe(p0);
    expect(s().canUndo).toBe(false);
    expect(s().canRedo).toBe(true);
    s().redo(); s().redo();
    expect(s().project).toBe(p2);
    expect(s().canRedo).toBe(false);
    s().undo();
    s().setUnits('metric');
    expect(s().canRedo).toBe(false);
  });

  test('batch collapses into one step; empty batch adds none', () => {
    s().addRoom({ points: sq() });
    const id = s().placeItem('d1');
    const before = s().project;
    s().beginBatch();
    for (let i = 1; i <= 5; i++) s().updateItem(id, { x: i });
    s().endBatch();
    s().beginBatch(); s().endBatch();
    s().undo();
    expect(s().project).toBe(before);
  });

  test('history is capped at 100', () => {
    s().addRoom({ points: sq() });
    const id = s().placeItem('d1');
    for (let i = 0; i < 150; i++) s().updateItem(id, { x: i });
    let n = 0;
    while (s().canUndo) { s().undo(); n++; }
    expect(n).toBe(100);
  });

  test('newProject, loadDemo, replaceProject clear history', () => {
    s().addRoom({ points: sq() });
    s().loadDemo();
    expect(s().canUndo).toBe(false);
    expect(s().project.rooms[0].name).toBe('Bedroom');
    s().setUnits('metric');
    const demo = buildDemoProject();
    s().replaceProject(demo);
    expect(s().project).toBe(demo);
    expect(s().canUndo || s().canRedo).toBe(false);
  });
});

test('underlay', () => {
  s().updateUnderlay({ opacity: 0.2 });
  expect(s().canUndo).toBe(false);
  s().setUnderlay({ imageId: 'i', widthPx: 1, heightPx: 1, cmPerPx: 1, x: 0, y: 0, opacity: 0.5, visible: true });
  s().updateUnderlay({ opacity: 0.2 });
  expect(s().project.underlay?.opacity).toBe(0.2);
});
