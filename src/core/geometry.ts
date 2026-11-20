import type {
  ClearancePolygon, DistancesToWalls, DoorSwingPolygon, GetOpeningGeometry, Guide, ItemPolygon, LocalToPlan,
  PointInPolygon, Polygon, PolygonArea, PolygonCentroid, PolygonInsideRoom, PolygonsIntersect, ProjectOnWalls,
  RectRoomPoints, Segment, SnapItem, Vec2, WallDistance, WallSegments,
} from '../types';

/** Penetration below this is "touching", not intersecting. */
export const TOUCH_TOL = 0.5;
const EPS = 1e-9;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Vec2) => Math.hypot(v.x, v.y);

export const rectRoomPoints: RectRoomPoints = (w, l) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: l }, { x: 0, y: l }];

export const wallSegments: WallSegments = (pts) => pts.map((a, i) => ({ a, b: pts[(i + 1) % pts.length] }));

const signedArea = (poly: Polygon) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
};

export const polygonArea: PolygonArea = (poly) => Math.abs(signedArea(poly));

export const polygonCentroid: PolygonCentroid = (poly) => {
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const c = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
};

/** subject ∩ convex (Sutherland–Hodgman with `subject` as the clipped polygon, so `subject` may be non-convex). [] if < 3 points. */
export const clipToConvex = (subject: Polygon, convex: Polygon): Polygon => {
  const k = signedArea(convex) >= 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < convex.length && out.length; i++) {
    const a = convex[i], b = convex[(i + 1) % convex.length];
    const side = (p: Vec2) => k * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
    }
  }
  return out.length >= 3 ? out : [];
};

export const pointInPolygon: PointInPolygon = (p, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

export const localToPlan: LocalToPlan = (pose, l) => {
  const r = (pose.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: pose.x + l.x * c - l.y * s, y: pose.y + l.x * s + l.y * c };
};

const rectToPlan = (pose: Parameters<LocalToPlan>[0], x0: number, y0: number, x1: number, y1: number): Polygon =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }].map((p) => localToPlan(pose, p));

export const itemPolygon: ItemPolygon = (pose, { w, d }) => rectToPlan(pose, -w / 2, -d / 2, w / 2, d / 2);

export const clearancePolygon: ClearancePolygon = (pose, { w, d }, z) => {
  const hw = w / 2, hd = d / 2;
  switch (z.side) {
    case 'front': return rectToPlan(pose, -hw, hd, hw, hd + z.depth);
    case 'back': return rectToPlan(pose, -hw, -hd - z.depth, hw, -hd);
    case 'left': return rectToPlan(pose, -hw - z.depth, -hd, -hw, hd);
    case 'right': return rectToPlan(pose, hw, -hd, hw + z.depth, hd);
  }
};

export const getOpeningGeometry: GetOpeningGeometry = (pts, o) => {
  const p = pts[o.wall], q = pts[(o.wall + 1) % pts.length];
  const L = len(sub(q, p)) || 1;
  const u = { x: (q.x - p.x) / L, y: (q.y - p.y) / L };
  const at = (t: number) => ({ x: p.x + u.x * t, y: p.y + u.y * t });
  // For a simple polygon the interior lies on the same side of every edge, determined by the winding.
  const k = signedArea(pts) >= 0 ? 1 : -1;
  return {
    a: at(o.offset - o.width / 2),
    b: at(o.offset + o.width / 2),
    center: at(o.offset),
    angle: (Math.atan2(u.y, u.x) * 180) / Math.PI,
    normalIn: { x: -u.y * k, y: u.x * k },
  };
};

