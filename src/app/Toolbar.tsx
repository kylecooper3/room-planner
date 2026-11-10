import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { exportPlanPng } from '../editor2d/exportPng';
import { exportProject, importProject, PROJECT_FILE_EXTENSION } from '../store/projectFile';
import { useStore } from '../store/store';
import type { OpeningKind, UIState, ViewMode } from '../types';
import { exportView3dPng } from '../view3d/exportPng';
import { startOptions } from './WelcomeCard';

const OPENINGS: [OpeningKind, string, string][] = [
  ['door', '🚪', 'Door'], ['window', '🪟', 'Window'], ['outlet', '🔌', 'Outlet'], ['radiator', '♨️', 'Radiator'],
];
const VIEWS: [ViewMode, string][] = [['plan', 'Plan'], ['3d', '3D'], ['split', 'Split'], ['compare', 'Compare']];
type Toggle = 'showGrid' | 'snap' | 'showClearances' | 'cutaway' | 'walkMode';

const s = () => useStore.getState();
const closeMenu = (e: MouseEvent) => e.currentTarget.closest('details')?.removeAttribute('open');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fileName = (name: string, ext: string) => `${(name.trim() || 'room-plan').replace(/[\\/:*?"<>|]+/g, '-')}${ext}`;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Menu({ label, title, children, testId }: { label: ReactNode; title: string; children: ReactNode; testId?: string }) {
  return (
    <details className="app-menu">
      <summary className="btn" title={title} data-testid={testId}>{label}</summary>
      <div className="app-menu-list" role="menu">{children}</div>
    </details>
  );
}

