import { describe, expect, it } from 'vitest';
import { CM_PER_FOOT, type Room, type Underlay } from '../types';
import { buildInkMask, fitToInk, inkCentre, makeInkSnap } from './inkMask';
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
  // 12 px wall at x 88..99 (centre line x = 94), plus a 1 px furniture line at x = 150 that must be ignored.
  const m = buildInkMask(img(200, 100, (x) => (x >= 88 && x < 100) || x === 150));
  it('finds the centre line of the nearest wall band along an axis, ignoring thin strokes and too-wide fills', () => {
    expect(inkCentre(m, 103.4, 50, 'x', 10, 48)).toBe(94);
    expect(inkCentre(m, 91, 50, 'x', 10, 48)).toBe(94);
    expect(inkCentre(m, 148, 50, 'x', 10, 48)).toBeNull();
    expect(inkCentre(m, 103, 50, 'y', 10, 48)).toBeNull();
    expect(inkCentre(m, 103.4, 50, 'x', 10, 11)).toBeNull(); // 12 px is wider than a wall here
  });
  it('maps to plan cm through the underlay', () => {
    const snap = makeInkSnap(m, u);
    expect(snap({ x: 10 + 103 * 5, y: 20 + 250 }, 'x', 50)).toBe(10 + 94 * 5);
  });
});

describe('ink band at a corner', () => {
  it("finds both walls' centre lines where the line through the point runs along the perpendicular wall", () => {
    // Room interior x<100, y<100; walls: x 100..111 (vertical) and y 100..111 (horizontal).
    const m = buildInkMask(img(200, 200, (x, y) => (x >= 100 && x < 112 && y < 112) || (y >= 100 && y < 112 && x < 112)));
    expect(inkCentre(m, 106, 105, 'x', 10, 48)).toBe(106);
    expect(inkCentre(m, 105, 106, 'y', 10, 48)).toBe(106);
  });
});

describe('fitToInk', () => {
  // Inner rectangle (40,40)-(160,120) inside 12 px walls; 1 cm per px, so plan cm = image px.
  const m = buildInkMask(img(200, 160, (x, y) => x >= 28 && x < 172 && y >= 28 && y < 132 && !(x >= 40 && x < 160 && y >= 40 && y < 120)));
  const band = makeInkSnap(m, { ...u, cmPerPx: 1, x: 0, y: 0 }).band!;
  const mid = [{ x: 34, y: 34 }, { x: 166, y: 34 }, { x: 166, y: 126 }, { x: 34, y: 126 }];
  const close = (got: { x: number; y: number }[], want: { x: number; y: number }[]) => got.forEach((p, i) => {
    expect(p.x).toBeCloseTo(want[i].x, 6);
    expect(p.y).toBeCloseTo(want[i].y, 6);
  });
  it('moves walls drawn on the lines onto their inner edges, either winding; thickness = line width', () => {
    const f = fitToInk(mid, band)!;
    close(f.points, [{ x: 40, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 120 }, { x: 40, y: 120 }]);
    expect(f.wallThickness).toBe(12);
    close(fitToInk([...mid].reverse(), band)!.points, [{ x: 40, y: 120 }, { x: 160, y: 120 }, { x: 160, y: 40 }, { x: 40, y: 40 }]);
  });
  it('keeps walls marked to stay; no fit when most walls find no line', () => {
    close(fitToInk(mid, band, [true])!.points, [{ x: 40, y: 34 }, { x: 160, y: 34 }, { x: 160, y: 120 }, { x: 40, y: 120 }]);
    expect(fitToInk([{ x: 34, y: 34 }, { x: 166, y: 34 }, { x: 166, y: 80 }, { x: 80, y: 80 }, { x: 80, y: 60 }, { x: 34, y: 60 }].map((p) => ({ x: p.x, y: p.y + 200 })), band)).toBeNull();
  });
});
