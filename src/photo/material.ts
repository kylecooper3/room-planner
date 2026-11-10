import type { Material } from '../types';
import { rgbToHsl } from './color';

export interface MaterialStats {
  meanSat: number;
  meanL: number;
  stdL: number;
  /** Fraction of brown-ish pixels (warm hue, low-to-mid saturation, mid/dark lightness). */
  brown: number;
  /** Fraction of near-neutral (grey/silver/black/white) pixels. */
  neutral: number;
  /** Mean |ΔL| between neighbouring opaque pixels (texture / edge energy). */
  edge: number;
  /** max(gx, gy) / min(gx, gy): grain-like directional texture is > ~1.5. */
  direction: number;
  /** Fraction of bright, low-saturation highlight pixels well above the mean lightness. */
  specular: number;
}

export function materialStats(rgba: Uint8ClampedArray, w: number, h: number): MaterialStats | null {
  const n = w * h;
  const L = new Float32Array(n);
  const op = new Uint8Array(n);
  let cnt = 0, sat = 0, sumL = 0, sumL2 = 0, brown = 0, neutral = 0;
  const S = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    const [hue, s, l] = rgbToHsl(rgba[o], rgba[o + 1], rgba[o + 2]);
    op[i] = 1; L[i] = l; S[i] = s; cnt++; sat += s; sumL += l; sumL2 += l * l;
    if (hue >= 10 && hue <= 50 && s >= 0.15 && s <= 0.75 && l >= 0.1 && l <= 0.7) brown++;
    if (s < 0.12 || l < 0.08) neutral++;
  }
  if (!cnt) return null;
  const meanL = sumL / cnt;
  let gx = 0, nx = 0, gy = 0, ny = 0, spec = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!op[i]) continue;
    if (x + 1 < w && op[i + 1]) { gx += Math.abs(L[i] - L[i + 1]); nx++; }
    if (y + 1 < h && op[i + w]) { gy += Math.abs(L[i] - L[i + w]); ny++; }
    if (L[i] > 0.8 && L[i] > meanL + 0.25 && S[i] < 0.3) spec++;
  }
  const ax = nx ? gx / nx : 0, ay = ny ? gy / ny : 0;
  return {
    meanSat: sat / cnt, meanL, stdL: Math.sqrt(Math.max(0, sumL2 / cnt - meanL * meanL)), brown: brown / cnt, neutral: neutral / cnt,
    edge: (ax + ay) / 2, direction: Math.max(ax, ay) / Math.max(1e-4, Math.min(ax, ay)), specular: spec / cnt,
  };
}

/**
 * Rough material guess from colour/texture statistics over opaque pixels. Colour carries most of the weight, because
 * photos are small and often flat: texture only separates the close calls. Defaults to fabric.
 */
export function estimateMaterial(rgba: Uint8ClampedArray, w: number, h: number): Material {
  const s = materialStats(rgba, w, h);
  if (!s) return 'fabric';
  const smooth = s.edge < 0.03;
  // Dark, smooth, warm or black, with highlights.
  if (s.meanL < 0.35 && smooth && s.specular > 0.01 && (s.brown > 0.4 || s.neutral > 0.6)) return 'leather';
  // Warm brown / tan, low-to-mid saturation (grain, if any, only adds confidence).
  if (s.brown > 0.5 || (s.brown > 0.35 && s.direction > 1.4)) return 'wood';
  // Near-neutral grey/silver, or strongly specular.
  if (s.neutral > 0.6 && ((s.meanL >= 0.3 && s.meanL <= 0.85) || s.specular > 0.04)) return 'metal';
  if (s.meanSat < 0.2 && s.specular > 0.1) return 'metal';
  // Very uniform, bright, highly saturated.
  if (s.meanSat > 0.6 && s.meanL > 0.3 && s.stdL < 0.1 && smooth) return 'plastic';
  return 'fabric';
}
