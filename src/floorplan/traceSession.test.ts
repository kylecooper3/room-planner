import { describe, expect, it } from 'vitest';
import { CM_PER_FOOT, type Room, type Underlay } from '../types';
import { buildInkMask, inkBoundary, makeInkSnap } from './inkMask';
import { countsTowardArea, derivedStep, isCalibrated, parseArea, scaleToArea, scaleWords } from './traceSession';
import { emptyProject } from '../store/store';

const SQFT = CM_PER_FOOT * CM_PER_FOOT;
const img = (w: number, h: number, ink: (x: number, y: number) => boolean) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = ink(x, y) ? 0 : 255; data.set([v, v, v, 255], (y * w + x) * 4); }
  return { data, width: w, height: h } as unknown as ImageData;
};
const u: Underlay = { imageId: 'i', widthPx: 200, heightPx: 100, cmPerPx: 5, x: 10, y: 20, opacity: 0.6, visible: true };
const room = (id: string, name: string, w: number, h: number): Room =>
  ({ id, name, points: [{ x: 10, y: 20 }, { x: 10 + w, y: 20 }, { x: 10 + w, y: 20 + h }, { x: 10, y: 20 + h }] } as Room);

describe('parseArea', () => {
  it('reads listing-style areas', () => {
    expect(parseArea('531 sq ft', 'imperial')).toBeCloseTo(531 * SQFT, 3);
    expect(parseArea('531', 'imperial')).toBeCloseTo(531 * SQFT, 3);
    expect(parseArea('531 SF', 'metric')).toBeCloseTo(531 * SQFT, 3);
    expect(parseArea('49,3 m²', 'imperial')).toBeCloseTo(493000, 3);
    expect(parseArea('49.3', 'metric')).toBeCloseTo(493000, 3);
    expect(parseArea('lots', 'metric')).toBeNull();
    expect(parseArea('0', 'metric')).toBeNull();
  });
});

describe('scale by known area', () => {
  it('rescales the underlay and rooms about the underlay origin so counted rooms match; balconies excluded by default', () => {
    const rooms = [room('a', 'Bedroom', 300, 400), room('b', 'Balcony', 100, 100)];
    expect(countsTowardArea(rooms[1], {})).toBe(false);
    const r = scaleToArea(u, rooms, {}, 4 * 300 * 400)!;
    expect(r.factor).toBeCloseTo(2, 9);
    expect(r.underlay.cmPerPx).toBeCloseTo(10, 9);
    expect(r.rooms[0].points[2]).toEqual({ x: 610, y: 820 });
    expect(r.rooms[1].points[0]).toEqual({ x: 10, y: 20 }); // origin fixed
    expect(scaleToArea(u, rooms, { a: false }, 100)).toBeNull();
  });
  it('derives the step and describes the scale in words', () => {
    const p = { ...emptyProject(), underlay: { ...u, cmPerPx: 1000 / 200 } };
    expect(derivedStep(emptyProject(), { skipScale: false, knownArea: null })).toBe(1);
    expect(isCalibrated(p.underlay)).toBe(false);
    expect(derivedStep(p, { skipScale: false, knownArea: null })).toBe(2);
    expect(derivedStep(p, { skipScale: true, knownArea: null })).toBe(3);
    expect(scaleWords({ ...u, cmPerPx: CM_PER_FOOT / 19 }, 'imperial')).toBe('1 ft ≈ 19 px on your image');
  });
});

describe('ink mask', () => {
  // 12 px wall at x 88..99 (inner face at x = 100), plus a 1 px furniture line at x = 150 that must be ignored.
  const m = buildInkMask(img(200, 100, (x) => (x >= 88 && x < 100) || x === 150));
  it('finds the nearest wall face along an axis, ignoring thin strokes', () => {
    expect(inkBoundary(m, 103.4, 50, 'x', 10)).toBe(100);
    expect(inkBoundary(m, 91, 50, 'x', 10)).toBe(88);
    expect(inkBoundary(m, 148, 50, 'x', 10)).toBeNull();
    expect(inkBoundary(m, 103, 50, 'y', 10)).toBeNull();
  });
  it('maps to plan cm through the underlay', () => {
    const snap = makeInkSnap(m, u);
    expect(snap({ x: 10 + 103 * 5, y: 20 + 250 }, 'x', 50)).toBe(10 + 100 * 5);
  });
});

describe('ink boundary at a corner', () => {
  it('finds the inner face even when the line through the point runs inside the perpendicular wall', () => {
    // Room interior x<100, y<100; walls: x 100..111 (vertical) and y 100..111 (horizontal).
    const m = buildInkMask(img(200, 200, (x, y) => (x >= 100 && x < 112 && y < 112) || (y >= 100 && y < 112 && x < 112)));
    expect(inkBoundary(m, 100, 97, 'y', 10)).toBe(100);
  });
});
