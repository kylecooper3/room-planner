import {
  Box, ChevronRight, CircleQuestionMark, Columns2, Download, FileImage, FolderOpen, GitCompare, House, ImageDown, LayoutGrid,
  Map as MapIcon, Menu as MenuIcon, Plus, Redo2, Undo2,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { exportPlanPng } from '../editor2d/exportPng';
import { closeFloorPlan, importFloorPlan, openFloorPlan, renameFloorPlan, useFloorPlans } from '../store/floorPlans';
import { exportProject, PROJECT_FILE_EXTENSION } from '../store/projectFile';
import { useStore } from '../store/store';
import type { ViewMode } from '../types';
import { exportView3dPng } from '../view3d/exportPng';
import { attempt, Note, say } from './feedback';
import { RenameInput } from './inputs';
import { Menu, MenuItem } from './Menu';
import { newFloorPlan } from './WelcomeCard';

const VIEWS: [ViewMode, string, typeof Box, string][] = [
  ['plan', 'Plan', MapIcon, '1'], ['3d', '3D', Box, '2'], ['split', 'Split', Columns2, '3'], ['compare', 'Compare', GitCompare, '4'],
];

const s = () => useStore.getState();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const fileName = (name: string, ext: string) => `${(name.trim() || 'room-plan').replace(/[\\/:*?"<>|]+/g, '-')}${ext}`;
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Name of the open floor plan (the open project's name is the source of truth; the library meta follows on save). */
export const usePlanName = () => useStore((st) => st.project.name);

/** Hidden file input for .roomplan files; `pick()` opens the OS file dialog. */
export function useRoomplanPicker(onFile: (file: File) => void, testId: string) {
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input} type="file" accept={PROJECT_FILE_EXTENSION} hidden data-testid={testId} aria-label="Import a floor plan file"
      onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onFile(file); }}
    />
  );
  return { element, pick: () => input.current?.click() };
}

function Breadcrumb() {
  const name = usePlanName();
  const activeId = useFloorPlans((f) => f.activeId);
  const [editing, setEditing] = useState(false);
  return (
    <nav className="app-crumbs" aria-label="Breadcrumb">
      <button className="app-crumb" data-testid="nav-home" title="All floor plans" onClick={() => void attempt('Closing the plan', closeFloorPlan)}>
        <LayoutGrid size={16} /><span className="app-crumb-home-label">Floor plans</span>
      </button>
      <ChevronRight size={14} className="app-crumb-sep" aria-hidden />
      {editing ? (
        <RenameInput label="Floor plan name" value={name} onDone={(next) => {
          setEditing(false);
          if (next && activeId) void attempt('Rename', () => renameFloorPlan(activeId, next));
        }} />
      ) : (
        <button className="app-crumb" data-testid="plan-name" title="Rename this floor plan" aria-label={`Floor plan: ${name}. Click to rename`}
          onClick={() => setEditing(true)}>
          <span className="app-plan-name">{name}</span>
        </button>
      )}
    </nav>
  );
}

export function Toolbar() {
  const view = useStore((st) => st.ui.view);
  const project = useStore((st) => st.project);
  const canUndo = useStore((st) => st.canUndo);
  const canRedo = useStore((st) => st.canRedo);
  const name = usePlanName();
  const importer = useRoomplanPicker((file) => void attempt('Import', async () => {
    const id = await importFloorPlan(file);
    await openFloorPlan(id);
    say(`Opened ${file.name}`);
  }), 'import-file');

  const exportPng = (kind: '2d' | '3d') => attempt(`${kind.toUpperCase()} export`, async () => {
    const mounted: ViewMode[] = kind === '2d' ? ['plan', 'split'] : ['3d', 'split'];
    if (!mounted.includes(s().ui.view)) {
      s().setUI({ view: kind === '2d' ? 'plan' : '3d' });
      await wait(kind === '2d' ? 300 : 1200); // let the view (and lazy three.js chunk) mount and draw a frame
    }
    const blob = await (kind === '2d' ? exportPlanPng() : exportView3dPng());
    download(blob, fileName(name, kind === '2d' ? '-plan.png' : '-3d.png'));
  });

  return (
    <header className="app-toolbar">
      <div className="app-tb-left">
        <span className="app-mark" aria-hidden><House size={16} /></span>
        <Breadcrumb />
      </div>

      <div className="app-segmented" role="group" aria-label="View">
        {VIEWS.map(([v, label, Icon, key]) => (
          <button key={v} className={`btn${view === v ? ' active' : ''}`} aria-pressed={view === v} title={`${label} view (${key})`}
            aria-label={`${label} view`} data-testid={`view-${v}`} onClick={() => s().setUI({ view: v })}>
            <Icon size={15} /><span className="app-seg-label">{label}</span>
          </button>
        ))}
      </div>

      <div className="app-tb-right">
        <button className="btn ghost icon" title={`Undo (${MOD}+Z)`} aria-label="Undo" data-testid="undo" disabled={!canUndo} onClick={() => s().undo()}><Undo2 size={16} /></button>
        <button className="btn ghost icon" title={`Redo (${MOD}+Shift+Z)`} aria-label="Redo" data-testid="redo" disabled={!canRedo} onClick={() => s().redo()}><Redo2 size={16} /></button>
        <span className="app-tb-sep" aria-hidden />
        <button className="btn ghost app-units" data-testid="units-toggle"
          title={`Units: ${project.units === 'imperial' ? 'feet and inches' : 'metres and centimetres'} (click to switch)`}
          aria-label={`Units: ${project.units}. Switch units`}
          onClick={() => s().setUnits(project.units === 'imperial' ? 'metric' : 'imperial')}>
          {project.units === 'imperial' ? 'ft · in' : 'm · cm'}
        </button>
        <Menu label={<><MenuIcon size={16} /><span className="app-tb-label">File</span></>} title="File: new, import, export" testId="file-menu" className="btn ghost" place="right">
          <MenuItem icon={<Plus size={16} />} label="New floor plan" testId="file-new" onClick={() => void newFloorPlan()} />
          <MenuItem icon={<LayoutGrid size={16} />} label="All floor plans" testId="file-home" onClick={() => void attempt('Closing the plan', closeFloorPlan)} />
          <div className="app-menu-sep" />
          <MenuItem icon={<FolderOpen size={16} />} label="Import .roomplan…" hint="Adds it as a new floor plan" testId="file-import" onClick={importer.pick} />
          <MenuItem icon={<Download size={16} />} label="Export .roomplan" hint="Backup or move to another device" testId="file-export"
            onClick={() => void attempt('Export', async () => download(await exportProject(s().project), fileName(name, PROJECT_FILE_EXTENSION)))} />
          <div className="app-menu-sep" />
          <MenuItem icon={<FileImage size={16} />} label="Export plan as PNG" testId="export-plan-png" onClick={() => void exportPng('2d')} />
          <MenuItem icon={<ImageDown size={16} />} label="Export 3D view as PNG" testId="export-3d-png" onClick={() => void exportPng('3d')} />
        </Menu>
        {importer.element}
        <button className="btn ghost icon" title="Help and keyboard shortcuts (?)" aria-label="Help" data-testid="open-help" onClick={() => s().setUI({ dialog: 'help' })}>
          <CircleQuestionMark size={17} />
        </button>
      </div>
      <Note />
    </header>
  );
}
