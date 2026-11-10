import { labDist2, rgbToLab, type Lab } from './color';
import type { RGBAImage } from './image';

/** Mask: 1 = item, 0 = background, one byte per pixel. */
export type Mask = Uint8Array;

/** Background ΔE from the border colour. */
const BG_DE = 16;

/** A usable mask keeps between 3% and 97% of the pixels. */
export function maskSane(mask: Mask): boolean {
  let on = 0;
  for (let i = 0; i < mask.length; i++) on += mask[i];
  const f = on / Math.max(1, mask.length);
  return f >= 0.03 && f <= 0.97;
}

/** Classical fallback: border colour estimate + flood fill from the border over colour-similar pixels. */
export function classicalSegment({ data, width: w, height: h }: RGBAImage): Mask {
  const n = w * h;
  const lab: Lab[] = new Array(n);
  for (let i = 0; i < n; i++) lab[i] = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  // Median per channel is robust to the item touching the border.
  const med = (j: number) => { const v = border.map((i) => lab[i][j]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg: Lab = [med(0), med(1), med(2)];
  const isBg = (i: number) => labDist2(lab[i], bg) < BG_DE * BG_DE;

  const mask = new Uint8Array(n).fill(1);
  const stack: number[] = [];
  for (const i of border) if (mask[i] && isBg(i)) { mask[i] = 0; stack.push(i); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const j of nb) if (j >= 0 && j < n && mask[j] && isBg(j)) { mask[j] = 0; stack.push(j); }
  }
  return mask;
}

/** Copy of the image with alpha = 0 outside the mask. */
export function applyMask(img: RGBAImage, mask: Mask): RGBAImage {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < mask.length; i++) if (!mask[i]) data[i * 4 + 3] = 0;
  return { data, width: img.width, height: img.height };
}

export const U2_SIZE = 320;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

/** U-2-Net input: image stretched to 320×320, ImageNet-normalised, CHW float32. */
export function toU2Input({ data, width: w, height: h }: RGBAImage): Float32Array {
  const S = U2_SIZE, out = new Float32Array(3 * S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / S)), sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / S));
    const o = (sy * w + sx) * 4;
    for (let c = 0; c < 3; c++) out[c * S * S + y * S + x] = (data[o + c] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

/** U-2-Net 320×320 saliency output → binary mask at w×h (min-max normalised, bilinear, threshold 0.5). */
export function maskFromU2(pred: ArrayLike<number>, w: number, h: number): Mask {
  const S = U2_SIZE;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < S * S; i++) { mn = Math.min(mn, pred[i]); mx = Math.max(mx, pred[i]); }
  const span = mx - mn || 1;
  const at = (x: number, y: number) => (pred[y * S + x] - mn) / span;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.max(0, ((x + 0.5) * S) / w - 0.5), fy = Math.max(0, ((y + 0.5) * S) / h - 0.5);
    const x0 = Math.min(S - 1, Math.floor(fx)), y0 = Math.min(S - 1, Math.floor(fy));
    const x1 = Math.min(S - 1, x0 + 1), y1 = Math.min(S - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const v = (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
    mask[y * w + x] = v >= 0.5 ? 1 : 0;
  }
  return mask;
}
