import { Copy, Download, Ellipsis, FolderOpen, House, LayoutGrid, Pencil, Plus, Sparkles, SquarePlus, Trash } from 'lucide-react';
import { useState } from 'react';
import { formatArea } from '../core/units';
import { buildDemoProject } from '../store/demo';
import {
  createFloorPlan, deleteFloorPlan, duplicateFloorPlan, exportFloorPlan, importFloorPlan, openFloorPlan, renameFloorPlan,
  useFloorPlans, type FloorPlanMeta,
} from '../store/floorPlans';
import { PROJECT_FILE_EXTENSION } from '../store/projectFile';
import { useStore } from '../store/store';
import type { UnitSystem } from '../types';
import { attempt, Note, say } from './feedback';
import { RenameInput } from './inputs';
import { Menu, MenuItem } from './Menu';
import { download, fileName, useRoomplanPicker } from './Toolbar';
import { newFloorPlan, startOptions } from './WelcomeCard';

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
/** "just now", "5 minutes ago", "yesterday", "3 weeks ago"… */
export function timeAgo(ms: number, now = Date.now()): string {
  const sec = Math.round((ms - now) / 1000);
  if (Math.abs(sec) < 45) return 'just now';
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2629800], ['year', 31557600]];
  let unit = steps[0];
  for (const st of steps) if (Math.abs(sec) >= st[1]) unit = st;
  return rtf.format(Math.round(sec / unit[1]), unit[0]);
}

const tryDemo = () => attempt('Opening the demo', () => createFloorPlan({ project: buildDemoProject() }));

function NewPlanMenu() {
  return (
    <Menu label={<><Plus size={16} /> New floor plan</>} title="Create a new floor plan" testId="home-new" className="btn primary" place="right">
      <div className="app-menu-title">Start with</div>
      {startOptions('plan').map((o) => (
        <MenuItem key={o.id} icon={o.icon} label={o.label} hint={o.hint} testId={`home-new-${o.id}`} onClick={() => void newFloorPlan(o.id)} />
      ))}
      <div className="app-menu-sep" />
      <MenuItem icon={<SquarePlus size={18} />} label="Blank floor plan" hint="Add rooms later" testId="home-new-blank" onClick={() => void newFloorPlan()} />
    </Menu>
  );
}