export const doorSwingPolygon: DoorSwingPolygon = (pts, o) => {
  if (o.kind !== 'door') return null;
  const swing = o.swing ?? { hinge: 'start', side: 'in' };
  const g = getOpeningGeometry(pts, o);
  const [h, other] = swing.hinge === 'start' ? [g.a, g.b] : [g.b, g.a];
  const r = o.width;
  const u = { x: (other.x - h.x) / r, y: (other.y - h.y) / r };
  const n = swing.side === 'in' ? g.normalIn : { x: -g.normalIn.x, y: -g.normalIn.y };
  const N = 12;
  const poly: Polygon = [h];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * (Math.PI / 2), c = Math.cos(t), s = Math.sin(t);
    poly.push({ x: h.x + r * (u.x * c + n.x * s), y: h.y + r * (u.y * c + n.y * s) });
  }
  return poly;
};

const project = (poly: Polygon, ax: Vec2) => {
  let min = Infinity, max = -Infinity;
  for (const p of poly) {
    const v = p.x * ax.x + p.y * ax.y;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max] as const;
};

export const polygonsIntersect: PolygonsIntersect = (a, b) => {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      const l = len(e);
      if (l < EPS) continue;
      const ax = { x: -e.y / l, y: e.x / l };
      const [a0, a1] = project(a, ax), [b0, b1] = project(b, ax);
      if (Math.min(a1, b1) - Math.max(a0, b0) < TOUCH_TOL) return false;
    }
  }
  return true;
};

const closestOnSegment = (p: Vec2, a: Vec2, b: Vec2) => {
  const ab = sub(b, a), l2 = ab.x * ab.x + ab.y * ab.y;
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
  return { t, point: { x: a.x + ab.x * t, y: a.y + ab.y * t } };
};

const distToBoundary = (p: Vec2, poly: Polygon) => {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, len(sub(p, closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]).point)));
  return d;
};

/** Signed distance of p from the line through a→b. */
const sideOf = (p: Vec2, a: Vec2, b: Vec2) => {
  const ab = sub(b, a), l = len(ab);
  return l < EPS ? 0 : (ab.x * (p.y - a.y) - ab.y * (p.x - a.x)) / l;
};
/** Each segment's endpoints lie on opposite sides of the other's line, by at least TOUCH_TOL (touching/flush never counts). */
const segmentsCross = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
  const opposite = (u: number, v: number) => u * v < 0 && Math.min(Math.abs(u), Math.abs(v)) >= TOUCH_TOL;
  return opposite(sideOf(a, c, d), sideOf(b, c, d)) && opposite(sideOf(c, a, b), sideOf(d, a, b));
};

export const polygonInsideRoom: PolygonInsideRoom = (poly, room) => {
  for (const p of poly) if (!pointInPolygon(p, room) && distToBoundary(p, room) >= TOUCH_TOL) return false;
  // With every corner inside, the polygon can still leave the room where a reflex room corner pokes into it...
  for (const r of room) if (pointInPolygon(r, poly) && distToBoundary(r, poly) >= TOUCH_TOL) return false;
  // ...or where a wall cuts right across it (e.g. a notch whose corners both lie beyond the polygon).
  for (let i = 0; i < poly.length; i++) {
    for (let j = 0; j < room.length; j++) {
      if (segmentsCross(poly[i], poly[(i + 1) % poly.length], room[j], room[(j + 1) % room.length])) return false;
    }
  }
  return true;
};

export const projectOnWalls: ProjectOnWalls = (pts, p) => {
  let best = { wall: 0, offset: 0, distance: Infinity, point: pts[0] };
  wallSegments(pts).forEach(({ a, b }, wall) => {
    const { t, point } = closestOnSegment(p, a, b);
    const distance = len(sub(p, point));
    if (distance < best.distance) best = { wall, offset: t * len(sub(b, a)), distance, point };
  });
  return best;
};

const SIDES = [
  { side: 'front', m: { x: 0, y: 0.5 }, dir: { x: 0, y: 1 } },
  { side: 'back', m: { x: 0, y: -0.5 }, dir: { x: 0, y: -1 } },
  { side: 'left', m: { x: -0.5, y: 0 }, dir: { x: -1, y: 0 } },
  { side: 'right', m: { x: 0.5, y: 0 }, dir: { x: 1, y: 0 } },
] as const;

