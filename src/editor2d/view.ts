import { CM_PER_FOOT } from '../types';
import type { ItemDef, Opening, OpeningKind, UnitSystem, Vec2 } from '../types';

/** Plan fill (also the library swatch): the body colour; plants use their foliage ('cushion' part in the generator) so they read as plants from above. */
export const bodyColor = (def: ItemDef, fallback = '#b9b4ae') => (def.model.kind !== 'parametric' ? fallback
  : def.model.category === 'plant' ? def.model.colors.cushion : def.model.colors.body);

/** Pan/zoom: screen = plan * k + (x, y). k = screen px per cm. */
export interface View { x: number; y: number; k: number }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export const MIN_K = 0.05;
export const MAX_K = 20;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const screenToPlan = (v: View, sx: number, sy: number): Vec2 => ({ x: (sx - v.x) / v.k, y: (sy - v.y) / v.k });

/** Zoom by `factor` keeping the plan point under screen (sx, sy) fixed. */
export function zoomAbout(v: View, sx: number, sy: number, factor: number): View {
  const k = clamp(v.k * factor, MIN_K, MAX_K);
  const p = screenToPlan(v, sx, sy);
  return { k, x: sx - p.x * k, y: sy - p.y * k };
}

export function boundsOf(points: Vec2[], pad = 0): Bounds | null {
  if (!points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
}

/** Centres `b` in a w×h viewport with `margin` screen px on every side. */
export function fitView(b: Bounds, w: number, h: number, margin = 40): View {
  const bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
  const k = clamp(Math.min((w - 2 * margin) / bw, (h - 2 * margin) / bh), MIN_K, MAX_K);
  return { k, x: w / 2 - ((b.minX + b.maxX) / 2) * k, y: h / 2 - ((b.minY + b.maxY) / 2) * k };
}

/** Grid cell (cm): 1 ft / 50 cm, doubled until a cell is at least `minPx` on screen. */
export function gridStep(units: UnitSystem, k: number, minPx = 12): number {
  let step = units === 'imperial' ? CM_PER_FOOT : 50;
  while (step * k < minPx) step *= 2;
  return step;
}

export function openingDefaults(kind: OpeningKind): Pick<Opening, 'width' | 'height' | 'sill' | 'swing'> {
  switch (kind) {
    case 'door': return { width: 81, height: 203, sill: 0, swing: { hinge: 'start', side: 'in' } };
    case 'window': return { width: 120, height: 120, sill: 90 };
    case 'outlet': return { width: 8, height: 12, sill: 30 };
    case 'radiator': return { width: 100, height: 60, sill: 10 };
    case 'open': return { width: 90, height: 0, sill: 0 };
  }
}

/** Item rotation (deg, 0..360) that points the item's BACK (local -y) at `p`; snaps to 15° unless `free`. */
export function rotationFromPointer(center: Vec2, p: Vec2, free: boolean): number {
  let deg = (Math.atan2(p.x - center.x, -(p.y - center.y)) * 180) / Math.PI;
  if (!free) deg = Math.round(deg / 15) * 15;
  return ((deg % 360) + 360) % 360;
}

/** Aligns p's x / y with any neighbour's x / y within `threshold`. */
export function snapCorner(p: Vec2, neighbours: Vec2[], threshold: number): Vec2 {
  let { x, y } = p;
  let bx = threshold, by = threshold;
  for (const n of neighbours) {
    if (Math.abs(n.x - p.x) <= bx) { bx = Math.abs(n.x - p.x); x = n.x; }
    if (Math.abs(n.y - p.y) <= by) { by = Math.abs(n.y - p.y); y = n.y; }
  }
  return { x, y };
}

export const clampOffset = (offset: number, width: number, wallLen: number): number =>
  wallLen <= width ? wallLen / 2 : clamp(offset, width / 2, wallLen - width / 2);

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Mitred vertices of the wall's OUTER face, `t` outside the polygon (interior stays exact). */
export function wallOutline(points: Vec2[], t: number): Vec2[] {
  const n = points.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = points[i], b = points[(i + 1) % n]; area += a.x * b.y - b.x * a.y; }
  const s = area >= 0 ? 1 : -1;
  const outward = (a: Vec2, b: Vec2): Vec2 => {
    const l = dist(a, b) || 1;
    return { x: (s * (b.y - a.y)) / l, y: (-s * (b.x - a.x)) / l };
  };
  return points.map((p, i) => {
    const n1 = outward(points[(i - 1 + n) % n], p), n2 = outward(p, points[(i + 1) % n]);
    const denom = Math.max(1 + n1.x * n2.x + n1.y * n2.y, 0.25); // caps spikes at very sharp corners
    return { x: p.x + ((n1.x + n2.x) * t) / denom, y: p.y + ((n1.y + n2.y) * t) / denom };
  });
}
