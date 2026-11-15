import { useState, type KeyboardEvent } from 'react';
import { uniqueName, useStore } from '../store/store';
import type { Room } from '../types';

const SUGGESTIONS = ['Bedroom', 'Bathroom', 'Kitchen', 'Living room', 'Dining room', 'Closet', 'Hallway', 'Laundry', 'Balcony'];

/** "Name this room" combobox over the plan, at screen point (x, y), for the room just drawn. Esc keeps the default name. */
export function RoomNamePopover({ room, rooms, x, y }: { room: Room; rooms: Room[]; x: number; y: number }) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const q = text.trim().toLowerCase();
  const options = SUGGESTIONS.filter((n) => n.toLowerCase().startsWith(q)).map((n) => uniqueName(n, rooms, room.id));
  const close = () => useStore.getState().setUI({ namingRoomId: null });
  const save = (name: string) => {
    if (name.trim()) useStore.getState().updateRoom(room.id, { name: name.trim() });
    close();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(-1, Math.min(options.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') { e.preventDefault(); save(options[active] ?? text); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    // Nothing typed yet: Ctrl+Z is the app's undo (drops the room just drawn), not the field's.
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !text) { e.preventDefault(); useStore.getState().undo(); }
  };
  const listId = `room-name-list-${room.id}`;
  return (
    <div className="app-menu-list pe-name-pop" data-testid="room-name-popover" style={{ left: x, top: y }}>
      <label className="app-menu-title" htmlFor={`${listId}-input`}>Name this room</label>
      <div className="field">
        <input id={`${listId}-input`} data-testid="room-name-input" autoFocus autoComplete="off" placeholder={room.name}
          role="combobox" aria-expanded={options.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={active >= 0 && options[active] ? `${listId}-${active}` : undefined}
          value={text} onKeyDown={onKeyDown}
          onChange={(e) => { setText(e.target.value); setActive(-1); }} />
      </div>
      <div role="listbox" id={listId} aria-label="Suggestions">
        {options.map((n, i) => (
          <div key={n} id={`${listId}-${i}`} role="option" aria-selected={i === active} className="app-menu-item" data-testid="room-name-option"
            ref={i === active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => save(n)}>{n}</div>
        ))}
      </div>
    </div>
  );
}
