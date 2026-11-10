import type { Underlay, Vec2 } from '../types';

/** Rescales the underlay so the plan distance p1→p2 becomes `realCm`, keeping p1 fixed in plan space. */
export function calibrateUnderlay(u: Underlay, p1: Vec2, p2: Vec2, realCm: number): Underlay {
  const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (!(d > 1e-6) || !(realCm > 0) || !Number.isFinite(realCm)) return u;
  const k = realCm / d;
  return { ...u, cmPerPx: u.cmPerPx * k, x: p1.x - (p1.x - u.x) * k, y: p1.y - (p1.y - u.y) * k };
}
