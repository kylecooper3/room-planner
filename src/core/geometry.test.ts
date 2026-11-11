import { describe, expect, test } from 'vitest';
import type { Opening, Vec2 } from '../types';
import {
  clearancePolygon, distancesToWalls, doorSwingPolygon, getOpeningGeometry, itemPolygon, localToPlan, pointInPolygon,
  polygonArea, polygonCentroid, polygonInsideRoom, polygonsIntersect, projectOnWalls, rectRoomPoints, snapItem,
  snapRightAngle, wallSegments,
} from './geometry';

const near = (p: Vec2, q: Vec2) => { expect(p.x).toBeCloseTo(q.x, 6); expect(p.y).toBeCloseTo(q.y, 6); };
const rect = rectRoomPoints(300, 400);
const L: Vec2[] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 400 }, { x: 0, y: 400 }];
const door = (o: Partial<Opening> = {}): Opening =>
  ({ id: 'd', kind: 'door', wall: 0, offset: 100, width: 80, height: 200, sill: 0, swing: { hinge: 'start', side: 'in' }, ...o });

test('basic polygon helpers', () => {
  expect(rect).toEqual([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }, { x: 0, y: 400 }]);
  expect(wallSegments(rect)[3]).toEqual({ a: rect[3], b: rect[0] });
  expect(polygonArea(rect)).toBe(120000);
  expect(polygonArea([...rect].reverse())).toBe(120000);
  expect(polygonArea(L)).toBe(120000);
  near(polygonCentroid(rect), { x: 150, y: 200 });
  expect(pointInPolygon({ x: 100, y: 100 }, L)).toBe(true);
  expect(pointInPolygon({ x: 300, y: 300 }, L)).toBe(false);
});

test('rotation convention: rotation 90 turns the front (+y) to point left (-x)', () => {
  near(localToPlan({ x: 0, y: 0, rotation: 0 }, { x: 0, y: 1 }), { x: 0, y: 1 });
  near(localToPlan({ x: 0, y: 0, rotation: 90 }, { x: 0, y: 1 }), { x: -1, y: 0 });
  near(localToPlan({ x: 10, y: 20, rotation: 90 }, { x: 1, y: 0 }), { x: 10, y: 21 });
});

test('item and clearance polygons', () => {
  const pose = { x: 100, y: 100, rotation: 0 }, size = { w: 40, d: 20, h: 10 };
  expect(itemPolygon(pose, size)).toEqual([{ x: 80, y: 90 }, { x: 120, y: 90 }, { x: 120, y: 110 }, { x: 80, y: 110 }]);
  const z = (side: 'front' | 'back' | 'left' | 'right') => clearancePolygon(pose, size, { kind: 'drawer', side, depth: 30, label: 'x' });
  expect(z('front')).toEqual([{ x: 80, y: 110 }, { x: 120, y: 110 }, { x: 120, y: 140 }, { x: 80, y: 140 }]);
  expect(z('back')[0]).toEqual({ x: 80, y: 60 });
  expect(z('left')[0]).toEqual({ x: 50, y: 90 });
  expect(z('right')[2]).toEqual({ x: 150, y: 110 });
  // rotated 90: front zone lies to the left of the item
  const rz = clearancePolygon({ ...pose, rotation: 90 }, size, { kind: 'drawer', side: 'front', depth: 30, label: 'x' });
  for (const p of rz) expect(p.x).toBeLessThanOrEqual(90 + 1e-9);
});

