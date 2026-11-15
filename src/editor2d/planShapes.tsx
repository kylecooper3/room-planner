import type { ReactNode } from 'react';
import type { Vec2 } from '../types';
import { THEME } from '../theme';
import type { SnapHit, SnapKind } from './drawSnap';

/** SVG shapes shared by the plan editor and the draw-room tool. */

const INK = THEME.planLabel;
const ACCENT = THEME.accent;
export const GUIDE = '#d6336c';
export const FONT = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
/** Snap marker colour and the word shown next to it. */
const SNAP_STYLE: Record<SnapKind, [string, string]> = {
  corner: ['#7c4dde', 'corner'], wall: [THEME.success, 'Attached'], align: [GUIDE, 'aligned'], ink: ['#c2410c', 'plan wall'], angle: [ACCENT, 'straight'],
};

export const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(' ');

/** Text at a constant screen size. `bg` draws a soft rounded plate behind it (for labels over busy drawing). */
export function Label({ at, k, children, size = 12, fill = INK, weight = 500, bg, angle = 0 }: {
  at: Vec2; k: number; children: ReactNode; size?: number; fill?: string; weight?: number; bg?: string; angle?: number;
}) {
  const text = (
    <text x={at.x} y={at.y} fontSize={size / k} fontFamily={FONT} fontWeight={weight} fill={fill} textAnchor="middle"
      dominantBaseline="central" pointerEvents="none" transform={angle ? `rotate(${angle} ${at.x} ${at.y})` : undefined}>{children}</text>
  );
  if (!bg) return text;
  const w = (String(children).length * size * 0.56 + 10) / k, h = (size + 6) / k;
  return (
    <g pointerEvents="none">
      <rect x={at.x - w / 2} y={at.y - h / 2} width={w} height={h} rx={h / 2} fill={bg} fillOpacity={0.88} />
      {text}
    </g>
  );
}

/** Small coloured marker (+ word) where a snap landed, plus its dashed alignment guides. */
export function SnapMarker({ hit, k }: { hit: SnapHit; k: number }) {
  if (!hit.kind) return null;
  const [color, word] = SNAP_STYLE[hit.kind];
  const s = 5 / k;
  return (
    <g data-testid="snap-marker" data-kind={hit.kind} pointerEvents="none">
      {hit.guides.map((g, i) => (
        <line key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={color} strokeWidth={1.25 / k} strokeDasharray={`${5 / k} ${4 / k}`} />
      ))}
      <rect x={hit.p.x - s} y={hit.p.y - s} width={2 * s} height={2 * s} fill="none" stroke={color} strokeWidth={2 / k}
        transform={`rotate(45 ${hit.p.x} ${hit.p.y})`} />
      <Label at={{ x: hit.p.x + 24 / k, y: hit.p.y + 16 / k }} k={k} size={10} weight={600} fill={color} bg="#ffffff">{word}</Label>
    </g>
  );
}
