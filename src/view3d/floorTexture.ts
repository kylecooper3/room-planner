import * as THREE from 'three';
import type { FloorMaterial } from '../types';

/** Base colours used for the toon material under each floor texture. */
export const FLOOR_COLOR: Record<FloorMaterial, string> = { wood: '#e2b788', carpet: '#cfc3dc', tile: '#eef1f0' };

const cache = new Map<FloorMaterial, THREE.Texture | null>();

/** Procedural cartoon floor texture; one texture tile = 1 m × 1 m (floor UVs are in metres). Shared across views. */
export function floorTexture(kind: FloorMaterial): THREE.Texture | null {
  if (cache.has(kind)) return cache.get(kind)!;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  let tex: THREE.Texture | null = null;
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    if (kind === 'wood') {
      const rows = 6, h = size / rows; // ~16 cm planks
      for (let r = 0; r < rows; r++) {
        ctx.fillStyle = r % 2 ? '#f4ece2' : '#fbf6f0';
        ctx.fillRect(0, r * h, size, h);
        ctx.fillStyle = '#c9b49c';
        ctx.fillRect(0, r * h, size, 2);
        const joint = ((r * 97) % size);
        ctx.fillRect(joint, r * h, 2, h);
      }
    } else if (kind === 'carpet') {
      // deterministic speckle so the texture is stable between reloads
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 1400; i++) {
        ctx.fillStyle = rnd() > 0.5 ? '#ece6f0' : '#f8f5fa';
        ctx.fillRect(rnd() * size, rnd() * size, 2, 2);
      }
    } else {
      const n = 3, s = size / n; // ~33 cm tiles
      ctx.fillStyle = '#c8cfcc';
      for (let i = 0; i < n; i++) { ctx.fillRect(i * s, 0, 3, size); ctx.fillRect(0, i * s, size, 3); }
    }
    tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  }
  cache.set(kind, tex);
  return tex;
}