describe('opening geometry', () => {
  test('rect, both windings', () => {
    const g = getOpeningGeometry(rect, door());
    near(g.a, { x: 60, y: 0 }); near(g.b, { x: 140, y: 0 }); near(g.center, { x: 100, y: 0 });
    expect(g.angle).toBeCloseTo(0); near(g.normalIn, { x: 0, y: 1 });
    const rev = [...rect].reverse(); // wall 0: (0,400)->(300,400)
    const r = getOpeningGeometry(rev, door());
    near(r.center, { x: 100, y: 400 }); near(r.normalIn, { x: 0, y: -1 });
    near(getOpeningGeometry(rev, door({ wall: 1 })).normalIn, { x: -1, y: 0 }); // (300,400)->(300,0)
  });
  test('concave room', () => {
    near(getOpeningGeometry(L, door({ wall: 3 })).normalIn, { x: -1, y: 0 });
    near(getOpeningGeometry(L, door({ wall: 2 })).normalIn, { x: 0, y: -1 });
    near(getOpeningGeometry([...L].reverse(), door({ wall: 1 })).normalIn, { x: -1, y: 0 }); // (200,400)->(200,200)
  });
});

describe('door swing', () => {
  test('quarter disc into the room', () => {
    const p = doorSwingPolygon(rect, door())!;
    expect(p.length).toBeGreaterThanOrEqual(10);
    near(p[0], { x: 60, y: 0 });
    near(p[1], { x: 140, y: 0 });
    near(p[p.length - 1], { x: 60, y: 80 });
    for (const q of p.slice(1)) expect(Math.hypot(q.x - 60, q.y)).toBeCloseTo(80);
    expect(polygonArea(p)).toBeGreaterThan(0.97 * (Math.PI * 80 * 80) / 4);
    expect(polygonInsideRoom(p, rect)).toBe(true);
  });
  test('hinge end, swing out, non-doors', () => {
    const e = doorSwingPolygon(rect, door({ swing: { hinge: 'end', side: 'in' } }))!;
    near(e[0], { x: 140, y: 0 }); near(e[1], { x: 60, y: 0 }); near(e[e.length - 1], { x: 140, y: 80 });
    const o = doorSwingPolygon(rect, door({ swing: { hinge: 'start', side: 'out' } }))!;
    near(o[o.length - 1], { x: 60, y: -80 });
    expect(doorSwingPolygon(rect, door({ kind: 'window' }))).toBeNull();
  });
});

describe('intersection tests', () => {
  const sq = (x: number, y: number, s = 10) => itemPolygon({ x, y, rotation: 0 }, { w: s, d: s, h: 1 });
  test('polygonsIntersect tolerates touching', () => {
    expect(polygonsIntersect(sq(0, 0), sq(5, 5))).toBe(true);
    expect(polygonsIntersect(sq(0, 0), sq(10, 0))).toBe(false);
    expect(polygonsIntersect(sq(0, 0), sq(9.7, 0))).toBe(false);
    expect(polygonsIntersect(sq(0, 0), sq(9, 0))).toBe(true);
    expect(polygonsIntersect(sq(0, 0), sq(30, 0))).toBe(false);
  });
  test('polygonInsideRoom', () => {
    expect(polygonInsideRoom(itemPolygon({ x: 50, y: 25, rotation: 0 }, { w: 100, d: 50, h: 1 }), rect)).toBe(true);
    expect(polygonInsideRoom(itemPolygon({ x: 40, y: 100, rotation: 45 }, { w: 100, d: 50, h: 1 }), rect)).toBe(false);
    expect(polygonInsideRoom(itemPolygon({ x: 300, y: 300, rotation: 0 }, { w: 20, d: 20, h: 1 }), L)).toBe(false);
    // rotated square whose corners are all inside the L but which covers the reflex corner (200,200)
    expect(polygonInsideRoom(itemPolygon({ x: 185, y: 185, rotation: 45 }, { w: 56.5685, d: 56.5685, h: 1 }), L)).toBe(false);
    expect(polygonInsideRoom(itemPolygon({ x: 150, y: 150, rotation: 45 }, { w: 56.5685, d: 56.5685, h: 1 }), L)).toBe(true);
  });
  test('polygonInsideRoom rejects an item a wall notch cuts across, keeps flush items', () => {
    // 400×300 room with a 40 cm wide chimney breast sticking 100 cm in from the top wall (x 180..220, y 0..100).
    const notched = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 100 }, { x: 220, y: 100 }, { x: 220, y: 0 }, { x: 400, y: 0 },
      { x: 400, y: 300 }, { x: 0, y: 300 }];
    // Sofa from y 40 to 120: all four corners in the room, but the breast pierces its back edge.
    const sofa = [{ x: 100, y: 40 }, { x: 300, y: 40 }, { x: 300, y: 120 }, { x: 100, y: 120 }];
    expect(polygonInsideRoom(sofa, notched)).toBe(false);
    // Flush against the breast's face and the bottom wall.
    expect(polygonInsideRoom([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }], notched)).toBe(true);
  });
});

