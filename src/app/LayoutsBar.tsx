import { useState } from 'react';
import { useActiveRoom } from '../store/selectors';
import { useStore } from '../store/store';
import { RenameInput } from './inputs';

export function LayoutsBar() {
  const room = useActiveRoom();
  const [editing, setEditing] = useState<string | null>(null);
  if (!room) return null;
  const s = useStore.getState;
  const active = room.layouts.find((l) => l.id === room.activeLayoutId);

  return (
    <nav className="app-layouts" aria-label="Layouts">
      <span className="app-layouts-title">Layouts</span>
      {room.layouts.map((l) =>
        editing === l.id ? (
          <RenameInput key={l.id} label="Layout name" value={l.name} onDone={(name) => { setEditing(null); if (name) s().renameLayout(l.id, name); }} />
        ) : (
          <button
            key={l.id} className={`app-layout-tab${l.id === room.activeLayoutId ? ' active' : ''}`} data-testid="layout-tab"
            aria-pressed={l.id === room.activeLayoutId} title="Click to open, double-click to rename"
            onClick={() => s().setActiveLayout(l.id)} onDoubleClick={() => setEditing(l.id)}
          >{l.name}</button>
        ))}
      <button className="btn app-small" data-testid="layout-add" title="Add an empty layout" aria-label="Add layout" onClick={() => s().addLayout()}>＋</button>
      <button className="btn app-small" data-testid="layout-duplicate" title="Duplicate this layout" aria-label="Duplicate layout"
        onClick={() => s().duplicateLayout(room.activeLayoutId)}>⧉</button>
      <button
        className="btn app-small danger" data-testid="layout-delete" title="Delete this layout" aria-label="Delete layout"
        disabled={room.layouts.length <= 1}
        onClick={() => active && confirm(`Delete layout "${active.name}"?`) && s().deleteLayout(active.id)}
      >🗑️</button>
    </nav>
  );
}
