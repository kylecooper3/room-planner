import { usePlanView } from '../editor2d/planContext';
import { useTrace } from './traceSession';
import { polygonCentroid } from '../core/geometry';

/** Auto-detected room outlines awaiting Keep / Discard in the tracing panel (dashed, numbered). */
export function ProposalLayer() {
  const proposals = useTrace((s) => s.proposals);
  const { pxPerCm: k } = usePlanView();
  if (!proposals.length) return null;
  return (
    <g data-chrome="" pointerEvents="none">
      {proposals.map((poly, i) => {
        const c = polygonCentroid(poly);
        return (
          <g key={i} data-testid="plan-proposal">
            <polygon points={poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="#2f9be0" fillOpacity={0.12} stroke="#2f9be0"
              strokeWidth={2.5 / k} strokeDasharray={`${8 / k} ${5 / k}`} />
            <circle cx={c.x} cy={c.y} r={13 / k} fill="#2f9be0" />
            <text x={c.x} y={c.y} fontSize={13 / k} fontWeight={700} fill="#ffffff" textAnchor="middle" dominantBaseline="central">{i + 1}</text>
          </g>
        );
      })}
    </g>
  );
}
