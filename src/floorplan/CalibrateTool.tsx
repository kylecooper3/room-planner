import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/store';
import { usePlanView } from '../editor2d/planContext';
import { formatLength, parseLength } from '../core/units';
import { calibrateUnderlay } from './calibrate';
import type { Vec2 } from '../types';
import './fp-floorplan.css';

const BIG = 1e7;

/** SVG overlay rendered by PlanEditor on top of everything while ui.tool === 'calibrate': click two points, enter the real distance, rescale the underlay. */
export function CalibrateTool() {
  const underlay = useStore((s) => s.project.underlay);
  const units = useStore((s) => s.project.units);
  const setUI = useStore((s) => s.setUI);
  const updateUnderlay = useStore((s) => s.updateUnderlay);
  const { toPlan, pxPerCm } = usePlanView();
  const [pts, setPts] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setUI({ tool: 'select' }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setUI]);

  useEffect(() => {
    if (underlay) return;
    const t = setTimeout(() => setUI({ tool: 'select' }), 2000);
    return () => clearTimeout(t);
  }, [underlay, setUI]);

  if (!underlay) return createPortal(<div className="fp-panel" role="status">Upload a floor plan image first.</div>, document.body);

  const end = pts[1] ?? (pts[0] && hover);
  const measured = pts[0] && end ? Math.hypot(end.x - pts[0].x, end.y - pts[0].y) : 0;
  const k = 1 / pxPerCm;
  const bare = units === 'imperial' ? 'ft' : 'm';

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const cm = parseLength(text, units, bare);
    if (cm === null) { setError(units === 'imperial' ? 'Try something like 12\' 6" or 12.5' : 'Try something like 3.8 m or 380 cm'); return; }
    updateUnderlay(calibrateUnderlay(underlay, pts[0], pts[1], cm));
    setUI({ tool: 'select' });
  };

  // Centred over the plan pane (not the window), like the other canvas overlays.
  const pane = document.querySelector('[data-testid="plan-svg"][data-readonly="false"]')?.getBoundingClientRect();
  const at = pane && { left: pane.left + pane.width / 2, top: pane.top + 12, maxWidth: Math.min(420, pane.width - 24) };
  const panel = pts.length < 2 ? (
    <div className="fp-panel" role="status" style={at}>
      <strong>{pts.length === 0 ? 'Click one end of a length you know (e.g. a labelled wall).' : 'Now click the other end.'}</strong>
      <span className="fp-hint">Nothing labelled? A standard interior door is about 30–32 in / 80 cm wide: click both sides of one. Esc to cancel.</span>
    </div>
  ) : (
    <form className="fp-panel" onSubmit={apply} style={at}>
      <label className="field">
        How long is that, really?
        <input data-testid="calibrate-distance" autoFocus value={text} onChange={(e) => { setText(e.target.value); setError(''); }} />
      </label>
      <span className="fp-hint">{units === 'imperial' ? 'e.g. 12\' 6" — a plain number means feet' : 'e.g. 3.8 m — a plain number means metres'}</span>
      {error && <div className="note error">{error}</div>}
      <div className="fp-panel-row">
        <button type="button" className="btn" onClick={() => setUI({ tool: 'select' })}>Cancel</button>
        <button type="submit" className="btn primary" data-testid="calibrate-apply">Apply</button>
      </div>
    </form>
  );

  return (
    <g>
      <rect
        x={-BIG / 2} y={-BIG / 2} width={BIG} height={BIG} fill="transparent" style={{ cursor: 'crosshair' }}
        onPointerDown={(e) => { e.stopPropagation(); if (pts.length < 2) setPts([...pts, toPlan(e)]); }}
        onPointerMove={(e) => setHover(toPlan(e))}
      />
      <g style={{ pointerEvents: 'none' }}>
        {pts[0] && end && <line x1={pts[0].x} y1={pts[0].y} x2={end.x} y2={end.y} stroke="var(--accent)" strokeWidth={2 * k} strokeDasharray={`${6 * k} ${4 * k}`} />}
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={6 * k} fill="var(--accent)" stroke="#fff" strokeWidth={2 * k} />)}
        {measured > 0 && end && (
          <text x={(pts[0].x + end.x) / 2} y={(pts[0].y + end.y) / 2 - 8 * k} fontSize={13 * k} textAnchor="middle" fill="var(--ink)" stroke="#fff" strokeWidth={3 * k} paintOrder="stroke">
            {formatLength(measured, units)}
          </text>
        )}
      </g>
      {createPortal(panel, document.body)}
    </g>
  );
}
