import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clear, del, get, set } from 'idb-keyval';
import type { Project, Room } from '../types';

vi.mock('../core/geometry', () => ({ rectRoomPoints: () => [], polygonCentroid: () => ({ x: 0, y: 0 }) }));
vi.mock('../models/presets', () => ({ PRESETS: [] }));

import { emptyProject } from './store';
import { floorPlanThumbnail } from './floorPlans';

const PLAN = (id: string) => `room-planner/plan/${id}`;
const tri = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
const room = (name = 'Room'): Room => ({
  id: crypto.randomUUID(), name, points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }],
  ceilingHeight: 240, wallThickness: 10, openings: [], wallColor: '#fff', floor: 'wood',
  layouts: [{ id: 'l', name: 'Layout 1', items: [] }], activeLayoutId: 'l',
});
const withImage = (imageId: string, name = 'Plan'): Project => ({
  ...emptyProject(), name,
  underlay: { imageId, widthPx: 10, heightPx: 10, cmPerPx: 1, x: 0, y: 0, opacity: 0.5, visible: true },
});
const blob = () => new Blob([new Uint8Array([1])], { type: 'image/png' });

describe('floorPlanThumbnail', () => {
  test('empty plan → empty string', () => expect(floorPlanThumbnail({ rooms: [] })).toBe(''));
  test('fits every room into the viewBox, numbers only (no user text)', () => {
    const a = room('<script>alert(1)</script>'), b = { ...room(), points: [{ x: 400, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }] };
    const svg = floorPlanThumbnail({ rooms: [a, b] });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-36 -36 672 372"/);
    expect(svg.match(/<polygon /g)).toHaveLength(2);
    expect(svg).toContain('points="400,0 600,0 600,300"');
    expect(svg).not.toMatch(/script|<text|href|url\(/);
  });
});

describe('floor-plan library', () => {
  beforeEach(async () => { await clear(); vi.resetModules(); });
  const load = async (locks?: Partial<LockManager>) => {
    vi.stubGlobal('navigator', { ...navigator, locks });
    const fp = await import('./floorPlans');
    const { useStore } = await import('./store');
    const blobs = await import('./blobs');
    await fp.initPersistence();
    vi.unstubAllGlobals();
    return { ...fp, ...blobs, useStore };
  };
  const reload = async () => { vi.resetModules(); return load(); };

  test('first launch: no plans, library showing, hydrated + ready', async () => {
    const { useFloorPlans, useStore } = await load();
    expect(useFloorPlans.getState()).toEqual({ plans: [], activeId: null, ready: true });
    expect(useStore.getState().hydrated).toBe(true);
    // Edits with no plan open go nowhere.
    useStore.getState().addRoom({ points: tri });
    await new Promise((r) => setTimeout(r, 600));
    expect(await get('room-planner/plans')).toBeUndefined();
  });

  test('migrates the legacy single project into the first plan, with a stable id', async () => {
    const legacy: Project = { ...emptyProject(), name: 'Old home', rooms: [room()], activeRoomId: null };
    await set('room-planner/project', legacy);
    const { useFloorPlans, useStore } = await load();
    const { plans, activeId } = useFloorPlans.getState();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ name: 'Old home', roomCount: 1, areaCm2: 120000 });
    expect(activeId).toBe(plans[0].id);
    expect(useStore.getState().project).toEqual(legacy);
    expect(await get(PLAN(activeId!))).toEqual(legacy);
    expect(await get('room-planner/project')).toEqual(legacy); // kept so an older version still opens it
    const again = await reload();
    expect(again.useFloorPlans.getState().activeId).toBe(activeId);
    expect(again.useFloorPlans.getState().plans).toHaveLength(1); // not migrated twice
  });

  test('create / switch saves each plan into its own record; reload reopens the last plan', async () => {
    const { createFloorPlan, openFloorPlan, useFloorPlans, useStore } = await load();
    const a = await createFloorPlan({ name: 'A' });
    expect(useFloorPlans.getState().activeId).toBe(a);
    useStore.getState().addRoom({ points: tri, name: 'In A' });
    const b = await createFloorPlan(); // flushes A first
    expect(useStore.getState().project.name).toBe('Untitled floor plan');
    expect((await get<Project>(PLAN(a)))!.rooms.map((r) => r.name)).toEqual(['In A']);
    useStore.getState().addRoom({ points: tri, name: 'In B' });
    await openFloorPlan(a);
    expect(useStore.getState().project.rooms.map((r) => r.name)).toEqual(['In A']);
    expect(useStore.getState().canUndo).toBe(false);
    expect((await get<Project>(PLAN(b)))!.rooms.map((r) => r.name)).toEqual(['In B']);
    const metaB = useFloorPlans.getState().plans.find((m) => m.id === b)!;
    expect(metaB.roomCount).toBe(1);
    expect(metaB.thumbnailSvg).toContain('<polygon');
    const again = await reload();
    expect(again.useFloorPlans.getState().activeId).toBe(a);
    expect(again.useStore.getState().project.rooms.map((r) => r.name)).toEqual(['In A']);
    await again.closeFloorPlan();
    expect((await reload()).useFloorPlans.getState().activeId).toBeNull();
  });

  test('rename updates the record and the meta (open and closed plans)', async () => {
    const { createFloorPlan, renameFloorPlan, useFloorPlans, useStore } = await load();
    const a = await createFloorPlan({ name: 'A' });
    const b = await createFloorPlan({ name: 'B' });
    await renameFloorPlan(a, 'Kitchen flat');
    await renameFloorPlan(b, 'Loft');
    expect(useStore.getState().project.name).toBe('Loft');
    expect((await get<Project>(PLAN(a)))!.name).toBe('Kitchen flat');
    expect((await get<Project>(PLAN(b)))!.name).toBe('Loft');
    expect(useFloorPlans.getState().plans.map((m) => m.name).sort()).toEqual(['Kitchen flat', 'Loft']);
    expect((await get<{ name: string }[]>('room-planner/plans'))!.map((m) => m.name).sort()).toEqual(['Kitchen flat', 'Loft']);
  });

  test('duplicate copies the plan and keeps its image; does not open it', async () => {
    const { createFloorPlan, duplicateFloorPlan, putBlob, getBlob, useFloorPlans } = await load();
    const img = await putBlob(blob());
    const a = await createFloorPlan({ project: withImage(img, 'Flat') });
    const c = await duplicateFloorPlan(a);
    expect(useFloorPlans.getState().activeId).toBe(a);
    const copy = (await get<Project>(PLAN(c)))!;
    expect(copy.name).toBe('Flat copy');
    expect(copy.underlay?.imageId).toBe(img);
    expect(await getBlob(img)).toBeDefined();
  });

  test('delete: active plan → library; blobs another plan uses survive, its own are removed', async () => {
    const { createFloorPlan, duplicateFloorPlan, deleteFloorPlan, putBlob, getBlob, useFloorPlans } = await load();
    const shared = await putBlob(blob()), own = await putBlob(blob());
    const a = await createFloorPlan({ project: { ...withImage(shared), library: [] } });
    const b = await duplicateFloorPlan(a);
    const solo = await createFloorPlan({ project: withImage(own) });
    await deleteFloorPlan(solo);
    expect(useFloorPlans.getState().activeId).toBeNull();
    expect(await getBlob(own)).toBeUndefined();
    await deleteFloorPlan(a);
    expect(await get(PLAN(a))).toBeUndefined();
    expect(useFloorPlans.getState().plans.map((m) => m.id)).toEqual([b]);
    expect(await getBlob(shared)).toBeDefined();
    expect(await get('room-planner/last-open')).toBeUndefined();
  });

  test('import adds a new plan with a fresh id and never replaces the open one', async () => {
    const { createFloorPlan, exportFloorPlan, importFloorPlan, useFloorPlans, useStore } = await load();
    const a = await createFloorPlan({ name: 'A' });
    useStore.getState().addRoom({ points: tri, name: 'R' });
    const file = await exportFloorPlan(a); // open plan: exports the live state
    const n = await importFloorPlan(new File([file], 'a.roomplan'));
    expect(n).not.toBe(a);
    expect(useFloorPlans.getState().activeId).toBe(a);
    expect(useFloorPlans.getState().plans).toHaveLength(2);
    expect((await get<Project>(PLAN(n)))!.rooms.map((r) => r.name)).toEqual(['R']);
    await expect(importFloorPlan(new File(['junk'], 'x.roomplan'))).rejects.toThrow(/not a Room Planner file/);
    expect(useFloorPlans.getState().plans).toHaveLength(2);
  });

  test('startup orphan cleanup keeps blobs referenced by ANY plan', async () => {
    const first = await load();
    const ia = await first.putBlob(blob()), ib = await first.putBlob(blob()), orphan = await first.putBlob(blob());
    await first.createFloorPlan({ project: withImage(ia) });
    await first.createFloorPlan({ project: withImage(ib) });
    const again = await reload(); // reopens the second plan; the first is closed
    expect(await again.getBlob(ia)).toBeDefined();
    expect(await again.getBlob(ib)).toBeDefined();
    expect(await again.getBlob(orphan)).toBeUndefined();
  });

  const twoPlansWithImages = async () => {
    const first = await load();
    const ia = await first.putBlob(blob()), ib = await first.putBlob(blob());
    const a = await first.createFloorPlan({ project: withImage(ia, 'A') });
    const b = await first.createFloorPlan({ project: withImage(ib, 'B') });
    await first.closeFloorPlan();
    return { ia, ib, a, b };
  };

  test('a damaged index is backed up and rebuilt from the plan records; no image is deleted', async () => {
    const { ia, ib, a, b } = await twoPlansWithImages();
    const bad = [{ id: a, name: 'A', createdAt: 1, updatedAt: 1, roomCount: 0, areaCm2: 0, thumbnailSvg: '' }, null];
    await set('room-planner/plans', bad);
    const { useFloorPlans, usePersistence, getBlob } = await reload();
    expect(useFloorPlans.getState().plans.map((m) => m.id).sort()).toEqual([a, b].sort());
    expect(await getBlob(ia)).toBeDefined();
    expect(await getBlob(ib)).toBeDefined();
    expect(await get('room-planner/plans-backup')).toEqual(bad);
    expect(usePersistence.getState().notice).toMatch(/rebuilt/);
    expect((await get<{ id: string }[]>('room-planner/plans'))!.map((m) => m.id).sort()).toEqual([a, b].sort());
  });

  test('a missing index with plan records is rebuilt; no image is deleted, legacy key not re-migrated', async () => {
    const { ia, ib, a, b } = await twoPlansWithImages();
    await del('room-planner/plans');
    await set('room-planner/project', withImage(ia, 'Legacy'));
    const { useFloorPlans, getBlob } = await reload();
    expect(useFloorPlans.getState().plans.map((m) => m.id).sort()).toEqual([a, b].sort());
    expect(await getBlob(ia)).toBeDefined();
    expect(await getBlob(ib)).toBeDefined();
  });

  test('rename then an immediate open shows the new name', async () => {
    const { createFloorPlan, renameFloorPlan, openFloorPlan, useStore } = await load();
    const a = await createFloorPlan({ name: 'A' });
    await createFloorPlan({ name: 'B' });
    await Promise.all([renameFloorPlan(a, 'Renamed'), openFloorPlan(a)]);
    expect(useStore.getState().project.name).toBe('Renamed');
  });

  test('renaming the open plan is an undo step of its own', async () => {
    const { createFloorPlan, renameFloorPlan, useStore } = await load();
    const a = await createFloorPlan({ name: 'A' });
    await renameFloorPlan(a, 'Loft');
    useStore.getState().addRoom({ points: tri });
    useStore.getState().undo();
    expect(useStore.getState().project.name).toBe('Loft');
  });

  test('an edit made while deleting the open plan does not bring its record back', async () => {
    const { createFloorPlan, deleteFloorPlan, useStore } = await load();
    const a = await createFloorPlan({ name: 'A' });
    const d = deleteFloorPlan(a);
    useStore.getState().addRoom({ points: tri }); // lands while the plan is still open (autosave pending)
    await d;
    await new Promise((r) => setTimeout(r, 600));
    expect(await get(PLAN(a))).toBeUndefined();
  });

  test('delete succeeds (keeps images) when another plan record is damaged', async () => {
    const { ia, a, b } = await twoPlansWithImages();
    const { deleteFloorPlan, getBlob, useFloorPlans } = await reload();
    await set(PLAN(b), { junk: true });
    await expect(deleteFloorPlan(a)).resolves.toBeUndefined();
    expect(useFloorPlans.getState().plans.map((m) => m.id)).toEqual([b]);
    expect(await getBlob(ia)).toBeDefined();
  });

  test('a damaged plan record is backed up and opened as an empty plan, with a notice', async () => {
    const damaged = { version: 1, rooms: [{ id: 'r' }] };
    await set('room-planner/plans', [{ id: 'p', name: 'Broken', createdAt: 1, updatedAt: 1, roomCount: 1, areaCm2: 0, thumbnailSvg: '' }]);
    await set(PLAN('p'), damaged);
    await set('room-planner/last-open', 'p');
    const { useStore, usePersistence, useFloorPlans, BACKUP_KEY } = await load();
    expect(useFloorPlans.getState().activeId).toBe('p');
    expect(useStore.getState().project).toMatchObject({ name: 'Broken', rooms: [] });
    expect(usePersistence.getState().notice).toMatch(/backup/);
    expect(await get(BACKUP_KEY)).toEqual(damaged);
  });
});