test('projectOnWalls and snapRightAngle', () => {
  const r = projectOnWalls(rect, { x: 100, y: 10 });
  expect(r.wall).toBe(0); expect(r.offset).toBeCloseTo(100); expect(r.distance).toBeCloseTo(10); near(r.point, { x: 100, y: 0 });
  const s = projectOnWalls(rect, { x: 295, y: 150 });
  expect(s.wall).toBe(1); expect(s.offset).toBeCloseTo(150); expect(s.distance).toBeCloseTo(5);
  expect(snapRightAngle({ x: 0, y: 0 }, { x: 10, y: 3 })).toEqual({ x: 10, y: 0 });
  expect(snapRightAngle({ x: 0, y: 0 }, { x: 2, y: -9 })).toEqual({ x: 0, y: -9 });
});

test('distancesToWalls for a centred item', () => {
  const d = distancesToWalls({ x: 150, y: 200, rotation: 0 }, { w: 100, d: 50, h: 1 }, rect);
  const by = Object.fromEntries(d.map((w) => [w.side, w]));
  expect(by.front.distance).toBeCloseTo(175); expect(by.back.distance).toBeCloseTo(175);
  expect(by.left.distance).toBeCloseTo(100); expect(by.right.distance).toBeCloseTo(100);
  near(by.front.from, { x: 150, y: 225 }); near(by.front.to, { x: 150, y: 400 });
  near(by.left.to, { x: 0, y: 200 });
});

describe('snapItem', () => {
  const size = { w: 100, d: 50, h: 1 };
  test('flush to wall', () => {
    const r = snapItem({ roomPoints: rect, others: [], pose: { x: 53, y: 200, rotation: 0 }, size, threshold: 5 });
    expect(r.x).toBeCloseTo(50); expect(r.y).toBe(200);
    expect(r.guides).toEqual([{ kind: 'wall', a: { x: 0, y: 0 }, b: { x: 0, y: 400 } }]);
    // rotated 90: AABB is 50 wide, so flush means centre at x = 25
    const q = snapItem({ roomPoints: rect, others: [], pose: { x: 28, y: 200, rotation: 90 }, size, threshold: 5 });
    expect(q.x).toBeCloseTo(25);
  });
  test('item alignment with guides', () => {
    const others = [{ pose: { x: 200, y: 100, rotation: 0 }, size }]; // x 150..250, y 75..125
    const r = snapItem({ roomPoints: rect, others, pose: { x: 203, y: 152, rotation: 0 }, size, threshold: 5 });
    expect(r.x).toBeCloseTo(200); expect(r.y).toBeCloseTo(150);
    expect(r.guides).toHaveLength(2);
    expect(r.guides.every((g) => g.kind === 'align')).toBe(true);
    const vert = r.guides.find((g) => g.a.x === g.b.x)!;
    expect(vert.a.x).toBe(150);
  });
  test('nothing in range', () => {
    const r = snapItem({ roomPoints: rect, others: [], pose: { x: 150, y: 200, rotation: 0 }, size, threshold: 5 });
    expect(r).toEqual({ x: 150, y: 200, guides: [] });
  });
});
