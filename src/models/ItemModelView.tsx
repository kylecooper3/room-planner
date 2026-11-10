import { useMemo } from 'react';
import { RoundedBox } from '@react-three/drei';
import { BoxGeometry, Color, CylinderGeometry, SphereGeometry } from 'three';
import { CM_TO_M } from '../types';
import type { ItemModel, Material, ModelPart, Size3 } from '../types';
import { generateModel } from './generate';
import { ToonMaterial, ToonOutline } from './toon';

export interface ItemModelViewProps {
  model: ItemModel;
  size: Size3;
  /** selected = accent outline; error = red tint + red outline. */
  highlight?: 'none' | 'selected' | 'error';
}

// Shared unit geometries (scaled per mesh), low segment counts for integrated GPUs.
const GEOM = {
  box: new BoxGeometry(1, 1, 1),
  cylinder: new CylinderGeometry(0.5, 0.5, 1, 14),
  sphere: new SphereGeometry(0.5, 14, 10),
  cone: new CylinderGeometry(0.2, 0.5, 1, 14), // frustum: reads as a lampshade / pot
};
const ERROR = '#e5484d';
const OUTLINE = { none: ['#4a3b33', 2], selected: ['#f08a4b', 4], error: [ERROR, 3] } as const;
const tint = (hex: string) => `#${new Color(hex).lerp(new Color(ERROR), 0.55).getHexString()}`;

/** Renders an item model as an r3f <group> in METRES, origin at the floor centre, +z front. Must be inside a <Canvas>. */
export function ItemModelView({ model, size, highlight = 'none' }: ItemModelViewProps) {
  const { w, d, h } = size;
  const parts = useMemo<ModelPart[]>(
    () => (model.kind === 'parametric' ? generateModel(model, { w, d, h })
      : [{ role: 'body', shape: 'box', size: [w, h, d], position: [0, h / 2, 0], color: '#a0a0a0' }]),
    [model, w, d, h],
  );
  const material: Material = model.kind === 'parametric' ? model.material : 'plastic';
  const colors = useMemo(() => parts.map((p) => {
    const c = p.color ?? (model.kind === 'parametric' ? model.colors[p.role] : '#a0a0a0');
    return highlight === 'error' ? tint(c) : c;
  }), [parts, model, highlight]);
  const [outline, thickness] = OUTLINE[highlight];

  return (
    <group scale={CM_TO_M}>
      {parts.map((p, i) => {
        const children = <><ToonMaterial color={colors[i]} material={material} /><ToonOutline color={outline} thickness={thickness} /></>;
        return p.shape === 'box' && p.round
          ? <RoundedBox key={i} args={p.size} radius={p.round} smoothness={2} position={p.position} rotation={p.rotation} castShadow receiveShadow>{children}</RoundedBox>
          : <mesh key={i} geometry={GEOM[p.shape]} scale={p.size} position={p.position} rotation={p.rotation} castShadow receiveShadow>{children}</mesh>;
      })}
    </group>
  );
}
