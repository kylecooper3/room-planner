import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { getBlob } from '../store/blobs';
import { MAX_WALL_CM, type BandAt, type InkSnap } from '../editor2d/drawSnap';
import { signedArea } from '../core/geometry';
import type { Underlay, Vec2 } from '../types';

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

/** Decodes the stored image, scaled so its longer side is at most maxSide px. */
export async function loadImageData(imageId: string, maxSide: number): Promise<{ image: ImageData; scale: number } | null> {
  const blob = await getBlob(imageId);
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  const f = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * f));
  canvas.height = Math.max(1, Math.round(bmp.height * f));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const scale = bmp.width / canvas.width;
  bmp.close();
  return { image: ctx.getImageData(0, 0, canvas.width, canvas.height), scale };
}

/**
 * Centre line, along `axis`, of the nearest wall band (an ink run at most maxBandPx wide) that (mx, my) is on or within maxPx
 * of (mask px); null if none. Scans the line through the point and parallel lines up to maxBandPx either side: at a corner
 * the line through the point runs along the perpendicular wall's ink (one band too wide to count).
 */
export function inkCentre(m: InkMask, mx: number, my: number, axis: 'x' | 'y', maxPx: number, maxBandPx: number): number | null {
  const along = axis === 'x' ? mx : my;
  const size = axis === 'x' ? m.w : m.h;
  const r = Math.ceil(Math.min(maxPx, 64) + maxBandPx), R = Math.ceil(maxBandPx);
  const i0 = Math.max(0, Math.floor(along) - r), i1 = Math.min(size, Math.floor(along) + r + 1);
  let best: number | null = null, bd = Infinity, bc = Infinity;
  for (let off = -R; off <= R; off++) {
    const fixed = Math.floor((axis === 'x' ? my : mx) + off);
    if (fixed < 0 || fixed >= (axis === 'x' ? m.h : m.w)) continue;
    const at = (i: number) => i >= 0 && i < size && m.data[axis === 'x' ? fixed * m.w + i : i * m.w + fixed] === 1;
    for (let i = i0, s = -1; i <= i1; i++) {
      const ink = i < i1 && at(i);
      if (ink && s < 0) s = i;
      if (ink || s < 0) continue;
      const lo = s, hi = i; // run [lo, hi)
      s = -1;
      if ((lo === i0 && at(lo - 1)) || (hi === i1 && at(hi)) || hi - lo > maxBandPx) continue; // cut off by the scan, or no wall
      const d = Math.max(lo - along, along - hi, 0), c = (lo + hi) / 2;
      if (d <= maxPx && (d < bd || (d === bd && Math.abs(c - along) < bc))) { bd = d; bc = Math.abs(c - along); best = c; }
    }
  }
  return best;
}

/**
 * The ink run on the line (mx, my) + t·(dx, dy) through the point, or nearest to it within maxPx / 2, as t offsets (mask px,
 * edges exact to the pixel boundary); null if none or wider than maxPx.
 */
export function inkRun(m: InkMask, mx: number, my: number, dx: number, dy: number, maxPx: number): { lo: number; hi: number } | null {
  const ink = (t: number) => {
    const x = Math.floor(mx + dx * t), y = Math.floor(my + dy * t);
    return x >= 0 && y >= 0 && x < m.w && y < m.h && m.data[y * m.w + x] === 1;
  };
  const S = 0.25;
  const edge = (a: number, b: number) => { // ink(a) !== ink(b): bisect to the boundary
    const va = ink(a);
    for (let k = 0; k < 30; k++) { const c = (a + b) / 2; if (ink(c) === va) a = c; else b = c; }
    return (a + b) / 2;
  };
  let t0: number | null = null;
  for (let t = 0; t <= maxPx / 2 && t0 === null; t += S) t0 = ink(t) ? t : ink(-t) ? -t : null;
  if (t0 === null) return null;
  let lo = t0, hi = t0;
  while (ink(lo - S)) { lo -= S; if (hi - lo > maxPx) return null; }
  while (ink(hi + S)) { hi += S; if (hi - lo > maxPx) return null; }
  return { lo: edge(lo, lo - S), hi: edge(hi, hi + S) };
}

