import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as RMouseEvent, PointerEvent as RPointerEvent, ReactNode } from 'react';
import { isFlat } from '../types';
import type { Guide, Issue, ItemDef, ModelPart, Opening, PlacedItem, Room, Vec2 } from '../types';
import { THEME } from '../theme';
import { generateModel, withItemColors } from '../models/generate';
import { useStore } from '../store/store';
import { useActiveRoom, useGetDef, useIssues, useLayout } from '../store/selectors';
import {
  clearancePolygon, clipToConvex, distancesToWalls, doorSwingPolygon, getOpeningGeometry, pointInPolygon, polygonArea, polygonCentroid, projectOnWalls,
  snapItem, wallNearMisses,
} from '../core/geometry';
import { formatArea, formatLength } from '../core/units';
import { UnderlayLayer } from '../floorplan/UnderlayLayer';
import { CalibrateTool } from '../floorplan/CalibrateTool';
import { useInkSnap } from '../floorplan/inkMask';
import { PlanViewContext } from './planContext';
import type { PlanView } from './planContext';
import { snapPoint, WALL_SNAP_PX } from './drawSnap';
import type { SnapHit } from './drawSnap';
import { useDrawRoom } from './drawRoom';
import { FONT, GUIDE, Label, SnapMarker, pts } from './planShapes';
import { insertCorner, openingsClash, slideWall, snapSlide, wallJoin, wallNormal } from './wallEdit';
import {
  bodyColor, boundsOf, clampOffset, dist, fitView, gridStep, openingDefaults, rotationFromPointer, screenToPlan,
  wallOutline, zoomAbout,
} from './view';
import type { View } from './view';
import './pe-plan.css';
import { ChevronRight, Maximize, ZoomIn, ZoomOut } from 'lucide-react';

export interface PlanEditorProps {
  /** Layout of the active room to show; defaults to the active layout. */
  layoutId?: string;
  /** Compare view: no editing, no tools. */
  readOnly?: boolean;
}

const WALL = THEME.planWall;
const ACCENT = THEME.accent;
const DANGER = THEME.danger;
const MUTED = THEME.text3;
const STROKE = THEME.planItemStroke;
const DIM = THEME.planDim;
/** Screen px a left press may travel before it becomes a pan instead of a click (draw tool). */
const CLICK_SLOP = 4;
/** Near-white floor fills with only a hint of the finish. */
const FLOOR_FILL: Record<Room['floor'], string> = { wood: '#fbf8f3', carpet: '#f9f8f6', tile: THEME.planFloor };

