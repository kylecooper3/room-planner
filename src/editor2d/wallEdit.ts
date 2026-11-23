import type { Actions, Opening, OpeningKind, Room, Segment, Vec2 } from '../types';
import type { WallNearMiss } from '../core/geometry';
import { wallNearMisses } from '../core/geometry';
import type { SnapRoom } from './drawSnap';
import { wallOutline } from './view';

/**
 * Wall i gets length `len` by moving its END corner (points[i+1]) along the wall direction. When the next wall is
 * perpendicular, its far corner moves too, so that wall keeps its right angles (a rectangle stays a rectangle).
 */
export function setWallLength(points: Vec2[], i: number, len: number): Vec2[] {
  const n = points.length;
  const a = points[i], b = points[(i + 1) % n], c = points[(i + 2) % n];
  const cur = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(len > 0) || !(cur > 1e-9) || !Number.isFinite(len)) return points;
  const ux = (b.x - a.x) / cur, uy = (b.y - a.y) / cur;
  const dx = ux * (len - cur), dy = uy * (len - cur);
  const nl = Math.hypot(c.x - b.x, c.y - b.y) || 1;
  const perpendicular = n > 3 && Math.abs(((c.x - b.x) * ux + (c.y - b.y) * uy) / nl) < 1e-6;
  return points.map((p, j) => (j === (i + 1) % n || (perpendicular && j === (i + 2) % n) ? { x: p.x + dx, y: p.y + dy } : p));
}

/** Inserts a corner at fraction t of wall i, re-indexing openings, as ONE undo step; selects the new corner. */
export function insertCorner(st: Pick<Actions, 'beginBatch' | 'endBatch' | 'updateOpening' | 'updateRoom' | 'select'> & Partial<Pick<Actions, 'addOpening'>>, room: Room, i: number, t: number) {
  const n = room.points.length;
  const a = room.points[i], b = room.points[(i + 1) % n];
  const split = t * Math.hypot(b.x - a.x, b.y - a.y);
  const np = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  st.beginBatch();
  // wall indices after i shift by one; openings past the split move to the new wall
  for (const o of room.openings) {
    const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2;
    if (o.wall > i) st.updateOpening(o.id, { wall: o.wall + 1 });
    else if (o.wall === i && o.kind === 'open' && s0 < split - 0.5 && s1 > split + 0.5 && st.addOpening) {
      // An open gap across the new corner becomes one gap on each side of it.
      st.updateOpening(o.id, { offset: (s0 + split) / 2, width: split - s0 });
      const { id: _id, ...rest } = o;
      st.addOpening({ ...rest, wall: i + 1, offset: (s1 - split) / 2, width: s1 - split });
    } else if (o.wall === i && o.offset > split) st.updateOpening(o.id, { wall: i + 1, offset: o.offset - split });
  }
  st.updateRoom(room.id, { points: [...room.points.slice(0, i + 1), np, ...room.points.slice(i + 1)] });
  st.endBatch();
  st.select({ type: 'corner', index: i + 1 });
}

/**
 * Removes corner k (only when more than 3 remain) as ONE undo step, the inverse of insertCorner: walls k-1 and k merge into
 * one wall from points[k-1] to points[k+1]; their openings are projected onto it (dropped only if wider than it), later
 * walls shift down by one. Corner 0 wraps: the merged wall becomes the last wall.
 */
