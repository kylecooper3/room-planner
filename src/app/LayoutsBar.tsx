import { Copy, Plus, SquareDashed, Trash } from 'lucide-react';
import { useState } from 'react';
import { useActiveRoom } from '../store/selectors';
import { useStore } from '../store/store';
import { RenameInput } from './inputs';

/** Tab strip above the canvas: the active room and its furniture layouts. */
export function LayoutsBar() {
  const room = useActiveRoom();
  const [editing, setEditing] = useState<string | null>(null);
  if (!room) return null;
  const s = useStore.getState;
  const active = room.layouts.find((l) => l.id === room.activeLayoutId);

  return (
    <nav className="app-layouts" aria-label="Layouts">
      <span className="app-layouts-room" title="Active room"><SquareDashed size={15} />{room.name}</span>
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
      <span className="app-layouts-actions">
        <button className="btn ghost app-small icon" data-testid="layout-add" title="New empty layout" aria-label="Add layout" onClick={() => s().addLayout()}><Plus size={15} /></button>
        <button className="btn ghost app-small icon" data-testid="layout-duplicate" title="Duplicate this layout" aria-label="Duplicate layout"
          onClick={() => s().duplicateLayout(room.activeLayoutId)}><Copy size={14} /></button>
        <button
          className="btn ghost app-small icon danger" data-testid="layout-delete" title="Delete this layout" aria-label="Delete layout"
          disabled={room.layouts.length <= 1}
          onClick={() => active && confirm(`Delete layout "${active.name}"?`) && s().deleteLayout(active.id)}
        ><Trash size={14} /></button>
      </span>
    </nav>
  );
}
