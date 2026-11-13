import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CM_TO_M as M, type Opening, type Room, type Vec2 } from '../types';
import { getSurfaceMaterial, SurfaceMaterial, type Surface } from '../models/materials';
import { THEME } from '../theme';
import { buildWalls, wallFacesAway, type WallInfo } from './sceneMath';
import type { Passage } from './walk';
import { FLOOR_ROUGHNESS, floorTexture } from './floorTexture';

const KERB = 10;
const FRAME_COLOR = '#f4f3f0';
const DOOR_COLOR = '#ebe8e2';
/** Baseboard height and thickness (cm). */
const BASE_H = 8, BASE_T = 1.2;
const unitBox = new THREE.BoxGeometry(1, 1, 1);

/** Box in metres. */
function Box({ size, pos, rotY = 0, color, surface = 'paint' }: { size: [number, number, number]; pos: [number, number, number]; rotY?: number; color: string; surface?: Surface }) {
  const glass = surface === 'glass';
  return (
    <mesh geometry={unitBox} scale={size} position={pos} rotation-y={rotY} castShadow={!glass} receiveShadow={!glass}>
      <SurfaceMaterial color={color} surface={surface} />
    </mesh>
  );
}

/** Wall piece: matte paint, with a dark "cut" cap on top when it reaches the ceiling (reads as a section from above). */
function WallBox({ size, pos, color, cap }: { size: [number, number, number]; pos: [number, number, number]; color: string; cap: boolean }) {
  const mats = useMemo(() => {
    const paint = getSurfaceMaterial(color, 'paint');
    // BoxGeometry groups: +x, -x, +y, -y, +z, -z
    return cap ? [paint, paint, getSurfaceMaterial(THEME.planWall, 'paint'), paint, paint, paint] : paint;
  }, [color, cap]);
  return <mesh geometry={unitBox} scale={size} position={pos} material={mats} castShadow receiveShadow />;
}

/** Plan polygon → ShapeGeometry lying on the floor (use with rotation-x = -π/2); UVs are in metres. */
export function floorShape(points: Vec2[]): THREE.ShapeGeometry {
  return new THREE.ShapeGeometry(new THREE.Shape(points.map((p) => new THREE.Vector2(p.x * M, -p.y * M))));
}

function Door({ o, w, t }: { o: Opening; w: WallInfo; t: number }) {
  const u0 = Math.max(0, o.offset - o.width / 2), u1 = Math.min(w.length, o.offset + o.width / 2);
  const width = u1 - u0, h = o.height, s = w.side, zc = -s * t / 2, f = 5;
  if (width <= 2 * f) return null;
  const hinge = o.swing?.hinge ?? 'start', inward = (o.swing?.side ?? 'in') === 'in';
  const dirU = hinge === 'start' ? 1 : -1, zs = inward ? s : -s, ajar = 35 * Math.PI / 180;
  const hu = hinge === 'start' ? u0 + f : u1 - f, hz = inward ? 0 : -s * t;
  const leaf = width - 2 * f, vx = dirU * Math.cos(ajar), vz = zs * Math.sin(ajar);
  return (
    <>
      <Box size={[f * M, h * M, (t + 2) * M]} pos={[(u0 + f / 2) * M, (o.sill + h / 2) * M, zc * M]} color={FRAME_COLOR} />
      <Box size={[f * M, h * M, (t + 2) * M]} pos={[(u1 - f / 2) * M, (o.sill + h / 2) * M, zc * M]} color={FRAME_COLOR} />
      <Box size={[width * M, f * M, (t + 2) * M]} pos={[(u0 + width / 2) * M, (o.sill + h - f / 2) * M, zc * M]} color={FRAME_COLOR} />
      <Box
        size={[leaf * M, (h - f - 1) * M, 4 * M]}
        pos={[(hu + vx * leaf / 2) * M, (o.sill + (h - f - 1) / 2) * M, (hz + vz * leaf / 2) * M]}
        rotY={-Math.atan2(vz, vx)}
        color={DOOR_COLOR}
      />
      {/* lever handle, on both faces of the leaf */}
      <Box
        size={[12 * M, 2 * M, 10 * M]}
        pos={[(hu + vx * (leaf - 8)) * M, (o.sill + 100) * M, (hz + vz * (leaf - 8)) * M]}
        rotY={-Math.atan2(vz, vx)}
        color="#8d8f93"
        surface="metal"
      />
    </>
  );
}

function Window({ o, w, t }: { o: Opening; w: WallInfo; t: number }) {
  const u0 = Math.max(0, o.offset - o.width / 2), u1 = Math.min(w.length, o.offset + o.width / 2);
  const width = u1 - u0, h = o.height, zc = -w.side * t / 2, f = 5, d = (t + 2) * M;
  if (width <= 2 * f || h <= 2 * f) return null;
  const cu = (u0 + u1) / 2, cy = o.sill + h / 2;
  return (
    <>
      <Box size={[width * M, f * M, d]} pos={[cu * M, (o.sill + f / 2) * M, zc * M]} color={FRAME_COLOR} />
      <Box size={[width * M, f * M, d]} pos={[cu * M, (o.sill + h - f / 2) * M, zc * M]} color={FRAME_COLOR} />
      <Box size={[f * M, (h - 2 * f) * M, d]} pos={[(u0 + f / 2) * M, cy * M, zc * M]} color={FRAME_COLOR} />
      <Box size={[f * M, (h - 2 * f) * M, d]} pos={[(u1 - f / 2) * M, cy * M, zc * M]} color={FRAME_COLOR} />
      <Box size={[(width - 2 * f) * M, (h - 2 * f) * M, 1 * M]} pos={[cu * M, cy * M, zc * M]} color="#cfe0e8" surface="glass" />
    </>
  );
}

