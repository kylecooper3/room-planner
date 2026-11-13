import { CircleCheck, Copy, DoorOpen, Move, RotateCw, Scissors, SquareDashed, SquareSplitHorizontal, Sofa, Spline, Trash, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatArea, formatLength } from '../core/units';
import { polygonArea } from '../core/geometry';
import { useActiveRoom, useGetDef, useIssues, useLayout } from '../store/selectors';
import { useStore } from '../store/store';
import type { Category, DoorSwing, FloorMaterial, ItemDef, Opening, OpeningKind, PartRole, PlacedItem, Room, UnitSystem } from '../types';
import { visibleRoles } from '../models/generate';
import { ColorPicker } from './ColorPicker';
import { THEME } from '../theme';
import { useMemo } from 'react';
import { LengthInput, NumberInput, TextInput } from './inputs';
import { deleteCorner, normDeg } from './shortcuts';
import { insertCorner, openGaps, openingsClash, setWallLength, toggleOpenWall } from '../editor2d/wallEdit';

const s = useStore.getState;
/** Item positions beyond 100 m from the origin are typos, not furniture. */
const MAX_COORD = 10_000;
const MIN_OPENING = 5;
/** Sane opening widths per kind (cm); the max is further capped at the wall length minus a small margin. */
const OPENING_WIDTH: Record<OpeningKind, [number, number]> = { door: [60, 200], window: [30, 400], radiator: [30, 300], outlet: [5, 30], open: [10, MAX_COORD] };
const KIND_NAME: Record<OpeningKind, string> = { door: 'Door', window: 'Window', radiator: 'Radiator', outlet: 'Outlet', open: 'Opening' };
const WALL_MARGIN = 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wallLength = (room: Room, wall: number) => {
  const a = room.points[wall], b = room.points[(wall + 1) % room.points.length];
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : Infinity;
};

function Head({ kind, icon, title, sub }: { kind: string; icon: ReactNode; title: string; sub?: string | false }) {
  return (
    <div className="app-insp-head">
      <div className="app-insp-kind">{icon}{kind}</div>
      <h2>{title}</h2>
      {sub && <p className="app-muted">{sub}</p>}
    </div>
  );
}
const Section = ({ title, children }: { title?: string; children: ReactNode }) => (
  <section className="app-insp-section">{title && <h3>{title}</h3>}{children}</section>
);

/** What each colourable part is called, per category (generators decide which parts get which role). */
const PART_NAMES: Partial<Record<Category, Partial<Record<PartRole, string>>>> = {
  sofa: { body: 'Upholstery', cushion: 'Cushions', frame: 'Legs' },
  armchair: { body: 'Upholstery', cushion: 'Cushions', frame: 'Legs' },
  chair: { body: 'Back', cushion: 'Seat', frame: 'Frame', accent: 'Casters' },
  bed: { frame: 'Frame', cushion: 'Sheets', body: 'Headboard & blanket', accent: 'Pillows' },
  table: { body: 'Top', frame: 'Legs' },
  desk: { body: 'Top', frame: 'Legs', accent: 'Handles' },
  dresser: { body: 'Body', frame: 'Drawers', accent: 'Handles' },
  nightstand: { body: 'Body', frame: 'Drawers', accent: 'Handles' },
  shelf: { body: 'Shelves', frame: 'Uprights', accent: 'Books' },
  lamp: { body: 'Base', frame: 'Stand', accent: 'Shade' },
  rug: { body: 'Rug', frame: 'Border' },
  plant: { body: 'Pot', frame: 'Soil & stem', cushion: 'Leaves', accent: 'Highlights' },
  tv: { body: 'TV', frame: 'Stand', accent: 'Handles' },
  box: { body: 'Colour' },
};
const DEFAULT_PART_NAMES: Record<PartRole, string> = { body: 'Body', cushion: 'Cushions', frame: 'Frame', accent: 'Accents' };

