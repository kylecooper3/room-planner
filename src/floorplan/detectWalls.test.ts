import { describe, expect, it } from 'vitest';
import { detectRooms, detectWalls } from './detectWalls';
import { calibrateUnderlay } from './calibrate';
import type { Underlay, Vec2 } from '../types';

function img(w: number, h: number, paint: (x: number, y: number) => boolean): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = paint(x, y) ? 0 : 255;
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  return { data, width: w, height: h } as unknown as ImageData;
}
const inRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x < x1 && y >= y0 && y < y1;

function expectCorners(got: Vec2[] | null, want: Vec2[], tol = 3) {
  expect(got).not.toBeNull();
  expect(got!.length).toBe(want.length);
  for (const w of want) expect(got!.some((p) => Math.hypot(p.x - w.x, p.y - w.y) <= tol)).toBe(true);
}

// Room outline 30..170, walls 10px thick → interior face 40..160.
const rectOutline = (x: number, y: number) => inRect(x, y, 30, 30, 170, 170) && !inRect(x, y, 40, 40, 160, 160);
const rectInterior = [{ x: 40, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 160 }, { x: 40, y: 160 }];

describe('detectWalls', () => {
  it('finds the 4 interior corners of a rectangular room', () => {
    expectCorners(detectWalls(img(200, 200, rectOutline)), rectInterior);
  });

  it('finds 6 corners of an L-shaped room', () => {
    // Interior: (40,40)-(160,40)-(160,100)-(100,100)-(100,160)-(40,160).
    const interior = (x: number, y: number) => inRect(x, y, 40, 40, 160, 100) || inRect(x, y, 40, 40, 100, 160);
    const outer = (x: number, y: number) => inRect(x, y, 30, 30, 170, 110) || inRect(x, y, 30, 30, 110, 170);
    expectCorners(detectWalls(img(200, 200, (x, y) => outer(x, y) && !interior(x, y))), [
      { x: 40, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 160 }, { x: 40, y: 160 },
    ]);
  });

  it('returns null on a blank image', () => {
    expect(detectWalls(img(200, 200, () => false))).toBeNull();
  });

  it('still detects with a door-sized gap in a wall', () => {
    const withDoor = (x: number, y: number) => rectOutline(x, y) && !inRect(x, y, 80, 160, 98, 170);
    expectCorners(detectWalls(img(200, 200, withDoor)), rectInterior);
  });

  it('ignores furniture/text ink inside the room', () => {
    const withInk = (x: number, y: number) => rectOutline(x, y) || inRect(x, y, 70, 70, 90, 120);
    expectCorners(detectWalls(img(200, 200, withInk)), rectInterior);
  });

  it('returns every enclosed room of a two-room plan, even with a door between them', () => {
    // Outer 30..370 x 30..170, walls 10 px; shared wall x 190..200 with a 30 px door gap.
    const ink = (x: number, y: number) => (inRect(x, y, 30, 30, 370, 170) && !inRect(x, y, 40, 40, 360, 160))
      || (inRect(x, y, 190, 30, 200, 170) && !inRect(x, y, 190, 90, 200, 120));
    const rooms = detectRooms(img(400, 200, ink));
    expect(rooms).toHaveLength(2);
    const byX = [...rooms].sort((a, b) => a[0].x - b[0].x);
    expectCorners(byX[0], [{ x: 40, y: 40 }, { x: 190, y: 40 }, { x: 190, y: 160 }, { x: 40, y: 160 }]);
    expectCorners(byX[1], [{ x: 200, y: 40 }, { x: 360, y: 40 }, { x: 360, y: 160 }, { x: 200, y: 160 }]);
  });

  it('is bounded on a 1000x1000 image', () => {
    const big = img(1000, 1000, (x, y) => inRect(x, y, 100, 100, 900, 900) && !inRect(x, y, 130, 130, 870, 870));
    const t0 = performance.now();
    expectCorners(detectWalls(big), [{ x: 130, y: 130 }, { x: 870, y: 130 }, { x: 870, y: 870 }, { x: 130, y: 870 }]);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe('calibrateUnderlay', () => {
  const u: Underlay = { imageId: 'i', widthPx: 800, heightPx: 600, cmPerPx: 1.25, x: 10, y: -20, opacity: 0.6, visible: true };
  // A plan drawn at an unknown wrong scale: true scale is 2.3 cm/px.
  const toPlan = (un: Underlay, px: Vec2): Vec2 => ({ x: un.x + px.x * un.cmPerPx, y: un.y + px.y * un.cmPerPx });

  it('makes other segments measure their real length and keeps p1 fixed', () => {
    const a = { x: 100, y: 50 }, b = { x: 400, y: 450 };
    const p1 = toPlan(u, a), p2 = toPlan(u, b);
    const real = Math.hypot(300, 400) * 2.3;
    const c = calibrateUnderlay(u, p1, p2, real);
    const q1 = toPlan(c, a);
    expect(q1.x).toBeCloseTo(p1.x, 6);
    expect(q1.y).toBeCloseTo(p1.y, 6);
    const s = toPlan(c, { x: 700, y: 10 }), e = toPlan(c, { x: 20, y: 590 });
    const len = Math.hypot(e.x - s.x, e.y - s.y), want = Math.hypot(680, 580) * 2.3;
    expect(Math.abs(len - want) / want).toBeLessThan(0.02);
    expect(c.cmPerPx).toBeCloseTo(2.3, 6);
  });

  it('ignores zero-length or invalid input', () => {
    expect(calibrateUnderlay(u, { x: 5, y: 5 }, { x: 5, y: 5 }, 100)).toBe(u);
    expect(calibrateUnderlay(u, { x: 0, y: 0 }, { x: 5, y: 5 }, 0)).toBe(u);
  });
});
