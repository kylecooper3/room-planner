import { isFlat, type ItemDef, type Room, type Vec2 } from '../types';
import { getOpeningGeometry, itemPolygon } from '../core/geometry';
import { buildWalls, type WallInfo } from './sceneMath';

/** Walkable, see-through box through a door (plan cm): `dir` runs along the door's wall, `n` across it. */
export interface Passage { center: Vec2; dir: Vec2; n: Vec2; halfW: number; halfD: number; bottom: number; top: number }

/** One passage per door of every room, deep enough to cross both rooms' walls (2 × max wall thickness + 30 cm). */
export function housePassages(rooms: Pick<Room, 'points' | 'openings' | 'wallThickness'>[]): Passage[] {
  const maxT = Math.max(0, ...rooms.map((r) => r.wallThickness));
  const out: Passage[] = [];
  for (const r of rooms) {
    if (r.points.length < 3) continue;
    for (const o of r.openings) {
      if (o.kind !== 'door') continue;
      const g = getOpeningGeometry(r.points, o);
      const a = (g.angle * Math.PI) / 180;
      out.push({ center: g.center, dir: { x: Math.cos(a), y: Math.sin(a) }, n: g.normalIn, halfW: o.width / 2, halfD: maxT + 15, bottom: o.sill, top: o.sill + o.height });
    }
  }
  return out;
}

const PARALLEL = Math.cos((20 * Math.PI) / 180);

/**
 * The u-interval (cm along the wall from its start) a passage cuts out of a wall whose solid strip runs from the room
 * edge `outward` by `t`; null when they don't overlap. Only near-parallel walls are cut (not perpendicular walls at a corner).
 */
export function passageHole(a: Vec2, u: Vec2, out: Vec2, length: number, t: number, p: Passage): { start: number; end: number } | null {
  if (Math.abs(u.x * p.dir.x + u.y * p.dir.y) < PARALLEL) return null;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const sw of [-1, 1]) for (const sd of [-1, 1]) {
    const x = p.center.x + p.dir.x * p.halfW * sw + p.n.x * p.halfD * sd - a.x;
    const y = p.center.y + p.dir.y * p.halfW * sw + p.n.y * p.halfD * sd - a.y;
    const pu = x * u.x + y * u.y, pv = x * out.x + y * out.y;
    u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
  }
  if (v1 <= 0 || v0 >= t || u1 <= 0 || u0 >= length) return null;
  return { start: u0, end: u1 };
}

/** A convex obstacle (plan cm) with its bounding box. */
export interface Collider { pts: Vec2[]; minX: number; maxX: number; minY: number; maxY: number }
const collider = (pts: Vec2[]): Collider => ({
  pts, minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
});

/** Floor-level solid wall pieces of one room (door holes already cut by buildWalls) as plan rectangles. */
export function wallColliders(walls: WallInfo[], t: number): Collider[] {
  const out: Collider[] = [];
  for (const w of walls) {
    const u = { x: Math.cos(w.angle), y: Math.sin(w.angle) }, o = { x: -w.normalIn.x, y: -w.normalIn.y };
    const rect = (u0: number, u1: number) => {
      const p = (s: number, v: number) => ({ x: w.a.x + u.x * s + o.x * v, y: w.a.y + u.y * s + o.y * v });
      out.push(collider([p(u0, 0), p(u1, 0), p(u1, t), p(u0, t)]));
    };
    if (w.ext0 > 0) rect(-w.ext0, 0);
    for (const pc of w.pieces) if (pc.y0 === 0) rect(pc.u0, pc.u1);
    if (w.ext1 > 0) rect(w.length, w.length + w.ext1);
  }
  return out;
}

/** Everything the walker bumps into: every room's walls (minus door passages) and solid (non-flat) furniture. */
export function houseColliders(rooms: Room[], passages: Passage[], getDef: (id: string) => ItemDef | undefined): Collider[] {
  const out: Collider[] = [];
  for (const r of rooms) {
    if (r.points.length < 3) continue;
    out.push(...wallColliders(buildWalls(r, passages), r.wallThickness));
    for (const it of r.layouts.find((l) => l.id === r.activeLayoutId)?.items ?? []) {
      const def = getDef(it.defId);
      if (def && !isFlat(def)) out.push(collider(itemPolygon(it, def.size)));
    }
  }
  return out;
}

/** Pushes the circle (centre `p`, mutated in place, radius r) out of a convex polygon. Allocation-free. */
function pushOut(p: Vec2, c: Collider, r: number): void {
  if (p.x < c.minX - r || p.x > c.maxX + r || p.y < c.minY - r || p.y > c.maxY + r) return;
  const pts = c.pts, n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a.x * b.y - b.x * a.y; }
  const k = area > 0 ? 1 : -1;
  // Signed distance to each edge line (positive = outside); remember the closest boundary point as we go.
  let maxSd = -Infinity, nx = 0, ny = 0, best = Infinity, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const ex = b.x - a.x, ey = b.y - a.y, L = Math.hypot(ex, ey) || 1;
    const ox = (ey / L) * k, oy = (-ex / L) * k; // outward normal
    const sd = (p.x - a.x) * ox + (p.y - a.y) * oy;
    if (sd > maxSd) { maxSd = sd; nx = ox; ny = oy; }
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (L * L)));
    const qx = a.x + ex * t, qy = a.y + ey * t, d = Math.hypot(p.x - qx, p.y - qy);
    if (d < best) { best = d; cx = qx; cy = qy; }
  }
  if (maxSd >= r) return;
  if (maxSd < 0) { p.x += nx * (r - maxSd); p.y += ny * (r - maxSd); return; } // centre inside: shortest way out
  if (best >= r || best === 0) return;
  const s = (r - best) / best;
  p.x += (p.x - cx) * s; p.y += (p.y - cy) * s;
}

/** Moves the walker by (dx, dy) cm, sub-stepped so it can't tunnel, sliding along obstacles. Mutates `p`. */
export function walkStep(p: Vec2, dx: number, dy: number, colliders: Collider[], r = 22): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (r / 2)));
  for (let s = 0; s < steps; s++) {
    p.x += dx / steps; p.y += dy / steps;
    for (let it = 0; it < 3; it++) for (const c of colliders) pushOut(p, c, r);
  }
}

/** Unit plan direction (written into `out`) for forward f / right r input at three.js yaw; zero when there is no input. */
export function moveVector(yaw: number, f: number, r: number, out: Vec2): Vec2 {
  const len = Math.hypot(f, r);
  if (!len) { out.x = 0; out.y = 0; return out; }
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  // three.js camera looks along (-sin yaw, -cos yaw) in (x, z) = plan (x, y); right is (cos yaw, -sin yaw).
  out.x = (-sin * f + cos * r) / len;
  out.y = (-cos * f - sin * r) / len;
  return out;
}

/** Walk-mode keys (KeyboardEvent.code) → [forward, right]. */
export const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0],
  KeyD: [0, 1], ArrowRight: [0, 1], KeyA: [0, -1], ArrowLeft: [0, -1],
};