export function deleteCorner(st: Pick<Actions, 'beginBatch' | 'endBatch' | 'updateOpening' | 'deleteOpening' | 'updateRoom' | 'select'>, room: Room, k: number): boolean {
  const pts = room.points, n = pts.length;
  if (n <= 3 || k < 0 || k >= n) return false;
  const prev = (k - 1 + n) % n;
  const a = pts[prev], b = pts[(k + 1) % n];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const merged = k === 0 ? n - 2 : k - 1;
  st.beginBatch();
  for (const o of room.openings) {
    if (o.wall !== k && o.wall !== prev) {
      if (o.wall > k) st.updateOpening(o.id, { wall: o.wall - 1 });
      continue;
    }
    if (o.width > len) { st.deleteOpening(o.id); continue; }
    const s = pts[o.wall], e = pts[(o.wall + 1) % n];
    const wl = Math.hypot(e.x - s.x, e.y - s.y) || 1;
    const c = { x: s.x + ((e.x - s.x) / wl) * o.offset, y: s.y + ((e.y - s.y) / wl) * o.offset };
    const along = ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / (len || 1);
    st.updateOpening(o.id, { wall: merged, offset: Math.min(Math.max(along, o.width / 2), len - o.width / 2) });
  }
  st.updateRoom(room.id, { points: pts.filter((_, i) => i !== k) });
  st.endBatch();
  st.select(null);
  return true;
}

/**
 * True when `o` would overlap another opening on its wall where one of the two is an open gap ('open'): a gap has no
 * wall for a door or window to sit in. Doors, windows and fixtures may still share a stretch of wall (a radiator under a window).
 */
export function openingsClash(openings: Opening[], o: Pick<Opening, 'kind' | 'wall' | 'offset' | 'width'> & { id?: string }): boolean {
  return openings.some((q) => q.id !== o.id && q.wall === o.wall && (q.kind === 'open' || o.kind === 'open')
    && Math.abs(q.offset - o.offset) < (q.width + o.width) / 2 - 0.5);
}

export const MIN_OPENING = 5;
/** Built-in openings (not open gaps) keep this much wall in total. */
export const WALL_MARGIN = 10;
/** Sane opening widths per kind (cm); the max is further capped at the wall length (minus WALL_MARGIN, except open gaps). */
export const OPENING_WIDTH: Record<OpeningKind, [number, number]> = { door: [60, 200], window: [30, 400], radiator: [30, 300], outlet: [5, 30], open: [10, 10_000] };

/**
 * Drags end `end` of opening `o` (a = toward the wall's start, b = toward its end) to `at` cm along its wall of length `len`;
 * the other end stays put. The width stays within the kind's range and the opening on its wall.
 */
export function resizeOpening(o: Pick<Opening, 'kind' | 'offset' | 'width'>, end: 'a' | 'b', at: number, len: number): { offset: number; width: number } {
  const [lo, hi] = OPENING_WIDTH[o.kind];
  const fixed = end === 'a' ? o.offset + o.width / 2 : o.offset - o.width / 2;
  const room = end === 'a' ? fixed : len - fixed; // wall left on the dragged side
  const max = Math.max(MIN_OPENING, Math.min(hi, len - (o.kind === 'open' ? 0 : WALL_MARGIN), room));
  const want = end === 'a' ? fixed - at : at - fixed;
  const width = Math.min(max, Math.max(Math.min(Math.max(MIN_OPENING, lo), max), want));
  return { width, offset: end === 'a' ? fixed - width / 2 : fixed + width / 2 };
}

/** The open gaps on wall i. */
export const openGaps = (room: Room, i: number) => room.openings.filter((o) => o.kind === 'open' && o.wall === i);

/**
 * "Open this wall": replaces wall i's gaps with one floor-to-ceiling gap along its whole length. "Close this wall" (when it
 * has any gap): removes them. One undo step. Refuses to open (returns false) while a door, window or fixture is on the wall.
 */
export function toggleOpenWall(st: Pick<Actions, 'beginBatch' | 'endBatch' | 'addOpening' | 'deleteOpening' | 'select'>, room: Room, i: number): boolean {
  const n = room.points.length;
  const a = room.points[i], b = room.points[(i + 1) % n];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const gaps = openGaps(room, i);
  if (!gaps.length && room.openings.some((o) => o.wall === i)) return false;
  st.beginBatch();
  for (const g of gaps) st.deleteOpening(g.id);
  if (!gaps.length) st.addOpening({ kind: 'open', wall: i, offset: len / 2, width: len, height: 0, sill: 0 });
  st.endBatch();
  st.select({ type: 'wall', index: i });
  return true;
}

