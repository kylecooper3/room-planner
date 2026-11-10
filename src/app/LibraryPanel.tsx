import { useState } from 'react';
import { formatLength } from '../core/units';
import { bodyColor } from '../editor2d/view';
import { PRESETS } from '../models/presets';
import { useStore } from '../store/store';
import type { ItemDef, UnitSystem } from '../types';
import { RenameInput } from './inputs';

const swatch = (def: ItemDef) => bodyColor(def, '#c9bfb4');
const category = (def: ItemDef) => (def.model.kind === 'parametric' ? def.model.category : 'other');
const sizeText = (def: ItemDef, u: UnitSystem) =>
  `${formatLength(def.size.w, u)} × ${formatLength(def.size.d, u)} × ${formatLength(def.size.h, u)}`;

function groupPresets() {
  const groups = new Map<string, ItemDef[]>();
  for (const def of PRESETS) groups.set(category(def), [...(groups.get(category(def)) ?? []), def]);
  return [...groups];
}

export function LibraryPanel() {
  const [tab, setTab] = useState<'furniture' | 'mine'>('furniture');
  const [renaming, setRenaming] = useState<string | null>(null);
  const units = useStore((st) => st.project.units);
  const library = useStore((st) => st.project.library);
  const hasRoom = useStore((st) => st.project.rooms.length > 0);
  const s = useStore.getState;
  const noRoomHint = hasRoom ? undefined : 'Add a room first';

  return (
    <aside className="app-library" aria-label="Library">
      <div className="app-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'furniture'} className={tab === 'furniture' ? 'active' : ''} data-testid="tab-furniture" onClick={() => setTab('furniture')}>Furniture</button>
        <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'active' : ''} data-testid="tab-my-stuff" onClick={() => setTab('mine')}>My stuff</button>
      </div>
      {!hasRoom && <p className="note app-lib-hint">Create a room to start placing furniture.</p>}

      {tab === 'furniture' ? (
        <div className="app-lib-list">
          {groupPresets().map(([cat, defs]) => (
            <section key={cat}>
              <h3 className="app-lib-cat">{cat}</h3>
              {defs.map((def) => (
                <button
                  key={def.id} className="app-lib-row" data-testid="lib-item" data-def-id={def.id} disabled={!hasRoom}
                  title={noRoomHint ?? `Place ${def.name}`} onClick={() => s().placeItem(def.id)}
                >
                  <span className="app-swatch" style={{ background: swatch(def) }} aria-hidden />
                  <span className="app-lib-name">{def.name}</span>
                  <small>{sizeText(def, units)}</small>
                </button>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="app-lib-list">
          <button className="btn primary app-new-photo" data-testid="new-from-photo" onClick={() => s().setUI({ dialog: 'item-creator', editingDefId: null })}>
            📸 New from photo
          </button>
          {library.length === 0 && (
            <p className="app-empty">Nothing here yet! Snap a photo of your own sofa, desk or plant and it becomes a 3D item at its real size.</p>
          )}
          {library.map((def) => (
            <div key={def.id} className="app-lib-row app-my-row" data-testid="my-item" data-def-id={def.id}>
              <span className="app-swatch" style={{ background: swatch(def) }} aria-hidden />
              <span className="app-lib-name">
                {renaming === def.id
                  ? <RenameInput label="Item name" value={def.name} onDone={(name) => { setRenaming(null); if (name) s().saveDef({ ...def, name }); }} />
                  : <span onDoubleClick={() => setRenaming(def.id)}>{def.name}</span>}
                <small>{sizeText(def, units)}</small>
              </span>
              <span className="app-row-actions">
                <button className="btn app-small" title={noRoomHint ?? 'Place'} aria-label={`Place ${def.name}`} disabled={!hasRoom} data-testid="my-item-place" onClick={() => s().placeItem(def.id)}>＋</button>
                <button className="btn app-small" title="Edit" aria-label={`Edit ${def.name}`} data-testid="my-item-edit" onClick={() => s().setUI({ dialog: 'item-creator', editingDefId: def.id })}>✏️</button>
                <button className="btn app-small" title="Rename" aria-label={`Rename ${def.name}`} data-testid="my-item-rename" onClick={() => setRenaming(def.id)}>🏷️</button>
                <button className="btn app-small danger" title="Delete" aria-label={`Delete ${def.name}`} data-testid="my-item-delete"
                  onClick={() => confirm(`Delete "${def.name}"? It will also be removed from every room.`) && s().deleteDef(def.id)}>🗑️</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
