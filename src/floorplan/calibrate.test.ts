import { describe, expect, it } from 'vitest';
import { calibrateUnderlay } from './calibrate';
import type { Underlay, Vec2 } from '../types';

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