export const distancesToWalls: DistancesToWalls = (pose, size, room) => {
  const out: WallDistance[] = [];
  const rot = { x: 0, y: 0, rotation: pose.rotation };
  for (const s of SIDES) {
    const from = localToPlan(pose, { x: s.m.x * size.w, y: s.m.y * size.d });
    const dir = localToPlan(rot, s.dir);
    let best = Infinity;
    for (const { a, b } of wallSegments(room)) {
      const e = sub(b, a), den = dir.x * e.y - dir.y * e.x;
      if (Math.abs(den) < EPS) continue;
      const af = sub(a, from);
      const t = (af.x * e.y - af.y * e.x) / den; // along ray
      const v = (af.x * dir.y - af.y * dir.x) / den; // along wall
      if (t >= -EPS && v >= -EPS && v <= 1 + EPS && t < best) best = t;
    }
    if (best < Infinity) {
      const t = Math.max(0, best);
      out.push({ from, to: { x: from.x + dir.x * t, y: from.y + dir.y * t }, distance: t, side: s.side });
    }
  }
  return out;
};

interface Box { x0: number; x1: number; y0: number; y1: number }
const aabb = (poly: Polygon): Box => ({
  x0: Math.min(...poly.map((p) => p.x)), x1: Math.max(...poly.map((p) => p.x)),
  y0: Math.min(...poly.map((p) => p.y)), y1: Math.max(...poly.map((p) => p.y)),
});

export const snapItem: SnapItem = ({ roomPoints, others, pose, size, threshold }) => {
  const me = aabb(itemPolygon(pose, size));
  const boxes = others.map((o) => aabb(itemPolygon(o.pose, o.size)));
  const walls = wallSegments(roomPoints);
  const guides: Guide[] = [];
  let dx = 0, dy = 0;

  // axis 'x' snaps vertical lines (x = const); 'y' snaps horizontal lines.
  for (const axis of ['x', 'y'] as const) {
    const [lo, hi, oLo, oHi] = axis === 'x' ? (['x0', 'x1', 'y0', 'y1'] as const) : (['y0', 'y1', 'x0', 'x1'] as const);
    const mine = [me[lo], me[hi], (me[lo] + me[hi]) / 2];
    let best: { delta: number; line: number; kind: Guide['kind']; span: [number, number] } | null = null;
    const offer = (edges: number[], line: number, kind: Guide['kind'], span: [number, number]) => {
      for (const e of edges) {
        const delta = line - e;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line, kind, span };
      }
    };
    for (const { a, b } of walls) {
      if (Math.abs(a[axis] - b[axis]) > EPS) continue;
      const other = axis === 'x' ? 'y' : 'x';
      const s0 = Math.min(a[other], b[other]), s1 = Math.max(a[other], b[other]);
      if (me[oHi] < s0 - threshold || me[oLo] > s1 + threshold) continue; // wall not beside the item
      offer([mine[0], mine[1]], a[axis], 'wall', [s0, s1]);
    }
    for (const o of boxes) {
      const span: [number, number] = [Math.min(me[oLo], o[oLo]), Math.max(me[oHi], o[oHi])];
      offer([mine[0], mine[1]], o[lo], 'align', span);
      offer([mine[0], mine[1]], o[hi], 'align', span);
      offer([mine[2]], (o[lo] + o[hi]) / 2, 'align', span);
    }
    const hit = best as { delta: number; line: number; kind: Guide['kind']; span: [number, number] } | null;
    if (!hit) continue;
    if (axis === 'x') dx = hit.delta; else dy = hit.delta;
    const [s0, s1] = hit.span;
    guides.push(axis === 'x'
      ? { kind: hit.kind, a: { x: hit.line, y: s0 }, b: { x: hit.line, y: s1 } }
      : { kind: hit.kind, a: { x: s0, y: hit.line }, b: { x: s1, y: hit.line } });
  }
  return { x: pose.x + dx, y: pose.y + dy, guides };
};

