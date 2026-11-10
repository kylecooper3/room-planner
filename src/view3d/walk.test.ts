import { describe, expect, it } from 'vitest';
import type { Opening, Room, Vec2 } from '../types';
import { buildWalls } from './sceneMath';
import { houseColliders, housePassages, moveVector, walkStep, wallColliders, type Collider } from './walk';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const box = (x0: number, y0: number, x1: number, y1: number): Collider => ({ pts: rect(x0, y0, x1, y1), minX: x0, maxX: x1, minY: y0, maxY: y1 });
const room = (id: string, points: Vec2[], openings: Opening[] = []): Room => ({
  id, name: id, points, ceilingHeight: 250, wallThickness: 12, openings, wallColor: '#fff', floor: 'wood',
  layouts: [{ id: 'l', name: 'L', items: [] }], activeLayoutId: 'l',
});
// Two rooms traced along the inner wall faces: A [0,400]×[0,300], B [412,812]×[0,300]; door on A's right wall (wall 1).
const door: Opening = { id: 'd', kind: 'door', wall: 1, offset: 150, width: 90, height: 200, sill: 0, swing: { hinge: 'start', side: 'in' } };
const A = room('A', rect(0, 0, 400, 300), [door]), B = room('B', rect(412, 0, 812, 300));

describe('moveVector', () => {
  it('forward at yaw 0 is -z (plan -y); right is +x', () => {
    const v = moveVector(0, 1, 0, { x: 0, y: 0 });
    expect(v.x).toBeCloseTo(0); expect(v.y).toBeCloseTo(-1);
    const r = moveVector(0, 0, 1, { x: 0, y: 0 });
    expect(r.x).toBeCloseTo(1); expect(r.y).toBeCloseTo(0);
  });
  it('diagonals are normalised; no keys → zero', () => {
    const v = moveVector(0.7, 1, 1, { x: 0, y: 0 });
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(moveVector(1, 0, 0, { x: 5, y: 5 })).toEqual({ x: 0, y: 0 });
  });
});

describe('walkStep collision', () => {
  it('slides along a wall instead of stopping dead', () => {
    const wall = box(0, -12, 400, 0); // thin wall along y = 0
    const p = { x: 100, y: 30 };
    walkStep(p, 50, -50, [wall]); // diagonally into the wall
    expect(p.y).toBeCloseTo(22, 0); // held at the radius
    expect(p.x).toBeGreaterThan(140); // kept moving along it
  });
  it('cannot pass through a box, and is pushed out of one it starts in', () => {
    const b = box(100, 100, 200, 200);
    const p = { x: 50, y: 150 };
    walkStep(p, 300, 0, [b]);
    expect(p.x).toBeLessThanOrEqual(100 - 22 + 0.01);
    const q = { x: 110, y: 150 };
    walkStep(q, 0, 0, [b]);
    expect(q.x).toBeCloseTo(78);
  });
});

describe('door passages', () => {
  it("cut the neighbouring room's overlapping wall into the right pieces", () => {
    const passages = housePassages([A, B]);
    expect(passages).toHaveLength(1);
    const bLeft = buildWalls(B, passages)[3]; // B's wall 3 runs (412,300) → (412,0)
    // Door spans plan y 105..195 → along B's wall 3 (from y = 300 going up) u = 105..195.
    const full = bLeft.pieces.filter((p) => p.y0 === 0 && p.y1 === 250).map((p) => [p.u0, p.u1]);
    expect(full).toEqual([[0, 105], [195, 300]]);
    expect(bLeft.pieces.some((p) => p.u0 === 105 && p.u1 === 195 && p.y0 === 200)).toBe(true); // lintel above
    // B's other walls are untouched; a perpendicular wall near a door is never cut.
    for (const w of buildWalls(B, passages).slice(0, 3)) expect(w.pieces).toHaveLength(1);
  });
  it('a two-room house: walk from A through the door into B, but not through a solid wall', () => {
    const passages = housePassages([A, B]);
    const colliders = houseColliders([A, B], passages, () => undefined);
    const p = { x: 200, y: 150 }; // centre of A, level with the door
    for (let i = 0; i < 60; i++) walkStep(p, 10, 0, colliders);
    expect(p.x).toBeGreaterThan(412 + 100); // well inside B
    expect(p.x).toBeLessThanOrEqual(812 - 22 + 0.01); // stopped by B's far wall
    const q = { x: 200, y: 60 }; // off to the side of the door: the shared wall blocks
    for (let i = 0; i < 60; i++) walkStep(q, 10, 0, colliders);
    expect(q.x).toBeLessThanOrEqual(400 - 22 + 0.01);
  });
  it("without the cut, the neighbour's wall would block the doorway", () => {
    const colliders = [...wallColliders(buildWalls(A), 12), ...wallColliders(buildWalls(B), 12)];
    const p = { x: 200, y: 150 };
    for (let i = 0; i < 60; i++) walkStep(p, 10, 0, colliders);
    expect(p.x).toBeLessThan(412);
  });
  it('windows stay solid', () => {
    const win: Opening = { ...door, kind: 'window', sill: 90, height: 120 };
    const W = room('W', rect(0, 0, 400, 300), [win]);
    const c = houseColliders([W], housePassages([W]), () => undefined);
    const p = { x: 200, y: 150 };
    for (let i = 0; i < 60; i++) walkStep(p, 10, 0, c);
    expect(p.x).toBeLessThanOrEqual(400 - 22 + 0.01);
  });
});
