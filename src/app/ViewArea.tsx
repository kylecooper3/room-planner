import { Copy } from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { PlanEditor } from '../editor2d/PlanEditor';
import { PlanDropZone, usePlanDrop } from '../floorplan/PlanDropZone';
import { TracePanel } from '../floorplan/TracePanel';
import { useActiveRoom } from '../store/selectors';
import { useStore } from '../store/store';
import { ToolRail } from './ToolRail';
import { WelcomeCard } from './WelcomeCard';

// three.js stays out of the first-paint bundle.
const View3D = lazy(() => import('../view3d/View3D').then((m) => ({ default: m.View3D })));

const Pane = ({ children, label }: { children: ReactNode; label?: string }) => (
  <div className="app-pane">
    {label && <div className="app-pane-label">{label}</div>}
    <Suspense fallback={<div className="app-pane-loading">Building your 3D room…</div>}>{children}</Suspense>
  </div>
);

function CompareView() {
  const room = useActiveRoom();
  const compareId = useStore((st) => st.ui.compareLayoutId);
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  if (!room) return null;
  const left = room.layouts.find((l) => l.id === room.activeLayoutId);
  const others = room.layouts.filter((l) => l.id !== room.activeLayoutId);
  const right = others.find((l) => l.id === compareId) ?? others[0];
  const s = useStore.getState;

  if (!right) {
    return (
      <div className="app-compare-empty">
        <p>Compare needs two layouts of this room.</p>
        <button className="btn primary" data-testid="compare-duplicate"
          onClick={() => s().setUI({ compareLayoutId: s().duplicateLayout(room.activeLayoutId) })}>
          <Copy size={15} /> Duplicate this layout to compare
        </button>
      </div>
    );
  }
  const render = (layoutId: string, readOnly: boolean) =>
    mode === '2d' ? <PlanEditor layoutId={layoutId} readOnly={readOnly} /> : <View3D layoutId={layoutId} readOnly={readOnly} />;
  return (
    <div className="app-compare">
      <div className="app-compare-bar">
        <div className="app-segmented" role="group" aria-label="Compare in">
          {(['2d', '3d'] as const).map((m) => (
            <button key={m} className={`btn${mode === m ? ' active' : ''}`} aria-pressed={mode === m} data-testid={`compare-${m}`} onClick={() => setMode(m)}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="app-compare-pick">Compare with
          <select data-testid="compare-layout" value={right.id} onChange={(e) => s().setUI({ compareLayoutId: e.target.value })}>
            {others.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </div>
      <div className="app-panes">
        <Pane label={left?.name}>{render(room.activeLayoutId, false)}</Pane>
        <Pane label={right.name}>{render(right.id, true)}</Pane>
      </div>
    </div>
  );
}

export function ViewArea() {
  const view = useStore((st) => st.ui.view);
  const tracing = useStore((st) => st.ui.dialog === 'floorplan');
  const hasPlan = useStore((st) => !!st.project.underlay);
  // Not while a tool (draw / calibrate) is in use, a floor plan is loaded or being added: the card would cover the plan.
  const showWelcome = useStore((st) => st.project.rooms.length === 0 && st.ui.tool === 'select' && !st.project.underlay && !tracing);
  const drop = usePlanDrop();
  return (
    <main className="app-view" data-testid="view-area" {...drop.handlers}>
      <div className="app-view-row">
        <ToolRail />
        {tracing && <TracePanel />}
        <div className="app-view-main">
          {view === 'compare' ? <CompareView /> : (
            <div className="app-panes">
              {view !== '3d' && <Pane><PlanEditor /></Pane>}
              {view !== 'plan' && <Pane><View3D /></Pane>}
            </div>
          )}
          {((tracing && !hasPlan) || drop.over) && <PlanDropZone over={drop.over} error={drop.error} onError={drop.setError} />}
          {showWelcome && <div className="app-welcome-backdrop"><WelcomeCard /></div>}
        </div>
      </div>
    </main>
  );
}
