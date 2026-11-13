import { beforeEach, describe, expect, it } from 'vitest';
import type { Opening, Vec2 } from '../types';
import { useStore } from '../store/store';
import { isProject } from '../store/projectFile';
import { selectActiveRoom } from '../store/selectors';
import { buildWalls } from '../view3d/sceneMath';
import { houseColliders, housePassages, walkStep } from '../view3d/walk';
import { findIssues } from '../core/collision';
import { insertCorner, openingsClash, toggleOpenWall } from './wallEdit';

const s = () => useStore.getState();
const room = () => selectActiveRoom(s())!;
const rect = (w: number, h: number): Vec2[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const gap = (o: Partial<Opening> = {}): Omit<Opening, 'id'> => ({ kind: 'open', wall: 0, offset: 200, width: 90, height: 0, sill: 0, ...o });

beforeEach(() => { s().newProject(); s().addRoom({ points: rect(400, 300) }); });

describe('open gaps (kind "open")', () => {
  it('validate in saved projects; unknown kinds do not', () => {
    s().addOpening(gap());
    const p = s().project;
    expect(isProject(p)).toBe(true);
    const bad = { ...p, rooms: p.rooms.map((r) => ({ ...r, openings: r.openings.map((o) => ({ ...o, kind: 'hole' })) })) };
    expect(isProject(bad)).toBe(false);
  });

  it('Open this wall adds one full-length gap (one undo step); Close removes every gap on it', () => {
    s().addOpening(gap({ offset: 100, width: 50 }));
    expect(toggleOpenWall(s(), room(), 0)).toBe(true); // a wall with a partial gap counts as open: closes it
    expect(room().openings).toHaveLength(0);
    toggleOpenWall(s(), room(), 0);
    expect(room().openings).toEqual([expect.objectContaining({ kind: 'open', wall: 0, offset: 200, width: 400 })]);
    expect(s().ui.selection).toEqual({ type: 'wall', index: 0 });
    s().undo();
    expect(room().openings).toHaveLength(0);
  });

  it('a wall with a door cannot be opened; gaps never overlap other openings', () => {
    s().addOpening({ kind: 'door', wall: 1, offset: 150, width: 80, height: 200, sill: 0 });
    expect(toggleOpenWall(s(), room(), 1)).toBe(false);
    expect(room().openings).toHaveLength(1);
    const os = room().openings;
    expect(openingsClash(os, gap({ wall: 1, offset: 150 }))).toBe(true);
    expect(openingsClash(os, gap({ wall: 1, offset: 150 + 85 + 1 }))).toBe(false); // just clear of the door
    expect(openingsClash(os, gap({ wall: 0, offset: 150 }))).toBe(false); // another wall
    // Doors / windows / fixtures may still share wall with each other (a radiator under a window).
    expect(openingsClash(os, { kind: 'radiator', wall: 1, offset: 150, width: 100 })).toBe(false);
  });

  it('a full-wall gap follows its wall when corners move, and is clamped when it no longer fits', () => {
    toggleOpenWall(s(), room(), 0);
    s().updateRoom(room().id, { points: rect(500, 300) });
    expect(room().openings[0]).toMatchObject({ width: 500, offset: 250 });
    s().addOpening(gap({ wall: 2, offset: 300, width: 200 }));
    s().updateRoom(room().id, { points: rect(150, 300) });
    expect(room().openings[1]).toMatchObject({ width: 150, offset: 75 });
  });

  it('splitting a wall splits a gap across the new corner and renumbers later walls', () => {
    toggleOpenWall(s(), room(), 0);
    s().addOpening(gap({ wall: 2, offset: 100, width: 60 }));
    insertCorner(s(), room(), 0, 0.25);
    const os = room().openings;
    expect(os).toHaveLength(3);
    expect(os.find((o) => o.wall === 0)).toMatchObject({ offset: 50, width: 100 });
    expect(os.find((o) => o.wall === 1)).toMatchObject({ offset: 150, width: 300 });
    expect(os.find((o) => o.wall === 3)).toMatchObject({ offset: 100, width: 60 });
    s().undo();
    expect(room().openings).toHaveLength(2);
  });

  it('3D: no wall above the gap; walk mode passes through; no door swing in the fit check', () => {
    s().addOpening(gap({ wall: 1, offset: 150, width: 120 }));
    const r = room();
    const right = buildWalls(r)[1];
    expect(right.pieces.map((p) => [p.u0, p.u1, p.y0, p.y1])).toEqual([[0, 90, 0, r.ceilingHeight], [210, 300, 0, r.ceilingHeight]]);
    const colliders = houseColliders([r], housePassages([r]), () => undefined);
    const p = { x: 200, y: 150 };
    for (let i = 0; i < 60; i++) walkStep(p, 10, 0, colliders);
    expect(p.x).toBeGreaterThan(450);
    expect(findIssues(r, r.layouts[0], () => undefined)).toEqual([]);
  });
});
