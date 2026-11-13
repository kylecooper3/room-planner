import { AppWindow, Camera, ChevronDown, DoorOpen, Heater, Pencil, Plug, Plus, Search, SlidersHorizontal, SquareDashed, Trash } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { polygonArea } from '../core/geometry';
import { formatArea, formatLength } from '../core/units';
import { bodyColor } from '../editor2d/view';
import { PRESETS } from '../models/presets';
import { useStore } from '../store/store';
import type { ItemDef, OpeningKind, UnitSystem } from '../types';
import { RenameInput } from './inputs';
import { Menu, MenuItem } from './Menu';
import { startOptions } from './WelcomeCard';

const swatch = (def: ItemDef) => bodyColor(def, '#c9c4bc');
const category = (def: ItemDef) => (def.model.kind === 'parametric' ? def.model.category : 'other');
const footprint = (def: ItemDef, u: UnitSystem) => `${formatLength(def.size.w, u)} × ${formatLength(def.size.d, u)}`;
const sizeText = (def: ItemDef, u: UnitSystem) => `${footprint(def, u)} × ${formatLength(def.size.h, u)}`;
const CATEGORY_LABEL: Record<string, string> = {
  bed: 'Beds', sofa: 'Sofas', armchair: 'Armchairs', desk: 'Desks', chair: 'Chairs', dresser: 'Storage', shelf: 'Shelves',
  table: 'Tables', nightstand: 'Nightstands', lamp: 'Lighting', rug: 'Rugs', plant: 'Plants', tv: 'TV & media', box: 'Other',
};

function groupPresets(query: string) {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, ItemDef[]>();
  for (const def of PRESETS) {
    const cat = category(def);
    if (q && !def.name.toLowerCase().includes(q) && !cat.includes(q) && !(CATEGORY_LABEL[cat] ?? '').toLowerCase().includes(q)) continue;
    groups.set(cat, [...(groups.get(cat) ?? []), def]);
  }
  return [...groups];
}
const s = useStore.getState;

