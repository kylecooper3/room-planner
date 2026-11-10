import type { Vec2 } from '../types';

/** Proposes a room outline (image pixel coordinates) from a floor-plan image: the largest enclosed region; null if none. */
export const detectWalls = (image: ImageData): Vec2[] | null => detectRooms(image)[0] ?? null;

/**
 * Every enclosed room-sized region of a floor-plan image (image pixel coordinates), largest first. Door gaps are bridged
 * by morphological closing at a few radii; the radius that separates the most rooms wins. Never throws; bounded time
 * (a handful of linear passes per radius).
 */
export const detectRooms = (image: ImageData): Vec2[][] => {
  try {
    return detect(image);
  } catch {
    return [];
  }
};

/** A region must cover this fraction of the image and be at least this fraction of the longer side across. */
const MIN_REGION_FRACTION = 0.004;
const MIN_SIDE_FRACTION = 0.04;

function detect({ data, width: w, height: h }: ImageData): Vec2[][] {
  const n = w * h;
  if (w < 8 || h < 8 || data.length < n * 4) return [];

  const wall = buildInkMask({ data, width: w, height: h } as ImageData).data;
  if (!wall.some((v) => v === 1)) return []; // blank / no contrast

  const s = Math.max(w, h);
  const minSide = s * MIN_SIDE_FRACTION;
  const radii = [...new Set([1, 0.01, 0.02, 0.035, 0.05].map((f) => Math.max(1, Math.round(f < 1 ? s * f : f))))];
  let best: ReturnType<typeof enclosedRegions> | null = null;
  for (const r of radii) {
    const found = enclosedRegions(close(wall, w, h, r), w, h, n * MIN_REGION_FRACTION, minSide);
    if (found.rooms.length > (best?.rooms.length ?? 0)) best = found;
  }
  if (!best) return [];

  const { labels } = best;
  const out: { pts: Vec2[]; area: number }[] = [];
  for (const { label, first, area } of best.rooms) {
    const contour = traceCracks((x, y) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === label, first, w, n);
    if (contour.length < 3) continue;
    const pts = rectify(simplifyClosed(contour, Math.max(2, s * 0.01)));
    if (pts.length >= 3) out.push({ pts, area });
  }
  return out.sort((a, b) => b.area - a.area).map((r) => r.pts);
}

/** Downsampled "wall ink" mask of a floor-plan image: 1 = thick dark ink, 0 = paper. */
export interface InkMask { w: number; h: number; data: Uint8Array; /** image px per mask px */ scale: number }

/**
 * Dark ink (at or below the Otsu threshold, capped so mid-grey floor textures stay paper), minus strokes thinner than
 * 3 px (furniture outlines, text, door arcs, hatching): a morphological opening with a 3×3 square. Blank / no-contrast
 * images give an empty mask.
 */
export function buildInkMask({ data, width: w, height: h }: ImageData, scale = 1): InkMask {
  const n = w * h;
  const gray = new Uint8Array(n);
  const hist = new Float64Array(256);
  let lo = 255, hi = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    const g = Math.round((0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * a + 255 * (1 - a));
    gray[i] = g;
    hist[g]++;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const out = new Uint8Array(n);
  if (hi - lo < 32) return { w, h, data: out, scale };
  const t = Math.min(otsu(hist, n), 140);
  const dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) dark[i] = gray[i] <= t ? 1 : 0;
  const ero = boxCount(dark, w, h, 1);
  const core = new Uint8Array(n);
  for (let i = 0; i < n; i++) core[i] = ero[i] === 9 ? 1 : 0;
  const dil = boxCount(core, w, h, 1);
  for (let i = 0; i < n; i++) out[i] = dark[i] && dil[i] > 0 ? 1 : 0;
  return { w, h, data: out, scale };
}

export function otsu(hist: Float64Array, n: number): number {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, bestVar = -1, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; t = i; }
  }
  return t;
}

/** Box-window sum over a binary image via an integral image (out-of-bounds counts as 0). */
export function boxCount(src: Uint8Array, w: number, h: number, r: number): Int32Array {
  const W = w + 1;
  const ii = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      ii[(y + 1) * W + x + 1] = ii[y * W + x + 1] + row;
    }
  }
  const out = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = ii[y1 * W + x1] - ii[y0 * W + x1] - ii[y1 * W + x0] + ii[y0 * W + x0];
    }
  }
  return out;
}

/** Morphological closing with a (2r+1)² square, OR-ed with the original so it never removes ink. */
function close(wall: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const dil = boxCount(wall, w, h, r);
  const d = new Uint8Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = dil[i] > 0 ? 1 : 0;
  const ero = boxCount(d, w, h, r);
  const full = (2 * r + 1) * (2 * r + 1);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = wall[i] || ero[i] === full ? 1 : 0;
  return out;
}

