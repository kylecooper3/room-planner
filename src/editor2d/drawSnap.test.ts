import { describe, expect, it } from 'vitest';
import { snapPoint, type InkSnap } from './drawSnap';
import { insertCorner, setWallLength } from './wallEdit';
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
