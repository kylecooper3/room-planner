import type { PaletteColor } from '../types';
import { labDist2, labToRgb, rgbToHex, rgbToLab, type Lab } from './color';

const MAX_SAMPLES = 10000;
/** Clusters closer than this (ΔE) are merged. */
const MERGE_DE = 10;

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** k-means (k-means++ init, fixed seed) in CIELAB over pixels with alpha >= 128. */
export function extractPalette(rgba: Uint8ClampedArray, k = 5): PaletteColor[] {
  const n = rgba.length >> 2;
  let opaque = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] >= 128) opaque++;
  if (opaque === 0 || k < 1) return [];
  const stride = Math.max(1, Math.ceil(opaque / MAX_SAMPLES));
  const pts: Lab[] = [];
  for (let i = 0, seen = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    if (seen++ % stride === 0) pts.push(rgbToLab(rgba[o], rgba[o + 1], rgba[o + 2]));
  }

  const rand = rng(42);
  const centers: Lab[] = [pts[Math.floor(rand() * pts.length)]];
  const d2 = pts.map((p) => labDist2(p, centers[0]));
  while (centers.length < Math.min(k, pts.length)) {
    const sum = d2.reduce((a, b) => a + b, 0);
    if (sum === 0) break; // fewer distinct colours than k
    let r = rand() * sum, idx = 0;
    while (idx < pts.length - 1 && (r -= d2[idx]) > 0) idx++;
    centers.push(pts[idx]);
    for (let i = 0; i < pts.length; i++) d2[i] = Math.min(d2[i], labDist2(pts[i], pts[idx]));
  }

  const assign = new Int32Array(pts.length);
  for (let iter = 0; iter < 20; iter++) {
    let changed = false;
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) { const d = labDist2(pts[i], centers[c]); if (d < bd) { bd = d; best = c; } }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    const acc = centers.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => { const a = acc[assign[i]]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++; });
    acc.forEach((a, c) => { if (a[3]) centers[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    if (!changed && iter > 0) break;
  }

  let clusters = centers.map((lab, c) => ({ lab, count: 0, c }));
  for (let i = 0; i < pts.length; i++) clusters[assign[i]].count++;
  clusters = clusters.filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
  // Merge near-duplicates into the heavier cluster (weighted mean).
  const merged: { lab: Lab; count: number }[] = [];
  for (const cl of clusters) {
    const m = merged.find((x) => labDist2(x.lab, cl.lab) < MERGE_DE * MERGE_DE);
    if (!m) { merged.push({ lab: cl.lab, count: cl.count }); continue; }
    const t = m.count + cl.count;
    m.lab = [0, 1, 2].map((j) => (m.lab[j] * m.count + cl.lab[j] * cl.count) / t) as Lab;
    m.count = t;
  }
  return merged
    .sort((a, b) => b.count - a.count)
    .map(({ lab, count }) => ({ hex: rgbToHex(...labToRgb(lab)), weight: count / pts.length }));
}
