import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import type { Project } from '../types';

vi.mock('../core/geometry', () => ({ rectRoomPoints: () => [], polygonCentroid: () => ({ x: 0, y: 0 }) }));
vi.mock('../models/presets', () => ({ PRESETS: [] }));

import { orphanBlobIds } from './blobs';
import { isProject } from './projectFile';
import { emptyProject } from './store';

const KEY = 'room-planner/project';
const room = () => ({
  id: 'r', name: 'Room', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }], ceilingHeight: 240, wallThickness: 10,
  openings: [{ id: 'o', kind: 'door', wall: 2, offset: 50, width: 80, height: 200, sill: 0 }], wallColor: '#fff', floor: 'wood',
  layouts: [{ id: 'l', name: 'Layout 1', items: [{ id: 'i', defId: 'gone', x: 1, y: 2, rotation: 0 }] }], activeLayoutId: 'l',
});
const withRoom = (patch: (r: ReturnType<typeof room>) => unknown) => {
  const r = room();
  return { ...emptyProject(), rooms: [patch(r) ?? r], activeRoomId: 'r' };
};

describe('isProject', () => {
  test('accepts a valid project (an item whose def is missing is fine: renderers skip it)', () => {
    expect(isProject(withRoom(() => undefined))).toBe(true);
  });
  test('per-item colours: optional, known part roles only, #rrggbb only', () => {
    const colored = (colors: unknown) => withRoom((r) => { (r.layouts[0].items[0] as { colors?: unknown }).colors = colors; });
    expect(isProject(colored({ body: '#A1b2c3', accent: '#000000' }))).toBe(true);
    for (const c of [{ wheels: '#000000' }, { body: 'red' }, { body: '#fff' }, ['#000000'], 'x']) expect(isProject(colored(c)), JSON.stringify(c)).toBe(false);
  });
  test('rejects malformed shapes that the old shallow check let through', () => {
    const bad = [
      withRoom((r) => { r.points = [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 0, y: 100 }]; }),
      withRoom((r) => { r.points = [{ x: 0, y: 0 }, { x: 1, y: 1 }]; }),
      withRoom((r) => { (r as { points: unknown }).points = 'abc'; }),
      withRoom((r) => { r.openings[0].wall = 3; }),
      withRoom((r) => { r.layouts = []; }),
      withRoom((r) => { (r.layouts[0].items[0] as { x: unknown }).x = '1'; }),
      withRoom((r) => { (r as { layouts: unknown }).layouts = [{ id: 'l', name: 'x' }]; }),
      { ...emptyProject(), rooms: [null] },
      { ...emptyProject(), library: [{ id: 'd', name: 'D', size: { w: 1, d: 1 }, model: { kind: 'mesh', meshId: 'm' }, clearances: [], source: 'user' }] },
      { ...emptyProject(), library: [{ id: 'd', name: 'D', size: { w: 1, d: 1, h: 1 }, model: { kind: 'parametric', category: 'spaceship' }, clearances: [], source: 'user' }] },
      { ...emptyProject(), underlay: { imageId: 'x' } },
    ];
    for (const [i, p] of bad.entries()) expect(isProject(p), `case ${i}`).toBe(false);
  });
});

test('orphanBlobIds: stored blobs the project does not reference', () => {
  const keys = ['room-planner/project', 'room-planner/blob/a', 'room-planner/blob/b', 'room-planner/blob/c', 42];
  expect(orphanBlobIds(keys, ['b', 'zzz'])).toEqual(['a', 'c']);
});

describe('initPersistence', () => {
  beforeEach(async () => { await clear(); vi.resetModules(); });
  const load = async (locks?: Partial<LockManager>) => {
    vi.stubGlobal('navigator', { ...navigator, locks });
    const persistence = await import('./persistence');
    const { useStore } = await import('./store');
    await persistence.initPersistence();
    vi.unstubAllGlobals();
    return { ...persistence, useStore };
  };

  test('a tab that does not get the edit lock never writes the index or any plan, and is marked read-only', async () => {
    const saved: Project = { ...emptyProject(), name: 'Newer work in the other tab' };
    const index = [{ id: 'p1', name: saved.name, createdAt: 1, updatedAt: 1, roomCount: 0, areaCm2: 0, thumbnailSvg: '' }];
    await set('room-planner/plans', index);
    await set('room-planner/plan/p1', saved);
    await set('room-planner/last-open', 'p1');
    const { useStore, usePersistence } = await load({ request: ((_n: string, _o: unknown, cb: (l: Lock | null) => unknown) => Promise.resolve(cb(null))) as never });
    const fp = await import('./floorPlans');
    expect(usePersistence.getState().readOnly).toBe(true);
    expect(useStore.getState().project.name).toBe('Newer work in the other tab');
    useStore.getState().addRoom({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }], name: 'Stale' });
    await new Promise((r) => setTimeout(r, 600));
    await fp.closeFloorPlan();
    await expect(fp.createFloorPlan()).rejects.toThrow(/read-only/);
    await expect(fp.renameFloorPlan('p1', 'x')).rejects.toThrow(/read-only/);
    await expect(fp.deleteFloorPlan('p1')).rejects.toThrow(/read-only/);
    expect(await get('room-planner/plan/p1')).toEqual(saved);
    expect(await get('room-planner/plans')).toEqual(index);
    expect(await get('room-planner/last-open')).toBe('p1');
  });

  test('a damaged autosave is kept as a backup and the app starts fresh, with a notice', async () => {
    const damaged = { version: 1, name: 'x', units: 'metric', rooms: [{ id: 'r' }], library: [], activeRoomId: null, underlay: null };
    await set(KEY, damaged);
    const { useStore, usePersistence, BACKUP_KEY } = await load();
    expect(useStore.getState().hydrated).toBe(true);
    expect(useStore.getState().project.rooms).toEqual([]);
    expect(usePersistence.getState().notice).toMatch(/backup/);
    expect(await get(BACKUP_KEY)).toEqual(damaged);
    expect(await get(KEY)).toBeUndefined();
  });
});
