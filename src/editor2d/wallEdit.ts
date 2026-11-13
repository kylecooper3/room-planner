import type { Actions, Opening, Room, Vec2 } from '../types';

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
