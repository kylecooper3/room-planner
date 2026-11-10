import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { getBlob } from '../store/blobs';
import type { InkSnap } from '../editor2d/drawSnap';
import type { Underlay } from '../types';
import { buildInkMask, type InkMask } from './detectWalls';

export type { InkMask };

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