/** A near-miss between two rooms' walls: `from` on a room's wall line, `to` its projection on the neighbour's outer face. */
/** `wall`: the wall drawn as `from` (index into the input rooms + wall index): sliding it onto `to` joins them. */
export interface WallNearMiss { kind: 'gap' | 'overlap'; distance: number; from: Segment; to: Segment; wall: { room: number; index: number } }
/** cm: walls this close count as attached; gaps are reported from WALL_GAP_MIN to WALL_GAP_MAX (overlaps up to WALL_GAP_MAX). */
export const WALL_COINCIDE_TOL = 0.5, WALL_GAP_MIN = 2, WALL_GAP_MAX = 40;

/**
 * Where a room's wall line (`inner`) runs parallel to, and faces, a neighbour's wall outer face (`outer`, same edge order)
 * without lying on it: a gap of WALL_GAP_MIN..WALL_GAP_MAX cm, or an overlap into the neighbour. Two walls are attached when
 * either room's line lies on the other's face (within WALL_COINCIDE_TOL); those, and non-parallel walls, are not reported.
 */
export const wallNearMisses = (rooms: { inner: Vec2[]; outer: Vec2[] }[]): WallNearMiss[] => {
  const out: WallNearMiss[] = [];
  const cosTol = Math.cos((1 * Math.PI) / 180);
  // Edge i: start, length, direction and outward normal (s = the room's orientation, as wallOutline).
  const edge = (poly: Vec2[], i: number, s: number) => {
    const a = poly[i], b = poly[(i + 1) % poly.length], l = len(sub(b, a));
    return l < EPS ? null : { a, l, u: { x: (b.x - a.x) / l, y: (b.y - a.y) / l }, n: { x: (s * (b.y - a.y)) / l, y: (-s * (b.x - a.x)) / l } };
  };
  type E = NonNullable<ReturnType<typeof edge>>;
  const dot = (p: Vec2, q: Vec2) => p.x * q.x + p.y * q.y;
  const at = (e: E, t: number, d = 0) => ({ x: e.a.x + e.u.x * t + e.n.x * d, y: e.a.y + e.u.y * t + e.n.y * d });
  for (let ai = 0; ai < rooms.length; ai++) for (let bi = ai + 1; bi < rooms.length; bi++) {
    const A = rooms[ai], B = rooms[bi];
    if (A.inner.length < 3 || B.inner.length < 3) continue;
    const sA = signedArea(A.inner) >= 0 ? 1 : -1, sB = signedArea(B.inner) >= 0 ? 1 : -1;
    for (let i = 0; i < A.inner.length; i++) for (let j = 0; j < B.inner.length; j++) {
      const lA = edge(A.inner, i, sA), fA = edge(A.outer, i, sA), lB = edge(B.inner, j, sB), fB = edge(B.outer, j, sB);
      if (!lA || !fA || !lB || !fB || dot(lA.n, lB.n) > -cosTol) continue; // must be parallel and face each other
      const dAB = dot(sub(lA.a, fB.a), fB.n), dBA = dot(sub(lB.a, fA.a), fA.n); // > 0: short of the face (gap)
      if (Math.abs(dAB) <= WALL_COINCIDE_TOL || Math.abs(dBA) <= WALL_COINCIDE_TOL) continue;
      const [line, face, d, wall] = Math.abs(dAB) <= Math.abs(dBA) ? [lA, fB, dAB, { room: ai, index: i }] : [lB, fA, dBA, { room: bi, index: j }];
      const kind = d >= WALL_GAP_MIN && d <= WALL_GAP_MAX ? 'gap' : d < 0 && d >= -WALL_GAP_MAX ? 'overlap' : null;
      if (!kind) continue;
      const t1 = dot(sub(line.a, face.a), face.u), t2 = t1 + dot(line.u, face.u) * line.l;
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(face.l, Math.max(t1, t2));
      if (hi - lo < 1) continue; // the walls don't run alongside each other
      out.push({ kind, distance: Math.abs(d), from: { a: at(face, lo, d), b: at(face, hi, d) }, to: { a: at(face, lo), b: at(face, hi) }, wall });
    }
  }
  return out;
};
