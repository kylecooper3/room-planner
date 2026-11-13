import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { getBlob } from '../store/blobs';
import type { InkSnap } from '../editor2d/drawSnap';
import type { Underlay } from '../types';

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
 * Nearest ink/paper boundary to (mx, my) along `axis`, within maxPx (mask px). Boundary b lies between pixels b-1 and b.
 * Scans the line through the point and lines 2 px either side: a corner sits exactly on the face of the perpendicular
 * wall, so the line through it may run inside that wall's ink. O(maxPx).
 */
export function inkBoundary(m: InkMask, mx: number, my: number, axis: 'x' | 'y', maxPx: number): number | null {
  const along = axis === 'x' ? mx : my;
  const size = axis === 'x' ? m.w : m.h;
  const r = Math.min(Math.ceil(maxPx), 64);
  let best: number | null = null, bd = maxPx;
  for (const off of [0, -2, 2]) {
    const fixed = Math.floor((axis === 'x' ? my : mx) + off);
    if (fixed < 0 || fixed >= (axis === 'x' ? m.h : m.w)) continue;
    const at = (i: number) => m.data[axis === 'x' ? fixed * m.w + i : i * m.w + fixed];
    for (let b = Math.max(1, Math.round(along) - r); b <= Math.min(size - 1, Math.round(along) + r); b++) {
      if (at(b - 1) !== at(b) && Math.abs(b - along) < bd) { bd = Math.abs(b - along); best = b; }
    }
  }
  return best;
}

export const makeInkSnap = (m: InkMask, u: Underlay): InkSnap => {
  const cmPerMask = u.cmPerPx * m.scale;
  return (p, axis, maxCm) => {
    const b = inkBoundary(m, (p.x - u.x) / cmPerMask, (p.y - u.y) / cmPerMask, axis, maxCm / cmPerMask);
    return b === null ? null : (axis === 'x' ? u.x : u.y) + b * cmPerMask;
  };
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
