import { describe, expect, it } from 'vitest';
import {
  boundsOf, clampOffset, fitView, gridStep, openingDefaults, rotationFromPointer, screenToPlan, snapCorner, wallOutline, zoomAbout,
} from './view';

describe('view transform', () => {
  it('zoomAbout keeps the point under the cursor fixed', () => {
    const v = { x: 30, y: -10, k: 1.5 };
    const before = screenToPlan(v, 200, 120);
    const z = zoomAbout(v, 200, 120, 2);
    expect(z.k).toBe(3);
    const after = screenToPlan(z, 200, 120);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
  it('zoom is clamped', () => {
    expect(zoomAbout({ x: 0, y: 0, k: 1 }, 0, 0, 1e6).k).toBe(20);
  });
  it('fitView centres the bounds inside the margin', () => {
    const b = boundsOf([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }], 0)!;
    const v = fitView(b, 1000, 600, 100);
    expect(v.k).toBe(2); // min(800/400, 400/200)
    expect(v.x + 200 * v.k).toBe(500);
    expect(v.y + 100 * v.k).toBe(300);
  });
  it('boundsOf handles empty and padding', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ x: 1, y: 2 }], 5)).toEqual({ minX: -4, minY: -3, maxX: 6, maxY: 7 });
  });
});

describe('gridStep', () => {
  it('uses 1 ft / 50 cm at normal zoom', () => {
    expect(gridStep('imperial', 1)).toBeCloseTo(30.48);
    expect(gridStep('metric', 1)).toBe(50);
  });
  it('coarsens when zoomed far out', () => {
    expect(gridStep('metric', 0.1)).toBe(200); // 50*0.1=5px -> 100 -> 200 (20px)
    expect(gridStep('imperial', 0.05) * 0.05).toBeGreaterThanOrEqual(12);
  });
});

describe('openingDefaults', () => {
  it('matches the brief', () => {
    expect(openingDefaults('door')).toEqual({ width: 81, height: 203, sill: 0, swing: { hinge: 'start', side: 'in' } });
    expect(openingDefaults('window')).toEqual({ width: 120, height: 120, sill: 90 });
    expect(openingDefaults('outlet')).toEqual({ width: 8, height: 12, sill: 30 });
    expect(openingDefaults('radiator')).toEqual({ width: 100, height: 60, sill: 10 });
  });
});

describe('rotationFromPointer', () => {
  const c = { x: 0, y: 0 };
  it('handle above the item = 0°, to the right = 90° (clockwise)', () => {
    expect(rotationFromPointer(c, { x: 0, y: -10 }, false)).toBe(0);
    expect(rotationFromPointer(c, { x: 10, y: 0 }, false)).toBe(90);
    expect(rotationFromPointer(c, { x: 0, y: 10 }, false)).toBe(180);
    expect(rotationFromPointer(c, { x: -10, y: 0 }, false)).toBe(270);
  });
  it('snaps to 15° unless free', () => {
    const p = { x: Math.sin(0.2), y: -Math.cos(0.2) }; // 11.46°
    expect(rotationFromPointer(c, p, false)).toBe(15);
    expect(rotationFromPointer(c, p, true)).toBeCloseTo(11.459, 2);
  });
});

describe('misc helpers', () => {
  it('snapCorner aligns to neighbours within threshold', () => {
    expect(snapCorner({ x: 103, y: 50 }, [{ x: 100, y: 0 }, { x: 0, y: 52 }], 5)).toEqual({ x: 100, y: 52 });
    expect(snapCorner({ x: 110, y: 50 }, [{ x: 100, y: 0 }], 5)).toEqual({ x: 110, y: 50 });
  });
  it('clampOffset keeps an opening on its wall', () => {
    expect(clampOffset(10, 80, 300)).toBe(40);
    expect(clampOffset(290, 80, 300)).toBe(260);
    expect(clampOffset(5, 80, 60)).toBe(30);
  });
  it('wallOutline offsets outward for either winding', () => {
    const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(wallOutline(sq, 10)[0]).toEqual({ x: -10, y: -10 });
    expect(wallOutline([...sq].reverse(), 10)[3]).toEqual({ x: -10, y: -10 });
  });
});