function ColorSection({ item, def }: { item: PlacedItem; def: ItemDef }) {
  const roles = useMemo(() => visibleRoles(def), [def]);
  if (def.model.kind !== 'parametric' || !roles.length) return null;
  const { category, colors } = def.model;
  const set = (patch: PlacedItem['colors']) => s().updateItem(item.id, { colors: patch && Object.keys(patch).length ? patch : undefined });
  return (
    <Section title="Colour">
      {roles.map((role) => {
        const own = item.colors?.[role];
        const { [role]: _drop, ...others } = item.colors ?? {};
        return (
          <ColorPicker key={role} label={PART_NAMES[category]?.[role] ?? DEFAULT_PART_NAMES[role]} value={own ?? colors[role]} isDefault={!own} testId={`item-color-${role}`}
            onChange={(hex) => set({ ...item.colors, [role]: hex })} onReset={own ? () => set(others) : undefined} />
        );
      })}
    </Section>
  );
}

function ItemPanel({ item, units }: { item: PlacedItem; units: UnitSystem }) {
  const def = useGetDef()(item.defId);
  const issues = useIssues().filter((i) => i.itemIds.includes(item.id));
  const update = (patch: Partial<PlacedItem>) => s().updateItem(item.id, patch);
  return (
    <>
      <Head kind="Furniture" icon={<Sofa size={13} />} title={def?.name ?? 'Item'}
        sub={def && `${formatLength(def.size.w, units)} × ${formatLength(def.size.d, units)} × ${formatLength(def.size.h, units)}`} />
      {issues.length > 0 && (
        <Section title="Problems">
          {issues.map((i) => <p key={i.id} className="app-issue" role="note"><TriangleAlert size={14} />{i.message}</p>)}
        </Section>
      )}
      {def && <ColorSection item={item} def={def} />}
      <Section title="Position">
      <div className="app-row">
        <LengthInput label="X" value={item.x} units={units} allowZero allowNegative maxAbs={MAX_COORD} testId="item-x" onCommit={(x) => update({ x })} />
        <LengthInput label="Y" value={item.y} units={units} allowZero allowNegative maxAbs={MAX_COORD} testId="item-y" onCommit={(y) => update({ y })} />
      </div>
      <NumberInput label="Rotation (°)" value={item.rotation} testId="item-rotation" onCommit={(r) => update({ rotation: normDeg(r) })} />
      </Section>
      <Section title="Actions">
        <div className="app-actions">
          <button className="btn" data-testid="item-rotate" title="Rotate 90° (R rotates 15°)" onClick={() => update({ rotation: normDeg(item.rotation + 90) })}><RotateCw size={15} /> Rotate 90°</button>
          <button className="btn" data-testid="item-duplicate" title="Duplicate (Ctrl+D)" onClick={() => s().duplicateItem(item.id)}><Copy size={15} /> Duplicate</button>
          <button className="btn danger" data-testid="item-delete" title="Delete (Del)" onClick={() => { s().deleteItem(item.id); s().select(null); }}><Trash size={15} /> Delete</button>
        </div>
        <p className="app-muted">Drag to move · arrow keys nudge · R rotates 15°</p>
      </Section>
    </>
  );
}