/** Outward unit normal of wall i (walls extrude outward from the outline, as wallOutline). */
export function wallNormal(points: Vec2[], i: number): Vec2 {
  let area = 0;
  for (let k = 0; k < points.length; k++) { const p = points[k], q = points[(k + 1) % points.length]; area += p.x * q.y - q.x * p.y; }
  const a = points[i], b = points[(i + 1) % points.length], l = Math.hypot(b.x - a.x, b.y - a.y) || 1, s = area >= 0 ? 1 : -1;
  return { x: (s * (b.y - a.y)) / l, y: (-s * (b.x - a.x)) / l };
}

/**
 * Wall i slid by d along its outward normal (d < 0: inward). Each end slides along its neighbouring wall, so the neighbours
 * keep their direction and only stretch or shrink; an end whose neighbour runs (nearly) parallel moves straight out instead.
 */
export function slideWall(points: Vec2[], i: number, d: number): Vec2[] {
  const n = points.length, j = (i + 1) % n, nrm = wallNormal(points, i);
  const end = (k: number, from: Vec2 | null): Vec2 => {
    const p = points[k], l = from ? Math.hypot(p.x - from.x, p.y - from.y) : 0;
    const v = from && l > 1e-9 ? { x: (p.x - from.x) / l, y: (p.y - from.y) / l } : nrm;
    const c = v.x * nrm.x + v.y * nrm.y;
    return Math.abs(c) > 0.2 ? { x: p.x + (v.x * d) / c, y: p.y + (v.y * d) / c } : { x: p.x + nrm.x * d, y: p.y + nrm.y * d };
  };
  const closed = n >= 3;
  return points.map((p, k) => (k === i ? end(i, closed ? points[(i - 1 + n) % n] : null) : k === j ? end(j, closed ? points[(j + 1) % n] : null) : p));
}

/**
 * The slide (along wall i's outward normal, as slideWall) that puts wall i's line on the line through `face`; null unless
 * the face runs parallel to the wall (within 1°) and alongside it.
 */
export function flushDistance(points: Vec2[], i: number, face: Segment): number | null {
  const a = points[i], b = points[(i + 1) % points.length], L = Math.hypot(b.x - a.x, b.y - a.y);
  const fx = face.b.x - face.a.x, fy = face.b.y - face.a.y, fl = Math.hypot(fx, fy);
  if (L < 1e-9 || fl < 1e-9) return null;
  const nrm = wallNormal(points, i), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
  if (Math.abs((fx * nrm.x + fy * nrm.y) / fl) > Math.sin(Math.PI / 180)) return null;
  const t1 = (face.a.x - a.x) * ux + (face.a.y - a.y) * uy, t2 = t1 + (fx * ux + fy * uy);
  if (Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)) < 1) return null;
  return (face.a.x - a.x) * nrm.x + (face.a.y - a.y) * nrm.y;
}

export interface SlideSnap { d: number; link?: { roomId: string; wall: number }; guide?: Segment }

/**
 * Wall-drag snapping, nearest to `d` wins:
 * - flush onto another room's outer wall face (shared wall), within `tol` cm → `link`;
 * - in line with another room's wall that faces the same way (its inner line, or its outer face lining up with this wall's
 *   outer face, `t` = this wall's thickness), within `alignTol` cm → `guide`, a line through both walls to draw.
 * Else d unchanged.
 */