const hex = (c: string) => { const n = parseInt(c.slice(1, 7), 16); return Number.isFinite(n) ? [n >> 16, (n >> 8) & 255, n & 255] : [180, 180, 180]; };
/** a + (b - a) * t for '#rrggbb' colours. */
const mix = (a: string, b: string, t: number) => {
  const x = hex(a), y = hex(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
/** Top-down plan symbol of an item: its generated 3D parts, drawn low to high. Cached per (immutable) def. */
const symbolCache = new WeakMap<ItemDef, ModelPart[]>();
const symbolParts = (def: ItemDef): ModelPart[] => {
  let parts = symbolCache.get(def);
  if (!parts) {
    const { w, d } = def.size, min = Math.min(w, d) * 0.04;
    parts = def.model.kind !== 'parametric' ? [] : generateModel(def.model, def.size)
      .filter((p) => p.size[0] > min && p.size[2] > min && !(Math.abs(p.size[0] - w) < 0.5 && Math.abs(p.size[2] - d) < 0.5 && p.shape === 'box'))
      .sort((a, b) => a.position[1] + a.size[1] / 2 - (b.position[1] + b.size[1] / 2));
    symbolCache.set(def, parts);
  }
  return parts;
};

type Gesture =
  /** enter: plan level, the room clicked; highlighted on release unless the press became a pan (double-click opens it). */
  | { kind: 'pan'; sx: number; sy: number; view: View; enter?: string }
  | { kind: 'draw'; sx: number; sy: number; view: View; raw: Vec2; free: boolean }
  | { kind: 'item'; id: string; dx: number; dy: number; batched: boolean }
  | { kind: 'rotate'; id: string; batched: boolean }
  | { kind: 'opening'; id: string; batched: boolean }
  | { kind: 'corner'; index: number; batched: boolean }
  /** Slides wall `index` along its normal; `points`/`from`: the room and pointer at the press. */
  | { kind: 'wall'; index: number; sx: number; sy: number; from: Vec2; points: Vec2[]; batched: boolean };

const add = (a: Vec2, b: Vec2, s = 1): Vec2 => ({ x: a.x + b.x * s, y: a.y + b.y * s });

function OpeningSymbol({ o, room, k, selected, floor }: { o: Opening; room: Room; k: number; selected: boolean; floor: string }) {
  const g = getOpeningGeometry(room.points, o);
  const t = room.wallThickness;
  const out = { x: -g.normalIn.x, y: -g.normalIn.y };
  const stroke = selected ? ACCENT : WALL;
  const sw = (selected ? 2 : 1) / k;
  const gap = [g.a, g.b, add(g.b, out, t), add(g.a, out, t)];
  let body: ReactNode;
  if (o.kind === 'open') {
    // No wall at all: the floor runs through, with thin end ticks and a dashed line where the wall face would be.
    const ta = add(g.a, out, t), tb = add(g.b, out, t);
    const lw = (selected ? 2 : 1.25) / k;
    body = (
      <g data-open-gap="">
        <polygon points={pts(gap)} fill={floor} stroke="none" />
        <line x1={g.a.x} y1={g.a.y} x2={ta.x} y2={ta.y} stroke={stroke} strokeWidth={lw} />
        <line x1={g.b.x} y1={g.b.y} x2={tb.x} y2={tb.y} stroke={stroke} strokeWidth={lw} />
        <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={stroke} strokeOpacity={selected ? 1 : 0.45} strokeWidth={lw} strokeDasharray={`${4 / k} ${4 / k}`} />
      </g>
    );
  } else if (o.kind === 'door') {
    const swing = o.swing ?? { hinge: 'start', side: 'in' };
    const hinge = swing.hinge === 'start' ? g.a : g.b;
    const other = swing.hinge === 'start' ? g.b : g.a;
    const leafEnd = add(hinge, swing.side === 'in' ? g.normalIn : out, o.width);
    const cross = (leafEnd.x - hinge.x) * (other.y - hinge.y) - (leafEnd.y - hinge.y) * (other.x - hinge.x);
    body = (
      <>
        <polygon points={pts(gap)} fill={floor} stroke="none" />
        <line x1={hinge.x} y1={hinge.y} x2={leafEnd.x} y2={leafEnd.y} stroke={stroke} strokeWidth={sw * 2.2} strokeLinecap="butt" />
        <path d={`M ${leafEnd.x} ${leafEnd.y} A ${o.width} ${o.width} 0 0 ${cross > 0 ? 1 : 0} ${other.x} ${other.y}`}
          fill="none" stroke={stroke} strokeWidth={sw * 0.75} />
      </>
    );
  } else if (o.kind === 'window') {
    const l1a = add(g.a, out, t / 3), l1b = add(g.b, out, t / 3), l2a = add(g.a, out, (2 * t) / 3), l2b = add(g.b, out, (2 * t) / 3);
    body = (
      <>
        <polygon points={pts(gap)} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
        <line x1={l1a.x} y1={l1a.y} x2={l1b.x} y2={l1b.y} stroke={stroke} strokeWidth={sw * 0.75} />
        <line x1={l2a.x} y1={l2a.y} x2={l2b.x} y2={l2b.y} stroke={stroke} strokeWidth={sw * 0.75} />
      </>
    );
  } else if (o.kind === 'outlet') {
    const c = add(g.center, g.normalIn, 4);
    body = (
      <g transform={`rotate(${g.angle} ${c.x} ${c.y})`}>
        <rect x={c.x - o.width / 2} y={c.y - 4} width={o.width} height={8} rx={2} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
        <line x1={c.x - 1.5} y1={c.y - 2} x2={c.x - 1.5} y2={c.y + 2} stroke={stroke} strokeWidth={sw} />
        <line x1={c.x + 1.5} y1={c.y - 2} x2={c.x + 1.5} y2={c.y + 2} stroke={stroke} strokeWidth={sw} />
      </g>
    );
  } else {
    const depth = 10;
    const fins = [];
    for (let s = 10; s < o.width - 5; s += 10) {
      const p = add(g.a, { x: (g.b.x - g.a.x) / o.width, y: (g.b.y - g.a.y) / o.width }, s);
      const q = add(p, g.normalIn, depth);
      fins.push(<line key={s} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={stroke} strokeWidth={sw / 2} />);
    }
    body = (
      <>
        <polygon points={pts([g.a, g.b, add(g.b, g.normalIn, depth), add(g.a, g.normalIn, depth)])} fill="#f1f1ef" stroke={stroke} strokeWidth={sw} />
        {fins}
      </>
    );
  }
  return (
    <>
      {body}
      {/* invisible fat hit target along the opening */}
      <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke="transparent" strokeWidth={Math.max(t, 14 / k)} />
    </>
  );
}

/** 2D plan editor. Fills its parent. Root <svg> has data-testid="plan-svg". */
export function PlanEditor({ layoutId, readOnly = false }: PlanEditorProps) {
  const room = useActiveRoom();
  const layout = useLayout(layoutId);
  const getDef = useGetDef();
  const issues = useIssues(layoutId);
  const ui = useStore((s) => s.ui);
  const units = useStore((s) => s.project.units);
  const rooms = useStore((s) => s.project.rooms);
  const underlay = useStore((s) => s.project.underlay);
  const others = rooms.filter((r) => r.id !== room?.id);
  const snapRoom = (r: Room) => ({ id: r.id, inner: r.points, outer: wallOutline(r.points, r.wallThickness) });
  // Over a visible plan image (plan and room level): the active room / drawn rooms in full-strength accent, so they stand out from the picture.
  const contrast = !!underlay?.visible;
  const tool = readOnly ? 'select' : ui.tool;

  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 40, y: 40, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const gesture = useRef<Gesture | null>(null);
  const space = useRef(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [dragItem, setDragItem] = useState<string | null>(null);
  /** `free`: snapping suspended for this point (Alt or Shift held, or snapping toggled off). */
  const [cursor, setCursor] = useState<{ p: Vec2; free: boolean } | null>(null);
  const [hoverItem, setHoverItem] = useState<string | null>(null);
  const [cornerSnap, setCornerSnap] = useState<SnapHit | null>(null);
  const inkSnap = useInkSnap(!readOnly);
  const k = view.k;

  // ── viewport size, view context ──
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const update = () => { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const vw = size.w || 800, vh = size.h || 600;

  const toPlan = useCallback((e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current?.getBoundingClientRect();
    return screenToPlan(viewRef.current, e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0));
  }, []);
  const ctx = useMemo<PlanView>(() => ({ toPlan, pxPerCm: k }), [toPlan, k]);

  const roomBounds = room ? boundsOf(room.points, room.wallThickness) : null;
  // Fit every room and the floor-plan underlay, so a plan can be calibrated / traced without panning first.
  const u = underlay;
  const fitBounds = boundsOf([
    ...rooms.flatMap((r) => r.points),
    ...(u ? [{ x: u.x, y: u.y }, { x: u.x + u.widthPx * u.cmPerPx, y: u.y + u.heightPx * u.cmPerPx }] : []),
  ], room?.wallThickness ?? 12);
  // Room level: the open room fills the pane; plan level: the whole floor plan.
  const fit = () => { const b = ui.roomOpen && roomBounds ? roomBounds : fitBounds; if (b) setView(fitView(b, vw, vh, 48)); };
  // Refit on a new project / plan image / scale, and when the pane is resized (e.g. plan ↔ split view). Not when a room
  // is added while tracing: that would throw away the user's zoom. Going into / out of a room refits too.
  const fitKey = `${u ? `u:${u.imageId}:${u.cmPerPx}` : `r:${rooms[0]?.id}`}|${ui.roomOpen ? room?.id : ''}`;
  useEffect(fit, [fitKey, size.w, size.h]);

  // ── wheel zoom (native listener: React's is passive) ──
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => zoomAbout(v, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const zoomCenter = (f: number) => setView((v) => zoomAbout(v, vw / 2, vh / 2, f));

  // ── Space = pan modifier ──
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !isField(e.target)) space.current = true; };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // ── Alt = no snapping while held. Swallow the bare Alt press so Windows/Firefox don't move focus to the menu bar. ──
  const noSnap = (e: { altKey: boolean; shiftKey: boolean }) => e.altKey || e.shiftKey || !useStore.getState().ui.snap;
  useEffect(() => {
    if (readOnly) return;
    const onAlt = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
      e.preventDefault();
      setCursor((c) => c && { ...c, free: noSnap(e) });
    };
    window.addEventListener('keydown', onAlt);
    window.addEventListener('keyup', onAlt);
    return () => { window.removeEventListener('keydown', onAlt); window.removeEventListener('keyup', onAlt); };
  }, [readOnly]);

  const draw = useDrawRoom({
    tool, readOnly, cursor, rooms, snapRooms: rooms.map(snapRoom), ink: inkSnap, k, units, view, vw, vh, namingRoomId: ui.namingRoomId,
  });

  // ── place-opening tool: the nearest wall of ANY room (that room becomes active); only the open room at room level ──
  const openingAt = (p: Vec2): { room: Room; o: Omit<Opening, 'id'> } | null => {
    let best: { r: Room; hit: ReturnType<typeof projectOnWalls> } | null = null;
    for (const r of ui.roomOpen ? (room ? [room] : []) : room ? [room, ...others] : others) {
      if (r.points.length < 3) continue;
      const hit = projectOnWalls(r.points, p);
      if (hit.distance * k <= 40 && (!best || hit.distance < best.hit.distance)) best = { r, hit };
    }
    if (!best) return null;
    const { r, hit } = best;
    const d = openingDefaults(ui.openingKind);
    const a = r.points[hit.wall], b = r.points[(hit.wall + 1) % r.points.length];
    const width = ui.openingKind === 'open' ? Math.min(d.width, dist(a, b)) : d.width;
    const o = { kind: ui.openingKind, wall: hit.wall, ...d, width, offset: clampOffset(hit.offset, width, dist(a, b)) };
    return openingsClash(r.openings, o) ? null : { room: r, o };
  };

  // ── pointer handling ──
  const itemById = (id: string): PlacedItem | undefined => layout?.items.find((i) => i.id === id);
  const startBatch = (g: Exclude<Gesture, { kind: 'pan' | 'draw' }>) => { if (!g.batched) { useStore.getState().beginBatch(); g.batched = true; } };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    // React bubbles events from portals (e.g. the calibrate panel) through here: capturing those would swallow their clicks.
    if (!svgRef.current?.contains(e.target as Node)) return;
    const startPan = () => { gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view: viewRef.current }; };
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* jsdom / synthetic events */ }
    if (e.button === 1 || (e.button === 0 && space.current)) { e.preventDefault(); startPan(); return; }
    if (e.button !== 0) return;
    if (readOnly) { startPan(); return; }
    const p = toPlan(e);
    const st = useStore.getState();
    if (st.ui.namingRoomId) st.setUI({ namingRoomId: null }); // clicking on: the room keeps its default name
    if (tool === 'calibrate') return;
    // A click adds the corner on release; a press that moves becomes a pan, so panning mid-draw never adds a stray corner.
    if (tool === 'draw-room') { gesture.current = { kind: 'draw', sx: e.clientX, sy: e.clientY, view: viewRef.current, raw: p, free: noSnap(e) }; return; }
    if (tool === 'place-opening') {
      const hit = openingAt(p);
      if (hit) {
        st.beginBatch();
        st.setActiveRoom(hit.room.id);
        const id = st.addOpening(hit.o);
        st.endBatch();
        st.select({ type: 'opening', id });
        st.setUI({ tool: 'select' });
      }
      return;
    }
    const el = e.target as Element;
    const rot = el.closest('[data-testid="rotate-handle"]');
    const corner = el.closest('[data-testid="plan-corner"]');
    const opening = el.closest('[data-opening-id]');
    const item = el.closest('[data-item-id]');
    const wall = el.closest('[data-testid="plan-wall"]');
    const gap = el.closest('[data-testid="plan-wall-gap"]');
    if (gap) {
      // Plan level: a near-miss mark selects its wall (that room becomes active), which offers "Join walls".
      const m = nearMisses[Number(gap.getAttribute('data-index'))];
      if (m) { st.focusRoom(rooms[m.wall.room].id); st.select({ type: 'wall', index: m.wall.index }); }
    } else if (rot && ui.selection?.type === 'item') {
      gesture.current = { kind: 'rotate', id: ui.selection.id, batched: false };
    } else if (corner) {
      const index = Number(corner.getAttribute('data-index'));
      st.select({ type: 'corner', index });
      gesture.current = { kind: 'corner', index, batched: false };
    } else if (opening) {
      const id = opening.getAttribute('data-opening-id')!;
      st.select({ type: 'opening', id });
      gesture.current = { kind: 'opening', id, batched: false };
    } else if (item) {
      const id = item.getAttribute('data-item-id')!;
      const it = itemById(id);
      st.select({ type: 'item', id });
      if (it) gesture.current = { kind: 'item', id, dx: it.x - p.x, dy: it.y - p.y, batched: false };
    } else if (wall) {
      const index = Number(wall.getAttribute('data-wall'));
      st.select({ type: 'wall', index });
      if (room) gesture.current = { kind: 'wall', index, sx: e.clientX, sy: e.clientY, from: p, points: room.points, batched: false };
    } else {
      st.select(null);
      startPan();
      // Plan level: a click on any room's floor (furniture is click-through) highlights it; double-click or Open goes in.
      const hit = ui.roomOpen ? undefined : [...(room ? [room] : []), ...others].find((r) => r.points.length >= 3 && pointInPolygon(p, r.points));
      if (hit && gesture.current?.kind === 'pan') gesture.current.enter = hit.id;
    }
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = toPlan(e);
    if (tool === 'draw-room' || tool === 'place-opening') setCursor({ p, free: noSnap(e) });
    let g = gesture.current;
    if (!g) return;
    if (g.kind === 'draw') {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) <= CLICK_SLOP) return;
      g = gesture.current = { kind: 'pan', sx: g.sx, sy: g.sy, view: g.view };
    }
    if (g.kind === 'pan') {
      if (g.enter && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > CLICK_SLOP) g.enter = undefined;
      setView({ ...g.view, x: g.view.x + e.clientX - g.sx, y: g.view.y + e.clientY - g.sy });
      return;
    }
    if (!room) return;
    const st = useStore.getState();
    if (g.kind === 'item') {
      const it = itemById(g.id);
      const def = it && getDef(it.defId);
      if (!it || !def) return;
      startBatch(g);
      let x = p.x + g.dx, y = p.y + g.dy;
      if (ui.snap && !e.altKey) {
        const others = (layout?.items ?? []).flatMap((o) => {
          const od = o.id !== g.id ? getDef(o.defId) : undefined;
          return od && !isFlat(od) ? [{ pose: o, size: od.size }] : [];
        });
        const s = snapItem({ roomPoints: room.points, others, pose: { x, y, rotation: it.rotation }, size: def.size, threshold: 8 / k });
        x = s.x; y = s.y;
        setGuides(s.guides);
      } else setGuides([]);
      setDragItem(g.id);
      st.updateItem(g.id, { x, y });
    } else if (g.kind === 'rotate') {
      const it = itemById(g.id);
      if (!it) return;
      startBatch(g);
      st.updateItem(g.id, { rotation: rotationFromPointer(it, p, e.shiftKey) });
    } else if (g.kind === 'opening') {
      const o = room.openings.find((x) => x.id === g.id);
      if (!o) return;
      startBatch(g);
      const hit = projectOnWalls(room.points, p);
      const a = room.points[hit.wall], b = room.points[(hit.wall + 1) % room.points.length];
      const next = { wall: hit.wall, offset: clampOffset(hit.offset, o.width, dist(a, b)) };
      if (!openingsClash(room.openings, { ...o, ...next })) st.updateOpening(g.id, next);
    } else if (g.kind === 'corner') {
      const hit = snapPoint({
        raw: p, align: room.points.filter((_, i) => i !== g.index), rooms: others.map(snapRoom), ink: inkSnap, pxPerCm: k, free: noSnap(e),
      });
      const np = hit.p;
      setCornerSnap(hit.kind ? hit : null);
      startBatch(g);
      st.updateRoom(room.id, { points: room.points.map((q, i) => (i === g.index ? np : q)) });
    } else if (g.kind === 'wall') {
      if (!g.batched && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) <= CLICK_SLOP) return; // still a click: selects the wall
      const nrm = wallNormal(g.points, g.index);
      const raw = (p.x - g.from.x) * nrm.x + (p.y - g.from.y) * nrm.y;
      const s = noSnap(e) ? { d: raw } : snapSlide(g.points, g.index, raw, others.map(snapRoom), WALL_SNAP_PX / k);
      const np = slideWall(g.points, g.index, s.d);
      const a = np[g.index], b = np[(g.index + 1) % np.length];
      setCornerSnap(s.link ? { p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, kind: 'wall', guides: [], link: s.link } : null);
      startBatch(g);
      st.updateRoom(room.id, { points: np });
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === 'draw') draw.addPoint(g.raw, g.free);
    else if (g?.kind === 'pan' && g.enter) useStore.getState().focusRoom(g.enter);
    else if (g && g.kind !== 'pan' && g.batched) useStore.getState().endBatch();
    setCornerSnap(null);
    setGuides([]);
    setDragItem(null);
  };

  const onDoubleClick = (e: RMouseEvent<SVGSVGElement>) => {
    if (readOnly) return;
    if (tool === 'draw-room') { draw.finish(); return; }
    // Not e.target: pointer capture (taken on pointerdown) retargets the click/dblclick to the <svg> itself.
    const wallEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-testid="plan-wall"]');
    if (!ui.roomOpen && tool === 'select' && !wallEl) {
      const p = toPlan(e);
      const hit = [...(room ? [room] : []), ...others].find((r) => r.points.length >= 3 && pointInPolygon(p, r.points));
      if (hit) useStore.getState().enterRoom(hit.id);
      return;
    }
    if (tool !== 'select' || !room || !wallEl) return;
    const i = Number(wallEl.getAttribute('data-wall'));
    const p = toPlan(e);
    const a = room.points[i], b = room.points[(i + 1) % room.points.length];
    const len = dist(a, b);
    insertCorner(useStore.getState(), room, i, Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len || 1))));
  };

  // ── derived render data ──
  const issuesFor = (id: string): Issue[] => issues.filter((is) => is.itemIds.includes(id));
  const placed = (layout?.items ?? []).flatMap((it) => { const def = getDef(it.defId); return def ? [{ it, def }] : []; });
  const flats = placed.filter((p) => isFlat(p.def));
  const solids = placed.filter((p) => !isFlat(p.def));
  const floor = room ? FLOOR_FILL[room.floor] ?? FLOOR_FILL.wood : FLOOR_FILL.wood;
  const editable = !readOnly && tool === 'select';
  const sel = ui.selection;
  // PNG export frame: the room plus every item, even ones placed outside it.
  const exportBounds = roomBounds && placed.reduce((b, { it, def }) => {
    const r = (it.rotation * Math.PI) / 180, c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
    const hx = (def.size.w * c + def.size.d * sn) / 2, hy = (def.size.w * sn + def.size.d * c) / 2;
    return { minX: Math.min(b.minX, it.x - hx), minY: Math.min(b.minY, it.y - hy), maxX: Math.max(b.maxX, it.x + hx), maxY: Math.max(b.maxY, it.y + hy) };
  }, roomBounds);

  const renderGrid = () => {
    const step = gridStep(units, k);
    const a = screenToPlan(view, 0, 0), b = screenToPlan(view, vw, vh);
    const lines: ReactNode[] = [];
    const major = (v: number) => Math.round(v / step) % 5 === 0;
    for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step)
      lines.push(<line key={`x${x}`} x1={x} y1={a.y} x2={x} y2={b.y} stroke={major(x) ? THEME.planGridMajor : THEME.planGrid} />);
    for (let y = Math.floor(a.y / step) * step; y <= b.y; y += step)
      lines.push(<line key={`y${y}`} x1={a.x} y1={y} x2={b.x} y2={y} stroke={major(y) ? THEME.planGridMajor : THEME.planGrid} />);
    return <g data-chrome="" strokeWidth={1 / k}>{lines}</g>;
  };

  const renderItem = ({ it, def }: { it: PlacedItem; def: ItemDef }) => {
    const { w, d } = def.size;
    const its = issuesFor(it.id);
    const bad = its.length > 0;
    const selected = sel?.type === 'item' && sel.id === it.id;
    const look = withItemColors(def, it.colors);
    const base = bodyColor(look);
    const flat = isFlat(def);
    const line = bad ? DANGER : STROKE;
    return (
      <g key={it.id} data-testid="plan-item" data-item-id={it.id} data-issue={bad ? 'true' : 'false'} pointerEvents={ui.roomOpen ? undefined : 'none'}
        onPointerEnter={() => setHoverItem(it.id)} onPointerLeave={() => setHoverItem((h) => (h === it.id ? null : h))}>
        {bad && <title>{its.map((i) => i.message).join('\n')}</title>}
        <g transform={`translate(${it.x} ${it.y}) rotate(${it.rotation})`}>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={Math.min(w, d) * 0.02} fill={mix(THEME.planItemFill, base, flat ? 0.3 : 0.22)}
            fillOpacity={flat ? 0.45 : 1} stroke={line} strokeWidth={(bad ? 2 : 1) / k} strokeDasharray={flat ? `${6 / k} ${3 / k}` : undefined} />
          {!flat && symbolParts(def).map((p, i) => {
            const fill = mix('#ffffff', p.color ?? (look.model.kind === 'parametric' ? look.model.colors[p.role] : base), 0.16);
            const [sx, , sz] = p.size, [px, , pz] = p.position;
            return p.shape === 'box'
              ? <rect key={i} x={px - sx / 2} y={pz - sz / 2} width={sx} height={sz} rx={Math.min(p.round ?? 0, sx / 2, sz / 2)} fill={fill}
                stroke={line} strokeOpacity={0.55} strokeWidth={0.75 / k} pointerEvents="none" />
              : <ellipse key={i} cx={px} cy={pz} rx={sx / 2} ry={sz / 2} fill={fill} stroke={line} strokeOpacity={0.55} strokeWidth={0.75 / k} pointerEvents="none" />;
          })}
          {bad && <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={DANGER} fillOpacity={0.22} pointerEvents="none" />}
          {!flat && (
            <line x1={-w / 2} y1={d / 2} x2={w / 2} y2={d / 2} stroke={line} strokeWidth={2 / k} pointerEvents="none" />
          )}
          {selected && (
            <g data-chrome="">
              <rect x={-w / 2 - 3 / k} y={-d / 2 - 3 / k} width={w + 6 / k} height={d + 6 / k} rx={2 / k} fill="none" stroke={ACCENT}
                strokeWidth={1.5 / k} pointerEvents="none" />
              {editable && (
                <>
                  <line x1={0} y1={-d / 2 - 3 / k} x2={0} y2={-d / 2 - 22 / k} stroke={ACCENT} strokeWidth={1.5 / k} pointerEvents="none" />
                  <circle data-testid="rotate-handle" cx={0} cy={-d / 2 - 28 / k} r={6 / k} fill="#ffffff" stroke={ACCENT}
                    strokeWidth={1.5 / k} style={{ cursor: 'grab' }} />
                </>
              )}
            </g>
          )}
        </g>
        <Label at={{ x: it.x, y: it.y }} k={k} size={11} bg={THEME.surface}>{def.name}</Label>
      </g>
    );
  };

  const renderCallout = (id: string) => {
    const p = placed.find((x) => x.it.id === id);
    const its = issuesFor(id);
    if (!p || !its.length) return null;
    const lines = its.map((i) => i.message);
    const fs = 12 / k, pad = 6 / k, lh = 16 / k;
    const wpx = Math.max(...lines.map((l) => l.length)) * 6.6 + 12;
    const bw = wpx / k, bh = lines.length * lh + pad * 2 - (lh - fs);
    const reach = Math.hypot(p.def.size.w, p.def.size.d) / 2;
    const x = p.it.x - bw / 2, y = p.it.y - reach - bh - 10 / k;
    return (
      <g data-testid="issue-callout" pointerEvents="none">
        <rect x={x} y={y} width={bw} height={bh} rx={6 / k} fill="#fdecea" stroke={DANGER} strokeWidth={1 / k} />
        {lines.map((l, i) => (
          <text key={i} x={x + pad} y={y + pad + fs * 0.85 + i * lh} fontSize={fs} fontFamily={FONT} fontWeight={500} fill="#8f1d16">{l}</text>
        ))}
      </g>
    );
  };

  /** Wall polygons of a room. Active room: selectable (data-testid plan-wall) with length labels; others: dimmed. */
  const renderWalls = (r: Room, active: boolean) => {
    const n = r.points.length;
    const outer = wallOutline(r.points, r.wallThickness);
    const closed = n >= 3;
    return r.points.map((a, i) => {
      const j = (i + 1) % n;
      if (!closed && j === 0) return null;
      const b = r.points[j];
      // Room level: only the open room is accent; the others stay greyed context.
      const c = contrast && (active || !ui.roomOpen) ? ACCENT : WALL;
      const poly = <polygon points={pts([a, b, outer[j], outer[i]])} fill={c} stroke={c} strokeWidth={0.5 / k} strokeLinejoin="round" />;
      if (!active) return <g key={i}>{poly}</g>;
      // Dimension line parallel to the wall, outside it: extension lines, 45° ticks, and the interior length on top.
      const L = dist(a, b) || 1, ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      const side = (outer[i].x - a.x) * -uy + (outer[i].y - a.y) * ux >= 0 ? 1 : -1;
      const nrm = { x: -uy * side, y: ux * side };
      const off = r.wallThickness + 18 / k;
      const da = add(a, nrm, off), db = add(b, nrm, off);
      const tick = 4 / k, tk = { x: (ux + nrm.x) * tick, y: (uy + nrm.y) * tick };
      const lab = add({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, nrm, off + 9 / k);
      const selected = sel?.type === 'wall' && sel.index === i;
      const dc = selected ? ACCENT : DIM;
      let deg = (Math.atan2(uy, ux) * 180) / Math.PI; // text runs along the wall, never upside down
      if (deg > 90) deg -= 180; else if (deg <= -90) deg += 180;
      return (
        <g key={i} data-testid="plan-wall" data-wall={i} data-selected={selected ? 'true' : undefined} className={editable ? 'pe-wall' : undefined}>
          {editable && <title>Drag to move · click for length</title>}
          {poly}
          {/* Selected: a thick selection-colour outline on a light halo (readable on dark and accent walls alike). */}
          {selected && (
            <g data-chrome="" fill="none" strokeLinejoin="round" pointerEvents="none">
              <polygon points={pts([a, b, outer[j], outer[i]])} stroke={THEME.surface} strokeWidth={5 / k} />
              <polygon points={pts([a, b, outer[j], outer[i]])} stroke={ACCENT} strokeWidth={2.5 / k} />
            </g>
          )}
          <g stroke={dc} strokeWidth={0.75 / k} pointerEvents="none">
            <line x1={add(a, nrm, r.wallThickness + 3 / k).x} y1={add(a, nrm, r.wallThickness + 3 / k).y} x2={add(da, nrm, 4 / k).x} y2={add(da, nrm, 4 / k).y} />
            <line x1={add(b, nrm, r.wallThickness + 3 / k).x} y1={add(b, nrm, r.wallThickness + 3 / k).y} x2={add(db, nrm, 4 / k).x} y2={add(db, nrm, 4 / k).y} />
            <line x1={da.x} y1={da.y} x2={db.x} y2={db.y} />
            <line x1={da.x - tk.x} y1={da.y - tk.y} x2={da.x + tk.x} y2={da.y + tk.y} strokeWidth={1.25 / k} />
            <line x1={db.x - tk.x} y1={db.y - tk.y} x2={db.x + tk.x} y2={db.y + tk.y} strokeWidth={1.25 / k} />
          </g>
          <Label at={lab} k={k} size={11} fill={dc} angle={deg}>{formatLength(dist(a, b), units)}</Label>
        </g>
      );
    });
  };
  const roomLabel = (r: Room) => {
    if (r.points.length < 3) return null;
    const c = polygonCentroid(r.points);
    return (
      <g key={r.id} data-testid="plan-room-label" data-room-id={r.id} pointerEvents="none">
        <Label at={{ x: c.x, y: c.y - 8 / k }} k={k} size={12} weight={600} fill={THEME.text2}>{r.name}</Label>
        <Label at={{ x: c.x, y: c.y + 8 / k }} k={k} size={11} fill={MUTED}>{formatArea(polygonArea(r.points), units)}</Label>
      </g>
    );
  };

  const dragged = dragItem ? placed.find((p) => p.it.id === dragItem) : undefined;
  const preview = tool === 'place-opening' && cursor ? openingAt(cursor.p) : null;
  const calloutId = (sel?.type === 'item' ? sel.id : null);
  const hint = !rooms.length && !underlay && tool === 'select' ? 'No room yet: choose “Draw room” and click to place its corners.' : null;
  const wallEnd = sel?.type === 'wall' && room ? (sel.index + 1) % room.points.length : -1;
  const wallStart = sel?.type === 'wall' ? sel.index : -1;
  // Plan level: walls that almost meet a neighbour's (a small gap or overlap) are marked so they can be dragged flush.
  const nearMisses = useMemo(() => (ui.roomOpen ? [] : wallNearMisses(rooms.map(snapRoom))), [rooms, ui.roomOpen]);
  // The neighbour wall the point being drawn / corner being dragged is attached to: highlighted green.
  const link = cornerSnap?.link ?? draw.link;
  const linkedRoom = link && rooms.find((r) => r.id === link.roomId);
  const linked = linkedRoom ? { r: linkedRoom, wall: link.wall } : null;
  // Plan level, a wall with a near-miss selected: "Join walls" slides it flush.
  const join = !ui.roomOpen && editable && sel?.type === 'wall' && room ? wallJoin(rooms, room.id, sel.index) : null;

  return (
    <div className="pe-root">
      <svg ref={svgRef} data-testid="plan-svg" data-readonly={readOnly ? 'true' : 'false'} width="100%" height="100%"
        data-px-per-cm={k} data-bounds={exportBounds ? `${exportBounds.minX} ${exportBounds.minY} ${exportBounds.maxX} ${exportBounds.maxY}` : undefined}
        className={`pe-svg pe-tool-${tool}`} xmlns="http://www.w3.org/2000/svg"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)} onDoubleClick={onDoubleClick} onContextMenu={(e) => e.preventDefault()}>
        <rect data-chrome="" x={0} y={0} width="100%" height="100%" fill={THEME.planBg} />
        <PlanViewContext.Provider value={ctx}>
          <g data-plan-root="" transform={`translate(${view.x} ${view.y}) scale(${k})`}>
            {ui.showGrid && renderGrid()}
            {others.map((r) => r.points.length >= 3 && (
              ui.roomOpen ? (
                // Room level: other rooms are greyed context, not clickable (back out to switch rooms).
                <polygon key={r.id} data-chrome="" data-testid="plan-other-room" data-other-room={r.id} points={pts(r.points)}
                  fill={THEME.planGridMajor} fillOpacity={0.35} stroke="none" pointerEvents="none" />
              ) : (
                <polygon key={r.id} data-chrome="" data-testid="plan-other-room" data-other-room={r.id} points={pts(r.points)}
                  fill={contrast ? ACCENT : FLOOR_FILL[r.floor] ?? FLOOR_FILL.wood} fillOpacity={contrast ? 0.25 : 0.6} stroke="none" style={editable ? { cursor: 'pointer' } : undefined}>
                  <title>{`${r.name}: click to open this room`}</title>
                </polygon>
              )
            ))}
            {room && room.points.length >= 3 && <polygon data-testid="plan-floor" points={pts(room.points)} fill={contrast ? ACCENT : floor} fillOpacity={contrast ? 0.25 : 1} stroke="none" />}
            {/* Underlay sits above the floor fills (so tracing stays visible) and below walls/items; chrome = not exported. */}
            <g data-chrome=""><UnderlayLayer /></g>
            {others.length > 0 && (
              <g data-chrome="" data-testid="plan-other-walls" opacity={ui.roomOpen ? 0.25 : contrast ? 1 : 0.45} pointerEvents="none">
                {others.map((r) => <g key={r.id}>{renderWalls(r, false)}</g>)}
              </g>
            )}
            {room && renderWalls(room, true)}
            {nearMisses.map((m, i) => (
              <polygon key={i} data-chrome="" data-testid="plan-wall-gap" data-kind={m.kind} data-index={i} points={pts([m.from.a, m.from.b, m.to.b, m.to.a])}
                fill={THEME.warning} fillOpacity={0.45} stroke={THEME.warning} strokeWidth={2 / k} strokeLinejoin="round"
                pointerEvents={editable ? undefined : 'none'} style={editable ? { cursor: 'pointer' } : undefined}>
                {editable && <title>Not joined: click to fix</title>}
              </polygon>
            ))}
            {linked && (() => {
              const { inner, outer } = snapRoom(linked.r), i = linked.wall, j = (i + 1) % inner.length;
              return <polygon data-chrome="" data-testid="plan-wall-attached" points={pts([inner[i], inner[j], outer[j], outer[i]])} fill={THEME.success}
                stroke={THEME.success} strokeWidth={2 / k} strokeLinejoin="round" pointerEvents="none" />;
            })()}
            {others.map((r) => <g key={r.id} data-chrome="" opacity={ui.roomOpen ? 0.4 : contrast ? 1 : 0.75} pointerEvents="none">{roomLabel(r)}</g>)}
            {room && roomLabel(room)}
            {room?.openings.map((o) => (
              <g key={o.id} data-testid="plan-opening" data-opening-id={o.id} style={editable ? { cursor: 'pointer' } : undefined}>
                <OpeningSymbol o={o} room={room} k={k} floor={floor} selected={sel?.type === 'opening' && sel.id === o.id} />
              </g>
            ))}
            {flats.map(renderItem)}
            {ui.showClearances && room && (
              <g pointerEvents="none" strokeDasharray={`${5 / k} ${4 / k}`} strokeWidth={1.25 / k}>
                {placed.flatMap(({ it, def }) => def.clearances.map((z, i) => (
                  <polygon key={`${it.id}-${i}`} points={pts(clipToConvex(room.points, clearancePolygon(it, def.size, z)))} fill="#6bb3d6" fillOpacity={0.1} stroke="#5b8fb0" strokeOpacity={0.7} />
                )))}
                {room.openings.map((o) => {
                  const swing = o.kind === 'door' ? doorSwingPolygon(room.points, o) : null;
                  const poly = swing && clipToConvex(room.points, swing);
                  return poly && poly.length > 0 && <polygon key={o.id} points={pts(poly)} fill="#f2b880" fillOpacity={0.14} stroke="#c98a12" strokeOpacity={0.7} />;
                })}
              </g>
            )}
            {issues.map((is) => is.zone && room && (
              <polygon key={is.id} points={pts(clipToConvex(room.points, is.zone))} fill={DANGER} fillOpacity={0.16} stroke={DANGER} strokeWidth={1.25 / k}
                strokeDasharray={`${5 / k} ${4 / k}`} pointerEvents="none" />
            ))}
            {solids.map(renderItem)}
            {preview && (
              <g data-chrome="" opacity={0.55} pointerEvents="none">
                <OpeningSymbol o={{ ...preview.o, id: 'preview' }} room={preview.room} k={k} floor={FLOOR_FILL[preview.room.floor] ?? floor} selected />
              </g>
            )}
            {cornerSnap && <g data-chrome=""><SnapMarker hit={cornerSnap} k={k} /></g>}
            {guides.length > 0 && (
              <g data-chrome="" stroke={GUIDE} strokeWidth={1.25 / k} strokeDasharray={`${4 / k} ${3 / k}`} pointerEvents="none">
                {guides.map((g, i) => <line key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} />)}
              </g>
            )}
            {dragged && room && (
              <g data-chrome="" pointerEvents="none">
                {distancesToWalls(dragged.it, dragged.def.size, room.points).map((m) => (
                  <g key={m.side}>
                    <line x1={m.from.x} y1={m.from.y} x2={m.to.x} y2={m.to.y} stroke={GUIDE} strokeWidth={1.25 / k} />
                    <circle cx={m.to.x} cy={m.to.y} r={2.5 / k} fill={GUIDE} />
                    <Label at={{ x: (m.from.x + m.to.x) / 2, y: (m.from.y + m.to.y) / 2 }} k={k} size={11} weight={600} fill={GUIDE} bg="#ffffff">{formatLength(m.distance, units)}</Label>
                  </g>
                ))}
                <Label at={{ x: dragged.it.x, y: dragged.it.y + 18 / k }} k={k} size={11} bg={THEME.surface}>
                  {`${formatLength(dragged.def.size.w, units)} × ${formatLength(dragged.def.size.d, units)}`}
                </Label>
              </g>
            )}
            {hoverItem && hoverItem !== calloutId && renderCallout(hoverItem)}
            {calloutId && renderCallout(calloutId)}
            {room && editable && (
              <g data-chrome="">
                {room.points.map((p, i) => {
                  const on = (sel?.type === 'corner' && sel.index === i) || i === wallEnd;
                  return (
                    <circle key={i} data-testid="plan-corner" data-index={i} data-on={on ? 'true' : undefined} className="pe-corner" cx={p.x} cy={p.y}
                      r={(on || i === wallStart ? 6.5 : 5) / k} fill={on ? ACCENT : '#ffffff'} stroke={ACCENT} strokeWidth={1.5 / k} style={{ cursor: 'move' }}>
                      <title>Drag to move corner</title>
                    </circle>
                  );
                })}
              </g>
            )}
            {draw.overlay}
            {tool === 'calibrate' && <CalibrateTool />}
          </g>
        </PlanViewContext.Provider>
        {hint && (
          <text data-chrome="" x={vw / 2} y={vh / 2} fontSize={15} fontFamily={FONT} fontWeight={500} fill={MUTED}
            textAnchor="middle" pointerEvents="none">{hint}</text>
        )}
      </svg>
      {draw.aids}
      {!ui.roomOpen && !readOnly && tool === 'select' && !draw.naming && room && room.points.length >= 3 && (() => {
        const c = polygonCentroid(room.points);
        return (
          <button type="button" className="btn primary pe-open-room" data-testid="plan-open-room" title={`Open ${room.name} (or double-click it)`}
            style={{ left: c.x * k + view.x, top: c.y * k + view.y + 26 }} onClick={() => useStore.getState().enterRoom(room.id)}>
            Open<ChevronRight size={15} aria-hidden />
          </button>
        );
      })()}
      {join && (() => {
        const c = { x: (join.miss.from.a.x + join.miss.from.b.x) / 2, y: (join.miss.from.a.y + join.miss.from.b.y) / 2 };
        return (
          <button type="button" className="btn primary pe-open-room" data-testid="plan-join-walls" title="Slide this wall flush with its neighbour"
            style={{ left: c.x * k + view.x, top: c.y * k + view.y + 14 }} onClick={() => room && useStore.getState().updateRoom(room.id, { points: join.points })}>
            Join walls
          </button>
        );
      })()}
      {(nearMisses.length > 0 || linked) && (
        <div className={`pe-legend app-float${tool === 'draw-room' ? ' pe-legend-up' : ''}`} data-testid="plan-legend">
          {linked && <span><i className="ok" />Attached</span>}
          {nearMisses.length > 0 && <span><i className="warn" />Not joined — click to fix</span>}
        </div>
      )}
      <div className="pe-zoom app-float">
        <button type="button" className="btn ghost icon" title="Zoom out" aria-label="Zoom out" onClick={() => zoomCenter(0.8)}><ZoomOut size={16} aria-hidden /></button>
        <button type="button" className="btn ghost icon" title="Zoom in" aria-label="Zoom in" onClick={() => zoomCenter(1.25)}><ZoomIn size={16} aria-hidden /></button>
        <button type="button" className="btn ghost icon" data-testid="plan-fit" title="Fit room" aria-label="Fit room" onClick={fit}><Maximize size={16} aria-hidden /></button>
      </div>
    </div>
  );
}
