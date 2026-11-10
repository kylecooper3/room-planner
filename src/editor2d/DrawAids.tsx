import type { ReactNode } from 'react';
import { useStore } from '../store/store';
import { useBlobUrl } from '../store/blobs';
import type { Vec2 } from '../types';

/** Hint bar + floating mini-toolbar shown while the draw-room tool is active. */
export function DrawHud({ count, canFinish, measure, onUndo, onFinish, onCancel }: {
  count: number; canFinish: boolean; measure: string | null; onUndo(): void; onFinish(): void; onCancel(): void;
}) {
  const hint = count === 0 ? 'Click the first corner of the room'
    : count < 3 ? 'Click the next corner — right angles snap (hold Shift for any angle)'
      : 'Click the green circle or press Enter to finish';
  return (
    <>
      <div className="pe-hint" role="status" data-testid="draw-hint">
        <strong>{hint}</strong>
        {measure ? <span className="pe-measure" data-testid="draw-measure">{measure}</span> : <small>Wheel to zoom · drag or Space + drag to pan</small>}
      </div>
      <div className="pe-minibar" data-testid="draw-hud">
        <button type="button" className="btn" data-testid="draw-undo" disabled={!count} title="Undo the last point (Backspace)" onClick={onUndo}>↶ Undo point</button>
        <button type="button" className="btn primary" data-testid="draw-finish" disabled={!canFinish} title="Finish the room (Enter, or click the first corner)" onClick={onFinish}>✓ Finish room</button>
        <button type="button" className="btn" data-testid="draw-cancel" title="Cancel this room (Esc)" onClick={onCancel}>✕ Cancel</button>
      </div>
    </>
  );
}

const LOUPE = 140;
const ZOOM = 3;

/** Magnifier: LOUPE px circle showing ZOOM× the underlay (full opacity) plus `children` (plan-space overlay), centred on `center`. */
export function Loupe({ center, k, view, pane, children }: {
  center: Vec2; k: number; view: { x: number; y: number }; pane: { w: number; h: number }; children: ReactNode;
}) {
  const u = useStore((s) => s.project.underlay);
  const url = useBlobUrl(u?.imageId);
  if (!u || !u.visible) return null;
  const sx = center.x * k + view.x, sy = center.y * k + view.y;
  // Up and to the right of the cursor, flipped when that would leave the pane.
  let left = sx + 28, top = sy - LOUPE - 28;
  if (left + LOUPE > pane.w - 8) left = sx - LOUPE - 28;
  if (top < 8) top = sy + 28;
  const r = LOUPE / 2 / (ZOOM * k);
  const line = { stroke: '#e5484d', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const };
  return (
    <div className="pe-loupe" data-testid="loupe" style={{ left, top, width: LOUPE, height: LOUPE }}>
      <svg width={LOUPE} height={LOUPE} viewBox={`${center.x - r} ${center.y - r} ${2 * r} ${2 * r}`}>
        <rect x={center.x - r} y={center.y - r} width={2 * r} height={2 * r} fill="#ffffff" />
        {url && <image href={url} x={u.x} y={u.y} width={u.widthPx * u.cmPerPx} height={u.heightPx * u.cmPerPx} preserveAspectRatio="none" />}
        {children}
        <line x1={center.x - r} y1={center.y} x2={center.x - r * 0.15} y2={center.y} {...line} />
        <line x1={center.x + r * 0.15} y1={center.y} x2={center.x + r} y2={center.y} {...line} />
        <line x1={center.x} y1={center.y - r} x2={center.x} y2={center.y - r * 0.15} {...line} />
        <line x1={center.x} y1={center.y + r * 0.15} x2={center.x} y2={center.y + r} {...line} />
      </svg>
    </div>
  );
}