function OpeningPanel({ opening: o, room, units }: { opening: Opening; room: Room; units: UnitSystem }) {
  const update = (patch: Partial<Opening>) => s().updateOpening(o.id, patch);
  const len = wallLength(room, o.wall);
  // Width within [5 cm, wall length]; the centre offset then keeps the whole opening on its wall.
  const place = (width: number, offset: number) => {
    const w = clamp(width, MIN_OPENING, Math.max(MIN_OPENING, len));
    const next = { width: w, offset: clamp(offset, w / 2, Math.max(w / 2, len - w / 2)) };
    if (!openingsClash(room.openings, { ...o, ...next })) update(next); // an open gap never overlaps another opening
  };
  const [wMin, wMax] = OPENING_WIDTH[o.kind];
  const open = o.kind === 'open';
  // An open gap may span the whole wall; built-in things keep a little wall at each end.
  const cap = (v: number) => Math.max(MIN_OPENING, Math.min(v, len - (open ? 0 : WALL_MARGIN)));
  const widthRange: [number, number] = [cap(wMin), cap(wMax)];
  const swing: DoorSwing = o.swing ?? { hinge: 'start', side: 'in' };
  return (
    <>
      <Head kind="Opening" icon={open ? <SquareSplitHorizontal size={13} /> : <DoorOpen size={13} />} title={KIND_NAME[o.kind]}
        sub={open ? `No wall here: open floor to ceiling · wall ${o.wall + 1}` : `On wall ${o.wall + 1}`} />
      <Section title="Size and position">
      {open ? (
        <div className="app-row">
          <LengthInput label="Width" value={o.width} units={units} range={widthRange} testId="opening-width" onCommit={(width) => place(width, o.offset)} />
          <LengthInput label="Offset along wall" value={o.offset} units={units} allowZero testId="opening-offset" onCommit={(offset) => place(o.width, offset)} />
        </div>
      ) : (
        <>
          <div className="app-row">
            <LengthInput label="Width" value={o.width} units={units} range={widthRange} testId="opening-width" onCommit={(width) => place(width, o.offset)} />
            <LengthInput label="Height" value={o.height} units={units} testId="opening-height" onCommit={(height) => update({ height })} />
          </div>
          <div className="app-row">
            <LengthInput label="Sill height" value={o.sill} units={units} allowZero testId="opening-sill" onCommit={(sill) => update({ sill })} />
            <LengthInput label="Offset along wall" value={o.offset} units={units} allowZero testId="opening-offset" onCommit={(offset) => place(o.width, offset)} />
          </div>
        </>
      )}
      </Section>
      {o.kind === 'door' && (
        <Section title="Door swing">
        <div className="app-actions">
          <button className="btn" data-testid="door-hinge" title="Flip hinge side" onClick={() => update({ swing: { ...swing, hinge: swing.hinge === 'start' ? 'end' : 'start' } })}>
            Hinge: {swing.hinge}
          </button>
          <button className="btn" data-testid="door-swing" title="Flip swing direction" onClick={() => update({ swing: { ...swing, side: swing.side === 'in' ? 'out' : 'in' } })}>
            Swings {swing.side}
          </button>
        </div>
        </Section>
      )}
      <Section>
        <button className="btn danger" data-testid="opening-delete" onClick={() => { s().deleteOpening(o.id); s().select(null); }}><Trash size={15} /> Delete {KIND_NAME[o.kind].toLowerCase()}</button>
      </Section>
    </>
  );
}

function WallPanel({ room, index, units }: { room: Room; index: number; units: UnitSystem }) {
  const len = wallLength(room, index);
  const end = (index + 1) % room.points.length;
  const gaps = openGaps(room, index);
  const blocked = !gaps.length && room.openings.some((o) => o.wall === index);
  return (
    <>
      <Head kind="Wall" icon={<Spline size={13} />} title={`Wall ${index + 1}`} sub={room.name} />
      <Section title="Length">
      <LengthInput label="Length" value={len} units={units} range={[10, MAX_COORD]} testId="wall-length"
        onCommit={(l) => s().updateRoom(room.id, { points: setWallLength(room.points, index, l) })} />
      <p className="app-muted">Typing a length moves the corner at the wall’s end (highlighted, corner {end + 1}) along the wall; a square room stays square.</p>
      </Section>
      <Section title="Shape">
        <button className="btn" data-testid="wall-split" title="Insert a corner in the middle of this wall" onClick={() => insertCorner(s(), room, index, 0.5)}><Scissors size={15} /> Split wall</button>
        <p className="app-muted">Tip: double-click a wall to add a corner exactly where you click.</p>
      </Section>
      <Section title="Open or closed">
        <button className="btn" data-testid="wall-open-toggle" disabled={blocked} onClick={() => toggleOpenWall(s(), room, index)}
          title={gaps.length ? 'Put the wall back (removes its open gaps)' : 'Remove this wall: the room opens straight into the space next to it'}>
          <SquareSplitHorizontal size={15} /> {gaps.length ? 'Close this wall' : 'Open this wall'}
        </button>
        <p className="app-muted">{blocked ? 'Remove the door, window or fixture on this wall first.'
          : gaps.length ? 'This wall has an open gap with no wall. Close it to put the wall back.'
            : 'Opening a wall leaves no wall at all along it, e.g. where a room opens into the next one.'}</p>
      </Section>
    </>
  );
}

