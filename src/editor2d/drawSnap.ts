import type { Segment, Vec2 } from '../types';
import { pointInPolygon, projectOnWalls, WALL_COINCIDE_TOL } from '../core/geometry';

/** Why the cursor jumped: drawn as a small coloured marker so the user can tell. */
export type SnapKind = 'corner' | 'wall' | 'align' | 'ink' | 'angle';
/** `link`: the neighbour wall a 'wall' hit landed on (room id + wall index), for the "attached" highlight. */
export interface SnapHit { p: Vec2; kind: SnapKind | null; guides: Segment[]; link?: { roomId: string; wall: number } }
/** The wall band of ink on the line p + t·dir (dir a unit vector) that p sits on, as t offsets in cm (lo < hi); or null. */
export type BandAt = (p: Vec2, dir: Vec2) => { lo: number; hi: number } | null;
/**
 * Centre line of the floor-plan image's nearest wall band along `axis` through p (p on the band or within maxCm of it);
 * the plan coordinate or null. `band` (with the mask loaded) measures bands for fitting a closed outline.
 */
export type InkSnap = ((p: Vec2, axis: 'x' | 'y', maxCm: number) => number | null) & { band?: BandAt };
/** Ink bands wider than this (real-world cm) are filled areas, not walls. */
export const MAX_WALL_CM = 60;

/** Snap radius in SCREEN px: a snap only happens when its target is this close to the cursor, at any zoom. */
export const SNAP_PX = 10;
/** Wall linking reaches further than other snaps: attaching a room to a neighbour's wall is the common case. */
export const WALL_SNAP_PX = 25;
/** Right-angle assist: the wall being drawn locks to horizontal/vertical only within this many degrees (and SNAP_PX). */
export const ANGLE_TOL_DEG = 8;

export interface SnapRoom { id: string; inner: Vec2[]; outer: Vec2[] }

export interface SnapInput {
  raw: Vec2;
  /** Previous outline point: enables right-angle snapping (drawing). Omit for free points (first corner, corner drag). */
  prev?: Vec2 | null;
  /** Points to line up with (the outline drawn so far / the room's other corners). */
  align: Vec2[];
  /** Other rooms: outline (`inner`) and wall outer face (`outer`, from wallOutline). Their wall bands link to the outer face. */
  rooms: SnapRoom[];
  ink?: InkSnap | null;
  /** Current zoom (screen px per cm): the radius is SNAP_PX / pxPerCm cm. */
  pxPerCm: number;
  /** Snapping off (Alt held, or snapping toggled off): the point is exactly the cursor. */
  free?: boolean;
}

const d2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const NONE = (p: Vec2): SnapHit => ({ p, kind: null, guides: [] });

/** Snaps one coordinate to the nearer of: alignment with a known point, the plan's wall ink. */
function snapAxis(p: Vec2, axis: 'x' | 'y', srcs: Vec2[], ink: InkSnap | null | undefined, t: number) {
  let best: Vec2 | null = null, bd = t;
  for (const s of srcs) {
    const d = Math.abs(s[axis] - p[axis]);
    if (d <= bd) { bd = d; best = s; }
  }
  const v = ink?.(p, axis, t);
  const inkOk = v != null && Math.abs(v - p[axis]) <= t + MAX_WALL_CM / 2; // a band centre: up to half a band beyond its edge
  // The nearer wins; on a tie the exact alignment (so neighbouring rooms share wall lines exactly).
  if (best && (!inkOk || bd <= Math.abs(v - p[axis]))) return { value: best[axis], kind: 'align' as const, src: best };
  return inkOk ? { value: v, kind: 'ink' as const, src: null } : null;
}

/** Where the line `axis` = v crosses polygon `poly`, nearest to `near` (+ the edge index); null when it never crosses. */
function crossing(poly: Vec2[], axis: 'x' | 'y', v: number, near: Vec2): { q: Vec2; i: number } | null {
  const o = axis === 'x' ? 'y' : 'x';
  let best: { q: Vec2; i: number } | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (a[axis] === b[axis] || (a[axis] - v) * (b[axis] - v) > 0) continue;
    const q = { [axis]: v, [o]: a[o] + ((v - a[axis]) / (b[axis] - a[axis])) * (b[o] - a[o]) } as unknown as Vec2;
    if (!best || d2(q, near) < d2(best.q, near)) best = { q, i };
  }
  return best;
}

/**
 * A neighbour's corner targets: on each wall's outer face, level with the wall's two INSIDE corners (not the outer corner).
 * A room started there continues the neighbour's wall line, so the two rooms' walls line up instead of stepping by a wall.
 */
export function facePoints({ inner, outer }: SnapRoom): { p: Vec2; wall: number }[] {
  const out: { p: Vec2; wall: number }[] = [];
  for (let i = 0; i < inner.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length], l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (!l2) continue;
    for (const c of [inner[i], inner[(i + 1) % inner.length]]) {
      const s = ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / l2;
      out.push({ p: { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s }, wall: i });
    }
  }
  return out;
}

/**
 * Drawing / corner-drag snapping. Every candidate must lie within SNAP_PX (wall bands: WALL_SNAP_PX) screen px of the cursor; the one that moves the
 * cursor least wins (corners count double so a click near a corner lands on it). Candidates: other rooms' face points (facePoints),
 * their wall bands (→ outer face, so neighbours share one wall), and per-axis alignment / plan ink. With `prev`, a wall within
 * ANGLE_TOL_DEG of horizontal/vertical locks to it (right-angle assist) and only its free coordinate snaps; beyond that the
 * point follows the mouse.
 */
