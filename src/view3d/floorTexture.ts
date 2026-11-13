import * as THREE from 'three';
import type { FloorMaterial } from '../types';

/** Real-world size (m) covered by one texture tile; floor UVs are in metres. */
export const FLOOR_TILE_M: Record<FloorMaterial, number> = { wood: 2.4, carpet: 1, tile: 1.2 };
/** Roughness per floor finish. */
export const FLOOR_ROUGHNESS: Record<FloorMaterial, number> = { wood: 0.55, carpet: 1, tile: 0.3 };

const cache = new Map<FloorMaterial, THREE.Texture | null>();
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/**
 * Procedural, full-colour floor texture (generated once, shared across views): oak planks ~15 cm wide, 60 cm porcelain
 * tiles, or a fine carpet pile. Deterministic, so it is stable between reloads.
 */
export function floorTexture(kind: FloorMaterial): THREE.Texture | null {
  if (cache.has(kind)) return cache.get(kind)!;
  const S = kind === 'carpet' ? 256 : 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  let tex: THREE.Texture | null = null;
  if (ctx) {
    const r = rng(kind === 'wood' ? 11 : kind === 'tile' ? 23 : 7);
    if (kind === 'wood') {
      const rows = 16, h = S / rows; // 2.4 m / 16 = 15 cm planks
      for (let row = 0; row < rows; row++) {
        let x = -r() * S * 0.5;
        while (x < S) {
          const len = S * (0.35 + r() * 0.45); // 0.85–1.9 m boards
          const l = 50 + r() * 8, sat = 26 + r() * 8, hue = 29 + r() * 4;
          ctx.fillStyle = `hsl(${hue} ${sat}% ${l}%)`;
          ctx.fillRect(x, row * h, len, h);
          // grain streaks along the board
          for (let g = 0; g < 7; g++) {
            const gy = row * h + 2 + r() * (h - 4);
            ctx.fillStyle = `rgba(90,55,25,${0.05 + r() * 0.1})`;
            ctx.fillRect(x, gy, len, 0.6 + r() * 1.4);
          }
          ctx.fillStyle = 'rgba(60,40,20,0.35)';
          ctx.fillRect(x, row * h, 1.5, h); // butt joint
          x += len;
        }
        ctx.fillStyle = 'rgba(60,40,20,0.3)';
        ctx.fillRect(0, row * h, S, 1.5); // long seam
      }
    } else if (kind === 'tile') {
      const n = 2, s = S / n; // 60 cm tiles
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const l = 86 + r() * 3;
        ctx.fillStyle = `hsl(40 6% ${l}%)`;
        ctx.fillRect(i * s, j * s, s, s);
        for (let k = 0; k < 900; k++) { ctx.fillStyle = `rgba(0,0,0,${r() * 0.04})`; ctx.fillRect(i * s + r() * s, j * s + r() * s, 2, 2); }
      }
      ctx.fillStyle = '#b9b6b0';
      for (let i = 0; i <= n; i++) { ctx.fillRect(i * s - 2, 0, 4, S); ctx.fillRect(0, i * s - 2, S, 4); }
    } else {
      ctx.fillStyle = '#b4aca0';
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = r() > 0.5 ? `rgba(255,255,255,${r() * 0.12})` : `rgba(0,0,0,${r() * 0.1})`;
        ctx.fillRect(r() * S, r() * S, 1.5, 1.5);
      }
    }
    tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.setScalar(1 / FLOOR_TILE_M[kind]);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
  }
  cache.set(kind, tex);
  return tex;
}