function RoomPanel({ room, units }: { room: Room; units: UnitSystem }) {
  const issues = useIssues();
  const update = (patch: Parameters<ReturnType<typeof s>['updateRoom']>[1]) => s().updateRoom(room.id, patch);
  return (
    <>
      <Head kind="Room" icon={<SquareDashed size={13} />} title={room.name} sub={`${formatArea(polygonArea(room.points), units)} · ${room.points.length} walls`} />
      <Section title="Details">
      <TextInput label="Name" value={room.name} testId="room-name" onCommit={(name) => update({ name })} />
      <LengthInput label="Ceiling height" value={room.ceilingHeight} units={units} testId="room-ceiling" onCommit={(ceilingHeight) => update({ ceilingHeight })} />
      <div className="app-row">
        <ColorPicker label="Wall colour" value={room.wallColor} testId="wall-color" onChange={(wallColor) => update({ wallColor })}
          isDefault={room.wallColor.toLowerCase() === THEME.wall3d} onReset={room.wallColor.toLowerCase() === THEME.wall3d ? undefined : () => update({ wallColor: THEME.wall3d })} />
        <label className="field">Floor
          <select data-testid="floor-material" value={room.floor} onChange={(e) => update({ floor: e.target.value as FloorMaterial })}>
            <option value="wood">Wood</option><option value="carpet">Carpet</option><option value="tile">Tile</option>
          </select>
        </label>
      </div>
      <p className="app-stat">Floor area <strong data-testid="floor-area">{formatArea(polygonArea(room.points), units)}</strong></p>
      </Section>
      <Section title="Fit check">
      {issues.length ? (
        <>
          <p className="app-status bad" data-testid="fit-status"><TriangleAlert size={16} />{issues.length === 1 ? '1 problem' : `${issues.length} problems`} in this layout</p>
          <ul className="app-issues" data-testid="issues-list">
            {issues.map((i) => (
              <li key={i.id}>
                <button className="app-issue" title="Select the item" onClick={() => i.itemIds[0] && s().select({ type: 'item', id: i.itemIds[0] })}><TriangleAlert size={14} />{i.message}</button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="app-status ok app-all-good" data-testid="all-fits"><CircleCheck size={16} />Everything fits</p>
      )}
      </Section>
    </>
  );
}

export function Inspector() {
  const room = useActiveRoom();
  const layout = useLayout();
  const sel = useStore((st) => st.ui.selection);
  const units = useStore((st) => st.project.units);

  let body;
  if (!room) body = <p className="app-empty">No room yet. Add one from the Rooms list and its details show up here.</p>;
  else {
    const item = sel?.type === 'item' ? layout?.items.find((i) => i.id === sel.id) : undefined;
    const opening = sel?.type === 'opening' ? room.openings.find((o) => o.id === sel.id) : undefined;
    if (item) body = <ItemPanel key={item.id} item={item} units={units} />;
    else if (opening) body = <OpeningPanel key={opening.id} opening={opening} room={room} units={units} />;
    else if (sel?.type === 'corner' && room.points[sel.index]) {
      body = (
        <>
          <Head kind="Corner" icon={<Move size={13} />} title={`Corner ${sel.index + 1}`} sub={room.name} />
          <Section>
            <p className="app-muted">Drag the corner to reshape the room.</p>
            <button className="btn danger" data-testid="corner-delete" disabled={room.points.length <= 3}
              onClick={() => deleteCorner(s(), sel.index)}><Trash size={15} /> Delete corner</button>
            {room.points.length <= 3 && <p className="app-muted">A room needs at least 3 corners.</p>}
          </Section>
        </>
      );
    } else if (sel?.type === 'wall' && room.points[sel.index]) {
      body = <WallPanel key={`${room.id}-${sel.index}`} room={room} index={sel.index} units={units} />;
    } else body = <RoomPanel room={room} units={units} />;
  }
  return <aside className="app-inspector" aria-label="Inspector">{body}</aside>;
}
