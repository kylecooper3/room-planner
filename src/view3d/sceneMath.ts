import { CM_TO_M, type Opening, type PlacedItem, type Room, type Size3, type Vec2 } from '../types';
import { getOpeningGeometry, itemPolygon, pointInPolygon, polygonCentroid } from '../core/geometry';
import { passageHole, type Passage } from './walk';

/** Plan point (cm) → world position (m), on the floor. */
export const planToWorld = (x: number, y: number, lift = 0): [number, number, number] => [x * CM_TO_M, lift, y * CM_TO_M];
/** Plan rotation (deg, clockwise on screen) → three.js rotation.y. */
export const itemRotationY = (deg: number): number => -deg * Math.PI / 180;

/** A solid rectangle of a wall in wall-local cm: u along the wall from points[i], y up. */
export interface WallPiece { u0: number; u1: number; y0: number; y1: number }
export interface Hole { start: number; end: number; bottom: number; top: number }

/** Splits a wall of `length` × `height` into solid pieces around `holes`; holes are clamped to the wall and to each other. */
export function splitWall(length: number, height: number, holes: Hole[]): WallPiece[] {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const sorted = holes
    .map((h) => ({ start: clamp(h.start, length), end: clamp(h.end, length), bottom: clamp(h.bottom, height), top: clamp(h.top, height) }))
    .sort((a, b) => a.start - b.start);
  const pieces: WallPiece[] = [];
  const push = (u0: number, u1: number, y0: number, y1: number) => { if (u1 > u0 && y1 > y0) pieces.push({ u0, u1, y0, y1 }); };
  let cursor = 0;
  for (const h of sorted) {
    const start = Math.max(h.start, cursor);
    if (h.end <= start || h.top <= h.bottom) continue;
    push(cursor, start, 0, height);
    push(start, h.end, 0, h.bottom);
    push(start, h.end, h.top, height);
    cursor = h.end;
  }
  push(cursor, length, 0, height);
  return pieces;
}

export interface WallInfo {
  index: number;
  a: Vec2;
  length: number;
  /** Plan direction angle (rad) of a→b. */
  angle: number;
  /** +1 when the interior is on the left of a→b in (x, y) algebra, i.e. along local +z of a group with rotation.y = -angle. */
  side: 1 | -1;
  normalIn: Vec2;
  mid: Vec2;
  /** Extra length (cm) at each end to close convex outer corners. */
  ext0: number;
  ext1: number;
  pieces: WallPiece[];
  openings: Opening[];
}

const signedArea = (pts: Vec2[]) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p.x * q.y - q.x * p.y; }
  return s / 2;
};

/** `passages`: door passages of the whole house; any that cross this room's walls are cut out of them too. */
export function buildWalls(room: Pick<Room, 'points' | 'openings' | 'wallThickness' | 'ceilingHeight'>, passages: Passage[] = []): WallInfo[] {
  const pts = room.points, n = pts.length;
  if (n < 3) return [];
  const side: 1 | -1 = signedArea(pts) > 0 ? 1 : -1;
  // Corner at vertex i is convex when the turn direction matches the winding.
  const convex = (i: number) => {
    const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
    const cross = (c.x - p.x) * (q.y - c.y) - (c.y - p.y) * (q.x - c.x);
    return cross * side > 0;
  };
  const t = room.wallThickness;
  return pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    const openings = room.openings.filter((o) => o.wall === i);
    const holes = openings
      .filter((o) => o.kind === 'door' || o.kind === 'window')
      .map((o) => ({ start: o.offset - o.width / 2, end: o.offset + o.width / 2, bottom: o.sill, top: o.sill + o.height }));
    const u = { x: dx / length, y: dy / length }, out = { x: (dy / length) * side, y: (-dx / length) * side };
    // shortcut: passages are cut only within [0, length]; corner extensions next to a door are not cut.
    for (const p of passages) {
      const h = passageHole(a, u, out, length, t, p);
      if (h) holes.push({ ...h, bottom: p.bottom, top: p.top });
    }
    return {
      index: i, a, length, angle: Math.atan2(dy, dx), side,
      normalIn: { x: (-dy / length) * side, y: (dx / length) * side },
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      ext0: convex(i) ? t : 0, ext1: convex((i + 1) % n) ? t : 0,
      pieces: splitWall(length, room.ceilingHeight, holes),
      openings,
    };
  });
}

/** Cutaway: true when the wall stands between the camera and the room (its interior side faces away from the camera). Plan cm. */
export const wallFacesAway = (w: Pick<WallInfo, 'normalIn' | 'mid'>, camX: number, camY: number): boolean =>
  w.normalIn.x * (camX - w.mid.x) + w.normalIn.y * (camY - w.mid.y) < 0;

const distToSegment = (p: Vec2, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

const clearanceAt = (p: Vec2, pts: Vec2[], solids: Vec2[][]) => {
  if (!pointInPolygon(p, pts)) return -Infinity;
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) d = Math.min(d, distToSegment(p, pts[i], pts[(i + 1) % pts.length]));
  for (const s of solids) {
    if (pointInPolygon(p, s)) return -Infinity;
    for (let i = 0; i < s.length; i++) d = Math.min(d, distToSegment(p, s[i], s[(i + 1) % s.length]));
  }
  return d;
};

/**
 * Walk-mode start (plan cm) and yaw (rad, three.js rotation.y) facing the room centroid: just inside an inward-swinging
 * door if that spot is free, else the sampled point farthest from walls and solid item footprints.
 */
export function walkStart(room: Pick<Room, 'points' | 'openings'>, solids: { item: PlacedItem; size: Size3 }[]): { pos: Vec2; yaw: number } {
  const pts = room.points;
  const feet = solids.map(({ item, size }) => itemPolygon(item, size));
  const FREE = 25; // cm of elbow room: just more than the walker's 22 cm radius
  let pos: Vec2 | null = null;
  for (const o of room.openings) {
    if (o.kind !== 'door' || o.swing?.side !== 'in') continue;
    const g = getOpeningGeometry(pts, o);
    for (const d of [60, 90, 120]) {
      const p = { x: g.center.x + g.normalIn.x * d, y: g.center.y + g.normalIn.y * d };
      if (clearanceAt(p, pts, feet) >= FREE) { pos = p; break; }
    }
    if (pos) break;
  }
  if (!pos) {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const step = Math.max(5, Math.max(x1 - x0, y1 - y0) / 60);
    let best = -Infinity;
    for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
      const d = clearanceAt({ x, y }, pts, feet);
      if (d > best) { best = d; pos = { x, y }; }
    }
  }
  const c = polygonCentroid(pts);
  pos ??= c;
  const dx = c.x - pos.x, dz = c.y - pos.y;
  // three.js camera looks along (-sin yaw, -cos yaw) in (x, z).
  return { pos, yaw: Math.hypot(dx, dz) > 1 ? Math.atan2(-dx, -dz) : 0 };
}