function Fixture({ o, w }: { o: Opening; w: WallInfo }) {
  const depth = o.kind === 'radiator' ? 8 : 1.5;
  const color = o.kind === 'radiator' ? '#efeeeb' : '#f7f7f5';
  return <Box size={[o.width * M, o.height * M, depth * M]} pos={[o.offset * M, (o.sill + o.height / 2) * M, w.side * depth / 2 * M]} color={color} />;
}

interface WallRefs { full: THREE.Group | null; kerb: THREE.Group | null }

interface RoomShellProps {
  room: Room; cutaway: boolean;
  /** Door passages of the whole house: cut out of this room's walls wherever they cross them. */
  passages?: Passage[];
  onFloorClick?: (e: ThreeEvent<MouseEvent>) => void;
  onFloorDoubleClick?: (e: ThreeEvent<MouseEvent>) => void;
}

export function RoomShell({ room, cutaway, passages, onFloorClick, onFloorDoubleClick }: RoomShellProps) {
  const walls = useMemo(() => buildWalls(room, passages), [room.points, room.openings, room.wallThickness, room.ceilingHeight, passages]);
  const floorGeo = useMemo(() => floorShape(room.points), [room.points]);
  useEffect(() => () => floorGeo.dispose(), [floorGeo]);
  const tex = useMemo(() => floorTexture(room.floor), [room.floor]);
  const refs = useRef<WallRefs[]>([]);
  const t = room.wallThickness, H = room.ceilingHeight, color = room.wallColor;

  useFrame(({ camera }) => {
    const cx = camera.position.x / M, cy = camera.position.z / M;
    for (let i = 0; i < walls.length; i++) {
      const r = refs.current[i];
      if (!r?.full || !r.kerb) continue;
      const hide = cutaway && wallFacesAway(walls[i], cx, cy);
      r.full.visible = !hide;
      r.kerb.visible = hide;
    }
  });

  return (
    <group>
      <mesh geometry={floorGeo} rotation-x={-Math.PI / 2} receiveShadow onClick={onFloorClick} onDoubleClick={onFloorDoubleClick}>
        <meshStandardMaterial map={tex} color={tex ? '#ffffff' : '#c8b6a0'} roughness={FLOOR_ROUGHNESS[room.floor]} envMapIntensity={0.6} />
      </mesh>
      {walls.map((w, i) => {
        const zc = -w.side * t / 2 * M;
        const piece = (u0: number, u1: number, y0: number, y1: number, key: string) => (
          <WallBox key={key} size={[(u1 - u0) * M, (y1 - y0) * M, t * M]} pos={[(u0 + u1) / 2 * M, (y0 + y1) / 2 * M, zc]} color={color} cap={y1 >= H - 0.01} />
        );
        const zb = w.side * BASE_T / 2 * M;
        return (
          <group key={i} position={[w.a.x * M, 0, w.a.y * M]} rotation-y={-w.angle}>
            <group ref={(g) => { (refs.current[i] ??= { full: null, kerb: null }).full = g; }}>
              {w.ext0 > 0 && piece(-w.ext0, 0, 0, H, 'e0')}
              {w.pieces.map((p, j) => piece(p.u0, p.u1, p.y0, p.y1, String(j)))}
              {w.pieces.map((p, j) => p.y0 === 0 && p.y1 > BASE_H && p.u1 - p.u0 > 2 && (
                <Box key={`b${j}`} size={[(p.u1 - p.u0) * M, BASE_H * M, BASE_T * M]} pos={[(p.u0 + p.u1) / 2 * M, BASE_H / 2 * M, zb]} color={FRAME_COLOR} />
              ))}
              {w.ext1 > 0 && piece(w.length, w.length + w.ext1, 0, H, 'e1')}
              {w.openings.map((o) =>
                o.kind === 'open' ? null
                : o.kind === 'door' ? <Door key={o.id} o={o} w={w} t={t} />
                : o.kind === 'window' ? <Window key={o.id} o={o} w={w} t={t} />
                : <Fixture key={o.id} o={o} w={w} />)}
            </group>
            {/* Cut-away stand-in: a low kerb along the wall's floor-level pieces, so door and open gaps stay open. */}
            <group ref={(g) => { (refs.current[i] ??= { full: null, kerb: null }).kerb = g; }} visible={false}>
              {[[-w.ext0, 0], ...w.pieces.filter((p) => p.y0 === 0).map((p) => [p.u0, p.u1]), [w.length, w.length + w.ext1]]
                .filter(([u0, u1]) => u1 - u0 > 0.01)
                .map(([u0, u1], j) => (
                  <mesh key={j} position={[(u0 + u1) / 2 * M, Math.min(KERB, H) / 2 * M, zc]} receiveShadow>
                    <boxGeometry args={[(u1 - u0) * M, Math.min(KERB, H) * M, t * M]} />
                    <primitive object={getSurfaceMaterial(THEME.planWall, 'paint')} attach="material" dispose={null} />
                  </mesh>
                ))}
            </group>
          </group>
        );
      })}
    </group>
  );
}
