import { describe, expect, it } from 'vitest';
import { flushDistance, resizeOpening, sharedChain, slideWall, snapSlide, wallJoin, wallNormal } from './wallEdit';
import { wallOutline } from './view';
import type { Room, Vec2 } from '../types';

const square: Vec2[] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
const box = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const room = (id: string, points: Vec2[]): Room => ({
  id, name: id, points, ceilingHeight: 250, wallThickness: 12, openings: [], wallColor: '#fff', floor: 'wood', layouts: [], activeLayoutId: '',
});

describe('slideWall', () => {
  it('moves the wall along its outward normal; the neighbours stretch', () => {
    expect(wallNormal(square, 1).x).toBe(1);
    expect(wallNormal(square, 1).y).toBeCloseTo(0);
    expect(slideWall(square, 1, 30)).toEqual([{ x: 0, y: 0 }, { x: 430, y: 0 }, { x: 430, y: 300 }, { x: 0, y: 300 }]);
    expect(slideWall(square, 0, -20)).toEqual([{ x: 0, y: 20 }, { x: 400, y: 20 }, { x: 400, y: 300 }, { x: 0, y: 300 }]);
    // the other winding: still outward
    const ccw = [...square].reverse();
    expect(slideWall(ccw, 0, 10)[0]).toEqual({ x: 0, y: 310 });
  });
  it('ends slide along slanted neighbours, keeping their direction and the wall parallel', () => {
    const trap = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 300, y: 300 }, { x: 100, y: 300 }];
    const p = slideWall(trap, 2, 30); // bottom wall down 30
    expect(p[2].y).toBeCloseTo(330);
    expect(p[3].y).toBeCloseTo(330);
    expect(p[2].x).toBeCloseTo(290); // along the right wall (direction (-1, 3))
    expect(p[3].x).toBeCloseTo(110);
  });
});

describe('flushDistance / snapSlide', () => {
  it('signed slide onto a parallel face that runs alongside; null otherwise', () => {
    expect(flushDistance(square, 1, { a: { x: 425, y: 50 }, b: { x: 425, y: 200 } })).toBeCloseTo(25);
    expect(flushDistance(square, 1, { a: { x: 390, y: 50 }, b: { x: 390, y: 200 } })).toBeCloseTo(-10);
    expect(flushDistance(square, 1, { a: { x: 425, y: 50 }, b: { x: 440, y: 200 } })).toBeNull(); // not parallel
    expect(flushDistance(square, 1, { a: { x: 425, y: 400 }, b: { x: 425, y: 600 } })).toBeNull(); // not alongside
  });
  it("snaps the dragged wall onto a neighbour's outer face within the tolerance", () => {
    const n = { id: 'n', inner: box(500, 0, 800, 300), outer: wallOutline(box(500, 0, 800, 300), 12) }; // outer face x = 488
    expect(snapSlide(square, 1, 80, [n], 25)).toEqual({ d: 88, link: { roomId: 'n', wall: 3 } });
    expect(snapSlide(square, 1, 40, [n], 25)).toEqual({ d: 40 });
  });
  it("lines the dragged wall up with a neighbour's wall that faces the same way, with a guide through both", () => {
    // R's left wall (wall 3, x = 10) sits under N's left wall (inner x = 0): sliding it out by 10 lines them up.
    const r = box(10, 400, 300, 700);
    const n = { id: 'n', inner: box(0, 0, 400, 300), outer: wallOutline(box(0, 0, 400, 300), 12) };
    const s = snapSlide(r, 3, 7, [n], 25, 5, 12);
    expect(s.d).toBeCloseTo(10);
    expect(s.link).toBeUndefined();
    expect(s.guide!.a.x).toBeCloseTo(0);
    expect(s.guide!.b.x).toBeCloseTo(0);
    expect(Math.min(s.guide!.a.y, s.guide!.b.y)).toBeCloseTo(0); // runs from N's wall…
    expect(Math.max(s.guide!.a.y, s.guide!.b.y)).toBeCloseTo(700); // …down R's wall
    expect(snapSlide(r, 3, 0, [n], 25, 5, 12)).toEqual({ d: 0 }); // 10 cm away: beyond the 5 cm line-up reach
    expect(snapSlide(box(410, 400, 700, 700), 3, 5, [n], 25, 5, 12).guide).toBeUndefined(); // N's right wall faces the other way
  });
});

describe('wallJoin', () => {
  it('slides a wall with a near-miss flush; nothing for an attached or unrelated wall', () => {
    const a = room('a', square), b = room('b', box(420, 0, 700, 300)); // 8 cm between a's wall line (400) and b's outer face (408)
    const j = wallJoin([a, b], 'a', 1); // equal walls: the mark is on the first room's wall
    expect(j?.miss.kind).toBe('gap');
    expect(j?.points[1]).toEqual({ x: 408, y: 0 });
    expect(j?.points[2]).toEqual({ x: 408, y: 300 });
    expect(wallJoin([a, b], 'a', 3)).toBeNull();
    expect(wallJoin([a, room('b', box(412, 0, 700, 300))], 'a', 1)).toBeNull(); // attached
  });
});

describe('resizeOpening', () => {
  it('moves one end, keeps the other; stays on the wall and within the kind width range', () => {
    const gap = { kind: 'open' as const, offset: 200, width: 100 }; // ends at 150 and 250 on a 400 cm wall
    expect(resizeOpening(gap, 'b', 330, 400)).toEqual({ width: 180, offset: 240 });
    expect(resizeOpening(gap, 'a', 20, 400)).toEqual({ width: 230, offset: 135 });
    expect(resizeOpening(gap, 'a', -80, 400)).toEqual({ width: 250, offset: 125 }); // stops at the wall start
    expect(resizeOpening(gap, 'b', 140, 400).width).toBe(10); // past the other end: the kind's minimum
    const door = { kind: 'door' as const, offset: 200, width: 80 }; // 160..240
    expect(resizeOpening(door, 'b', 600, 400).width).toBe(200); // the door maximum
    expect(resizeOpening({ ...door, offset: 320 }, 'b', 600, 400).width).toBe(120); // 280..400: stops at the wall end
    expect(resizeOpening(door, 'b', 150, 400).width).toBe(60); // the door minimum
  });
});

describe('sharedChain', () => {
  it('follows shared walls through a long wall shared by two rooms; partners slide the other way', () => {
    // A's wall 1 is shared with B's wall 3 and with C's wall 3. Dragging B's wall moves A's whole wall, so C's must follow.
    const shared = [{ owner: { room: 0, wall: 1 }, other: { room: 1, wall: 3 } }, { owner: { room: 0, wall: 1 }, other: { room: 2, wall: 3 } }];
    expect(sharedChain(shared, { room: 1, wall: 3 })).toEqual(expect.arrayContaining([
      { room: 1, wall: 3, sign: 1 }, { room: 0, wall: 1, sign: -1 }, { room: 2, wall: 3, sign: 1 },
    ]));
    expect(sharedChain(shared, { room: 1, wall: 3 })).toHaveLength(3);
    expect(sharedChain([], { room: 0, wall: 2 })).toEqual([{ room: 0, wall: 2, sign: 1 }]);
  });
});
