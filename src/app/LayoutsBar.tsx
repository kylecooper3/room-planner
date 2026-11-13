import { Copy, Ellipsis, Pencil, Plus, Trash } from 'lucide-react';
import { useState } from 'react';
import { useActiveRoom } from '../store/selectors';
import { useStore } from '../store/store';
import { RenameInput } from './inputs';
import { Menu, MenuItem } from './Menu';

/** Strip above the canvas: the active room's furniture layouts as tabs, with + and a ⋯ menu for the current one. */
export function LayoutsBar() {
  const room = useActiveRoom();
  const [editing, setEditing] = useState<string | null>(null);
  if (!room) return null;
  const s = useStore.getState;
  const active = room.layouts.find((l) => l.id === room.activeLayoutId);

  return (
    <nav className="app-layouts" aria-label="Layouts">
      <div className="app-layout-tabs">
        {room.layouts.map((l) =>
          editing === l.id ? (
            <RenameInput key={l.id} label="Layout name" value={l.name} onDone={(name) => { setEditing(null); if (name) s().renameLayout(l.id, name); }} />
          ) : (
            <button
              key={l.id} className={`app-layout-tab${l.id === room.activeLayoutId ? ' active' : ''}`} data-testid="layout-tab"
              aria-pressed={l.id === room.activeLayoutId} title="Layout: click to open, double-click to rename"
              onClick={() => s().setActiveLayout(l.id)} onDoubleClick={() => setEditing(l.id)}
            >{l.name}</button>
          ))}
      </div>
      <button className="btn ghost icon" data-testid="layout-add" title="New empty layout" aria-label="Add layout" onClick={() => s().addLayout()}><Plus size={16} /></button>
      <Menu label={<Ellipsis size={16} />} title="Layout options" ariaLabel="Layout options" testId="layout-menu" className="btn ghost icon">
        <MenuItem icon={<Pencil size={16} />} label="Rename layout" testId="layout-rename" onClick={() => active && setEditing(active.id)} />
        <MenuItem icon={<Copy size={16} />} label="Duplicate layout" testId="layout-duplicate" onClick={() => s().duplicateLayout(room.activeLayoutId)} />
        <div className="app-menu-sep" />
        <MenuItem
          icon={<Trash size={16} />} label="Delete layout" danger testId="layout-delete" disabled={room.layouts.length <= 1}
          onClick={() => active && confirm(`Delete layout "${active.name}"?`) && s().deleteLayout(active.id)}
        />
      </Menu>
    </nav>
  );
}
