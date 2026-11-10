import { useState, type FormEvent } from 'react';
import { rectRoomPoints } from '../core/geometry';
import { useStore } from '../store/store';
import { defaultCeilingText, formatHint, validateRoomSetup, type RoomField } from './roomSetup';

export function RoomSetupDialog() {
  const units = useStore((s) => s.project.units);
  const roomCount = useStore((s) => s.project.rooms.length);
  const [name, setName] = useState(roomCount ? `Room ${roomCount + 1}` : 'My room');
  const [text, setText] = useState<Record<RoomField, string>>({ width: '', length: '', height: defaultCeilingText(units) });
  const [submitted, setSubmitted] = useState(false);
  const result = validateRoomSetup(text, units);
  const errors = submitted && !result.ok ? result.errors : {};
  const close = () => useStore.getState().setUI({ dialog: 'none' });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!result.ok) return;
    const s = useStore.getState();
    s.addRoom({ points: rectRoomPoints(result.width, result.length), ceilingHeight: result.height, name: name.trim() || 'My room' });
    close();
  };

  const field = (key: RoomField, label: string) => (
    <label className="field">
      {label}
      <input
        data-testid={`room-${key}`} value={text[key]} autoFocus={key === 'width'} aria-invalid={!!errors[key]}
        onChange={(e) => setText({ ...text, [key]: e.target.value })}
      />
      {errors[key] && <span className="app-field-error">{errors[key]}</span>}
    </label>
  );

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form className="dialog app-room-setup" role="dialog" aria-modal="true" aria-label="Room dimensions" onSubmit={submit}>
        <h2>📐 Enter your room's size</h2>
        <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="app-row">
          {field('width', 'Width')}
          {field('length', 'Length')}
        </div>
        {field('height', 'Ceiling height')}
        <p className="app-hint">{formatHint(units)}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="submit" className="btn primary" data-testid="room-create">Create room</button>
        </div>
      </form>
    </div>
  );
}
