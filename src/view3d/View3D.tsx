import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CM_TO_M as M, isFlat, type Issue, type ItemDef, type Layout, type PlacedItem, type Polygon, type Room, type Vec2 } from '../types';
import { useStore } from '../store/store';
import { useActiveRoom, useGetDef, useIssues, useLayout } from '../store/selectors';
import { ItemModelView } from '../models/ItemModelView';
import { clearancePolygon, doorSwingPolygon } from '../core/geometry';
import { RoomShell, floorShape } from './RoomShell';
import { OrbitRig, WalkRig, type Bounds, type LockState } from './cameras';
import { itemRotationY, planToWorld, walkStart } from './sceneMath';
import { houseColliders, housePassages } from './walk';
import { registerView3d } from './exportPng';
import './v3-view3d.css';

export interface View3DProps {
  /** Layout of the active room to show; defaults to the active layout. */
  layoutId?: string;
  /** Compare view: no selection changes. */
  readOnly?: boolean;
}

const BG = '#fdf0e1';
const CLICK_SLOP = 4; // px: a pointer that moved more than this was a drag, not a click
const NO_ROOMS: Room[] = [];

/**
 * Live cartoon 3D render of the whole house (every room). Compare panes (a `layoutId` or `readOnly`) show only the active
 * room with the given layout. Fills its parent. Wrapper element has data-testid="view3d".
 */
export function View3D({ layoutId, readOnly = false }: View3DProps) {
  const room = useActiveRoom();
  const compare = readOnly || layoutId !== undefined;
  const allRooms = useStore((s) => (compare ? NO_ROOMS : s.project.rooms));
  const rooms = useMemo(() => (compare ? (room ? [room] : []) : allRooms).filter((r) => r.points.length >= 3), [compare, room, allRooms]);
  const walkMode = useStore((s) => s.ui.walkMode) && !compare && rooms.length > 0;
  const [lock, setLock] = useState<LockState>('free');
  const [top, setTop] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!walkMode) setLock('free'); }, [walkMode]);
  if (rooms.length === 0) {
    return (
      <div data-testid="view3d" className="v3-root">
        <div className="v3-empty">No room yet — draw or set up a room to see it in 3D.</div>
      </div>
    );
  }
  const setWalk = (on: boolean) => useStore.getState().setUI({ walkMode: on });
  return (
    <div data-testid="view3d" className="v3-root" ref={rootRef}>
      <Canvas
        shadows="percentage"
        dpr={[1, 1.5]}
        frameloop={walkMode ? 'always' : 'demand'}
        camera={{ fov: 50, near: 0.05, far: 200 }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerMissed={(e) => { if (!readOnly && !walkMode && e.button === 0) useStore.getState().select(null); }}
      >
        <Scene rooms={rooms} activeRoom={room ?? rooms[0]} layoutId={layoutId} readOnly={readOnly} walkMode={walkMode} top={top}
          onLock={setLock} overlay={rootRef} setCursor={(c) => { if (rootRef.current) rootRef.current.style.cursor = c; }} />
      </Canvas>
      {!compare && (
        <div className="v3-cams">
          <div className="v3-seg" role="group" aria-label="Camera">
            {/* blur: a focused button would be "clicked" by Space (jump) */}
            <button type="button" data-testid="cam-overview" aria-pressed={!walkMode} title="Orbit, pan and zoom over the whole home"
              onClick={(e) => { e.currentTarget.blur(); setWalk(false); }}>🗺 Overview</button>
            <button type="button" data-testid="cam-walk" aria-pressed={walkMode} title="Walk around inside, first person"
              onClick={(e) => { e.currentTarget.blur(); setWalk(true); }}>🚶 Walk</button>
          </div>
          {!walkMode && (
            <button type="button" className="v3-top" data-testid="cam-top" aria-pressed={top} title="Look straight down (click again to go back)"
              onClick={(e) => { e.currentTarget.blur(); setTop((t) => !t); }}>⬇ Top view</button>
          )}
        </div>
      )}
      {!walkMode && !compare && (
        <div className="v3-tip">Drag to orbit · Right-drag or Shift+drag to pan · Wheel to zoom · Double-click the floor to walk there</div>
      )}
      {walkMode && <div className="v3-crosshair" data-testid="walk-crosshair" aria-hidden />}
      {walkMode && (
        <div className="v3-hint" data-testid="walk-hint">
          {lock === 'released'
            ? 'Click to keep walking · press Esc again or O for Overview'
            : 'Click to look around · WASD move · Shift sprint · Space jump · Esc release mouse'}
        </div>
      )}
    </div>
  );
}

