import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as RMouseEvent, PointerEvent as RPointerEvent, ReactNode } from 'react';
import { isFlat } from '../types';
import type { Guide, Issue, ItemDef, Opening, PlacedItem, Room, Vec2 } from '../types';
import { useStore } from '../store/store';
import { useActiveRoom, useGetDef, useIssues, useLayout } from '../store/selectors';
import {
  clearancePolygon, distancesToWalls, doorSwingPolygon, getOpeningGeometry, polygonArea, polygonCentroid, projectOnWalls,
  snapItem,
} from '../core/geometry';
import { formatArea, formatLength } from '../core/units';
import { UnderlayLayer } from '../floorplan/UnderlayLayer';
import { CalibrateTool } from '../floorplan/CalibrateTool';
import { ProposalLayer } from '../floorplan/ProposalLayer';
import { useInkSnap } from '../floorplan/inkMask';
import { useTrace } from '../floorplan/traceSession';
import { PlanViewContext } from './planContext';
import type { PlanView } from './planContext';
import { DrawHud, Loupe } from './DrawAids';
import { snapPoint } from './drawSnap';
import type { SnapHit, SnapKind } from './drawSnap';
import { insertCorner } from './wallEdit';
import {
  bodyColor, boundsOf, clampOffset, dist, fitView, gridStep, openingDefaults, rotationFromPointer, screenToPlan,
  wallOutline, zoomAbout,
} from './view';
import type { View } from './view';
import './pe-plan.css';

export interface PlanEditorProps {
  /** Layout of the active room to show; defaults to the active layout. */
  layoutId?: string;
  /** Compare view: no editing, no tools. */
  readOnly?: boolean;
}

const INK = '#3a2f2a';
const WALL = '#5c4a40';
const ACCENT = '#f08a4b';
const DANGER = '#e5484d';
const GUIDE = '#2f9be0';
const OK = '#3a9d6b';
const MUTED = '#8c7f76';
/** Snap marker colour and the word shown next to it. */
const SNAP_STYLE: Record<SnapKind, [string, string]> = {
  corner: ['#8b5cf6', 'corner'], wall: ['#8b5cf6', 'on wall'], align: [GUIDE, 'aligned'], ink: ['#d6336c', 'plan wall'], angle: [ACCENT, ''],
};
/** Screen px: click this close to the first corner to close the outline (also the size of its target ring). */
const CLOSE_PX = 14;
/** Screen px a left press may travel before it becomes a pan instead of a click (draw tool). */
const CLICK_SLOP = 4;
const FONT = "ui-rounded, 'Nunito', 'Segoe UI', system-ui, sans-serif";
const FLOOR_FILL: Record<Room['floor'], string> = { wood: '#f4e4c8', carpet: '#ece5da', tile: '#eef0ee' };

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'draw'; sx: number; sy: number; view: View; raw: Vec2; shift: boolean }
  | { kind: 'item'; id: string; dx: number; dy: number; batched: boolean }
  | { kind: 'rotate'; id: string; batched: boolean }
  | { kind: 'opening'; id: string; batched: boolean }
  | { kind: 'corner'; index: number; batched: boolean };

const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(' ');
const add = (a: Vec2, b: Vec2, s = 1): Vec2 => ({ x: a.x + b.x * s, y: a.y + b.y * s });

/** Text with a white halo, constant screen size. */
function Label({ at, k, children, size = 12, fill = INK }: { at: Vec2; k: number; children: ReactNode; size?: number; fill?: string }) {
  return (
    <text x={at.x} y={at.y} fontSize={size / k} fontFamily={FONT} fontWeight={600} fill={fill} textAnchor="middle"
      dominantBaseline="middle" stroke="#ffffff" strokeWidth={3 / k} paintOrder="stroke" pointerEvents="none">{children}</text>
  );
}

/** Small coloured marker (+ word) where a snap landed, plus its dashed alignment guides. */
function SnapMarker({ hit, k }: { hit: SnapHit; k: number }) {
  if (!hit.kind || hit.kind === 'angle') return null;
  const [color, word] = SNAP_STYLE[hit.kind];
  const s = 5 / k;
  return (
    <g data-testid="snap-marker" data-kind={hit.kind} pointerEvents="none">
      {hit.guides.map((g, i) => (
        <line key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={color} strokeWidth={1.25 / k} strokeDasharray={`${5 / k} ${4 / k}`} />
      ))}
      <rect x={hit.p.x - s} y={hit.p.y - s} width={2 * s} height={2 * s} fill="none" stroke={color} strokeWidth={2 / k}
        transform={`rotate(45 ${hit.p.x} ${hit.p.y})`} />
      <text x={hit.p.x + 9 / k} y={hit.p.y + 16 / k} fontSize={10 / k} fontFamily={FONT} fontWeight={700} fill={color}
        stroke="#ffffff" strokeWidth={3 / k} paintOrder="stroke">{word}</text>
    </g>
  );
}

