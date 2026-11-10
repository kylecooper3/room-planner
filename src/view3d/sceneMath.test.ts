import { describe, expect, it, vi } from 'vitest';
import type { Opening, Vec2 } from '../types';

vi.mock('../core/geometry', () => ({
  pointInPolygon: (p: Vec2, poly: Vec2[]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  },
}));

const { splitWall, buildWalls, wallFacesAway, planToWorld, itemRotationY } = await import('./sceneMath');

const area = (ps: { u0: number; u1: number; y0: number; y1: number }[]) =>
  ps.reduce((s, p) => s + (p.u1 - p.u0) * (p.y1 - p.y0), 0);

describe('splitWall', () => {
  it('no openings → one full piece', () => {
    expect(splitWall(400, 250, [])).toEqual([{ u0: 0, u1: 400, y0: 0, y1: 250 }]);
  });
  it('door + window: pieces fill the wall minus the holes', () => {
    const ps = splitWall(400, 250, [
      { start: 250, end: 350, bottom: 90, top: 210 }, // window
      { start: 50, end: 140, bottom: 0, top: 210 }, // door
    ]);
    expect(area(ps)).toBeCloseTo(400 * 250 - 90 * 210 - 100 * 120);
    ps.forEach((p) => { expect(p.u1).toBeGreaterThan(p.u0); expect(p.y1).toBeGreaterThan(p.y0); });
    // full-height pieces add up to the wall length minus opening widths
    const full = ps.filter((p) => p.y0 === 0 && p.y1 === 250).reduce((s, p) => s + p.u1 - p.u0, 0);
    expect(full).toBe(400 - 90 - 100);
  });
  it('clamps out-of-range and overlapping openings, never negative sizes', () => {
    const ps = splitWall(300, 250, [
      { start: -50, end: 60, bottom: 0, top: 300 },
      { start: 40, end: 120, bottom: 0, top: 200 },
      { start: 280, end: 400, bottom: 100, top: 150 },
      { start: 200, end: 190, bottom: 0, top: 100 },
    ]);
    ps.forEach((p) => {
      expect(p.u0).toBeGreaterThanOrEqual(0); expect(p.u1).toBeLessThanOrEqual(300);
      expect(p.u1).toBeGreaterThan(p.u0); expect(p.y1).toBeGreaterThan(p.y0); expect(p.y1).toBeLessThanOrEqual(250);
    });
    expect(area(ps)).toBeCloseTo(300 * 250 - 60 * 250 - 60 * 200 - 20 * 50);
  });
});

describe('plan → world', () => {
  it('maps cm to metres with y → z', () => {
    expect(planToWorld(250, 100)).toEqual([2.5, 0, 1]);
  });
  it('clockwise plan rotation is negative three.js yaw', () => {
    const ry = itemRotationY(90);
    expect(ry).toBeCloseTo(-Math.PI / 2);
    // local +z (front) after rotation.y: (sin ry, cos ry) in world x,z; at 90° cw the front (plan +y) points to plan -x
    expect(Math.sin(ry)).toBeCloseTo(-1);
    expect(Math.cos(ry)).toBeCloseTo(0);
  });
});

describe('cutaway', () => {
  const cw: Vec2[] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const ccw = [...cw].reverse();
  const room = (points: Vec2[]) => ({ points, openings: [] as Opening[], wallThickness: 10, ceilingHeight: 250 });
  const cams: [string, number, number][] = [['north', 200, -500], ['south', 200, 800], ['west', -500, 150], ['east', 900, 150]];
  const sideOf = (m: Vec2) => (m.y === 0 ? 'north' : m.y === 300 ? 'south' : m.x === 0 ? 'west' : 'east');
  for (const [name, pts] of [['cw', cw], ['ccw', ccw]] as const) {
    it(`hides exactly the wall nearest the camera (${name})`, () => {
      const walls = buildWalls(room(pts));
      for (const [cam, x, y] of cams) {
        const hidden = walls.filter((w) => wallFacesAway(w, x, y)).map((w) => sideOf(w.mid));
        expect(hidden).toEqual([cam]);
      }
      // camera inside the room hides nothing
      expect(walls.some((w) => wallFacesAway(w, 200, 150))).toBe(false);
    });
  }
  it('inward normals point into the room for both windings', () => {
    for (const pts of [cw, ccw]) {
      for (const w of buildWalls(room(pts))) {
        const p = { x: w.mid.x + w.normalIn.x * 10, y: w.mid.y + w.normalIn.y * 10 };
        expect(p.x > 0 && p.x < 400 && p.y > 0 && p.y < 300).toBe(true);
      }
    }
  });
});
