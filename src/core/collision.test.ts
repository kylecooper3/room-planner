import { describe, expect, test } from 'vitest';
import type { Category, ClearanceZone, ItemDef, Opening, PlacedItem, Room, Vec2 } from '../types';
import { findIssues } from './collision';
import { rectRoomPoints } from './geometry';

const def = (id: string, name: string, w: number, d: number, clearances: ClearanceZone[] = [], category: Category = 'box'): ItemDef => ({
  id, name, size: { w, d, h: 50 }, clearances, source: 'preset',
  model: { kind: 'parametric', category, style: {}, material: 'wood', colors: { body: '#000000', cushion: '#000000', frame: '#000000', accent: '#000000' } },
});
const walk = (side: ClearanceZone['side']): ClearanceZone => ({ kind: 'walkway', side, depth: 91.44, label: 'walkway' });
const DEFS: Record<string, ItemDef> = Object.fromEntries([
  def('bed', 'Bed', 152.4, 203.2, [walk('left'), walk('right'), walk('front')], 'bed'),
  def('dresser', 'Dresser', 100, 50, [{ kind: 'drawer', side: 'front', depth: 50, label: 'drawer pull-out' }], 'dresser'),
  def('desk', 'Desk', 120, 60, [{ kind: 'chair', side: 'front', depth: 75, label: 'chair space' }], 'desk'),
  def('sofa', 'Sofa', 200, 90),
  def('rug', 'Rug', 200, 150, [], 'rug'),
].map((d) => [d.id, d]));
const getDef = (id: string) => DEFS[id];

const room = (points: Vec2[] = rectRoomPoints(304.8, 365.76), openings: Opening[] = []): Room => ({
  id: 'r', name: 'Room', points, ceilingHeight: 250, wallThickness: 10, openings, wallColor: '#ffffff', floor: 'wood',
  layouts: [], activeLayoutId: 'l',
});
let n = 0;
const it = (defId: string, x: number, y: number, rotation = 0): PlacedItem => ({ id: `${defId}${++n}`, defId, x, y, rotation });
const issues = (items: PlacedItem[], r = room()) => findIssues(r, { id: 'l', name: 'L', items }, getDef);

describe('flush placement', () => {
  test('queen bed flush in a corner or against a wall has no issues', () => {
    expect(issues([it('bed', 76.2, 101.6)])).toEqual([]);
    expect(issues([it('bed', 304.8 - 76.2, 365.76 - 101.6, 180)])).toEqual([]);
    expect(issues([it('bed', 152.4, 101.6)])).toEqual([]);
    expect(issues([it('bed', 101.6, 182.88, 90)])).toEqual([]); // rotated: front faces the left wall (walkway exempt)
  });
  test('items flush side by side do not overlap', () => {
    expect(issues([it('sofa', 100, 45), it('sofa', 100, 135)])).toEqual([]);
  });
});

describe('door swing', () => {
  const door = (side: 'in' | 'out'): Opening =>
    ({ id: 'door1', kind: 'door', wall: 0, offset: 100, width: 80, height: 200, sill: 0, swing: { hinge: 'start', side } });
  test('dresser in an inward swing is reported, clear is fine', () => {
    const dresser = it('dresser', 100, 40);
    const r = issues([dresser], room(undefined, [door('in')]));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'door-swing-blocked', itemIds: [dresser.id], openingId: 'door1', message: 'Dresser blocks the door swing' });
    expect(r[0].zone!.length).toBeGreaterThan(8);
    expect(issues([it('dresser', 200, 200)], room(undefined, [door('in')]))).toEqual([]);
    expect(issues([it('dresser', 200, 25)], room(undefined, [door('in')]))).toEqual([]); // flush to the wall beside the door
  });
  test('outward swings never block', () => {
    expect(issues([it('dresser', 100, 40)], room(undefined, [door('out')]))).toEqual([]);
  });
});