function boundsOf(rooms: Room[]): Bounds {
  const pts = rooms.flatMap((r) => r.points);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { cx: (minX + maxX) / 2 * M, cz: (minY + maxY) / 2 * M, span: Math.hypot(maxX - minX, maxY - minY) * M };
}

type Entry = { item: PlacedItem; def: ItemDef };
const entriesOf = (layout: Layout | null | undefined, getDef: (id: string) => ItemDef | undefined): Entry[] => (layout?.items ?? [])
  .map((item) => ({ item, def: getDef(item.defId) }))
  .filter((x): x is Entry => !!x.def);

interface SceneProps {
  rooms: Room[]; activeRoom: Room; layoutId?: string; readOnly: boolean; walkMode: boolean; top: boolean;
  setCursor: (c: string) => void; onLock: (s: LockState) => void;
  /** DOM parent for issue labels. */
  overlay: RefObject<HTMLDivElement | null>;
}

function Scene({ rooms, activeRoom, layoutId, readOnly, walkMode, top, setCursor, onLock, overlay }: SceneProps) {
  const layout = useLayout(layoutId);
  const getDef = useGetDef();
  const issues = useIssues(layoutId);
  const selection = useStore((s) => s.ui.selection);
  const cutaway = useStore((s) => s.ui.cutaway);
  const showClearances = useStore((s) => s.ui.showClearances);
  const [hovered, setHovered] = useState<string | null>(null);

  const { cx, cz, span } = useMemo(() => boundsOf(rooms), [rooms]);
  const bounds = useMemo(() => ({ cx, cz, span }), [cx, cz, span]);

  // Door passages only change with the shell geometry (not with furniture moves), so memoise on that.
  const shellKey = JSON.stringify(rooms.map((r) => [r.points, r.openings, r.wallThickness]));
  const passages = useMemo(() => housePassages(rooms), [shellKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const colliders = useMemo(() => (walkMode ? houseColliders(rooms, passages, getDef) : []), [walkMode, rooms, passages, getDef]);

  const messages = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const is of issues) for (const id of is.itemIds) m.set(id, [...(m.get(id) ?? []), is.message]);
    return m;
  }, [issues]);

  const activeItems = useMemo(() => entriesOf(layout, getDef), [layout, getDef]);
  const start = useMemo(() => walkStart(activeRoom, activeItems.filter(({ def }) => !isFlat(def)).map(({ item, def }) => ({ item, size: def.size }))),
    [activeRoom, activeItems]);
  const drop = useRef<{ pos: Vec2; yaw: number } | null>(null); // set by double-clicking the floor
  useEffect(() => { if (!walkMode) drop.current = null; }, [walkMode]);
  const begin = drop.current ?? start;

  const selectedId = selection?.type === 'item' ? selection.id : null;
  const canSelect = !readOnly && !walkMode;

  useEffect(() => () => setCursor(''), [setCursor]);

  const onFloorClick = (e: ThreeEvent<MouseEvent>) => { if (canSelect && e.delta <= CLICK_SLOP) { e.stopPropagation(); useStore.getState().select(null); } };
  const onFloorDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!canSelect) return;
    e.stopPropagation();
    const d = e.camera.getWorldDirection(new THREE.Vector3());
    drop.current = { pos: { x: e.point.x / M, y: e.point.z / M }, yaw: Math.hypot(d.x, d.z) > 1e-3 ? Math.atan2(-d.x, -d.z) : 0 };
    useStore.getState().setUI({ walkMode: true });
  };

  return (
    <>
      <color attach="background" args={[BG]} />
      <Registrar readOnly={readOnly} />
      <Lights bounds={bounds} />
      {rooms.map((room) => {
        const active = room.id === activeRoom.id;
        return (
          <group key={room.id} name={`room:${room.id}`}>
            <RoomShell room={room} cutaway={cutaway && !walkMode} passages={passages} onFloorClick={onFloorClick} onFloorDoubleClick={onFloorDoubleClick} />
            <RoomItems
              room={room}
              items={active ? activeItems : undefined}
              getDef={getDef}
              messages={active ? messages : undefined}
              selectedId={active ? selectedId : null}
              hovered={hovered}
              overlay={overlay}
              onClick={(id, e) => {
                e.stopPropagation();
                if (!canSelect || e.delta > CLICK_SLOP) return;
                const s = useStore.getState();
                if (!active) s.setActiveRoom(room.id);
                s.select({ type: 'item', id });
              }}
              onHover={(id, on) => {
                setHovered((h) => (on ? id : h === id ? null : h));
                if (canSelect) setCursor(on ? 'pointer' : '');
              }}
            />
          </group>
        );
      })}
      {/* The toggle hides only the neutral zones: red issue zones always show (as in 2D). */}
      <Overlays room={activeRoom} items={activeItems} issues={issues} showNeutral={showClearances} />
      <OrbitRig bounds={bounds} enabled={!walkMode} top={top} />
      {walkMode && <WalkRig start={begin.pos} yaw={begin.yaw} colliders={colliders} onLock={onLock} />}
    </>
  );
}