/** The floor plan's rooms: click to make active, rename, delete, add. */
function RoomsSection() {
  const rooms = useStore((st) => st.project.rooms);
  const activeId = useStore((st) => st.project.activeRoomId);
  const units = useStore((st) => st.project.units);
  const view = useStore((st) => st.ui.view);
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <section className="app-rooms" aria-label="Rooms">
      <div className="app-section-head">
        <h2>Rooms{rooms.length > 0 && ` · ${rooms.length}`}</h2>
        <Menu label={<><Plus size={14} /> Add room</>} title="Add a room to this floor plan" testId="new-room" className="btn app-small" place="right">
          {startOptions(view).map((o) => (
            <MenuItem key={o.id} icon={o.icon} label={o.label} hint={o.hint} testId={`new-room-${o.id}`} onClick={o.run} />
          ))}
        </Menu>
      </div>
      {rooms.length === 0 && <p className="app-rooms-empty">No rooms yet. Add one to start.</p>}
      <ul className="app-rooms-list" data-testid="rooms-list">
        {rooms.map((r) => (
          <li key={r.id} className={`app-room-row${r.id === activeId ? ' active' : ''}`} data-testid="room-row" data-room-id={r.id}>
            {renaming === r.id ? (
              <RenameInput label="Room name" value={r.name} onDone={(name) => { setRenaming(null); if (name) s().updateRoom(r.id, { name }); }} />
            ) : (
              <>
                <button className="app-room-main" aria-current={r.id === activeId ? 'true' : undefined} title={`Open ${r.name} (double-click to rename)`}
                  onClick={() => s().setActiveRoom(r.id)} onDoubleClick={() => setRenaming(r.id)}>
                  <SquareDashed size={15} />
                  <span className="app-room-name">{r.name}</span>
                  <span className="app-room-area">{formatArea(polygonArea(r.points), units)}</span>
                </button>
                <span className="app-room-actions">
                  <button className="btn ghost app-small icon" title="Rename room" aria-label={`Rename ${r.name}`} data-testid="room-rename" onClick={() => setRenaming(r.id)}><Pencil size={13} /></button>
                  <button className="btn ghost app-small icon danger" title="Delete room" aria-label={`Delete ${r.name}`} data-testid="room-delete"
                    onClick={() => confirm(`Delete "${r.name}" and all its layouts?`) && s().deleteRoom(r.id)}><Trash size={13} /></button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LibraryPanel() {
  const [tab, setTab] = useState<'furniture' | 'mine'>('furniture');
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const units = useStore((st) => st.project.units);
  const library = useStore((st) => st.project.library);
  const hasRoom = useStore((st) => st.project.rooms.length > 0);
  const noRoomHint = hasRoom ? undefined : 'Add a room first';
  const groups = groupPresets(query);
  const fixtures = FIXTURES.filter(([, , label, hint]) => matches(query, `${label} ${hint}`));

  return (
    <aside className="app-library" aria-label="Library">
      <RoomsSection />
      <div className="app-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'furniture'} className={tab === 'furniture' ? 'active' : ''} data-testid="tab-furniture" onClick={() => setTab('furniture')}>Furniture</button>
        <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'active' : ''} data-testid="tab-my-stuff" onClick={() => setTab('mine')}>
          My stuff{library.length > 0 && <span className="app-tab-count">{library.length}</span>}
        </button>
      </div>
      {!hasRoom && <p className="note app-lib-hint">Add a room to start placing furniture.</p>}

      {tab === 'furniture' ? (
        <>
          <label className="app-search">
            <Search size={15} />
            <input type="search" placeholder="Search furniture and fixtures" aria-label="Search furniture and fixtures" data-testid="lib-search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="app-lib-list">
            {fixtures.length > 0 && <FixturesSection items={fixtures} hasRoom={hasRoom} />}
            {groups.length === 0 && fixtures.length === 0 && <p className="app-empty">Nothing matches “{query}”.</p>}
            {groups.map(([cat, defs]) => (
              <section key={cat}>
                <h3 className="app-lib-cat">{CATEGORY_LABEL[cat] ?? cat}</h3>
                {defs.map((def) => (
                  <button
                    key={def.id} className="app-lib-row" data-testid="lib-item" data-def-id={def.id} disabled={!hasRoom}
                    title={noRoomHint ?? `Add ${def.name} (${sizeText(def, units)}) to the room`} onClick={() => s().placeItem(def.id)}
                  >
                    <span className="app-swatch" style={{ background: swatch(def) }} aria-hidden />
                    <span className="app-lib-name">{def.name}</span>
                    <span className="app-lib-size">{footprint(def, units)}</span>
                    <span className="app-lib-add" aria-hidden><Plus size={15} /></span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </>
      ) : (
        <div className="app-lib-list">
          <button className="btn primary app-new-photo" data-testid="new-from-photo" onClick={() => s().setUI({ dialog: 'item-creator', editingDefId: null })}>
            <Camera size={16} /> New item from a photo
          </button>
          {library.length === 0 && (
            <p className="app-empty">Your own furniture lives here. Snap a photo of your sofa, desk or plant and it becomes a 3D item at its real size.</p>
          )}
          {library.map((def) => (
            <div key={def.id} className="app-lib-row app-my-row" data-testid="my-item" data-def-id={def.id}>
              <span className="app-swatch" style={{ background: swatch(def) }} aria-hidden />
              <span className="app-my-main">
                {renaming === def.id
                  ? <RenameInput label="Item name" value={def.name} onDone={(name) => { setRenaming(null); if (name) s().saveDef({ ...def, name }); }} />
                  : <span className="app-lib-name" onDoubleClick={() => setRenaming(def.id)}>{def.name}</span>}
                <small>{sizeText(def, units)}</small>
              </span>
              <span className="app-row-actions">
                <button className="btn ghost app-small icon" title={noRoomHint ?? 'Add to the room'} aria-label={`Place ${def.name}`} disabled={!hasRoom} data-testid="my-item-place" onClick={() => s().placeItem(def.id)}><Plus size={15} /></button>
                <button className="btn ghost app-small icon" title="Edit" aria-label={`Edit ${def.name}`} data-testid="my-item-edit" onClick={() => s().setUI({ dialog: 'item-creator', editingDefId: def.id })}><SlidersHorizontal size={13} /></button>
                <button className="btn ghost app-small icon" title="Rename" aria-label={`Rename ${def.name}`} data-testid="my-item-rename" onClick={() => setRenaming(def.id)}><Pencil size={13} /></button>
                <button className="btn ghost app-small icon danger" title="Delete" aria-label={`Delete ${def.name}`} data-testid="my-item-delete"
                  onClick={() => confirm(`Delete "${def.name}"? It will also be removed from every room.`) && s().deleteDef(def.id)}><Trash size={13} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

/** Things built into the walls rather than furniture: picked here, then placed by clicking a wall. */
const FIXTURES: [OpeningKind, ReactNode, string, string][] = [
  ['door', <DoorOpen size={16} />, 'Door', 'swing, opens into the room'],
  ['window', <AppWindow size={16} />, 'Window', 'glass, any width'],
  ['outlet', <Plug size={16} />, 'Outlet', 'power socket'],
  ['radiator', <Heater size={16} />, 'Radiator', 'heater on the wall'],
];
const matches = (query: string, text: string) => text.toLowerCase().includes(query.trim().toLowerCase());

function FixturesSection({ items, hasRoom }: { items: typeof FIXTURES; hasRoom: boolean }) {
  const [open, setOpen] = useState(true);
  const ui = useStore((st) => st.ui);
  return (
    <section className="app-fixtures" data-testid="fixtures-section">
      <button className="app-lib-cat app-lib-toggle" aria-expanded={open} data-testid="fixtures-toggle" onClick={() => setOpen(!open)}>
        <ChevronDown size={13} className="app-chevron" aria-hidden /> Doors, windows &amp; fixtures
      </button>
      {open && items.map(([kind, icon, label, hint]) => {
        const active = ui.tool === 'place-opening' && ui.openingKind === kind;
        return (
          <button
            key={kind} className={`app-lib-row${active ? ' active' : ''}`} aria-pressed={active} data-testid={`tool-${kind}`} disabled={!hasRoom}
            title={hasRoom ? `Add a ${label.toLowerCase()}: then click a wall` : 'Add a room first'}
            onClick={() => s().setUI(active ? { tool: 'select' } : { tool: 'place-opening', openingKind: kind, view: ui.view === 'split' ? 'split' : 'plan' })}
          >
            <span className="app-lib-icon" aria-hidden>{icon}</span>
            <span className="app-lib-name">{label}</span>
            {active ? <span className="app-lib-size app-lib-now">Click a wall</span> : <span className="app-lib-size">{hint}</span>}
            <span className="app-lib-add" aria-hidden><Plus size={15} /></span>
          </button>
        );
      })}
    </section>
  );
}
