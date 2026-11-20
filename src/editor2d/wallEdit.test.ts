import { describe, expect, it } from 'vitest';
import { flushDistance, slideWall, snapSlide, wallJoin, wallNormal } from './wallEdit';
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
