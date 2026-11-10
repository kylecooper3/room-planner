import { describe, expect, test, vi } from 'vitest';
import { defaultUI, emptyProject } from '../store/store';
import type { AppState, Room, UIState } from '../types';
import { handleShortcut, type KeyInput } from './shortcuts';

const ACTIONS = [
  'newProject', 'loadDemo', 'replaceProject', 'setUnits', 'addRoom', 'updateRoom', 'deleteRoom', 'setActiveRoom',
  'addOpening', 'updateOpening', 'deleteOpening', 'addLayout', 'duplicateLayout', 'renameLayout', 'deleteLayout',
  'setActiveLayout', 'placeItem', 'updateItem', 'deleteItem', 'duplicateItem', 'saveDef', 'deleteDef', 'setUnderlay',
  'updateUnderlay', 'undo', 'redo', 'beginBatch', 'endBatch', 'setUI', 'select',
] as const;

const room: Room = {
  id: 'r1', name: 'Room', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }],
  ceilingHeight: 244, wallThickness: 10, openings: [], wallColor: '#ffffff', floor: 'wood',
  layouts: [{ id: 'l1', name: 'A', items: [{ id: 'i1', defId: 'preset-desk', x: 100, y: 100, rotation: 350 }] }],
  activeLayoutId: 'l1',
};

function mockState(ui: Partial<UIState> = {}) {
  const fns = Object.fromEntries(ACTIONS.map((a) => [a, vi.fn()]));
  const state = {
    ...fns, project: { ...emptyProject(), rooms: [room], activeRoomId: 'r1' }, ui: { ...defaultUI(), ...ui },
    canUndo: true, canRedo: true, hydrated: true,
  } as unknown as AppState;
  return { state, fns: fns as Record<(typeof ACTIONS)[number], ReturnType<typeof vi.fn>> };
}
const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput =>
  ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, ...mods });
const item = { selection: { type: 'item', id: 'i1' } } as const;

describe('handleShortcut', () => {
  test.each([
    ['ctrl+z', key('z', { ctrlKey: true }), 'undo', []],
    ['cmd+z', key('z', { metaKey: true }), 'undo', []],
    ['ctrl+shift+z', key('Z', { ctrlKey: true, shiftKey: true }), 'redo', []],
    ['ctrl+y', key('y', { ctrlKey: true }), 'redo', []],
    ['g', key('g'), 'setUI', [{ showGrid: false }]],
    ['s', key('s'), 'setUI', [{ snap: false }]],
    ['c', key('c'), 'setUI', [{ showClearances: false }]],
    ['v', key('v'), 'setUI', [{ tool: 'select' }]],
    ['2', key('2'), 'setUI', [{ view: '3d' }]],
    ['4', key('4'), 'setUI', [{ view: 'compare' }]],
    ['?', key('?', { shiftKey: true }), 'setUI', [{ dialog: 'help' }]],
  ] as const)('%s', (_n, e, action, args) => {
    const { state, fns } = mockState();
    expect(handleShortcut(e, state)).toBe(true);
    expect(fns[action]).toHaveBeenCalledWith(...args);
  });

  test('item editing keys', () => {
    const { state, fns } = mockState(item);
    handleShortcut(key('r'), state);
    expect(fns.updateItem).toHaveBeenLastCalledWith('i1', { rotation: 5 });
    handleShortcut(key('R', { shiftKey: true }), state);
    expect(fns.updateItem).toHaveBeenLastCalledWith('i1', { rotation: 335 });
    handleShortcut(key('ArrowRight'), state);
    expect(fns.updateItem).toHaveBeenLastCalledWith('i1', { x: 101, y: 100 });
    handleShortcut(key('ArrowUp', { shiftKey: true }), state);
    expect(fns.updateItem).toHaveBeenLastCalledWith('i1', { x: 100, y: 90 });
    handleShortcut(key('d', { ctrlKey: true }), state);
    expect(fns.duplicateItem).toHaveBeenCalledWith('i1');
    handleShortcut(key('Delete'), state);
    expect(fns.deleteItem).toHaveBeenCalledWith('i1');
  });

  test('delete opening and corner', () => {
    const a = mockState({ selection: { type: 'opening', id: 'o1' } });
    handleShortcut(key('Backspace'), a.state);
    expect(a.fns.deleteOpening).toHaveBeenCalledWith('o1');
    const b = mockState({ selection: { type: 'corner', index: 1 } });
    handleShortcut(key('Delete'), b.state);
    expect(b.fns.updateRoom).toHaveBeenCalledWith('r1', { points: [room.points[0], room.points[2], room.points[3]] });
  });

  test('Delete on a selected wall does nothing', () => {
    const { state, fns } = mockState({ selection: { type: 'wall', index: 1 } });
    expect(handleShortcut(key('Delete'), state)).toBe(false);
    expect(fns.updateRoom).not.toHaveBeenCalled();
    expect(fns.select).not.toHaveBeenCalled();
  });

  test('the docked floor-plan panel does not block shortcuts', () => {
    const { state, fns } = mockState({ dialog: 'floorplan' });
    expect(handleShortcut(key('z', { ctrlKey: true }), state)).toBe(true);
    expect(fns.undo).toHaveBeenCalled();
    handleShortcut(key('Escape'), state);
    expect(fns.select).toHaveBeenCalledWith(null);
  });

  test('Backspace does nothing in draw-room', () => {
    const { state, fns } = mockState({ ...item, tool: 'draw-room' });
    expect(handleShortcut(key('Backspace'), state)).toBe(false);
    expect(fns.deleteItem).not.toHaveBeenCalled();
  });

  test('arrows ignored in walk mode', () => {
    const { state, fns } = mockState({ ...item, walkMode: true });
    expect(handleShortcut(key('ArrowLeft'), state)).toBe(false);
    expect(fns.updateItem).not.toHaveBeenCalled();
  });

  test('ignored in inputs', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const { state, fns } = mockState(item);
      const target = document.createElement(tag);
      expect(handleShortcut(key('Delete', { target }), state)).toBe(false);
      expect(handleShortcut(key('z', { ctrlKey: true, target }), state)).toBe(false);
      expect(fns.deleteItem).not.toHaveBeenCalled();
      expect(fns.undo).not.toHaveBeenCalled();
    }
  });

  test('dialogs: only Esc and ? work', () => {
    const { state, fns } = mockState({ dialog: 'room-setup' });
    expect(handleShortcut(key('g'), state)).toBe(false);
    expect(handleShortcut(key('Escape', { target: document.createElement('input') }), state)).toBe(true);
    expect(fns.setUI).toHaveBeenCalledWith({ dialog: 'none' });
  });

  test('Esc deselects and returns to select tool', () => {
    const { state, fns } = mockState({ ...item, tool: 'place-opening' });
    handleShortcut(key('Escape'), state);
    expect(fns.select).toHaveBeenCalledWith(null);
    expect(fns.setUI).toHaveBeenCalledWith({ tool: 'select' });
  });
});
