import 'fake-indexeddb/auto';
import { describe, expect, test, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import type { Project } from '../types';

vi.mock('../core/geometry', () => ({ rectRoomPoints: () => [], polygonCentroid: () => ({ x: 0, y: 0 }) }));
vi.mock('../models/presets', () => ({ PRESETS: [] }));

import { deleteBlob, getBlob, putBlob } from './blobs';
import { exportProject, importProject } from './projectFile';
import { initPersistence } from './persistence';
import { emptyProject, useStore } from './store';

const bytes = (b: Blob) => b.arrayBuffer().then((a) => Array.from(new Uint8Array(a)));

test('blob put/get/delete round trip', async () => {
  const id = await putBlob(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  const got = await getBlob(id);
  expect(got?.type).toBe('image/png');
  expect(await bytes(got!)).toEqual([1, 2, 3]);
  await deleteBlob(id);
  expect(await getBlob(id)).toBeUndefined();
});

describe('project file', () => {
  test('export → import round trip keeps project and blobs', async () => {
    const imageId = await putBlob(new Blob([new Uint8Array([9, 8])], { type: 'image/jpeg' }));
    const photoId = await putBlob(new Blob([new Uint8Array([7])], { type: 'image/webp' }));
    const project: Project = {
      ...emptyProject(),
      underlay: { imageId, widthPx: 10, heightPx: 10, cmPerPx: 1, x: 0, y: 0, opacity: 0.5, visible: true },
      library: [
        { id: 'u1', name: 'Chair', size: { w: 1, d: 1, h: 1 }, model: { kind: 'mesh', meshId: 'm' }, clearances: [], source: 'user', photoId },
        { id: 'u2', name: 'Gone', size: { w: 1, d: 1, h: 1 }, model: { kind: 'mesh', meshId: 'm' }, clearances: [], source: 'user', photoId: 'missing' },
      ],
    };
    const file = await exportProject(project);
    await deleteBlob(imageId);
    await deleteBlob(photoId);
    expect(await importProject(file)).toEqual(project);
    const img = await getBlob(imageId);
    expect(img?.type).toBe('image/jpeg');
    expect(await bytes(img!)).toEqual([9, 8]);
    expect((await getBlob(photoId))?.type).toBe('image/webp');
    expect(await getBlob('missing')).toBeUndefined();
  });

  test('invalid files are rejected', async () => {
    await expect(importProject(new Blob(['hello']))).rejects.toThrow(/not a Room Planner file/);
    const zip = (json: unknown) => new Blob([zipSync({ 'project.json': strToU8(JSON.stringify(json)) })]);
    await expect(importProject(zip({ format: 'other', version: 1 }))).rejects.toThrow(/not a Room Planner file/);
    await expect(importProject(zip({ format: 'room-planner', version: 2 }))).rejects.toThrow(/version/);
    await expect(importProject(zip({ format: 'room-planner', version: 1, project: { rooms: 1 } }))).rejects.toThrow(/damaged/);
  });
});

test('persistence: autosave then reload restores the project', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await initPersistence();
  expect(useStore.getState().hydrated).toBe(true);
  useStore.getState().addRoom({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }], name: 'Saved' });
  const saved = useStore.getState().project;
  await vi.advanceTimersByTimeAsync(500);
  vi.useRealTimers();
  await new Promise((r) => setTimeout(r, 50)); // let the IndexedDB write settle

  useStore.setState({ project: emptyProject(), hydrated: false });
  await initPersistence();
  expect(useStore.getState().hydrated).toBe(true);
  expect(useStore.getState().project).toEqual(saved);
});
