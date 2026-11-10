import type { Segment, Vec2 } from '../types';
import { projectOnWalls, snapRightAngle } from '../core/geometry';

/** Why the cursor jumped: drawn as a small coloured marker so the user can tell. */
export type SnapKind = 'corner' | 'wall' | 'align' | 'ink' | 'angle';
export interface SnapHit { p: Vec2; kind: SnapKind | null; guides: Segment[] }
/** Nearest ink/paper boundary of the floor-plan image along `axis` through p, within maxCm; the plan coordinate or null. */
export type InkSnap = (p: Vec2, axis: 'x' | 'y', maxCm: number) => number | null;

export interface SnapInput {
  raw: Vec2;
  /** Previous outline point: enables right-angle snapping (drawing). Omit for free points (first corner, corner drag). */
  prev?: Vec2 | null;
  /** Points to line up with (the outline drawn so far / the room's other corners). */
  align: Vec2[];
  /** Other rooms' outlines: their corners and walls attract the cursor. */
  rooms: Vec2[][];
  ink?: InkSnap | null;
  /** Snap distance, cm. */
  threshold: number;
}

const d2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Snaps one coordinate to the nearer of: alignment with a known point, the plan's wall ink. */
function snapAxis(p: Vec2, axis: 'x' | 'y', srcs: Vec2[], ink: InkSnap | null | undefined, t: number) {
  let best: Vec2 | null = null, bd = t;
  for (const s of srcs) {
    const d = Math.abs(s[axis] - p[axis]);
    if (d <= bd) { bd = d; best = s; }
  }
  const v = ink?.(p, axis, t);
  // The nearer wins; on a tie the exact alignment (so neighbouring rooms share wall lines exactly).
  if (best && (v == null || bd <= Math.abs(v - p[axis]))) return { value: best[axis], kind: 'align' as const, src: best };
  return v == null ? null : { value: v, kind: 'ink' as const, src: null };
}

/**
 * Drawing / corner-drag snapping. Candidates: other rooms' corners, other rooms' walls (free points only), and the
 * axis result (right angle to prev, then alignment > ink on the free coordinate(s)). The one that moves the cursor
 * least wins, so a corner across a thin wall never steals a click that sits right on the plan's wall face.
 */
export function snapPoint({ raw, prev, align, rooms, ink, threshold: t }: SnapInput): SnapHit {
  const cands: (SnapHit & { d: number })[] = [];
  let corner: Vec2 | null = null, cd = t;
  for (const r of rooms) for (const c of r) { const d = d2(c, raw); if (d <= cd) { cd = d; corner = c; } }
  // Corners pull twice as hard: a click near a corner should land on it, not on one of its walls.
  if (corner) cands.push({ p: { ...corner }, kind: 'corner', guides: [], d: cd / 2 });

  const srcs = [...align, ...rooms.flat()];
  if (prev) {
    const p = snapRightAngle(prev, raw);
    const axis = p.y === prev.y ? 'x' : 'y'; // the coordinate still free along the wall being drawn
    const s = snapAxis(p, axis, srcs, ink, t);
    const q = s ? { ...p, [axis]: s.value } : p;
    cands.push({ p: q, kind: s?.kind ?? 'angle', guides: s?.src ? [{ a: s.src, b: q }] : [], d: d2(q, raw) });
  } else {
    let wall: Vec2 | null = null, wd = t;
    for (const r of rooms) {
      if (r.length < 2) continue;
      const hit = projectOnWalls(r, raw);
      if (hit.distance <= wd) { wd = hit.distance; wall = hit.point; }
    }
    if (wall) cands.push({ p: { ...wall }, kind: 'wall', guides: [], d: wd });
    const sx = snapAxis(raw, 'x', srcs, ink, t), sy = snapAxis(raw, 'y', srcs, ink, t);
    if (sx || sy) {
      const p = { x: sx?.value ?? raw.x, y: sy?.value ?? raw.y };
      const guides = [sx?.src, sy?.src].filter((s): s is Vec2 => !!s).map((a) => ({ a, b: p }));
      cands.push({ p, kind: sx?.kind === 'align' || sy?.kind === 'align' ? 'align' : 'ink', guides, d: d2(p, raw) });
    }
  }
  if (!cands.length) return { p: raw, kind: null, guides: [] };
  const best = cands.reduce((a, b) => (b.d < a.d - 1e-9 ? b : a)); // ties keep the earlier (corner > wall > axis)
  return { p: best.p, kind: best.kind, guides: best.guides };
}