/** Floods the outside from the border, then labels every remaining 4-connected non-wall region; keeps room-sized ones. */
function enclosedRegions(wall: Uint8Array, w: number, h: number, minArea: number, minSide: number) {
  const n = w * h;
  const labels = new Int32Array(n); // 0 = unvisited, -1 = wall/outside, >0 = enclosed region
  const queue = new Int32Array(n);
  for (let i = 0; i < n; i++) if (wall[i]) labels[i] = -1;
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  const flood = (seed: number, label: number): number => {
    let head = 0, tail = 0;
    queue[tail++] = seed;
    labels[seed] = label;
    x0 = x1 = seed % w; y0 = y1 = Math.floor(seed / w);
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && labels[i - 1] === 0) { labels[i - 1] = label; queue[tail++] = i - 1; }
      if (x < w - 1 && labels[i + 1] === 0) { labels[i + 1] = label; queue[tail++] = i + 1; }
      if (i >= w && labels[i - w] === 0) { labels[i - w] = label; queue[tail++] = i - w; }
      if (i < n - w && labels[i + w] === 0) { labels[i + w] = label; queue[tail++] = i + w; }
    }
    return tail;
  };
  for (let x = 0; x < w; x++) {
    if (labels[x] === 0) flood(x, -1);
    if (labels[n - w + x] === 0) flood(n - w + x, -1);
  }
  for (let y = 0; y < h; y++) {
    if (labels[y * w] === 0) flood(y * w, -1);
    if (labels[y * w + w - 1] === 0) flood(y * w + w - 1, -1);
  }
  const rooms: { label: number; first: number; area: number }[] = [];
  let next = 1;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== 0) continue;
    const area = flood(i, next);
    if (area >= minArea && x1 - x0 + 1 >= minSide && y1 - y0 + 1 >= minSide) rooms.push({ label: next, first: i, area });
    next++;
  }
  return { labels, rooms };
}

/** Follows the pixel-edge (crack) boundary of the region with the region on the right; returns its corner vertices. */
function traceCracks(inside: (x: number, y: number) => boolean, first: number, w: number, n: number): Vec2[] {
  const sx = first % w, sy = Math.floor(first / w); // top-left corner of the first pixel in scan order
  let x = sx, y = sy, dx = 1, dy = 0;
  const pts: Vec2[] = [];
  for (let steps = 0; steps < 4 * n + 8; steps++) {
    const rx = -dy, ry = dx;
    const right = inside(x + (dx + rx - 1) / 2, y + (dy + ry - 1) / 2);
    const left = inside(x + (dx - rx - 1) / 2, y + (dy - ry - 1) / 2);
    let ndx = dx, ndy = dy;
    if (!right) { ndx = rx; ndy = ry; } // turn right
    else if (left) { ndx = dy; ndy = -dx; } // turn left
    if (ndx !== dx || ndy !== dy || steps === 0) pts.push({ x, y });
    dx = ndx; dy = ndy;
    x += dx; y += dy;
    if (x === sx && y === sy) break;
  }
  return pts;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}

/** Douglas–Peucker on a closed ring (iterative), anchored at pts[0] and the point farthest from it. */
function simplifyClosed(pts: Vec2[], eps: number): Vec2[] {
  const m = pts.length;
  let far = 0, farD = -1;
  for (let i = 1; i < m; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    if (d > farD) { farD = d; far = i; }
  }
  const keep = new Uint8Array(m);
  keep[0] = keep[far] = 1;
  const at = (i: number) => pts[i % m];
  const stack: [number, number][] = [[0, far], [far, m]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let idx = -1, dMax = eps;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(at(i), at(a), at(b));
      if (d > dMax) { dMax = d; idx = i; }
    }
    if (idx >= 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Snaps near-axis-aligned edges (within ~8°) to exact horizontals/verticals and drops collinear points. */
function rectify(input: Vec2[]): Vec2[] {
  let pts = input.map((p) => ({ ...p }));
  const tan = Math.tan((8 * Math.PI) / 180);
  for (let pass = 0; pass < 3 && pts.length >= 3; pass++) {
    const m = pts.length;
    const kind = pts.map((a, i) => {
      const b = pts[(i + 1) % m];
      const ax = Math.abs(b.x - a.x), ay = Math.abs(b.y - a.y);
      return ay <= ax * tan ? 'h' : ax <= ay * tan ? 'v' : 'f';
    });
    // Merge runs of the same axis kind by dropping the vertex between them.
    const merged = pts.filter((_, i) => kind[i] === 'f' || kind[i] !== kind[(i - 1 + m) % m]);
    if (merged.length !== m) { pts = merged; continue; }
    pts = pts.map((p, i) => {
      const prev = (i - 1 + m) % m, next = (i + 1) % m;
      const q = { ...p };
      if (kind[prev] === 'h') q.y = (pts[prev].y + p.y) / 2;
      else if (kind[i] === 'h') q.y = (p.y + pts[next].y) / 2;
      if (kind[prev] === 'v') q.x = (pts[prev].x + p.x) / 2;
      else if (kind[i] === 'v') q.x = (p.x + pts[next].x) / 2;
      return q;
    });
    // Second sweep makes both ends of each axis edge share one coordinate.
    pts = pts.map((p, i) => {
      const next = pts[(i + 1) % m];
      if (kind[i] === 'h') next.y = p.y;
      if (kind[i] === 'v') next.x = p.x;
      return p;
    });
  }
  // Drop duplicates and collinear points.
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], p = pts[i], b = pts[(i + 1) % pts.length];
    const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
    if (Math.abs(cross) > 1e-6) out.push(p);
  }
  return out;
}