describe('issues', () => {
  test('overlap', () => {
    const a = it('sofa', 120, 100), b = it('desk', 150, 120);
    const r = issues([a, b]).filter((i) => i.kind === 'overlap');
    expect(r).toEqual([{ id: `overlap:${a.id}:${b.id}`, kind: 'overlap', itemIds: [a.id, b.id], message: 'Sofa overlaps Desk' }]);
  });
  test('outside room: straight, rotated through a wall, concave room', () => {
    expect(issues([it('sofa', 90, 100)])[0]).toMatchObject({ kind: 'outside-room', message: 'Sofa crosses a wall' });
    expect(issues([it('sofa', 100, 200, 0)])).toEqual([]);
    expect(issues([it('sofa', 100, 200, 30)]).map((i) => i.kind)).toEqual(['outside-room']);
    const L: Vec2[] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 400 }, { x: 0, y: 400 }];
    expect(issues([it('sofa', 150, 100)], room(L))).toEqual([]);
    expect(issues([it('sofa', 200, 220)], room(L)).map((i) => i.kind)).toEqual(['outside-room']); // across the notch
    expect(issues([it('sofa', 300, 300)], room(L)).map((i) => i.kind)).toEqual(['outside-room']); // in the notch
  });
  test('clearance blocked by another item', () => {
    const dresser = it('dresser', 100, 100), desk = it('desk', 100, 180);
    const r = issues([dresser, desk]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      id: `clearance-blocked:${dresser.id}:${desk.id}`, kind: 'clearance-blocked', message: "Desk blocks Dresser's drawer pull-out",
    });
    expect(r[0].itemIds.sort()).toEqual([dresser.id, desk.id].sort());
    expect(r[0].zone).toHaveLength(4);
  });
  test('clearance hitting a wall', () => {
    const r = issues([it('dresser', 100, 30, 180)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'clearance-blocked', message: "Dresser's drawer pull-out hits a wall" });
    expect(r[0].zone).toBeDefined();
  });
  test('walkway zones are not blocked by walls but are by items', () => {
    expect(issues([it('bed', 76.2, 101.6)])).toEqual([]);
    const bed = it('bed', 76.2, 101.6), dresser = it("dresser", 210, 60);
    expect(issues([bed, dresser]).map((i) => i.message)).toEqual(["Dresser blocks Bed's walkway"]);
  });
  test('overlapping clearance zones are fine', () => {
    expect(issues([it('dresser', 100, 30, 0), it('dresser', 100, 130, 180)])).toEqual([]);
  });
  test('rugs only get outside-room', () => {
    const door: Opening = { id: 'd', kind: 'door', wall: 0, offset: 100, width: 80, height: 200, sill: 0, swing: { hinge: 'start', side: 'in' } };
    const r = room(undefined, [door]);
    expect(issues([it('rug', 110, 80), it('sofa', 120, 150), it('dresser', 150, 330, 180)], r)).toEqual([]);
    expect(issues([it('rug', 50, 80)], r).map((i) => i.kind)).toEqual(['outside-room']);
  });
  test('missing defs are skipped', () => {
    expect(issues([it('nope', -500, -500)])).toEqual([]);
  });
});

test('60 items in well under 20 ms', () => {
  const ids = ['bed', 'dresser', 'desk', 'sofa', 'rug'];
  const items: PlacedItem[] = [];
  for (let i = 0; i < 60; i++) items.push(it(ids[i % 5], 100 + (i % 10) * 120, 100 + Math.floor(i / 10) * 150, (i * 37) % 360));
  const big = room(rectRoomPoints(1300, 1000), [{ id: 'd', kind: 'door', wall: 0, offset: 300, width: 90, height: 200, sill: 0 }]);
  findIssues(big, { id: 'l', name: 'L', items }, getDef);
  const t = performance.now();
  const r = findIssues(big, { id: 'l', name: 'L', items }, getDef);
  expect(performance.now() - t).toBeLessThan(20);
  expect(new Set(r.map((i) => i.id)).size).toBe(r.length);
});
