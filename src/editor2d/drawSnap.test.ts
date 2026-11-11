import { describe, expect, it } from 'vitest';
import { snapPoint, type InkSnap } from './drawSnap';
import { deleteCorner, insertCorner, setWallLength } from './wallEdit';
import type { Room } from '../types';

const square = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];

describe('snapPoint', () => {
  it("snaps to another room's corner exactly, before anything else", () => {
    const h = snapPoint({ raw: { x: 403, y: -4 }, prev: { x: 600, y: 50 }, align: [], rooms: [square], threshold: 10 });
    expect(h).toMatchObject({ p: { x: 400, y: 0 }, kind: 'corner' });
  });
  it('right angle to the previous point, then aligns the free coordinate with earlier points (with a guide)', () => {
    const h = snapPoint({ raw: { x: 7, y: 205 }, prev: { x: 200, y: 200 }, align: [{ x: 0, y: 0 }], rooms: [], threshold: 10 });
    expect(h.p).toEqual({ x: 0, y: 200 });
    expect(h.kind).toBe('align');
    expect(h.guides).toEqual([{ a: { x: 0, y: 0 }, b: { x: 0, y: 200 } }]);
  });
  it('uses the image ink along the axis being drawn when nothing aligns', () => {
    const ink: InkSnap = (p, axis) => (axis === 'x' ? 250 : null);
    const h = snapPoint({ raw: { x: 246, y: 103 }, prev: { x: 0, y: 100 }, align: [], rooms: [], ink, threshold: 10 });
    expect(h).toMatchObject({ p: { x: 250, y: 100 }, kind: 'ink' });
    expect(snapPoint({ raw: { x: 246, y: 103 }, prev: { x: 0, y: 100 }, align: [], rooms: [], threshold: 10 }))
      .toMatchObject({ p: { x: 246, y: 100 }, kind: 'angle' });
  });
  it('a nearer plan-wall face beats a corner across the wall', () => {
    const ink: InkSnap = (p, axis) => (axis === 'x' ? 412 : 0);
    expect(snapPoint({ raw: { x: 412, y: 1 }, align: [], rooms: [square], ink, threshold: 15 })).toMatchObject({ p: { x: 412, y: 0 } });
  });
  it('free point: walls of other rooms, else per-axis ink', () => {
    expect(snapPoint({ raw: { x: 150, y: 306 }, align: [], rooms: [square], threshold: 10 })).toMatchObject({ p: { x: 150, y: 300 }, kind: 'wall' });
    const ink: InkSnap = (p, axis) => (axis === 'x' ? 1000 : 2000);
    expect(snapPoint({ raw: { x: 1003, y: 1996 }, align: [], rooms: [square], ink, threshold: 10 })).toMatchObject({ p: { x: 1000, y: 2000 }, kind: 'ink' });
  });
});

describe('setWallLength', () => {
  it('moves the end corner and keeps a rectangle rectangular', () => {
    const p = setWallLength(square, 0, 500);
    expect(p).toEqual([{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }, { x: 0, y: 300 }]);
    const q = setWallLength(square, 3, 100); // last wall (0,300)->(0,0): its end is points[0]
    expect(q[0]).toEqual({ x: 0, y: 200 });
    expect(q[1]).toEqual({ x: 400, y: 200 });
    expect(setWallLength(square, 1, -3)).toBe(square);
  });
  it('only moves the end corner when the next wall is not perpendicular', () => {
    const tri = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
    expect(setWallLength(tri, 0, 50)).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 100 }]);
  });
});

describe('insertCorner', () => {
  it('splits a wall in one batch and re-indexes openings', () => {
    const calls: string[] = [];
    const room = { id: 'r', points: square, openings: [{ id: 'a', wall: 0, offset: 300 }, { id: 'b', wall: 2, offset: 10 }] } as unknown as Room;
    const st = {
      beginBatch: () => calls.push('begin'), endBatch: () => calls.push('end'),
      updateOpening: (id: string, p: object) => calls.push(`${id}:${JSON.stringify(p)}`),
      updateRoom: (_: string, p: { points?: unknown[] }) => calls.push(`room:${p.points?.length}`),
      select: () => calls.push('select'),
    };
    insertCorner(st, room, 0, 0.5);
    expect(calls).toEqual(['begin', 'a:{"wall":1,"offset":100}', 'b:{"wall":3}', 'room:5', 'end', 'select']);
  });
});

describe('deleteCorner', () => {
  // Pentagon-ish: square with an extra corner (200,0) splitting the top wall.
  const pts = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const run = (k: number, openings: object[]) => {
    const calls: string[] = [];
    const room = { id: 'r', points: pts, openings } as unknown as Room;
    const st = {
      beginBatch: () => calls.push('begin'), endBatch: () => calls.push('end'),
      updateOpening: (id: string, p: object) => calls.push(`${id}:${JSON.stringify(p)}`),
      deleteOpening: (id: string) => calls.push(`del:${id}`),
      updateRoom: (_: string, p: { points?: unknown[] }) => calls.push(`room:${p.points?.length}`),
      select: () => calls.push('select'),
    };
    return { ok: deleteCorner(st, room, k), calls };
  };
  it('merges the two walls onto one and shifts later walls down, in one batch', () => {
    const { ok, calls } = run(1, [
      { id: 'a', wall: 0, offset: 50, width: 80 }, { id: 'b', wall: 1, offset: 100, width: 80 },
      { id: 'c', wall: 3, offset: 10, width: 10 }, { id: 'big', wall: 1, offset: 100, width: 500 },
    ]);
    expect(ok).toBe(true);
    expect(calls).toEqual(['begin', 'a:{"wall":0,"offset":50}', 'b:{"wall":0,"offset":300}', 'c:{"wall":2}', 'del:big', 'room:4', 'end', 'select']);
  });
  it('wraps around when deleting corner 0: the merged wall is the last one', () => {
    // Deleting (0,0) merges wall 4 ((0,300)→(0,0)) and wall 0 ((0,0)→(200,0)) into (0,300)→(200,0), length 360.
    const { calls } = run(0, [{ id: 'a', wall: 4, offset: 300, width: 20 }, { id: 'b', wall: 0, offset: 100, width: 20 }, { id: 'c', wall: 2, offset: 5, width: 1 }]);
    expect(calls[1]).toMatch(/^a:\{"wall":3,"offset":/);
    expect(JSON.parse(calls[1].slice(2)).offset).toBeCloseTo(249.6, 1); // centre (0,0) projected onto the merged wall
    expect(calls[2]).toMatch(/^b:\{"wall":3,"offset":/);
    expect(JSON.parse(calls[2].slice(2)).offset).toBeCloseTo(305.1, 1); // centre (100,0)
    expect(calls.slice(3)).toEqual(['c:{"wall":1}', 'room:4', 'end', 'select']);
  });
  it('refuses to go below 3 corners', () => {
    expect(run(0, []).ok).toBe(true);
    const tri = { id: 'r', points: pts.slice(0, 3), openings: [] } as unknown as Room;
    expect(deleteCorner({} as never, tri, 0)).toBe(false);
  });
});