export function snapSlide(points: Vec2[], i: number, d: number, rooms: SnapRoom[], tol: number, alignTol = 0, t = 0): SlideSnap {
  let best: SlideSnap = { d }, bd = Infinity;
  const a = points[i], b = points[(i + 1) % points.length], L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-9) return best;
  const nrm = wallNormal(points, i), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
  const offset = (p: Vec2) => (p.x - a.x) * nrm.x + (p.y - a.y) * nrm.y;
  const parallel = (s: Segment) => {
    const fx = s.b.x - s.a.x, fy = s.b.y - s.a.y, fl = Math.hypot(fx, fy);
    return fl > 1e-9 && Math.abs((fx * nrm.x + fy * nrm.y) / fl) <= Math.sin(Math.PI / 180);
  };
  for (const r of rooms) {
    if (r.inner.length < 3) continue;
    const n = r.inner.length;
    for (let w = 0; w < n; w++) {
      const outerSeg = { a: r.outer[w], b: r.outer[(w + 1) % n] }, innerSeg = { a: r.inner[w], b: r.inner[(w + 1) % n] };
      const f = flushDistance(points, i, outerSeg);
      if (f !== null && Math.abs(f - d) <= tol && Math.abs(f - d) < bd) { bd = Math.abs(f - d); best = { d: f, link: { roomId: r.id, wall: w } }; }
      // Same facing (its outer side is on this wall's outer side) and parallel: line them up.
      if (!alignTol || !parallel(innerSeg) || offset(r.outer[w]) - offset(r.inner[w]) <= 0) continue;
      // c: the slide; line: where the lined-up line runs (inner line, or the shared outer-face line).
      for (const { c, line } of [{ c: offset(innerSeg.a), line: offset(innerSeg.a) }, { c: offset(outerSeg.a) - t, line: offset(outerSeg.a) }]) {
        if (Math.abs(c - d) > alignTol || Math.abs(c - d) >= bd) continue;
        bd = Math.abs(c - d);
        const along = (p: Vec2) => (p.x - a.x) * ux + (p.y - a.y) * uy;
        const ts = [0, L, along(innerSeg.a), along(innerSeg.b)];
        const on = (s: number) => ({ x: a.x + ux * s + nrm.x * line, y: a.y + uy * s + nrm.y * line });
        best = { d: c, guide: { a: on(Math.min(...ts)), b: on(Math.max(...ts)) } };
      }
    }
  }
  return best;
}

/**
 * Every wall joined to wall `start` through shared stretches, the whole chain (a long wall shared by two rooms, and so on),
 * with the direction it must slide: +1 = along its own normal like `start`, -1 = against it (a shared partner faces the
 * other way). `start` itself is included with +1. Slide each wall by sign × d to move the whole joined wall together.
 */
export function sharedChain(shared: { owner: { room: number; wall: number }; other: { room: number; wall: number } }[], start: { room: number; wall: number }): { room: number; wall: number; sign: number }[] {
  const seen = new Map<string, { room: number; wall: number; sign: number }>([[`${start.room}:${start.wall}`, { ...start, sign: 1 }]]);
  const todo = [...seen.values()];
  for (let cur = todo.pop(); cur; cur = todo.pop()) {
    for (const s of shared) {
      const next = s.owner.room === cur.room && s.owner.wall === cur.wall ? s.other : s.other.room === cur.room && s.other.wall === cur.wall ? s.owner : null;
      const key = next && `${next.room}:${next.wall}`;
      if (next && key && !seen.has(key)) { const n = { ...next, sign: -cur.sign }; seen.set(key, n); todo.push(n); }
    }
  }
  return [...seen.values()];
}

/**
 * A just-drawn room joins its neighbours: each wall running roughly alongside a neighbour's wall (facing it, within `tolDeg`
 * and `tolCm` of its outer face at both ends, overlapping it for at least half its length) is laid exactly onto that outer
 * face, so the two rooms share one wall however the clicks landed. Corners are re-found where neighbouring wall lines meet.
 * `joined[i]`: wall i was laid onto a neighbour. `skip[i]`: leave wall i as drawn (an end placed with snapping off).
 */