function OpeningSymbol({ o, room, k, selected, floor }: { o: Opening; room: Room; k: number; selected: boolean; floor: string }) {
  const g = getOpeningGeometry(room.points, o);
  const t = room.wallThickness;
  const out = { x: -g.normalIn.x, y: -g.normalIn.y };
  const stroke = selected ? ACCENT : INK;
  const sw = (selected ? 2.5 : 1.5) / k;
  const gap = [g.a, g.b, add(g.b, out, t), add(g.a, out, t)];
  let body: ReactNode;
  if (o.kind === 'door') {
    const swing = o.swing ?? { hinge: 'start', side: 'in' };
    const hinge = swing.hinge === 'start' ? g.a : g.b;
    const other = swing.hinge === 'start' ? g.b : g.a;
    const leafEnd = add(hinge, swing.side === 'in' ? g.normalIn : out, o.width);
    const cross = (leafEnd.x - hinge.x) * (other.y - hinge.y) - (leafEnd.y - hinge.y) * (other.x - hinge.x);
    body = (
      <>
        <polygon points={pts(gap)} fill={floor} stroke="none" />
        <line x1={hinge.x} y1={hinge.y} x2={leafEnd.x} y2={leafEnd.y} stroke={stroke} strokeWidth={sw * 1.6} strokeLinecap="round" />
        <path d={`M ${leafEnd.x} ${leafEnd.y} A ${o.width} ${o.width} 0 0 ${cross > 0 ? 1 : 0} ${other.x} ${other.y}`}
          fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={`${4 / k} ${3 / k}`} />
      </>
    );
  } else if (o.kind === 'window') {
    const l1a = add(g.a, out, t / 3), l1b = add(g.b, out, t / 3), l2a = add(g.a, out, (2 * t) / 3), l2b = add(g.b, out, (2 * t) / 3);
    body = (
      <>
        <polygon points={pts(gap)} fill="#e3f3fb" stroke={stroke} strokeWidth={sw} />
        <line x1={l1a.x} y1={l1a.y} x2={l1b.x} y2={l1b.y} stroke={stroke} strokeWidth={sw} />
        <line x1={l2a.x} y1={l2a.y} x2={l2b.x} y2={l2b.y} stroke={stroke} strokeWidth={sw} />
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
        <polygon points={pts([g.a, g.b, add(g.b, g.normalIn, depth), add(g.a, g.normalIn, depth)])} fill="#e9e7e4" stroke={stroke} strokeWidth={sw} />
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
  const [cursor, setCursor] = useState<{ p: Vec2; shift: boolean } | null>(null);
  const [drawPts, setDrawPts] = useState<Vec2[]>([]);
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
  const fit = () => { if (fitBounds) setView(fitView(fitBounds, vw, vh, 48)); };
  // Refit on a new project / plan image / scale, and when the pane is resized (e.g. plan ↔ split view). Not when a room
  // is added while tracing: that would throw away the user's zoom.
  const fitKey = u ? `u:${u.imageId}:${u.cmPerPx}` : `r:${rooms[0]?.id}`;
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

  // ── draw-room tool ──
  const finishDraw = (points: Vec2[]) => {
    if (points.length < 3) return;
    const st = useStore.getState();
    const id = st.addRoom({ points });
    st.setUI({ tool: 'select' });
    setDrawPts([]);
    if (st.ui.dialog === 'floorplan') useTrace.setState({ namingId: id, step: 3 }); // the tracing panel asks for its name
  };
  const cancelDraw = () => { setDrawPts([]); useStore.getState().setUI({ tool: 'select' }); };
  useEffect(() => { if (tool !== 'draw-room') setDrawPts([]); }, [tool]);
  useEffect(() => {
    if (tool !== 'draw-room') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'Enter') { e.preventDefault(); finishDraw(drawPts); }
      else if (e.key === 'Backspace') { e.preventDefault(); setDrawPts((p) => p.slice(0, -1)); }
      else if (e.key === 'Escape') cancelDraw();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bound each render so it sees the latest points
  const drawSnap = (raw: Vec2, shift: boolean): SnapHit => (shift ? { p: raw, kind: null, guides: [] } : snapPoint({
    raw, prev: drawPts[drawPts.length - 1], align: drawPts.slice(0, -1), rooms: rooms.map((r) => r.points), ink: inkSnap, threshold: 10 / k,
  }));
  const closes = (raw: Vec2) => drawPts.length >= 3 && dist(raw, drawPts[0]) * k < CLOSE_PX;
  const addDrawPoint = (raw: Vec2, shift: boolean) => {
    if (closes(raw)) { finishDraw(drawPts); return; }
    const { p } = drawSnap(raw, shift);
    if (drawPts.length && dist(p, drawPts[drawPts.length - 1]) < 1e-9) return; // 2nd click of a double-click
    setDrawPts([...drawPts, p]);
  };

  // ── place-opening tool: the nearest wall of ANY room (that room becomes active) ──
  const openingAt = (p: Vec2): { room: Room; o: Omit<Opening, 'id'> } | null => {
    let best: { r: Room; hit: ReturnType<typeof projectOnWalls> } | null = null;
    for (const r of room ? [room, ...others] : others) {
      if (r.points.length < 3) continue;
      const hit = projectOnWalls(r.points, p);
      if (hit.distance * k <= 40 && (!best || hit.distance < best.hit.distance)) best = { r, hit };
    }
    if (!best) return null;
    const { r, hit } = best;
    const d = openingDefaults(ui.openingKind);
    const a = r.points[hit.wall], b = r.points[(hit.wall + 1) % r.points.length];
    return { room: r, o: { kind: ui.openingKind, wall: hit.wall, offset: clampOffset(hit.offset, d.width, dist(a, b)), ...d } };
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
    if (tool === 'calibrate') return;
    // A click adds the corner on release; a press that moves becomes a pan, so panning mid-draw never adds a stray corner.
    if (tool === 'draw-room') { gesture.current = { kind: 'draw', sx: e.clientX, sy: e.clientY, view: viewRef.current, raw: p, shift: e.shiftKey }; return; }
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
    const other = el.closest('[data-other-room]');
    if (rot && ui.selection?.type === 'item') {
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
      st.select({ type: 'wall', index: Number(wall.getAttribute('data-wall')) });
    } else if (other) {
      st.setActiveRoom(other.getAttribute('data-other-room')!);
      st.select(null);
    } else {
      st.select(null);
      startPan();
    }
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = toPlan(e);
    if (tool === 'draw-room' || tool === 'place-opening') setCursor({ p, shift: e.shiftKey });
    let g = gesture.current;
    if (!g) return;
    if (g.kind === 'draw') {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) <= CLICK_SLOP) return;
      g = gesture.current = { kind: 'pan', sx: g.sx, sy: g.sy, view: g.view };
    }
    if (g.kind === 'pan') {
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
      st.updateOpening(g.id, { wall: hit.wall, offset: clampOffset(hit.offset, o.width, dist(a, b)) });
    } else if (g.kind === 'corner') {
      const hit = e.shiftKey ? null : snapPoint({
        raw: p, align: room.points.filter((_, i) => i !== g.index), rooms: others.map((r) => r.points), ink: inkSnap, threshold: 8 / k,
      });
      const np = hit?.p ?? p;
      setCornerSnap(hit);
      startBatch(g);
      st.updateRoom(room.id, { points: room.points.map((q, i) => (i === g.index ? np : q)) });
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === 'draw') addDrawPoint(g.raw, g.shift);
    else if (g && g.kind !== 'pan' && g.batched) useStore.getState().endBatch();
    setCornerSnap(null);
    setGuides([]);
    setDragItem(null);
  };

  const onDoubleClick = (e: RMouseEvent<SVGSVGElement>) => {
    if (readOnly) return;
    if (tool === 'draw-room') { finishDraw(drawPts); return; }
    // Not e.target: pointer capture (taken on pointerdown) retargets the click/dblclick to the <svg> itself.
    const wallEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-testid="plan-wall"]');
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
    for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step)
      lines.push(<line key={`x${x}`} x1={x} y1={a.y} x2={x} y2={b.y} />);
    for (let y = Math.floor(a.y / step) * step; y <= b.y; y += step)
      lines.push(<line key={`y${y}`} x1={a.x} y1={y} x2={b.x} y2={y} />);
    return <g data-chrome="" stroke="#e6dccf" strokeWidth={1 / k}>{lines}</g>;
  };

  const renderItem = ({ it, def }: { it: PlacedItem; def: ItemDef }) => {
    const { w, d } = def.size;
    const its = issuesFor(it.id);
    const bad = its.length > 0;
    const selected = sel?.type === 'item' && sel.id === it.id;
    return (
      <g key={it.id} data-testid="plan-item" data-item-id={it.id} data-issue={bad ? 'true' : 'false'}
        onPointerEnter={() => setHoverItem(it.id)} onPointerLeave={() => setHoverItem((h) => (h === it.id ? null : h))}>
        {bad && <title>{its.map((i) => i.message).join('\n')}</title>}
        <g transform={`translate(${it.x} ${it.y}) rotate(${it.rotation})`}>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={Math.min(w, d) * 0.06} fill={bodyColor(def)}
            fillOpacity={isFlat(def) ? 0.75 : 1} stroke={bad ? DANGER : INK} strokeWidth={(bad ? 2.5 : 1.25) / k} />
          {bad && <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={DANGER} fillOpacity={0.35} pointerEvents="none" />}
          <line x1={-w / 2 + 2} y1={d / 2 - 1.5 / k} x2={w / 2 - 2} y2={d / 2 - 1.5 / k} stroke={bad ? DANGER : INK}
            strokeWidth={3 / k} strokeLinecap="round" pointerEvents="none" />
          {selected && (
            <g data-chrome="">
              <rect x={-w / 2 - 4 / k} y={-d / 2 - 4 / k} width={w + 8 / k} height={d + 8 / k} fill="none" stroke={ACCENT}
                strokeWidth={2 / k} strokeDasharray={`${6 / k} ${4 / k}`} pointerEvents="none" />
              {editable && (
                <>
                  <line x1={0} y1={-d / 2 - 4 / k} x2={0} y2={-d / 2 - 22 / k} stroke={ACCENT} strokeWidth={2 / k} pointerEvents="none" />
                  <circle data-testid="rotate-handle" cx={0} cy={-d / 2 - 28 / k} r={7 / k} fill="#ffffff" stroke={ACCENT}
                    strokeWidth={2.5 / k} style={{ cursor: 'grab' }} />
                </>
              )}
            </g>
          )}
        </g>
        <Label at={{ x: it.x, y: it.y }} k={k} size={11}>{def.name}</Label>
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
        <rect x={x} y={y} width={bw} height={bh} rx={6 / k} fill="#fde2e3" stroke={DANGER} strokeWidth={1.5 / k} />
        {lines.map((l, i) => (
          <text key={i} x={x + pad} y={y + pad + fs * 0.85 + i * lh} fontSize={fs} fontFamily={FONT} fontWeight={600} fill="#9b1c1f">{l}</text>
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
      const poly = <polygon points={pts([a, b, outer[j], outer[i]])} fill={WALL} stroke={WALL} strokeWidth={0.5 / k} strokeLinejoin="round" />;
      if (!active) return <g key={i}>{poly}</g>;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const omid = { x: (outer[i].x + outer[j].x) / 2, y: (outer[i].y + outer[j].y) / 2 };
      const len = dist(omid, mid) || 1;
      const lab = add(omid, { x: (omid.x - mid.x) / len, y: (omid.y - mid.y) / len }, 12 / k);
      const selected = sel?.type === 'wall' && sel.index === i;
      return (
        <g key={i} data-testid="plan-wall" data-wall={i} data-selected={selected ? 'true' : undefined} style={editable ? { cursor: 'pointer' } : undefined}>
          {poly}
          {selected && <polygon data-chrome="" points={pts([a, b, outer[j], outer[i]])} fill={ACCENT} stroke={ACCENT} strokeWidth={3 / k} strokeLinejoin="round" />}
          <Label at={lab} k={k} size={11} fill={selected ? ACCENT : INK}>{formatLength(dist(a, b), units)}</Label>
        </g>
      );
    });
  };
  const roomLabel = (r: Room) => {
    if (r.points.length < 3) return null;
    const c = polygonCentroid(r.points);
    return (
      <g key={r.id} data-testid="plan-room-label" data-room-id={r.id} pointerEvents="none">
        <Label at={{ x: c.x, y: c.y - 8 / k }} k={k} size={13}>{r.name}</Label>
        <Label at={{ x: c.x, y: c.y + 8 / k }} k={k} size={11} fill={MUTED}>{formatArea(polygonArea(r.points), units)}</Label>
      </g>
    );
  };

  // Draw-room overlay
  const last = drawPts[drawPts.length - 1];
  const closing = tool === 'draw-room' && !!cursor && closes(cursor.p);
  const live = tool === 'draw-room' && cursor && !closing ? drawSnap(cursor.p, cursor.shift) : null;
  const end = closing ? drawPts[0] : live?.p ?? null;
  const outline = end ? [...drawPts, end] : drawPts;
  const drawMeasure = last && end
    ? `${formatLength(dist(last, end), units)}${outline.length >= 3 ? ` · area ${formatArea(polygonArea(outline), units)}` : ''}`
    : null;
  const drawOverlay = () => {
    if (tool !== 'draw-room') return null;
    return (
      <g data-chrome="" pointerEvents="none">
        {drawPts.length >= 2 && end && <polygon points={pts(outline)} fill={ACCENT} fillOpacity={0.08} stroke="none" />}
        {drawPts.length > 1 && <polyline points={pts(drawPts)} fill="none" stroke={ACCENT} strokeWidth={3 / k} strokeLinejoin="round" />}
        {last && end && (
          <>
            <line x1={last.x} y1={last.y} x2={end.x} y2={end.y} stroke={ACCENT} strokeWidth={2 / k} strokeDasharray={`${6 / k} ${4 / k}`} />
            <Label at={{ x: (last.x + end.x) / 2, y: (last.y + end.y) / 2 - 14 / k }} k={k}>{formatLength(dist(last, end), units)}</Label>
          </>
        )}
        {drawPts.length >= 3 && (
          <circle data-testid="draw-close-target" cx={drawPts[0].x} cy={drawPts[0].y} r={CLOSE_PX / k} fill={OK}
            fillOpacity={closing ? 0.55 : 0.18} stroke={OK} strokeWidth={2.5 / k} />
        )}
        {drawPts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={(i === 0 ? 6 : 4) / k} fill="#ffffff" stroke={i === 0 && drawPts.length >= 3 ? OK : ACCENT} strokeWidth={2 / k} />
        ))}
        {live && <SnapMarker hit={live} k={k} />}
        {end && !closing && <circle cx={end.x} cy={end.y} r={3 / k} fill={ACCENT} />}
      </g>
    );
  };
  const loupeContent = (
    <>
      {rooms.map((r) => <polygon key={r.id} points={pts(r.points)} fill="none" stroke={WALL} strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
      {outline.length > 1 && <polyline points={pts(outline)} fill="none" stroke={ACCENT} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
    </>
  );

  const dragged = dragItem ? placed.find((p) => p.it.id === dragItem) : undefined;
  const preview = tool === 'place-opening' && cursor ? openingAt(cursor.p) : null;
  const calloutId = (sel?.type === 'item' ? sel.id : null);
  const hint = !rooms.length && !underlay && tool === 'select' ? 'No room yet: choose “Draw room” and click to place its corners.' : null;
  const wallEnd = sel?.type === 'wall' && room ? (sel.index + 1) % room.points.length : -1;

  return (
    <div className="pe-root">
      <svg ref={svgRef} data-testid="plan-svg" data-readonly={readOnly ? 'true' : 'false'} width="100%" height="100%"
        data-px-per-cm={k} data-bounds={exportBounds ? `${exportBounds.minX} ${exportBounds.minY} ${exportBounds.maxX} ${exportBounds.maxY}` : undefined}
        className={`pe-svg pe-tool-${tool}`} xmlns="http://www.w3.org/2000/svg"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)} onDoubleClick={onDoubleClick} onContextMenu={(e) => e.preventDefault()}>
        <rect data-chrome="" x={0} y={0} width="100%" height="100%" fill="#fbf6ee" />
        <PlanViewContext.Provider value={ctx}>
          <g data-plan-root="" transform={`translate(${view.x} ${view.y}) scale(${k})`}>
            {ui.showGrid && renderGrid()}
            {others.map((r) => r.points.length >= 3 && (
              <polygon key={r.id} data-chrome="" data-testid="plan-other-room" data-other-room={r.id} points={pts(r.points)}
                fill={FLOOR_FILL[r.floor] ?? FLOOR_FILL.wood} fillOpacity={0.6} stroke="none" style={editable ? { cursor: 'pointer' } : undefined}>
                <title>{`${r.name}: click to edit this room`}</title>
              </polygon>
            ))}
            {room && room.points.length >= 3 && <polygon data-testid="plan-floor" points={pts(room.points)} fill={floor} stroke="none" />}
            {/* Underlay sits above the floor fills (so tracing stays visible) and below walls/items; chrome = not exported. */}
            <g data-chrome=""><UnderlayLayer /></g>
            {others.length > 0 && <g data-chrome="" opacity={0.45} pointerEvents="none">{others.map((r) => <g key={r.id}>{renderWalls(r, false)}</g>)}</g>}
            {room && renderWalls(room, true)}
            {others.map((r) => <g key={r.id} data-chrome="" opacity={0.75}>{roomLabel(r)}</g>)}
            {room && roomLabel(room)}
            <ProposalLayer />
            {room?.openings.map((o) => (
              <g key={o.id} data-testid="plan-opening" data-opening-id={o.id} style={editable ? { cursor: 'pointer' } : undefined}>
                <OpeningSymbol o={o} room={room} k={k} floor={floor} selected={sel?.type === 'opening' && sel.id === o.id} />
              </g>
            ))}
            {flats.map(renderItem)}
            {ui.showClearances && room && (
              <g pointerEvents="none" strokeDasharray={`${5 / k} ${4 / k}`} strokeWidth={1.25 / k}>
                {placed.flatMap(({ it, def }) => def.clearances.map((z, i) => (
                  <polygon key={`${it.id}-${i}`} points={pts(clearancePolygon(it, def.size, z))} fill="#6bb3d6" fillOpacity={0.12} stroke="#4a90b8" />
                )))}
                {room.openings.map((o) => {
                  const poly = o.kind === 'door' ? doorSwingPolygon(room.points, o) : null;
                  return poly && <polygon key={o.id} points={pts(poly)} fill="#f2b880" fillOpacity={0.18} stroke="#d08a4a" />;
                })}
              </g>
            )}
            {issues.map((is) => is.zone && (
              <polygon key={is.id} points={pts(is.zone)} fill={DANGER} fillOpacity={0.2} stroke={DANGER} strokeWidth={1.5 / k}
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
                    <Label at={{ x: (m.from.x + m.to.x) / 2, y: (m.from.y + m.to.y) / 2 }} k={k} size={11} fill={GUIDE}>{formatLength(m.distance, units)}</Label>
                  </g>
                ))}
                <Label at={{ x: dragged.it.x, y: dragged.it.y + 16 / k }} k={k} size={11}>
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
                    <circle key={i} data-testid="plan-corner" data-index={i} cx={p.x} cy={p.y} r={(on ? 8 : 6) / k}
                      fill={on ? ACCENT : '#ffffff'} stroke={ACCENT} strokeWidth={2 / k} style={{ cursor: 'move' }} />
                  );
                })}
              </g>
            )}
            {drawOverlay()}
            {tool === 'calibrate' && <CalibrateTool />}
          </g>
        </PlanViewContext.Provider>
        {hint && (
          <text data-chrome="" x={vw / 2} y={vh / 2} fontSize={15} fontFamily={FONT} fontWeight={600} fill="#8c7f76"
            textAnchor="middle" pointerEvents="none">{hint}</text>
        )}
      </svg>
      {tool === 'draw-room' && !readOnly && (
        <>
          <DrawHud count={drawPts.length} canFinish={drawPts.length >= 3} measure={drawMeasure}
            onUndo={() => setDrawPts((p) => p.slice(0, -1))} onFinish={() => finishDraw(drawPts)} onCancel={cancelDraw} />
          {cursor && <Loupe center={end ?? cursor.p} k={k} view={view} pane={{ w: vw, h: vh }}>{loupeContent}</Loupe>}
        </>
      )}
      <div className="pe-zoom">
        <button type="button" className="btn" title="Zoom in" aria-label="Zoom in" onClick={() => zoomCenter(1.25)}>+</button>
        <button type="button" className="btn" title="Zoom out" aria-label="Zoom out" onClick={() => zoomCenter(0.8)}>−</button>
        <button type="button" className="btn" data-testid="plan-fit" title="Fit room" aria-label="Fit room" onClick={fit}>Fit</button>
      </div>
    </div>
  );
}
