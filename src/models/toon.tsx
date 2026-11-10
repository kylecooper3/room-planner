import type {} from '@react-three/fiber';
import { Outlines } from '@react-three/drei';
import { DataTexture, MeshToonMaterial, NearestFilter, RedFormat, type Texture } from 'three';
import type { Material } from '../types';

/** Gradient-map tones (0..255) per material: metal = sharper, brighter steps; fabric = softer. */
const TONES: Record<Material, number[]> = {
  fabric: [120, 175, 215, 255],
  wood: [105, 165, 220, 255],
  leather: [95, 160, 235],
  plastic: [110, 190, 255],
  metal: [80, 200, 255],
};
const textures = new Map<Material, DataTexture>();
const gradient = (m: Material): DataTexture => {
  let t = textures.get(m);
  if (!t) {
    const tones = TONES[m] ?? TONES.fabric;
    t = new DataTexture(new Uint8Array(tones), tones.length, 1, RedFormat);
    t.minFilter = t.magFilter = NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    textures.set(m, t);
  }
  return t;
};

const materials = new Map<string, MeshToonMaterial>();
/** Shared, memoised toon material (never disposed: the set of colours in a session is small). */
export const getToonMaterial = (color: string, material: Material = 'fabric', transparent = false, opacity = 1, map: Texture | null = null): MeshToonMaterial => {
  const key = `${color}|${material}|${transparent}|${opacity}|${map?.uuid ?? ''}`;
  let m = materials.get(key);
  if (!m) {
    m = new MeshToonMaterial({ color, gradientMap: gradient(material), transparent, opacity, map });
    materials.set(key, m);
  }
  return m;
};

/** Cel-shaded material for any mesh in the 3D view (furniture, walls, floor). Use as a child of <mesh>. */
export function ToonMaterial(props: { color: string; material?: Material; transparent?: boolean; opacity?: number; map?: Texture | null }) {
  return <primitive object={getToonMaterial(props.color, props.material, props.transparent, props.opacity, props.map)} attach="material" dispose={null} />;
}

/** Soft cartoon outline (inverted hull). Use as a child of <mesh>. Thickness is in screen pixels, so it suits any scene scale. */
export function ToonOutline(props: { color?: string; thickness?: number }) {
  return <Outlines color={props.color ?? '#4a3b33'} thickness={props.thickness ?? 2} />;
}
