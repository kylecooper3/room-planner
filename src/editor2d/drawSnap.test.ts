import { describe, expect, it } from 'vitest';
import { cornerAngle, isRightAngle, snapPoint, type InkSnap } from './drawSnap';
import { deleteCorner, insertCorner, setWallLength } from './wallEdit';
import type { Room } from '../types';

const square = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];

describe('snapPoint', () => {
  // pxPerCm 1: the 10 px radius is 10 cm.
  const base = { align: [] as { x: number; y: number }[], rooms: [] as { x: number; y: number }[][], pxPerCm: 1 };
  it("snaps to another room's corner exactly, before anything else", () => {
    const h = snapPoint({ ...base, raw: { x: 403, y: -4 }, prev: { x: 600, y: 50 }, rooms: [square] });
    expect(h).toMatchObject({ p: { x: 400, y: 0 }, kind: 'corner' });
  });
  it('right angle to the previous point, then aligns the free coordinate with earlier points (with a guide)', () => {
    const h = snapPoint({ ...base, raw: { x: 7, y: 205 }, prev: { x: 200, y: 200 }, align: [{ x: 0, y: 0 }] });
    expect(h.p).toEqual({ x: 0, y: 200 });
    expect(h.kind).toBe('align');
    expect(h.guides).toEqual([{ a: { x: 0, y: 0 }, b: { x: 0, y: 200 } }]);
  });
  it('uses the image ink along the axis being drawn when nothing aligns', () => {
    const ink: InkSnap = (p, axis) => (axis === 'x' ? 250 : null);
    const h = snapPoint({ ...base, raw: { x: 246, y: 103 }, prev: { x: 0, y: 100 }, ink });
    expect(h).toMatchObject({ p: { x: 250, y: 100 }, kind: 'ink' });
    expect(snapPoint({ ...base, raw: { x: 246, y: 103 }, prev: { x: 0, y: 100 } })).toMatchObject({ p: { x: 246, y: 100 }, kind: 'angle' });
  });
  it('a nearer plan-wall face beats a corner across the wall', () => {
    const ink: InkSnap = (p, axis) => (axis === 'x' ? 412 : 0);
    expect(snapPoint({ ...base, raw: { x: 412, y: 1 }, rooms: [square], ink, pxPerCm: 10 / 15 })).toMatchObject({ p: { x: 412, y: 0 } });
  });
  it('free point: walls of other rooms, else per-axis ink', () => {
    expect(snapPoint({ ...base, raw: { x: 150, y: 306 }, rooms: [square] })).toMatchObject({ p: { x: 150, y: 300 }, kind: 'wall' });
    const ink: InkSnap = (p, axis) => (axis === 'x' ? 1000 : 2000);
    expect(snapPoint({ ...base, raw: { x: 1003, y: 1996 }, rooms: [square], ink })).toMatchObject({ p: { x: 1000, y: 2000 }, kind: 'ink' });
  });

  it('the radius is in screen px: the same 9 cm snaps zoomed out but not zoomed in', () => {
    const raw = { x: 409, y: 0 }; // 9 cm from the corner (400, 0)
    expect(snapPoint({ ...base, raw, rooms: [square], pxPerCm: 1 }).kind).toBe('corner'); // 9 px
    expect(snapPoint({ ...base, raw, rooms: [square], pxPerCm: 0.25 }).kind).toBe('corner'); // 2.25 px
    expect(snapPoint({ ...base, raw: { x: 409, y: -9 }, rooms: [square], pxPerCm: 2 })).toEqual({ p: { x: 409, y: -9 }, kind: null, guides: [] }); // 18 px+
    // Zoomed out, a corner 32 cm away is 8 px: snaps; at 1 px/cm it is 32 px: does not.
    expect(snapPoint({ ...base, raw: { x: 425, y: -20 }, rooms: [square], pxPerCm: 0.25 }).kind).toBe('corner');
    expect(snapPoint({ ...base, raw: { x: 425, y: -20 }, rooms: [square], pxPerCm: 1 }).kind).toBe(null);
  });
  it('nothing beyond the radius moves the point, ink included', () => {
    const ink: InkSnap = () => 0; // a (buggy) ink callback reporting a boundary far away
    const raw = { x: 500, y: 600 };
    expect(snapPoint({ ...base, raw, rooms: [square], ink, align: [{ x: 489, y: 611 }] })).toEqual({ p: raw, kind: null, guides: [] });
  });
  it('right angles lock only within the angle tolerance and the radius; otherwise the point follows the mouse', () => {
    const prev = { x: 0, y: 0 };
    expect(snapPoint({ ...base, raw: { x: 200, y: 6 }, prev }).p).toEqual({ x: 200, y: 0 }); // 1.7°, 6 px
    expect(snapPoint({ ...base, raw: { x: 200, y: 40 }, prev })).toMatchObject({ p: { x: 200, y: 40 }, kind: null }); // 11°: free
    expect(snapPoint({ ...base, raw: { x: 2000, y: 30 }, prev })).toMatchObject({ p: { x: 2000, y: 30 }, kind: null }); // 0.9° but 30 px off
    expect(snapPoint({ ...base, raw: { x: 2000, y: 30 }, prev, pxPerCm: 0.25 }).p).toEqual({ x: 2000, y: 0 }); // zoomed out: 7.5 px
    expect(snapPoint({ ...base, raw: { x: 5, y: 300 }, prev }).p).toEqual({ x: 0, y: 300 }); // vertical
  });
  it('free (Alt held / snapping off) returns the cursor exactly', () => {
    const raw = { x: 401, y: 1 };
    expect(snapPoint({ ...base, raw, rooms: [square], prev: { x: 0, y: 0 }, free: true })).toEqual({ p: raw, kind: null, guides: [] });
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

describe('cornerAngle / isRightAngle', () => {
  const o = { x: 0, y: 0 };
  it('square, acute, obtuse and degenerate corners', () => {
    expect(cornerAngle({ x: 100, y: 0 }, o, { x: 0, y: 100 })).toBeCloseTo(90);
    expect(isRightAngle(cornerAngle({ x: 100, y: 0 }, o, { x: 0, y: 100 }))).toBe(true);
    expect(cornerAngle({ x: 100, y: 0 }, o, { x: 100, y: 100 })).toBeCloseTo(45);
    expect(isRightAngle(cornerAngle({ x: 100, y: 0 }, o, { x: 3, y: 100 }))).toBe(false); // ~88.3°
    expect(cornerAngle({ x: 100, y: 0 }, o, { x: -100, y: 1 })).toBeGreaterThan(179);
    expect(cornerAngle(o, o, { x: 0, y: 100 })).toBeNull();
  });
});
