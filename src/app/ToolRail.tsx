import { Eye, Footprints, Grid3x3, ImageUp, Magnet, MousePointer2, PenTool, Scissors, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from '../store/store';
import type { UIState, ViewMode } from '../types';
import { Menu, MenuItem } from './Menu';

type Toggle = 'showGrid' | 'snap' | 'showClearances' | 'cutaway' | 'walkMode';
const s = () => useStore.getState();

function RailButton(props: { active?: boolean; label: string; title: string; icon: ReactNode; testId: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      className={`app-rail-btn${props.active ? ' active' : ''}`} aria-pressed={props.active} title={props.title} aria-label={props.label}
      data-testid={props.testId} disabled={props.disabled} onClick={props.onClick}
    >
      {props.icon}<span aria-hidden>{props.label}</span>
    </button>
  );
}

/** Editing tools and display options, docked on the left edge of the canvas. Doors, windows and fixtures live in the library. */
export function ToolRail() {
  const ui = useStore((st) => st.ui);
  const planOrSplit: ViewMode = ui.view === 'split' ? 'split' : 'plan';
  const set = (patch: Partial<UIState>) => s().setUI(patch);
  const toggle = (key: Toggle, label: string, icon: ReactNode, testId: string, kbd?: string) => (
    <MenuItem icon={icon} label={label} kbd={kbd} checked={ui[key]} testId={testId} onClick={() => set({ [key]: !s().ui[key] })} />
  );

  return (
    <div className="app-rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      <RailButton active={ui.tool === 'select'} label="Select" title="Select and move (V)" icon={<MousePointer2 size={19} />} testId="tool-select" onClick={() => set({ tool: 'select' })} />
      <RailButton active={ui.tool === 'draw-room'} label="Draw room" title="Draw a new room: click its corners"
        icon={<PenTool size={19} />} testId="tool-draw-room" onClick={() => set({ tool: 'draw-room', view: planOrSplit })} />
      <div className="app-rail-sep" />
      <RailButton active={ui.dialog === 'floorplan'} label="Trace plan" title="Trace rooms over a floor-plan image" icon={<ImageUp size={19} />}
        testId="open-floorplan" onClick={() => set({ dialog: ui.dialog === 'floorplan' ? 'none' : 'floorplan', view: planOrSplit })} />
      <div className="app-rail-spacer" />
      <Menu
        label={<><Eye size={19} /><span aria-hidden>Display</span></>} title="Display options: grid, snapping, clearances…"
        ariaLabel="Display options" testId="display-menu" className="app-rail-btn" place="side"
      >
        <div className="app-menu-title">Plan</div>
        {toggle('showGrid', 'Grid', <Grid3x3 size={16} />, 'toggle-grid', 'G')}
        {toggle('snap', 'Snapping', <Magnet size={16} />, 'toggle-snap', 'S')}
        {toggle('showClearances', 'Clearance zones', <ShieldCheck size={16} />, 'toggle-clearances', 'C')}
        <div className="app-menu-title">3D</div>
        {toggle('cutaway', 'Cut away walls', <Scissors size={16} />, 'toggle-cutaway')}
        {ui.view === '3d' && toggle('walkMode', 'Walk mode', <Footprints size={16} />, 'toggle-walk')}
      </Menu>
    </div>
  );
}
