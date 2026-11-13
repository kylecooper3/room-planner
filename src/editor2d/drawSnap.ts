import type { Segment, Vec2 } from '../types';
import { projectOnWalls } from '../core/geometry';

/** Why the cursor jumped: drawn as a small coloured marker so the user can tell. */
export type SnapKind = 'corner' | 'wall' | 'align' | 'ink' | 'angle';
export interface SnapHit { p: Vec2; kind: SnapKind | null; guides: Segment[] }
/** Nearest ink/paper boundary of the floor-plan image along `axis` through p, within maxCm; the plan coordinate or null. */
export type InkSnap = (p: Vec2, axis: 'x' | 'y', maxCm: number) => number | null;

/** Snap radius in SCREEN px: a snap only happens when its target is this close to the cursor, at any zoom. */
export const SNAP_PX = 10;
/** Right-angle assist: the wall being drawn locks to horizontal/vertical only within this many degrees (and SNAP_PX). */
export const ANGLE_TOL_DEG = 8;

export interface SnapInput {
  raw: Vec2;
  /** Previous outline point: enables right-angle snapping (drawing). Omit for free points (first corner, corner drag). */
  prev?: Vec2 | null;
  /** Points to line up with (the outline drawn so far / the room's other corners). */
  align: Vec2[];
  /** Other rooms' outlines: their corners and walls attract the cursor. */
  rooms: Vec2[][];
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
  const inkOk = v != null && Math.abs(v - p[axis]) <= t;
  // The nearer wins; on a tie the exact alignment (so neighbouring rooms share wall lines exactly).
  if (best && (!inkOk || bd <= Math.abs(v - p[axis]))) return { value: best[axis], kind: 'align' as const, src: best };
  return inkOk ? { value: v, kind: 'ink' as const, src: null } : null;
}

/**
 * Drawing / corner-drag snapping. Every candidate must lie within SNAP_PX screen px of the cursor; the one that moves the
 * cursor least wins (corners count double so a click near a corner lands on it). Candidates: other rooms' corners,
 * their walls (free points only), and per-axis alignment / plan ink. With `prev`, a wall within ANGLE_TOL_DEG of horizontal/vertical locks to it
 * (right-angle assist) and only its free coordinate snaps; beyond that the point follows the mouse.
 */
export function snapPoint({ raw, prev, align, rooms, ink, pxPerCm, free }: SnapInput): SnapHit {
  if (free || !(pxPerCm > 0)) return NONE(raw);
  const t = SNAP_PX / pxPerCm;
  const cands: (SnapHit & { d: number })[] = [];
  let corner: Vec2 | null = null, cd = t;
  for (const r of rooms) for (const c of r) { const d = d2(c, raw); if (d <= cd) { cd = d; corner = c; } }
  if (corner) cands.push({ p: { ...corner }, kind: 'corner', guides: [], d: cd / 2 });

  // Other rooms' walls attract free points only: while drawing, the right-angle lock and alignment do that job.
  let wall: Vec2 | null = null, wd = t;
  for (const r of prev ? [] : rooms) {
    if (r.length < 2) continue;
    const hit = projectOnWalls(r, raw);
    if (hit.distance <= wd) { wd = hit.distance; wall = hit.point; }
  }
  if (wall) cands.push({ p: { ...wall }, kind: 'wall', guides: [], d: wd });

  const srcs = [...align, ...rooms.flat()];
  // Right-angle lock: the coordinate across the wall is fixed to prev's, only the one along it snaps.
  const dx = prev ? Math.abs(raw.x - prev.x) : 0, dy = prev ? Math.abs(raw.y - prev.y) : 0;
  const tan = Math.tan((ANGLE_TOL_DEG * Math.PI) / 180);
  const lock: 'x' | 'y' | null = !prev ? null
    : dy <= t && dy <= dx * tan ? 'y' : dx <= t && dx <= dy * tan ? 'x' : null;
  if (prev && lock) {
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
  return { p: best.p, kind: best.kind, guides: best.guides };
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