export function Toolbar() {
  const ui = useStore((st) => st.ui);
  const project = useStore((st) => st.project);
  const canUndo = useStore((st) => st.canUndo);
  const canRedo = useStore((st) => st.canRedo);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const room = project.rooms.find((r) => r.id === project.activeRoomId);
  const planOrSplit: ViewMode = ui.view === 'split' ? 'split' : 'plan';

  const run = async (what: string, job: () => Promise<void>) => {
    try { await job(); } catch (err) {
      setNote({ text: `${what} failed: ${err instanceof Error ? err.message : String(err)}`, error: true });
    }
  };
  const exportPng = (kind: '2d' | '3d') => run(`${kind.toUpperCase()} export`, async () => {
    const mounted: ViewMode[] = kind === '2d' ? ['plan', 'split'] : ['3d', 'split'];
    if (!mounted.includes(s().ui.view)) {
      s().setUI({ view: kind === '2d' ? 'plan' : '3d' });
      await wait(kind === '2d' ? 300 : 1200); // let the view (and lazy three.js chunk) mount and draw a frame
    }
    const blob = await (kind === '2d' ? exportPlanPng() : exportView3dPng());
    download(blob, fileName(project.name, kind === '2d' ? '-plan.png' : '-3d.png'));
  });

  const tool = (active: boolean, patch: Partial<UIState>, label: string, icon: string, testId: string, disabled = false) => (
    <button
      key={testId} className={`btn${active ? ' active' : ''}`} aria-pressed={active} title={label} aria-label={label}
      data-testid={testId} disabled={disabled} onClick={() => s().setUI(patch)}
    >
      <span aria-hidden>{icon}</span><span className="app-tb-label">{label}</span>
    </button>
  );
  const toggle = (key: Toggle, label: string, icon: string, testId: string) => (
    <button
      className={`btn${ui[key] ? ' active' : ''}`} aria-pressed={ui[key]} title={label} aria-label={label}
      data-testid={testId} onClick={() => s().setUI({ [key]: !ui[key] })}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );

  return (
    <header className="app-toolbar">
      <div className="app-tb-group">
        <span className="app-logo" aria-hidden>🏠</span>
        {project.rooms.length > 0 && (
          <select
            className="app-room-picker" aria-label="Room" title="Switch room" data-testid="room-picker"
            value={project.activeRoomId ?? ''} onChange={(e) => s().setActiveRoom(e.target.value)}
          >
            {project.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <Menu label="+ New room" title="Add a new room" testId="new-room">
          {startOptions(ui.view).map((o) => (
            <button key={o.id} className="btn" role="menuitem" data-testid={`new-room-${o.id}`} onClick={(e) => { closeMenu(e); o.run(); }}>
              {o.icon} {o.label}
            </button>
          ))}
        </Menu>
        {room && (
          <button
            className="btn danger" title="Delete this room" aria-label="Delete this room" data-testid="room-delete"
            onClick={() => confirm(`Delete "${room.name}" and all its layouts?`) && s().deleteRoom(room.id)}
          >🗑️</button>
        )}
      </div>

      <div className="app-tb-group" role="group" aria-label="Tools">
        {tool(ui.tool === 'select', { tool: 'select' }, 'Select', '👆', 'tool-select')}
        {tool(ui.tool === 'draw-room', { tool: 'draw-room', view: planOrSplit }, 'Draw room', '✏️', 'tool-draw-room')}
        {OPENINGS.map(([kind, icon, label]) =>
          tool(ui.tool === 'place-opening' && ui.openingKind === kind, { tool: 'place-opening', openingKind: kind, view: planOrSplit },
            label, icon, `tool-${kind}`, !room))}
        <button className="btn" title="Floor plan underlay" aria-label="Floor plan underlay" data-testid="open-floorplan" onClick={() => s().setUI({ dialog: 'floorplan', view: planOrSplit })}>
          🗺️ <span className="app-tb-label">Floor plan</span>
        </button>
      </div>

      <div className="app-tb-group app-segmented" role="group" aria-label="View">
        {VIEWS.map(([v, label]) => (
          <button key={v} className={`btn${ui.view === v ? ' active' : ''}`} aria-pressed={ui.view === v} title={`${label} view`}
            data-testid={`view-${v}`} onClick={() => s().setUI({ view: v })}>{label}</button>
        ))}
      </div>

      <div className="app-tb-group" role="group" aria-label="Display">
        {toggle('showGrid', 'Grid', '#️⃣', 'toggle-grid')}
        {toggle('snap', 'Snapping', '🧲', 'toggle-snap')}
        {toggle('showClearances', 'Clearances', '🟧', 'toggle-clearances')}
        {toggle('cutaway', 'Cutaway walls', '✂️', 'toggle-cutaway')}
        {ui.view === '3d' && toggle('walkMode', 'Walk mode', '🚶', 'toggle-walk')}
        <button className="btn" title="Switch units" aria-label="Switch units" data-testid="units-toggle"
          onClick={() => s().setUnits(project.units === 'imperial' ? 'metric' : 'imperial')}>
          {project.units === 'imperial' ? 'ft/in' : 'm/cm'}
        </button>
      </div>

      <div className="app-tb-group">
        <button className="btn" title="Undo (Ctrl+Z)" aria-label="Undo" data-testid="undo" disabled={!canUndo} onClick={() => s().undo()}>↶</button>
        <button className="btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" data-testid="redo" disabled={!canRedo} onClick={() => s().redo()}>↷</button>
        <Menu label="File" title="Project file" testId="file-menu">
          <button className="btn" role="menuitem" data-testid="file-new" onClick={(e) => { closeMenu(e); if (confirm('Start a new, empty project? Unsaved work will be lost.')) s().newProject(); }}>
            📄 New project
          </button>
          <button className="btn" role="menuitem" data-testid="file-export" onClick={(e) => { closeMenu(e); void run('Export', async () => download(await exportProject(project), fileName(project.name, PROJECT_FILE_EXTENSION))); }}>
            💾 Export project
          </button>
          <button className="btn" role="menuitem" data-testid="file-import" onClick={(e) => { closeMenu(e); fileInput.current?.click(); }}>
            📂 Import project…
          </button>
          <button className="btn" role="menuitem" data-testid="export-plan-png" onClick={(e) => { closeMenu(e); void exportPng('2d'); }}>🖼️ Export 2D PNG</button>
          <button className="btn" role="menuitem" data-testid="export-3d-png" onClick={(e) => { closeMenu(e); void exportPng('3d'); }}>🎨 Export 3D PNG</button>
        </Menu>
        <input
          ref={fileInput} type="file" accept={PROJECT_FILE_EXTENSION} hidden data-testid="import-file" aria-label="Import project file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void run('Import', async () => { s().replaceProject(await importProject(file)); setNote({ text: `Opened ${file.name}` }); });
          }}
        />
        <button className="btn" title="Help and shortcuts (?)" aria-label="Help" data-testid="open-help" onClick={() => s().setUI({ dialog: 'help' })}>?</button>
      </div>

      {note && (
        <div className={`note app-tb-note${note.error ? ' error' : ''}`} role="status" data-testid="toolbar-note">
          {note.text} <button className="app-link" onClick={() => setNote(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
    </header>
  );
}
