import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CM_TO_M as M, type Opening, type Room, type Vec2 } from '../types';
import { ToonMaterial, ToonOutline } from '../models/toon';
import { buildWalls, wallFacesAway, type WallInfo } from './sceneMath';
import type { Passage } from './walk';
import { FLOOR_COLOR, floorTexture } from './floorTexture';

const KERB = 10;
const FRAME_COLOR = '#fffaf2';

/** Toon box in metres. */
function Box({ size, pos, rotY = 0, color, opacity }: { size: [number, number, number]; pos: [number, number, number]; rotY?: number; color: string; opacity?: number }) {
  const glass = opacity !== undefined;
  return (
    <mesh position={pos} rotation-y={rotY} castShadow={!glass} receiveShadow>
      <boxGeometry args={size} />
      <ToonMaterial color={color} transparent={glass} opacity={opacity} />
      {!glass && <ToonOutline />}
    </mesh>
  );
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
        color="#d9a066"
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
      <Box size={[(width - 2 * f) * M, (h - 2 * f) * M, 1 * M]} pos={[cu * M, cy * M, zc * M]} color="#bfe3f2" opacity={0.35} />
    </>
  );
}

function Fixture({ o, w }: { o: Opening; w: WallInfo }) {
  const depth = o.kind === 'radiator' ? 8 : 1.5;
  const color = o.kind === 'radiator' ? '#f4f1ec' : '#ffffff';
  return <Box size={[o.width * M, o.height * M, depth * M]} pos={[o.offset * M, (o.sill + o.height / 2) * M, w.side * depth / 2 * M]} color={color} />;
}

interface WallRefs { full: THREE.Group | null; kerb: THREE.Mesh | null }

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
        <ToonMaterial color={FLOOR_COLOR[room.floor]} map={tex} />
        <ToonOutline />
      </mesh>
      {walls.map((w, i) => {
        const zc = -w.side * t / 2 * M;
        const piece = (u0: number, u1: number, y0: number, y1: number, key: string) => (
          <Box key={key} size={[(u1 - u0) * M, (y1 - y0) * M, t * M]} pos={[(u0 + u1) / 2 * M, (y0 + y1) / 2 * M, zc]} color={color} />
        );
        return (
          <group key={i} position={[w.a.x * M, 0, w.a.y * M]} rotation-y={-w.angle}>
            <group ref={(g) => { (refs.current[i] ??= { full: null, kerb: null }).full = g; }}>
              {w.ext0 > 0 && piece(-w.ext0, 0, 0, H, 'e0')}
              {w.pieces.map((p, j) => piece(p.u0, p.u1, p.y0, p.y1, String(j)))}
              {w.ext1 > 0 && piece(w.length, w.length + w.ext1, 0, H, 'e1')}
              {w.openings.map((o) =>
                o.kind === 'door' ? <Door key={o.id} o={o} w={w} t={t} />
                : o.kind === 'window' ? <Window key={o.id} o={o} w={w} t={t} />
                : <Fixture key={o.id} o={o} w={w} />)}
            </group>
            <mesh
              ref={(m) => { (refs.current[i] ??= { full: null, kerb: null }).kerb = m; }}
              visible={false}
              position={[(w.length + w.ext1 - w.ext0) / 2 * M, Math.min(KERB, H) / 2 * M, zc]}
              receiveShadow
            >
              <boxGeometry args={[(w.length + w.ext0 + w.ext1) * M, Math.min(KERB, H) * M, t * M]} />
              <ToonMaterial color={color} />
              <ToonOutline />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
