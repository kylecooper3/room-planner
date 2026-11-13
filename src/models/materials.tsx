import type {} from '@react-three/fiber';
import { Outlines } from '@react-three/drei';
import { CanvasTexture, Color, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { Category, Material, PartRole } from '../types';

/**
 * Physically based surfaces. Item `Material`s plus a few internal ones the generators' parts need (a lamp shade, a
 * ceramic pot, leaves, a TV screen) and room-shell ones (paint, glass).
 */
export type Surface = Material | 'ceramic' | 'leaf' | 'screen' | 'shade' | 'paint' | 'glass' | 'soil' | 'paper';

interface SurfaceDef { roughness: number; metalness: number; detail?: 'grain' | 'weave' | 'pores' | 'leaf'; env?: number }
const SURFACES: Record<Surface, SurfaceDef> = {
  fabric: { roughness: 0.95, metalness: 0, detail: 'weave', env: 0.6 },
  wood: { roughness: 0.62, metalness: 0, detail: 'grain' },
  leather: { roughness: 0.5, metalness: 0, detail: 'pores' },
  metal: { roughness: 0.32, metalness: 0.85, env: 1.2 },
  plastic: { roughness: 0.42, metalness: 0 },
  ceramic: { roughness: 0.28, metalness: 0 },
  leaf: { roughness: 0.7, metalness: 0, detail: 'leaf' },
  screen: { roughness: 0.12, metalness: 0.1, env: 1.3 },
  shade: { roughness: 0.95, metalness: 0, detail: 'weave', env: 0.6 },
  paint: { roughness: 0.92, metalness: 0, env: 0.7 },
  glass: { roughness: 0.04, metalness: 0, env: 1.5 },
  soil: { roughness: 1, metalness: 0 },
  paper: { roughness: 0.85, metalness: 0 },
};

/** Which surface a generated part gets, from its category, role and the item's chosen material. */
export function surfaceFor(category: Category, role: PartRole, mat: Material): Surface {
  const soft = mat === 'leather' ? 'leather' : 'fabric';
  const legs: Surface = mat === 'metal' ? 'metal' : 'wood';
  switch (category) {
    case 'sofa': case 'armchair': return role === 'frame' ? legs : soft;
    case 'bed': return role === 'frame' ? (mat === 'wood' || mat === 'metal' ? mat : soft) : 'fabric';
    case 'chair':
      if (role === 'accent') return 'plastic';
      if (role === 'frame') return mat === 'plastic' ? 'metal' : mat === 'fabric' || mat === 'leather' ? 'wood' : mat;
      return role === 'cushion' && mat === 'plastic' ? 'fabric' : mat;
    case 'lamp': return role === 'accent' ? 'shade' : role === 'frame' ? 'metal' : 'ceramic';
    case 'plant': return role === 'body' ? 'ceramic' : role === 'frame' ? 'soil' : 'leaf';
    case 'rug': return 'fabric';
    case 'tv': return role === 'accent' ? 'screen' : role === 'frame' ? (mat === 'plastic' ? 'wood' : mat) : 'plastic';
    case 'shelf': return role === 'accent' ? 'paper' : mat;
    case 'dresser': case 'nightstand': case 'desk': return role === 'accent' ? 'metal' : mat;
    default: return mat;
  }
}

/** Seeded PRNG so procedural textures are identical on every load. */
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const details = new Map<string, Texture | null>();
/** Near-white grayscale detail map (multiplied with the colour), generated once per kind. */
function detailMap(kind: NonNullable<SurfaceDef['detail']>): Texture | null {
  if (details.has(kind)) return details.get(kind)!;
  let tex: Texture | null = null;
  const S = 256;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d');
  if (canvas && ctx) {
    canvas.width = canvas.height = S;
    const r = rng(kind.length * 977 + 13);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, S, S);
    if (kind === 'grain') {
      // long, slightly wavy streaks along u
      for (let i = 0; i < 70; i++) {
        const y = r() * S, a = 0.02 + r() * 0.05, w = 0.6 + r() * 1.6, ph = r() * 6, amp = 1 + r() * 3;
        ctx.strokeStyle = `rgba(90,60,30,${a})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        for (let x = -4; x <= S + 4; x += 8) ctx.lineTo(x, y + Math.sin(x / 40 + ph) * amp);
        ctx.stroke();
      }
    } else if (kind === 'weave') {
      for (let y = 0; y < S; y += 2) { ctx.fillStyle = `rgba(0,0,0,${0.035 + r() * 0.03})`; ctx.fillRect(0, y, S, 1); }
      for (let x = 0; x < S; x += 2) { ctx.fillStyle = `rgba(0,0,0,${0.025 + r() * 0.03})`; ctx.fillRect(x, 0, 1, S); }
      for (let i = 0; i < 2500; i++) { ctx.fillStyle = `rgba(0,0,0,${r() * 0.05})`; ctx.fillRect(r() * S, r() * S, 1, 1); }
    } else if (kind === 'pores') {
      for (let i = 0; i < 4000; i++) { ctx.fillStyle = `rgba(0,0,0,${r() * 0.06})`; ctx.fillRect(r() * S, r() * S, 1.5, 1.5); }
    } else {
      // leaf: soft blotches of lighter/darker green tone
      for (let i = 0; i < 260; i++) {
        const d = r() < 0.5;
        ctx.fillStyle = d ? `rgba(0,30,0,${0.08 + r() * 0.14})` : `rgba(255,255,220,${0.06 + r() * 0.1})`;
        ctx.beginPath();
        ctx.ellipse(r() * S, r() * S, 4 + r() * 10, 2 + r() * 5, r() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    tex = new CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
  }
  details.set(kind, tex);
  return tex;
}

const materials = new Map<string, MeshStandardMaterial>();
/** Shared, memoised PBR material (never disposed: the set of colours in a session is small). */
export function getSurfaceMaterial(color: string, surface: Surface = 'fabric', map: Texture | null = null): MeshStandardMaterial {
  const key = `${color}|${surface}|${map?.uuid ?? ''}`;
  let m = materials.get(key);
  if (!m) {
    const d = SURFACES[surface] ?? SURFACES.fabric;
    m = new MeshStandardMaterial({
      color, roughness: d.roughness, metalness: d.metalness, envMapIntensity: d.env ?? 1,
      map: map ?? (d.detail ? detailMap(d.detail) : null),
    });
    if (surface === 'glass') { m.transparent = true; m.opacity = 0.22; m.depthWrite = false; }
    if (surface === 'shade') { m.emissive = new Color(color); m.emissiveIntensity = 0.28; } // a lit lamp shade glows softly
    materials.set(key, m);
  }
  return m;
}

/** PBR material for a mesh. Use as a child of <mesh>. */
export function SurfaceMaterial(props: { color: string; surface?: Surface; map?: Texture | null }) {
  return <primitive object={getSurfaceMaterial(props.color, props.surface, props.map ?? null)} attach="material" dispose={null} />;
}

/** Thin screen-space outline for selection / error highlights only (normal meshes have none). Child of <mesh>. */
export function HighlightOutline({ color, thickness = 2.5 }: { color: string; thickness?: number }) {
  return <Outlines color={color} thickness={thickness} />;
}