function PlanCard({ plan, units }: { plan: FloorPlanMeta; units: UnitSystem }) {
  const [renaming, setRenaming] = useState(false);
  const open = () => void attempt('Opening the plan', () => openFloorPlan(plan.id));
  const meta = plan.roomCount === 0 ? 'No rooms yet'
    : `${plan.roomCount} ${plan.roomCount === 1 ? 'room' : 'rooms'} · ${formatArea(plan.areaCm2, units)}`;
  return (
    <article className="app-card" data-testid="plan-card" data-plan-id={plan.id} aria-label={plan.name}>
      <button className="app-card-open" onClick={open} title={`Open ${plan.name}`} data-testid="plan-card-open">
        <div className="app-card-thumb" aria-hidden>
          {plan.thumbnailSvg
            // As an <img>: the SVG can never run script or touch the page, whatever the plan's room names contain.
            ? <img alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(plan.thumbnailSvg)}`} />
            : <LayoutGrid size={36} strokeWidth={1.25} />}
        </div>
      </button>
      <div className="app-card-body">
        <div className="app-card-text">
          {renaming ? (
            <RenameInput label="Floor plan name" value={plan.name} onDone={(name) => {
              setRenaming(false);
              if (name) void attempt('Rename', () => renameFloorPlan(plan.id, name));
            }} />
          ) : (
            <span className="app-card-name" data-testid="plan-card-name" onDoubleClick={() => setRenaming(true)}>{plan.name}</span>
          )}
          <span className="app-card-meta" data-testid="plan-card-meta">{meta}</span>
          <span className="app-card-meta" title={new Date(plan.updatedAt).toLocaleString()}>Edited {timeAgo(plan.updatedAt)}</span>
        </div>
        <Menu label={<Ellipsis size={16} />} title="More actions" ariaLabel={`More actions for ${plan.name}`} testId="plan-card-menu" className="btn ghost icon" place="right">
          <MenuItem icon={<FolderOpen size={16} />} label="Open" testId="plan-card-open-item" onClick={open} />
          <MenuItem icon={<Pencil size={16} />} label="Rename" testId="plan-card-rename" onClick={() => setRenaming(true)} />
          <MenuItem icon={<Copy size={16} />} label="Duplicate" testId="plan-card-duplicate" onClick={() => void attempt('Duplicate', () => duplicateFloorPlan(plan.id))} />
          <MenuItem icon={<Download size={16} />} label="Export .roomplan" testId="plan-card-export"
            onClick={() => void attempt('Export', async () => download(await exportFloorPlan(plan.id), fileName(plan.name, PROJECT_FILE_EXTENSION)))} />
          <div className="app-menu-sep" />
          <MenuItem icon={<Trash size={16} />} label="Delete" danger testId="plan-card-delete"
            onClick={() => { if (confirm(`Delete "${plan.name}" and all its rooms? This cannot be undone.`)) void attempt('Delete', () => deleteFloorPlan(plan.id)); }} />
        </Menu>
      </div>
    </article>
  );
}

/** The floor-plan library: every saved plan, plus the ways to start a new one. Shown when no plan is open. */
export function HomeScreen() {
  const plans = useFloorPlans((f) => f.plans);
  const units = useStore((st) => st.project.units);
  const importer = useRoomplanPicker((file) => void attempt('Import', async () => {
    await importFloorPlan(file);
    say(`Imported ${file.name}`);
  }), 'home-import-file');
  const sorted = [...plans].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="app-home" data-testid="home">
      <header className="app-home-bar" style={{ position: 'relative' }}>
        <span className="app-mark" aria-hidden><House size={16} /></span>
        <span className="app-home-brand">Room Planner</span>
        <span className="app-spacer" />
        <button className="btn ghost" data-testid="home-import" title={`Import a ${PROJECT_FILE_EXTENSION} file as a new floor plan`} onClick={importer.pick}>
          <FolderOpen size={16} /> Import
        </button>
        {importer.element}
        <Note />
      </header>
      <main className="app-home-main">
        <div className="app-home-inner">
          {sorted.length === 0 ? (
            <div className="app-home-empty" data-testid="home-empty">
              <span className="app-mark" aria-hidden><House size={24} /></span>
              <h1>Plan your home at real scale</h1>
              <p>Draw or trace your floor plan, furnish every room, and check in 2D and 3D that everything fits. Everything stays on this device.</p>
              <div className="app-welcome-options">
                {startOptions('plan').map((o) => (
                  <button key={o.id} className="app-option" data-testid={`home-start-${o.id}`} onClick={() => void newFloorPlan(o.id)}>
                    <span className="app-option-icon" aria-hidden>{o.icon}</span>
                    <strong>{o.label}</strong>
                    <small>{o.hint}</small>
                  </button>
                ))}
              </div>
              <div className="app-home-or">
                <button className="btn" data-testid="home-demo" onClick={() => void tryDemo()}><Sparkles size={16} /> Try the demo</button>
                <button className="btn" data-testid="home-new-blank-empty" onClick={() => void newFloorPlan()}><SquarePlus size={16} /> Blank floor plan</button>
              </div>
            </div>
          ) : (
            <>
              <div className="app-home-head">
                <div>
                  <h1>Floor plans</h1>
                  <p>{sorted.length === 1 ? '1 floor plan' : `${sorted.length} floor plans`} on this device</p>
                </div>
                <div className="app-home-actions">
                  <button className="btn" data-testid="home-demo" onClick={() => void tryDemo()}><Sparkles size={16} /> Try the demo</button>
                  <NewPlanMenu />
                </div>
              </div>
              <div className="app-home-grid" data-testid="plan-grid">
                {sorted.map((p) => <PlanCard key={p.id} plan={p} units={units} />)}
                <div className="app-card app-card-new">
                  <h3><Plus size={16} /> New floor plan</h3>
                  {startOptions('plan').map((o) => (
                    <button key={o.id} className="app-menu-item" data-testid={`home-card-${o.id}`} onClick={() => void newFloorPlan(o.id)}>
                      {o.icon}<span>{o.label}<small>{o.hint}</small></span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