export function snapPoint({ raw, prev, align, rooms, ink, pxPerCm, free }: SnapInput): SnapHit {
  if (free || !(pxPerCm > 0)) return NONE(raw);
  const t = SNAP_PX / pxPerCm, tw = WALL_SNAP_PX / pxPerCm;
  const srcs = [...align, ...rooms.flatMap((r) => r.inner)];
  // Right-angle lock: the coordinate across the wall is fixed to prev's, only the one along it snaps.
  const dx = prev ? Math.abs(raw.x - prev.x) : 0, dy = prev ? Math.abs(raw.y - prev.y) : 0;
  const tan = Math.tan((ANGLE_TOL_DEG * Math.PI) / 180);
  const lock: 'x' | 'y' | null = !prev ? null
    : dy <= t && dy <= dx * tan ? 'y' : dx <= t && dx <= dy * tan ? 'x' : null;

  const cands: (SnapHit & { d: number })[] = [];
  // Wall linking: anywhere across another room's wall band (± tw) lands on its OUTER face, where this room's outward wall
  // coincides with it. Locked: where the locked line crosses that face. Unlocked: the projection, lined up along an
  // axis-aligned face with known points (so a neighbour's inside corner carries over).
  let wall: Vec2 | null = null, wd = Infinity, link: SnapHit['link'];
  for (const { id, inner, outer } of rooms) {
    if (inner.length < 3) continue;
    const o = projectOnWalls(outer, raw), di = projectOnWalls(inner, raw).distance;
    if (!(o.distance <= tw || di <= tw || (pointInPolygon(raw, outer) && !pointInPolygon(raw, inner)))) continue;
    let q: Vec2 | null, wi = o.wall;
    const fa = outer[o.wall], fb = outer[(o.wall + 1) % outer.length];
    if (prev && lock && Math.abs(fa[lock] - prev[lock]) <= WALL_COINCIDE_TOL && Math.abs(fb[lock] - prev[lock]) <= WALL_COINCIDE_TOL) {
      q = { ...raw, [lock]: prev[lock] }; // drawing along the face itself: stays on it, linked to that wall
    } else if (prev && lock) {
      const c = crossing(outer, lock, prev[lock], raw);
      q = c && d2(c.q, raw) <= o.distance + di + tw ? c.q : null; // else a far side of the room, not this band
      if (c) wi = c.i;
    } else {
      const a = outer[o.wall], b = outer[(o.wall + 1) % outer.length];
      const along = Math.abs(a.x - b.x) < 1e-9 ? 'y' : Math.abs(a.y - b.y) < 1e-9 ? 'x' : null;
      const s = along && snapAxis(o.point, along, srcs, null, t);
      q = s ? { ...o.point, [along!]: s.value } : { ...o.point };
    }
    if (q && d2(q, raw) < wd) { wd = d2(q, raw); wall = q; link = { roomId: id, wall: wi }; }
  }

  let corner: Vec2 | null = null, cd = t, cLink: SnapHit['link'];
  for (const r of rooms) for (const c of facePoints(r)) { const d = d2(c.p, raw); if (d <= cd) { cd = d; corner = c.p; cLink = { roomId: r.id, wall: c.wall }; } }
  // A wall-end point is an attach point too (shown as "Attached"); it counts double so a click near it lands on it.
  // A locked wall-band hit beats it (a point off the locked line would bend the wall).
  if (corner && !(lock && wall)) cands.push({ p: { ...corner }, kind: 'wall', guides: [], link: cLink, d: cd / 2 });
  if (wall) {
    cands.push({ p: wall, kind: 'wall', guides: [], link, d: wd });
  } else if (prev && lock) {
    const p = lock === 'y' ? { x: raw.x, y: prev.y } : { x: prev.x, y: raw.y };
    const axis = lock === 'y' ? 'x' : 'y';
    const s = snapAxis(p, axis, srcs, ink, t);
    const q = s ? { ...p, [axis]: s.value } : p;
    cands.push({ p: q, kind: s?.kind ?? 'angle', guides: s?.src ? [{ a: s.src, b: q }] : [], d: d2(q, raw) });
  } else {
    const sx = snapAxis(raw, 'x', srcs, ink, t), sy = snapAxis(raw, 'y', srcs, ink, t);
    if (sx || sy) {
      const p = { x: sx?.value ?? raw.x, y: sy?.value ?? raw.y };
      const guides = [sx?.src, sy?.src].filter((s): s is Vec2 => !!s).map((a) => ({ a, b: p }));
      cands.push({ p, kind: sx?.kind === 'align' || sy?.kind === 'align' ? 'align' : 'ink', guides, d: d2(p, raw) });
    }
  }
  if (!cands.length) return NONE(raw);
  const best = cands.reduce((a, b) => (b.d < a.d - 1e-9 ? b : a)); // ties keep the earlier (corner > wall > axis)
  return { p: best.p, kind: best.kind, guides: best.guides, ...(best.link && { link: best.link }) };
}

/** Interior angle at corner `c` between the walls to `a` and to `b`, in degrees (0..180); null for a zero-length wall. */
export const cornerAngle = (a: Vec2, c: Vec2, b: Vec2): number | null => {
  const ux = a.x - c.x, uy = a.y - c.y, vx = b.x - c.x, vy = b.y - c.y;
  const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
  if (lu < 1e-6 || lv < 1e-6) return null;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)))) * 180) / Math.PI;
};
/** Within this many degrees of 90 a corner counts as square (snapping lands exactly on 90). */
export const RIGHT_TOL_DEG = 0.25;
export const isRightAngle = (deg: number | null) => deg !== null && Math.abs(deg - 90) <= RIGHT_TOL_DEG;