interface RoomItemsProps {
  room: Room;
  /** Pre-resolved items (the active room); others use their active layout. */
  items?: Entry[];
  getDef: (id: string) => ItemDef | undefined;
  /** Issue messages: only the active room shows issues. */
  messages?: Map<string, string[]>;
  selectedId: string | null;
  hovered: string | null;
  overlay: RefObject<HTMLDivElement | null>;
  onClick: (id: string, e: ThreeEvent<MouseEvent>) => void;
  onHover: (id: string, on: boolean) => void;
}

function RoomItems({ room, items, getDef, messages, selectedId, hovered, overlay, onClick, onHover }: RoomItemsProps) {
  const layout = room.layouts.find((l) => l.id === room.activeLayoutId);
  const own = useMemo(() => (items ? null : entriesOf(layout, getDef)), [items, layout, getDef]);
  return (
    <>
      {(items ?? own ?? []).map(({ item, def }) => (
        <ItemNode
          key={item.id}
          item={item}
          def={def}
          highlight={messages?.has(item.id) ? 'error' : item.id === selectedId ? 'selected' : 'none'}
          overlay={overlay}
          label={hovered === item.id || item.id === selectedId ? messages?.get(item.id) : undefined}
          onClick={(e) => onClick(item.id, e)}
          onHover={(on) => onHover(item.id, on)}
        />
      ))}
    </>
  );
}

declare global {
  /** Read-only test hook (e2e): the editable 3D view's camera. */
  interface Window { __view3d?: { camera(): { position: number[]; direction: number[]; target: number[] | null }; rooms(): string[] } }
}

function Registrar({ readOnly }: { readOnly: boolean }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const off = registerView3d({ readOnly, get: () => { const s = get(); return { gl: s.gl, scene: s.scene, camera: s.camera }; } });
    if (readOnly) return off;
    const hook = {
      camera: () => {
        const { camera, controls } = get();
        const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
        return { position: camera.position.toArray(), direction: camera.getWorldDirection(new THREE.Vector3()).toArray(), target: target ? target.toArray() : null };
      },
      rooms: () => get().scene.children.filter((o) => o.name.startsWith('room:')).map((o) => o.name.slice(5)),
    };
    window.__view3d = hook;
    return () => { off(); if (window.__view3d === hook) delete window.__view3d; };
  }, [get, readOnly]);
  return null;
}

