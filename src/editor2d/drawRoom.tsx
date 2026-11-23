import { useEffect, useRef, useState } from 'react';
import type { Room, UnitSystem, Vec2 } from '../types';
import { THEME } from '../theme';
import { useStore } from '../store/store';
import { mergeCollinear, polygonArea, polygonCentroid, projectOnWalls } from '../core/geometry';
import { formatArea, formatLength } from '../core/units';
import { useTrace } from '../floorplan/traceSession';
import { fitToInk } from '../floorplan/inkMask';
import { DrawHud, Loupe } from './DrawAids';
import { RoomNamePopover } from './RoomNamePopover';
import { joinToNeighbours } from './wallEdit';
import { cornerAngle, isRightAngle, snapPoint } from './drawSnap';
import type { InkSnap, SnapHit, SnapRoom } from './drawSnap';
import { Label, SnapMarker, pts } from './planShapes';
import { dist } from './view';
import type { View } from './view';

const WALL = THEME.planWall;
const ACCENT = THEME.accent;
const OK = THEME.success;
const norm = (a: Vec2, c: Vec2) => { const l = Math.hypot(a.x - c.x, a.y - c.y) || 1; return { x: (a.x - c.x) / l, y: (a.y - c.y) / l }; };
/** Screen px: click this close to the first corner to close the outline (also the size of its target ring). */
const CLOSE_PX = 14;

/**
 * The draw-room tool: the outline being drawn, its snapping / closing / finishing, the in-plan overlay, and the
 * HUD, loupe and room-name popover shown over the pane. `cursor` is owned by the editor (place-opening uses it too).
 */
