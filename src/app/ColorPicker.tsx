import { Pipette, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useStore } from '../store/store';
import { Menu, MenuItem } from './Menu';

/** Calm interior colours: neutrals, woods, then muted accents. */
export const PALETTE: [string, string][] = [
  ['#ffffff', 'White'], ['#ece8e1', 'Linen'], ['#d3cdc3', 'Greige'], ['#a6a198', 'Stone'],
  ['#6c6964', 'Slate'], ['#38393c', 'Charcoal'], ['#dcc39a', 'Light oak'], ['#b4875a', 'Oak'],
  ['#875a38', 'Walnut'], ['#553a28', 'Dark walnut'], ['#c4704f', 'Terracotta'], ['#d3a24a', 'Ochre'],
  ['#97a585', 'Sage'], ['#4d6a55', 'Forest'], ['#8299ad', 'Dusty blue'], ['#2f4659', 'Navy'],
];

/**
 * Field-style swatch button that opens a palette popover: 16 curated colours, a native "Custom…" picker (dragging it is
 * one undo step) and, when `onReset` is given, "Reset to default".
 */
export function ColorPicker(props: {
  label: string; value: string; onChange: (hex: string) => void; onReset?: () => void; testId: string;
  /** The value is the item's own default colour: say "Default" rather than a hex code. */
  isDefault?: boolean;
}) {
  const { label, value, onChange, onReset, testId, isDefault } = props;
  const current = value.toLowerCase();
  const name = isDefault ? 'Default' : PALETTE.find(([hex]) => hex === current)?.[1] ?? value;
  return (
    <div className="field">
      <span>{label}</span>
      <Menu
        label={<><span className="app-chip" style={{ background: value }} aria-hidden /><span className="app-color-name">{name}</span></>}
        title={`${label}: ${name}`} ariaLabel={`${label}: ${name}. Change colour`} testId={testId} className="app-color-btn" place="right"
      >
        <div className="app-palette" role="group" aria-label={`${label} colours`}>
          {PALETTE.map(([hex, n]) => (
            <button key={hex} type="button" role="menuitem" className={`app-palette-swatch${hex === current ? ' active' : ''}`}
              style={{ background: hex }} title={n} aria-label={n} data-color={hex} data-testid={`${testId}-swatch`} onClick={() => onChange(hex)} />
          ))}
        </div>
        <div className="app-menu-sep" />
        <CustomColor label={label} value={value} onChange={onChange} testId={testId} />
        {onReset && <MenuItem icon={<RotateCcw size={16} />} label="Reset to default" testId={`${testId}-reset`} onClick={onReset} />}
      </Menu>
    </div>
  );
}

/** Native colour input: dragging in the OS picker fires many changes; they collapse into one undo step. */
function CustomColor({ label, value, onChange, testId }: { label: string; value: string; onChange: (hex: string) => void; testId: string }) {
  const batching = useRef(false);
  const end = () => {
    if (!batching.current) return;
    batching.current = false;
    useStore.getState().endBatch();
  };
  useEffect(() => end, []); // the popover can close (unmount) without a blur
  return (
    <label className="app-menu-item">
      <Pipette size={16} /><span>Custom…</span>
      <input type="color" className="app-custom-color" value={value} data-testid={`${testId}-custom`} aria-label={`Custom ${label.toLowerCase()}`}
        onChange={(e) => onChange(e.target.value)} onBlur={end}
        onFocus={() => { if (!batching.current) { batching.current = true; useStore.getState().beginBatch(); } }} />
    </label>
  );
}
