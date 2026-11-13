import { useMemo } from 'react';
import { RoundedBox } from '@react-three/drei';
import { BoxGeometry, Color, CylinderGeometry, SphereGeometry } from 'three';
import { CM_TO_M } from '../types';
import type { ItemModel, ModelPart, Size3 } from '../types';
import { THEME } from '../theme';
import { generateModel } from './generate';
import { HighlightOutline, SurfaceMaterial, surfaceFor, type Surface } from './materials';

export interface ItemModelViewProps {
  model: ItemModel;
  size: Size3;
  /** selected = thin accent outline; error = red tint + red outline. */
  highlight?: 'none' | 'selected' | 'error';
}

// Shared unit geometries (scaled per mesh), modest segment counts for integrated GPUs.
const GEOM = {
  box: new BoxGeometry(1, 1, 1),
  cylinder: new CylinderGeometry(0.5, 0.5, 1, 24),
  sphere: new SphereGeometry(0.5, 20, 14),
  cone: new CylinderGeometry(0.3, 0.5, 1, 24), // frustum: reads as a lampshade / pot
};
const OUTLINE = { selected: [THEME.accent, 2.5], error: [THEME.danger, 2.5] } as const;
const tint = (hex: string) => `#${new Color(hex).lerp(new Color(THEME.danger), 0.5).getHexString()}`;

/** Renders an item model as an r3f <group> in METRES, origin at the floor centre, +z front. Must be inside a <Canvas>. */
export function ItemModelView({ model, size, highlight = 'none' }: ItemModelViewProps) {
  const { w, d, h } = size;
  const parts = useMemo<ModelPart[]>(
    () => (model.kind === 'parametric' ? generateModel(model, { w, d, h })
      : [{ role: 'body', shape: 'box', size: [w, h, d], position: [0, h / 2, 0], color: '#a0a0a0' }]),
    [model, w, d, h],
  );
  const looks = useMemo(() => parts.map((p): [string, Surface] => {
    const c = p.color ?? (model.kind === 'parametric' ? model.colors[p.role] : '#a0a0a0');
    const s = model.kind === 'parametric' ? surfaceFor(model.category, p.role, model.material) : 'plastic';
    return [highlight === 'error' ? tint(c) : c, s];
  }), [parts, model, highlight]);
  const outline = highlight === 'none' ? null : OUTLINE[highlight];

  return (
    <group scale={CM_TO_M}>
      {parts.map((p, i) => {
        const children = <>
          <SurfaceMaterial color={looks[i][0]} surface={looks[i][1]} />
          {outline && <HighlightOutline color={outline[0]} thickness={outline[1]} />}
        </>;
        return p.shape === 'box' && p.round
          ? <RoundedBox key={i} args={p.size} radius={p.round} smoothness={3} position={p.position} rotation={p.rotation} castShadow receiveShadow>{children}</RoundedBox>
          : <mesh key={i} geometry={GEOM[p.shape]} scale={p.size} position={p.position} rotation={p.rotation} castShadow receiveShadow>{children}</mesh>;
      })}
    </group>
  );
}
