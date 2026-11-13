import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useStore } from '../store/store';
import { formatArea } from '../core/units';
import { polygonArea } from '../core/geometry';
import type { OpeningKind, Room } from '../types';
import { addPlanImage, detectPlanRooms } from './planImage';
import {
  countsTowardArea, derivedStep, freshSession, isCalibrated, parseArea, scaleToArea, scaleWords, useTrace,
} from './traceSession';
import {
  AppWindow, ArrowRight, Check, DoorOpen, PanelLeftClose, PanelLeftOpen, PenLine, Ruler, Trash2, WandSparkles, X,
} from 'lucide-react';
import './fp-floorplan.css';

const s = useStore.getState;
const NAMES = ['Bedroom', 'Bathroom', 'Kitchen', 'Living room', 'Closet', 'Hallway', 'Balcony'];
const DETECT_TIP = 'Looks for enclosed rooms in the image and proposes each one. Works best on clean plans: textures, '
  + 'furniture and text can confuse it, so keep only the proposals that look right.';

/** "Bedroom", or "Bedroom 2" when that name is taken by another room. */
function uniqueName(name: string, rooms: Room[], self: string) {
  const taken = new Set(rooms.filter((r) => r.id !== self).map((r) => r.name));
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name} ${i}`)) i++;
  return `${name} ${i}`;
}

/** File input styled as a button. */
export function PickImage({ label, primary, icon, testId = 'floorplan-file', onError }: {
  label: string; primary?: boolean; icon?: ReactNode; testId?: string; onError(e: string): void;
}) {
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onError((await addPlanImage(file)) ?? '');
  };
  return (
    <label className={`btn${primary ? ' primary' : ''} fp-pick`}>
      <input type="file" accept="image/*" data-testid={testId} onChange={pick} />
      {icon}{label}
    </label>
  );
}

function Step({ n, title, done, current, children }: { n: number; title: string; done: boolean; current: boolean; children: ReactNode }) {
  return (
    <li className={`fp-step${current ? ' current' : ''}${done ? ' done' : ''}`} data-testid={`floorplan-step-${n}`} aria-current={current ? 'step' : undefined}>
      <button type="button" className="fp-step-head" onClick={() => useTrace.setState({ step: n })} aria-expanded={current}>
        <span className="fp-badge" aria-hidden>{done && !current ? '✓' : n}</span>
        <span className="fp-step-title">{title}</span>
        {done && <span className="fp-sr">(done)</span>}
      </button>
      {current && <div className="fp-step-body">{children}</div>}
    </li>
  );
}

function NameRoom({ room, rooms, onNext, onDone }: { room: Room; rooms: Room[]; onNext(): void; onDone(): void }) {
  const [text, setText] = useState('');
  useEffect(() => setText(''), [room.id]);
  const rename = (name: string) => { if (name.trim()) s().updateRoom(room.id, { name: uniqueName(name.trim(), rooms, room.id) }); };
  const commit = () => { if (text.trim()) rename(text); };
  return (
    <div className="fp-naming" data-testid="floorplan-naming">
      <p className="fp-lead">Room traced ({formatArea(polygonArea(room.points), s().project.units)}). What is it?</p>
      <div className="fp-chips">
        {NAMES.map((n) => (
          <button key={n} type="button" className={`app-pill${room.name.startsWith(n) ? ' active' : ''}`} data-testid="floorplan-name-chip" onClick={() => rename(n)}>{n}</button>
        ))}
        <button type="button" className="app-pill" onClick={() => document.querySelector<HTMLInputElement>('[data-testid="floorplan-room-name"]')?.focus()}>Other…</button>
      </div>
      <div className="field">
        <input data-testid="floorplan-room-name" aria-label="Room name" placeholder={`Or type a name (now “${room.name}”)`} value={text}
          onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      </div>
      <div className="fp-row">
        <button type="button" className="btn primary" data-testid="floorplan-trace-next" onClick={() => { commit(); onNext(); }}><PenLine size={15} aria-hidden />Trace next room</button>
        <button type="button" className="btn" data-testid="floorplan-done-tracing" onClick={() => { commit(); onDone(); }}>Done tracing</button>
      </div>
    </div>
  );
}

/** Docked, non-modal "Trace floor plan" panel (shown while ui.dialog === 'floorplan'): numbered steps from image to finished rooms. */
export function TracePanel() {
  const project = useStore((st) => st.project);
  const tool = useStore((st) => st.ui.tool);
  const openingKind = useStore((st) => st.ui.openingKind);
  const view = useStore((st) => st.ui.view);
  const t = useTrace();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [areaText, setAreaText] = useState(() => (t.knownArea ? formatArea(t.knownArea, project.units) : ''));
  const [areaOpen, setAreaOpen] = useState(false);
  const { underlay: u, units, rooms } = project;
  const planView = view === 'split' ? 'split' : 'plan';

  const step = t.step ?? derivedStep(project, t);
  const scaleDone = !!u && (isCalibrated(u) || t.skipScale || t.knownArea !== null);
  const done = [!!u, scaleDone, rooms.length > 0, rooms.some((r) => r.openings.length > 0), false];
  const naming = rooms.find((r) => r.id === t.namingId);
  const go = (n: number) => useTrace.setState({ step: n });
  const trace = () => { useTrace.setState({ namingId: null, step: 3 }); s().setUI({ tool: 'draw-room', view: planView }); };
  const doneTracing = () => { useTrace.setState({ namingId: null, step: 4 }); s().setUI({ tool: 'select' }); };
  const close = () => s().setUI({ dialog: 'none', tool: 'select' });

  if (t.collapsed) {
    return (
      <aside className="fp-dock collapsed" aria-label="Trace floor plan">
        <button type="button" className="btn ghost icon" data-testid="floorplan-expand" title="Show the tracing steps" aria-label="Show the tracing steps"
          onClick={() => useTrace.setState({ collapsed: false })}>
          <PanelLeftOpen size={16} aria-hidden />
        </button>
      </aside>
    );
  }

  const counted = rooms.filter((r) => countsTowardArea(r, t.counted));
  const total = rooms.reduce((a, r) => a + polygonArea(r.points), 0);
  const countedTotal = counted.reduce((a, r) => a + polygonArea(r.points), 0);
  const diff = t.knownArea && countedTotal ? (countedTotal - t.knownArea) / t.knownArea : null;

  const saveArea = (e: FormEvent) => {
    e.preventDefault();
    const a = parseArea(areaText, units);
    if (a === null) { setError(units === 'imperial' ? 'Type the area like “531 sq ft”.' : 'Type the area like “49 m²”.'); return; }
    setError('');
    useTrace.setState({ knownArea: a, step: null });
  };
  const applyArea = () => {
    if (!u || !t.knownArea) return;
    const r = scaleToArea(u, rooms, t.counted, t.knownArea);
    if (!r) return;
    // shortcut: opening offsets are not rescaled (store clamps them); add doors after matching the area.
    s().beginBatch();
    s().updateUnderlay(r.underlay);
    for (const room of r.rooms) s().updateRoom(room.id, { points: room.points });
    s().endBatch();
  };
  const detect = async () => {
    if (!u) return;
    setError('');
    setBusy(true);
    try {
      const found = await detectPlanRooms(u);
      useTrace.setState({ proposals: found });
      if (!found.length) setError('No enclosed rooms found. Trace them yourself: “Trace a room”.');
    } catch {
      setError('Auto-detect failed on this image. Trace the rooms yourself instead.');
    } finally {
      setBusy(false);
    }
  };
  const keep = (i: number) => {
    const poly = t.proposals[i];
    const id = s().addRoom({ points: poly });
    useTrace.setState({ proposals: t.proposals.filter((_, j) => j !== i), namingId: id, step: 3 });
  };
  const keepAll = () => {
    s().beginBatch();
    for (const poly of t.proposals) s().addRoom({ points: poly });
    s().endBatch();
    useTrace.setState({ proposals: [] });
  };
  // The image blob is kept so undo can restore it; unreferenced blobs are cleaned up at the next startup.
  const removePlan = () => {
    if (!u) return;
    s().setUnderlay(null);
    useTrace.setState(freshSession());
  };
  const placing = (kind: OpeningKind) => tool === 'place-opening' && openingKind === kind;

  return (
    <aside className="fp-dock" aria-label="Trace floor plan" data-testid="floorplan-panel">
      <header className="fp-dock-head">
        <h2>Trace floor plan</h2>
        <button type="button" className="btn ghost icon app-small" title="Collapse the panel" aria-label="Collapse" data-testid="floorplan-collapse" onClick={() => useTrace.setState({ collapsed: true })}><PanelLeftClose size={16} aria-hidden /></button>
        <button type="button" className="btn ghost icon app-small" title="Close (your rooms and the plan stay)" aria-label="Close" data-testid="floorplan-close" onClick={close}><X size={16} aria-hidden /></button>
      </header>
      <ol className="fp-steps">
        <Step n={1} title="Add your plan" done={done[0]} current={step === 1}>
          {!u ? (
            <>
              <p>Drop a picture of your floor plan onto the plan area, or choose a file. A screenshot from a listing is fine.</p>
              <div className="fp-row"><PickImage label="Choose an image…" primary onError={setError} /></div>
            </>
          ) : (
            <>
              <p>Your plan is under the editor. Fade it so your rooms stand out.</p>
              <label className="field fp-field"><span>Opacity</span>
                <span className="app-slider">
                  <input type="range" className="app-range" min={0.1} max={1} step={0.05} value={u.opacity} data-testid="floorplan-opacity"
                    onPointerDown={() => {
                      // One undo step per drag: the batch closes on the next pointerup anywhere.
                      const st = s();
                      st.beginBatch();
                      window.addEventListener('pointerup', () => st.endBatch(), { once: true });
                    }}
                    onChange={(e) => s().updateUnderlay({ opacity: Number(e.target.value) })} />
                  <span className="app-slider-value">{Math.round(u.opacity * 100)}%</span>
                </span>
              </label>
              <label className="fp-check"><input type="checkbox" data-testid="floorplan-visible" checked={u.visible} onChange={(e) => s().updateUnderlay({ visible: e.target.checked })} /> Show the plan under the editor</label>
              <div className="fp-row">
                <PickImage label="Replace…" onError={setError} />
                <button type="button" className="btn ghost danger" data-testid="floorplan-remove" onClick={removePlan}><Trash2 size={15} aria-hidden />Remove</button>
              </div>
              <div className="fp-row"><button type="button" className="btn primary" data-testid="floorplan-next-1" onClick={() => go(2)}>Next: set the scale<ArrowRight size={15} aria-hidden /></button></div>
            </>
          )}
        </Step>

        <Step n={2} title="Set the scale" done={done[1]} current={step === 2}>
          <p>Tell the app how big the plan really is. Pick whichever you know:</p>
          <p className="note muted" data-testid="floorplan-scale">
            {u && isCalibrated(u) ? <>Scale: <strong>{scaleWords(u, units)}</strong></> : 'Scale not set yet: the plan is shown at a guessed size.'}
          </p>
          <button type="button" className="btn fp-choice" data-testid="floorplan-calibrate" disabled={!u}
            onClick={() => { useTrace.setState({ step: null }); s().setUI({ tool: 'calibrate', view: planView }); }}>
            <strong><Ruler size={15} aria-hidden />Measure a known length</strong>
            <small>Click both ends of something whose length you know, then type it. Nothing labelled? A standard interior door is about 30–32 in / 80 cm wide: click both sides of one.</small>
          </button>
          <button type="button" className={`btn fp-choice${areaOpen || t.knownArea ? ' active' : ''}`} data-testid="floorplan-area-option" disabled={!u} onClick={() => setAreaOpen(true)}>
            <strong>I know the total area</strong>
            <small>e.g. “531 sq ft” from the listing. You trace first; then the plan and your rooms are scaled together to match.</small>
          </button>
          {(areaOpen || t.knownArea !== null) && (
            <form className="fp-area" onSubmit={saveArea}>
              <label className="field">Listed total area
                <input data-testid="floorplan-area" autoFocus placeholder={units === 'imperial' ? 'e.g. 531 sq ft' : 'e.g. 49 m²'}
                  value={areaText} onChange={(e) => setAreaText(e.target.value)} />
              </label>
              <div className="fp-row"><button type="submit" className="btn primary" data-testid="floorplan-area-save">Use this area</button></div>
              <p className="fp-tip">Listings usually measure to the <em>outside</em> of the walls and usually leave out balconies. You choose which traced rooms count.</p>
            </form>
          )}
          <button type="button" className="btn fp-choice" data-testid="floorplan-skip-scale" disabled={!u} onClick={() => useTrace.setState({ skipScale: true, step: 3 })}>
            <strong>Skip for now</strong>
            <small>Trace first; you can type exact wall lengths afterwards.</small>
          </button>
        </Step>

        <Step n={3} title="Trace rooms" done={done[2]} current={step === 3}>
          <p>One room at a time: click each inside corner on the plan. Corners snap to the plan’s walls and to rooms you already traced.</p>
          {naming ? (
            <NameRoom room={naming} rooms={rooms} onNext={trace} onDone={doneTracing} />
          ) : tool === 'draw-room' ? (
            <p className="note" data-testid="floorplan-tracing">Tracing… follow the hint on the plan.</p>
          ) : (
            <div className="fp-row">
              <button type="button" className="btn primary" data-testid="floorplan-trace" onClick={trace}><PenLine size={15} aria-hidden />{rooms.length ? 'Trace next room' : 'Trace a room'}</button>
              {rooms.length > 0 && <button type="button" className="btn" data-testid="floorplan-done-tracing" onClick={doneTracing}>Done tracing<ArrowRight size={15} aria-hidden /></button>}
            </div>
          )}
          {rooms.length > 0 && (
            <ul className="fp-rooms">
              {rooms.map((r) => (
                <li key={r.id} data-testid="floorplan-room-row" className={`app-room-row${r.id === project.activeRoomId ? ' active' : ''}`}>
                  {t.knownArea !== null && (
                    <input type="checkbox" className="fp-count" title="Counts toward the listed area" aria-label={`${r.name} counts toward the listed area`}
                      data-testid="floorplan-room-counted" checked={countsTowardArea(r, t.counted)}
                      onChange={(e) => useTrace.setState({ counted: { ...t.counted, [r.id]: e.target.checked } })} />
                  )}
                  <button type="button" className="app-room-main" title="Make this the active room" onClick={() => s().setActiveRoom(r.id)}>
                    <span className="app-row-name">{r.name}</span>
                    <span className="app-row-meta">{formatArea(polygonArea(r.points), units)}</span>
                  </button>
                  <span className="app-row-actions">
                    <button type="button" className="btn ghost icon app-small danger" aria-label={`Delete ${r.name}`} title="Delete this room (undo with Ctrl+Z)" onClick={() => s().deleteRoom(r.id)}>
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {rooms.length > 0 && <p className="app-stat fp-total" data-testid="floorplan-total"><span>Total, {rooms.length} room{rooms.length > 1 ? 's' : ''}</span><strong>{formatArea(total, units)}</strong></p>}
          {t.knownArea !== null && rooms.length > 0 && diff !== null && (
            <div className="note muted fp-compare" data-testid="floorplan-area-compare">
              <p>Counted {formatArea(countedTotal, units)} vs listed {formatArea(t.knownArea, units)}:{' '}
              <strong className={Math.abs(diff) < 0.01 ? 'ok' : undefined}>{Math.abs(diff) < 0.0005 ? 'matches' : `${diff > 0 ? '+' : '−'}${Math.abs(diff * 100).toFixed(1)}%`}</strong></p>
              {Math.abs(diff) >= 0.0005 && (
                <button type="button" className="btn" data-testid="floorplan-apply-area" onClick={applyArea}>Scale plan to {formatArea(t.knownArea, units)}</button>
              )}
            </div>
          )}
          {t.proposals.length > 0 && (
            <div className="fp-proposals">
              <p className="fp-lead">Auto-detect found {t.proposals.length} room{t.proposals.length > 1 ? 's' : ''} (blue, numbered on the plan):</p>
              <ul className="fp-rooms">
                {t.proposals.map((poly, i) => (
                  <li key={i} data-testid="floorplan-proposal" className="fp-proposal">
                    <span className="app-row-name">#{i + 1}</span>
                    <span className="app-row-meta">{formatArea(polygonArea(poly), units)}</span>
                    <button type="button" className="btn app-small" data-testid="floorplan-keep" onClick={() => keep(i)}>Keep</button>
                    <button type="button" className="btn ghost icon app-small" aria-label={`Discard proposal ${i + 1}`} title="Discard"
                      onClick={() => useTrace.setState({ proposals: t.proposals.filter((_, j) => j !== i) })}><X size={15} aria-hidden /></button>
                  </li>
                ))}
              </ul>
              <div className="fp-row">
                <button type="button" className="btn" data-testid="floorplan-keep-all" onClick={keepAll}><Check size={15} aria-hidden />Keep all</button>
                <button type="button" className="btn ghost" onClick={() => useTrace.setState({ proposals: [] })}>Discard all</button>
              </div>
            </div>
          )}
          <div className="fp-row">
            <button type="button" className="btn" data-testid="floorplan-detect" disabled={!u || busy} title={DETECT_TIP} onClick={detect}>
              <WandSparkles size={15} aria-hidden />{busy ? 'Looking…' : 'Auto-detect rooms'}
            </button>
          </div>
        </Step>

        <Step n={4} title="Doors & windows" done={done[3]} current={step === 4}>
          <p>Add doors and windows to the walls you traced.</p>
          <div className="fp-row">
            <button type="button" className={`btn${placing('door') ? ' active' : ''}`} data-testid="floorplan-add-door" disabled={!rooms.length}
              onClick={() => s().setUI({ tool: 'place-opening', openingKind: 'door', view: planView })}><DoorOpen size={15} aria-hidden />Add a door</button>
            <button type="button" className={`btn${placing('window') ? ' active' : ''}`} data-testid="floorplan-add-window" disabled={!rooms.length}
              onClick={() => s().setUI({ tool: 'place-opening', openingKind: 'window', view: planView })}><AppWindow size={15} aria-hidden />Add a window</button>
          </div>
          {(placing('door') || placing('window')) && <p className="note">Now click a wall on the plan.</p>}
          <p className="fp-tip">Click on a wall where the plan shows a gap. Each click places one; click it afterwards to set its width or swing in the inspector.</p>
          <div className="fp-row"><button type="button" className="btn primary" data-testid="floorplan-next-4" onClick={() => go(5)}>Next: check &amp; fix<ArrowRight size={15} aria-hidden /></button></div>
        </Step>

        <Step n={5} title="Check & fix" done={done[4]} current={step === 5}>
          <ul className="fp-tips">
            <li>Drag a corner to move it: it snaps to the plan’s walls and other rooms.</li>
            <li>Click a wall to type its exact length in the inspector (or split it).</li>
            <li>Double-click a wall to add a corner.</li>
            <li>Click another room to edit it; lower the opacity to check your outlines.</li>
          </ul>
          <div className="fp-row"><button type="button" className="btn primary" data-testid="floorplan-finish" onClick={close}><Check size={15} aria-hidden />Finish</button></div>
        </Step>
      </ol>
      {error && <div className="note error" role="alert">{error}</div>}
    </aside>
  );
}