export function joinToNeighbours(points: Vec2[], rooms: SnapRoom[], skip: boolean[] = [], tolCm = 40, tolDeg = 6): { points: Vec2[]; joined: boolean[] } {
  const n = points.length, sin = Math.sin((tolDeg * Math.PI) / 180);
  const lines = points.map((a, i) => {
    const b = points[(i + 1) % n], L = Math.hypot(b.x - a.x, b.y - a.y);
    const u = L > 1e-9 ? { x: (b.x - a.x) / L, y: (b.y - a.y) / L } : { x: 1, y: 0 }, nrm = wallNormal(points, i);
    let best: { p: Vec2; u: Vec2; score: number } | null = null;
    for (const r of L > 1e-9 && !skip[i] ? rooms : []) {
      const m = r.inner.length;
      for (let w = 0; w < m && m >= 3; w++) {
        const fa = r.outer[w], fb = r.outer[(w + 1) % m], fl = Math.hypot(fb.x - fa.x, fb.y - fa.y);
        if (fl < 1e-9) continue;
        let fu = { x: (fb.x - fa.x) / fl, y: (fb.y - fa.y) / fl };
        if (Math.abs(u.x * fu.y - u.y * fu.x) > sin) continue; // not (nearly) parallel
        const ia = r.inner[w], ib = r.inner[(w + 1) % m];
        const out = { x: (fa.x + fb.x - ia.x - ib.x) / 2, y: (fa.y + fb.y - ia.y - ib.y) / 2 }; // the neighbour's outward side
        if (out.x * nrm.x + out.y * nrm.y >= 0) continue; // must face this room
        const off = (p: Vec2) => Math.abs((p.x - fa.x) * fu.y - (p.y - fa.y) * fu.x);
        if (off(a) > tolCm || off(b) > tolCm) continue;
        const ta = (a.x - fa.x) * fu.x + (a.y - fa.y) * fu.y, tb = (b.x - fa.x) * fu.x + (b.y - fa.y) * fu.y;
        const overlap = Math.min(fl, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb));
        if (overlap < L / 2) continue;
        if (fu.x * u.x + fu.y * u.y < 0) fu = { x: -fu.x, y: -fu.y }; // keep this wall's direction
        const score = overlap - (off(a) + off(b));
        if (!best || score > best.score) best = { p: fa, u: fu, score };
      }
    }
    return best ? { p: best.p, u: best.u, joined: true } : { p: a, u, joined: false };
  });
  const joined = lines.map((l) => l.joined);
  const out = points.map((p, k) => {
    const l0 = lines[(k + n - 1) % n], l1 = lines[k];
    if (!l0.joined && !l1.joined) return p;
    const cr = l0.u.x * l1.u.y - l0.u.y * l1.u.x;
    if (Math.abs(cr) < 1e-6) { // straight on: the point onto the joined line
      const l = l1.joined ? l1 : l0, t = (p.x - l.p.x) * l.u.x + (p.y - l.p.y) * l.u.y;
      return { x: l.p.x + l.u.x * t, y: l.p.y + l.u.y * t };
    }
    const t = ((l1.p.x - l0.p.x) * l1.u.y - (l1.p.y - l0.p.y) * l1.u.x) / cr;
    return { x: l0.p.x + l0.u.x * t, y: l0.p.y + l0.u.y * t };
  });
  return { points: out, joined };
}

/** "Join walls": when wall i of room `roomId` has a near-miss (wallNearMisses), that mark and the room's points with the wall slid flush. */
export function wallJoin(rooms: Room[], roomId: string, i: number): { miss: WallNearMiss; points: Vec2[] } | null {
  const ri = rooms.findIndex((r) => r.id === roomId);
  const miss = ri < 0 ? undefined : wallNearMisses(rooms.map((r) => ({ inner: r.points, outer: wallOutline(r.points, r.wallThickness) })))
    .find((m) => m.wall.room === ri && m.wall.index === i);
  const d = miss && flushDistance(rooms[ri].points, i, miss.to);
  return miss && d != null ? { miss, points: slideWall(rooms[ri].points, i, d) } : null;
}