/**
 * Moves each wall of `points` onto the inner edge (toward the interior) of the ink band it sits on, sampled along the
 * wall; corners are where neighbouring moved walls meet. `keep[i]`: wall i (points i → i+1) stays put. Thickness: the
 * median band width (0.5 cm steps, 5–60 cm). Null (no fit) when fewer than half the walls find a band.
 */
export function fitToInk(points: Vec2[], bandAt: BandAt, keep: boolean[] = []): { points: Vec2[]; wallThickness: number } | null {
  const n = points.length;
  const s = Math.sign(signedArea(points)) || 1;
  const med = (v: number[]) => { const o = [...v].sort((a, b) => a - b); return o.length % 2 ? o[o.length >> 1] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2; };
  const walls = points.map((a, i) => {
    const b = points[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const d = { x: (b.x - a.x) / l, y: (b.y - a.y) / l }, nIn = { x: -d.y * s, y: d.x * s };
    if (keep[i]) return { a, d, nIn, off: 0, width: null };
    const found = [0.15, 0.3, 0.5, 0.7, 0.85]
      .map((f) => bandAt({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, nIn))
      .filter((r): r is { lo: number; hi: number } => !!r);
    if (found.length < 3) return { a, d, nIn, off: 0, width: null };
    return { a, d, nIn, off: med(found.map((r) => r.hi)), width: med(found.map((r) => r.hi - r.lo)) };
  });
  const widths = walls.flatMap((w) => (w.width === null ? [] : [w.width]));
  const free = walls.length - keep.filter(Boolean).length;
  if (!widths.length || widths.length * 2 < free) return null;
  const moved = points.map((p, i) => {
    const w0 = walls[(i + n - 1) % n], w1 = walls[i];
    const p0 = { x: w0.a.x + w0.nIn.x * w0.off, y: w0.a.y + w0.nIn.y * w0.off }, p1 = { x: w1.a.x + w1.nIn.x * w1.off, y: w1.a.y + w1.nIn.y * w1.off };
    const cr = w0.d.x * w1.d.y - w0.d.y * w1.d.x;
    if (Math.abs(cr) < 1e-6) return p1; // straight on: no corner to intersect
    const t = ((p1.x - p0.x) * w1.d.y - (p1.y - p0.y) * w1.d.x) / cr;
    return { x: p0.x + w0.d.x * t, y: p0.y + w0.d.y * t };
  });
  return { points: moved, wallThickness: Math.min(60, Math.max(5, Math.round(med(widths) * 2) / 2)) };
}

export const makeInkSnap = (m: InkMask, u: Underlay): InkSnap => {
  const cmPerMask = u.cmPerPx * m.scale, maxBand = MAX_WALL_CM / cmPerMask;
  const snap: InkSnap = (p, axis, maxCm) => {
    const c = inkCentre(m, (p.x - u.x) / cmPerMask, (p.y - u.y) / cmPerMask, axis, maxCm / cmPerMask, maxBand);
    return c === null ? null : (axis === 'x' ? u.x : u.y) + c * cmPerMask;
  };
  snap.band = (p, d) => {
    const r = inkRun(m, (p.x - u.x) / cmPerMask, (p.y - u.y) / cmPerMask, d.x, d.y, maxBand);
    return r && { lo: r.lo * cmPerMask, hi: r.hi * cmPerMask };
  };
  return snap;
};

const MASK_SIDE = 2000;
const cache = new Map<string, Promise<InkMask | null>>();
const maskFor = (imageId: string) => {
  let m = cache.get(imageId);
  if (!m) {
    m = loadImageData(imageId, MASK_SIDE).then((r) => (r ? buildInkMask(r.image, r.scale) : null)).catch(() => null);
    cache.set(imageId, m);
  }
  return m;
};

/** Ink snapping for the current underlay (null while loading, without an underlay, or when it is hidden). Mask computed once per image. */
export function useInkSnap(enabled: boolean): InkSnap | null {
  const u = useStore((s) => s.project.underlay);
  const [mask, setMask] = useState<{ id: string; m: InkMask } | null>(null);
  const id = enabled && u?.visible ? u.imageId : null;
  useEffect(() => {
    if (!id) return;
    let live = true;
    void maskFor(id).then((m) => { if (live && m) setMask({ id, m }); });
    return () => { live = false; };
  }, [id]);
  return u && id && mask?.id === id ? makeInkSnap(mask.m, u) : null;
}