export function useDrawRoom({ tool, readOnly, cursor, rooms, snapRooms, ink, k, units, view, vw, vh, namingRoomId }: {
  tool: string; readOnly: boolean; cursor: { p: Vec2; free: boolean } | null; rooms: Room[]; snapRooms: SnapRoom[]; ink: InkSnap | null;
  k: number; units: UnitSystem; view: View; vw: number; vh: number; namingRoomId: string | null;
}) {
  const [drawPts, setDrawPts] = useState<Vec2[]>([]);
  /** The neighbour wall ("roomId:wall") each drawn point was snapped onto. */
  const linkOf = useRef(new WeakMap<Vec2, string>());
  /** Points placed with snapping off (Alt) stay where clicked: a wall touching one is never joined to a neighbour on close. */
  const freeOf = useRef(new WeakSet<Vec2>());
  const overPlan = useStore((s) => !!s.project.underlay?.visible);

  // ── draw-room tool: stays on after each room (the name popover opens); Done / Esc ends it ──
  const finishDraw = (clicked: Vec2[]) => {
    // Extra clicks along one straight line make a single wall, not several that move separately.
    const merged = mergeCollinear(clicked);
    if (merged.length < 3) return;
    const st = useStore.getState();
    // Walls drawn roughly along a neighbour's wall are laid exactly onto it (one shared wall), wherever the clicks landed.
    const { points, joined } = joinToNeighbours(merged, snapRooms, merged.map((a, i) => freeOf.current.has(a) || freeOf.current.has(merged[(i + 1) % merged.length])));
    // Over a plan image: the other walls move onto the inner edge of the ink lines they were drawn on.
    const fit = ink?.band ? fitToInk(points, ink.band, joined.map((j, i) => j || attached(points[i], points[(i + 1) % points.length]))) : null;
    st.setUI({ namingRoomId: st.addRoom({ ...(fit ?? {}), points: mergeCollinear(fit ? fit.points : points) }) });
    setDrawPts([]);
  };
  const doneDraw = () => {
    setDrawPts([]);
    const st = useStore.getState();
    st.setUI({ tool: 'select', namingRoomId: null });
    if (st.ui.dialog === 'floorplan' && st.project.rooms.length) useTrace.setState({ step: 4 }); // on to doors & windows
  };
  // The popover lives only while this editor is shown (leaving the plan view closes it, keeping the default name).
  useEffect(() => () => { if (!readOnly) useStore.getState().setUI({ namingRoomId: null }); }, [readOnly]);
  useEffect(() => { if (tool !== 'draw-room') setDrawPts([]); }, [tool]);
  useEffect(() => {
    if (tool !== 'draw-room') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'Enter') { e.preventDefault(); finishDraw(drawPts); }
      else if (e.key === 'Backspace') { e.preventDefault(); setDrawPts((p) => p.slice(0, -1)); }
      else if (e.key === 'Escape') { if (drawPts.length) setDrawPts([]); else doneDraw(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bound each render so it sees the latest points
  const drawSnap = (raw: Vec2, free: boolean): SnapHit => {
    const key = drawPts.length ? linkOf.current.get(drawPts[drawPts.length - 1]) : undefined;
    const [roomId, wall] = key ? key.split(':') : [];
    return snapPoint({
      raw, prev: drawPts[drawPts.length - 1], align: drawPts.slice(0, -1), rooms: snapRooms, ink, pxPerCm: k, free,
      follow: roomId ? { roomId, wall: Number(wall) } : null,
    });
  };
  // A point on the same neighbour wall as the last two extends that wall instead of adding a corner.
  const extendsWall = ({ link }: SnapHit) => {
    const key = link && `${link.roomId}:${link.wall}`, n = drawPts.length;
    return !!key && n >= 2 && linkOf.current.get(drawPts[n - 1]) === key && linkOf.current.get(drawPts[n - 2]) === key;
  };
  const closes = (raw: Vec2) => drawPts.length >= 3 && dist(raw, drawPts[0]) * k < CLOSE_PX;
  const addDrawPoint = (raw: Vec2, free: boolean) => {
    if (closes(raw)) { finishDraw(drawPts); return; }
    const hit = drawSnap(raw, free), { p, link } = hit;
    if (drawPts.length && dist(p, drawPts[drawPts.length - 1]) < 1e-9) return; // 2nd click of a double-click
    if (link) linkOf.current.set(p, `${link.roomId}:${link.wall}`);
    if (free) freeOf.current.add(p);
    setDrawPts([...(extendsWall(hit) ? drawPts.slice(0, -1) : drawPts), p]);
  };

  // Draw-room overlay
  const closing = tool === 'draw-room' && !!cursor && closes(cursor.p);
  const live = tool === 'draw-room' && cursor && !closing ? drawSnap(cursor.p, cursor.free) : null;
  // Extending a neighbour's wall: the preview runs on from the corner before, as one segment.
  const base = live && extendsWall(live) ? drawPts.slice(0, -1) : drawPts;
  const last = base[base.length - 1];
  const end = closing ? drawPts[0] : live?.p ?? null;
  const outline = end ? [...base, end] : base;
  const drawMeasure = last && end
    ? `${formatLength(dist(last, end), units)}${outline.length >= 3 ? ` · area ${formatArea(polygonArea(outline), units)}` : ''}`
    : null;
  // Outline segments lying along a neighbour's wall outer face (attached there) are drawn green.
  const attached = (a: Vec2, b: Vec2) => snapRooms.some((r) => r.inner.length >= 3
    && [a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }].every((p) => projectOnWalls(r.outer, p).distance < 0.5));
  // Right-angle marks on every square corner of the outline being drawn, and the live angle at the corner being worked from.
  const corners: { a: Vec2; c: Vec2; b: Vec2 }[] = [];
  for (let i = 1; i < outline.length - 1; i++) corners.push({ a: outline[i - 1], c: outline[i], b: outline[i + 1] });
  if (closing && drawPts.length >= 3) corners.push({ a: drawPts[drawPts.length - 1], c: drawPts[0], b: drawPts[1] });
  const liveAngle = last && end && base.length >= 2 ? cornerAngle(base[base.length - 2], last, end) : null;
  const rightMark = ({ a, c, b }: { a: Vec2; c: Vec2; b: Vec2 }, key: number) => {
    if (!isRightAngle(cornerAngle(a, c, b))) return null;
    const s = 12 / k, u = norm(a, c), v = norm(b, c);
    const p1 = { x: c.x + u.x * s, y: c.y + u.y * s }, p3 = { x: c.x + v.x * s, y: c.y + v.y * s };
    return <polyline key={key} data-testid="draw-right-angle" points={pts([p1, { x: p1.x + v.x * s, y: p1.y + v.y * s }, p3])} fill="none" stroke={OK} strokeWidth={1.5 / k} />;
  };
  const drawOverlay = () => {
    if (tool !== 'draw-room') return null;
    return (
      <g data-chrome="" pointerEvents="none">
        {drawPts.length >= 2 && end && <polygon points={pts(outline)} fill={ACCENT} fillOpacity={0.08} stroke="none" />}
        {drawPts.length > 1 && <polyline points={pts(drawPts)} fill="none" stroke={ACCENT} strokeWidth={2 / k} strokeLinejoin="round" />}
        {drawPts.slice(1).map((b, i) => attached(drawPts[i], b) && (
          <line key={`at${i}`} data-testid="draw-attached" x1={drawPts[i].x} y1={drawPts[i].y} x2={b.x} y2={b.y} stroke={OK} strokeWidth={3 / k} />
        ))}
        {last && end && (
          <>
            <line x1={last.x} y1={last.y} x2={end.x} y2={end.y} stroke={attached(last, end) ? OK : ACCENT} strokeWidth={2 / k} strokeDasharray={`${6 / k} ${4 / k}`} />
            <Label at={{ x: (last.x + end.x) / 2, y: (last.y + end.y) / 2 - 14 / k }} k={k} fill={ACCENT} weight={600} bg="#ffffff">{formatLength(dist(last, end), units)}</Label>
          </>
        )}
        {drawPts.length >= 3 && (
          <circle data-testid="draw-close-target" cx={drawPts[0].x} cy={drawPts[0].y} r={CLOSE_PX / k} fill={OK}
            fillOpacity={closing ? 0.55 : 0.18} stroke={OK} strokeWidth={2.5 / k} />
        )}
        {drawPts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={(i === 0 ? 6 : 4) / k} fill="#ffffff" stroke={i === 0 && drawPts.length >= 3 ? OK : ACCENT} strokeWidth={2 / k} />
        ))}
        {corners.map(rightMark)}
        {liveAngle !== null && !closing && (() => {
          const square = isRightAngle(liveAngle);
          const out = norm({ x: 2 * last.x - (base[base.length - 2].x + end!.x) / 2, y: 2 * last.y - (base[base.length - 2].y + end!.y) / 2 }, last);
          return (
            <g data-testid="draw-angle" data-square={square ? 'true' : 'false'}>
              <Label at={{ x: last.x + out.x * 22 / k, y: last.y + out.y * 22 / k }} k={k} fill={square ? OK : ACCENT} weight={600} bg="#ffffff">{`${Math.round(liveAngle)}°`}</Label>
            </g>
          );
        })()}
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
  const naming = rooms.find((r) => r.id === namingRoomId);

  /** Rendered over the pane, after the <svg>: the HUD + loupe while drawing, and the name popover once an outline closes. */
  const aids = (
    <>
      {tool === 'draw-room' && !readOnly && (
        <>
          <DrawHud count={drawPts.length} next={rooms.length > 0} overPlan={overPlan} free={!!cursor?.free} canFinish={drawPts.length >= 3} measure={drawMeasure}
            onUndo={() => setDrawPts((p) => p.slice(0, -1))} onFinish={() => finishDraw(drawPts)} onDone={doneDraw} />
          {cursor && <Loupe center={end ?? cursor.p} k={k} view={view} pane={{ w: vw, h: vh }}>{loupeContent}</Loupe>}
        </>
      )}
      {naming && !readOnly && (() => {
        const c = polygonCentroid(naming.points);
        // Centred on the room, kept inside the pane.
        const x = Math.max(120, Math.min(c.x * k + view.x, vw - 120)), y = Math.max(8, Math.min(c.y * k + view.y - 20, vh - 320));
        return <RoomNamePopover key={naming.id} room={naming} rooms={rooms} x={x} y={y} />;
      })()}
    </>
  );

  return { addPoint: addDrawPoint, finish: () => finishDraw(drawPts), overlay: drawOverlay(), aids, naming, link: live?.link };
}