function Lights({ bounds }: { bounds: Bounds }) {
  const { cx, cz, span } = bounds;
  const target = useMemo(() => new THREE.Object3D(), []);
  const r = span / 2 + 1;
  return (
    <>
      <hemisphereLight args={['#fff4e6', '#e9d6c2', 1.1]} />
      <ambientLight intensity={0.35} />
      <primitive object={target} position={[cx, 0, cz]} />
      <directionalLight
        target={target}
        position={[cx + r * 0.8, r * 2 + 2, cz + r * 0.5]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-left={-r}
        shadow-camera-right={r}
        shadow-camera-top={r}
        shadow-camera-bottom={-r}
        shadow-camera-near={0.5}
        shadow-camera-far={r * 5 + 4}
      />
    </>
  );
}

interface ItemNodeProps {
  item: PlacedItem;
  def: ItemDef;
  highlight: 'none' | 'selected' | 'error';
  label?: string[];
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (on: boolean) => void;
  overlay: RefObject<HTMLDivElement | null>;
}

function ItemNode({ item, def, highlight, label, onClick, onHover, overlay }: ItemNodeProps) {
  const ref = useRef<THREE.Group>(null);
  const flat = isFlat(def);
  useEffect(() => {
    ref.current?.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = !flat; o.receiveShadow = true; } });
  });
  return (
    <group
      ref={ref}
      position={planToWorld(item.x, item.y, flat ? 0.002 : 0)}
      rotation-y={itemRotationY(item.rotation)}
      onClick={onClick}
      onPointerOver={(e) => { e.stopPropagation(); onHover(true); }}
      onPointerOut={() => onHover(false)}
    >
      <ItemModelView model={def.model} size={def.size} highlight={highlight} />
      {label && label.length > 0 && (
        <Label3D overlay={overlay} position={[0, def.size.h * M + 0.25, 0]} lines={label} />
      )}
    </group>
  );
}

/**
 * Issue label: a plain DOM element in `overlay`, moved every frame to the projected anchor. (drei's <Html> creates a
 * React root per label, which crashes — removeChild NotFoundError — when the canvas unmounts with a label showing.)
 */
function Label3D({ overlay, position, lines }: { overlay: RefObject<HTMLDivElement | null>; position: [number, number, number]; lines: string[] }) {
  const anchor = useRef<THREE.Group>(null);
  const el = useMemo(() => document.createElement('div'), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useLayoutEffect(() => {
    el.className = 'v3-label v3-label-float';
    overlay.current?.appendChild(el);
    return () => el.remove();
  }, [el, overlay]);
  useLayoutEffect(() => {
    el.replaceChildren(...lines.map((l) => Object.assign(document.createElement('div'), { textContent: l })));
  }, [el, lines]);
  useFrame(({ camera, size }) => {
    if (!anchor.current) return;
    anchor.current.getWorldPosition(v).project(camera);
    el.style.display = v.z > 1 ? 'none' : '';
    el.style.transform = `translate(${(v.x + 1) / 2 * size.width}px, ${(1 - v.y) / 2 * size.height}px) translate(-50%, -50%)`;
  });
  return <group ref={anchor} position={position} />;
}

function FlatPoly({ poly, color, opacity, lift }: { poly: Polygon; color: string; opacity: number; lift: number }) {
  const geo = useMemo(() => floorShape(poly), [poly]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} rotation-x={-Math.PI / 2} position-y={lift} raycast={() => null} renderOrder={1}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function Overlays({ room, items, issues, showNeutral }: { room: Room; items: Entry[]; issues: Issue[]; showNeutral: boolean }) {
  const neutral = useMemo(() => {
    const polys: Polygon[] = [];
    if (!showNeutral) return polys;
    for (const { item, def } of items) for (const z of def.clearances) polys.push(clearancePolygon(item, def.size, z));
    for (const o of room.openings) {
      if (o.kind !== 'door' || o.swing?.side !== 'in') continue;
      const p = doorSwingPolygon(room.points, o);
      if (p) polys.push(p);
    }
    return polys;
  }, [items, room.points, room.openings, showNeutral]);
  return (
    <>
      {neutral.map((p, i) => <FlatPoly key={`n${i}`} poly={p} color="#8c7f76" opacity={0.14} lift={0.004} />)}
      {issues.map((is) => is.zone && <FlatPoly key={is.id} poly={is.zone} color="#e5484d" opacity={0.35} lift={0.006} />)}
    </>
  );
}
