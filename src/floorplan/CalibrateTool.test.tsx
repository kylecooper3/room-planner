import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Underlay } from '../types';

const state = vi.hoisted(() => ({
  project: { units: 'metric', underlay: null as Underlay | null },
  setUI: vi.fn(),
  updateUnderlay: vi.fn(),
}));
vi.mock('../store/store', () => ({
  useStore: <T,>(sel: (s: typeof state) => T) => sel(state),
}));
vi.mock('../core/units', () => ({
  formatLength: (cm: number) => `${Math.round(cm)} cm`,
  parseLength: (t: string) => (/^\d+(\.\d+)?$/.test(t.trim()) ? Number(t) * 100 : null),
}));
vi.mock('../editor2d/planContext', () => ({
  usePlanView: () => ({ toPlan: (e: { clientX: number; clientY: number }) => ({ x: e.clientX, y: e.clientY }), pxPerCm: 1 }),
}));

import { CalibrateTool } from './CalibrateTool';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLElement;
function render() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<svg><CalibrateTool /></svg>));
}
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

const fire = (el: Element, type: string, x: number, y: number) =>
  act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })); });
const typeInto = (input: HTMLInputElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;

describe('CalibrateTool', () => {
  it('two clicks + distance rescales the underlay and returns to select', () => {
    state.project.underlay = { imageId: 'i', widthPx: 100, heightPx: 100, cmPerPx: 1, x: 0, y: 0, opacity: 1, visible: true };
    render();
    const rect = host.querySelector('rect')!;
    fire(rect, 'pointerdown', 0, 0);
    fire(rect, 'pointerdown', 100, 0);
    typeInto(q('calibrate-distance'), 'abc');
    act(() => q('calibrate-apply').click());
    expect(document.querySelector('.note.error')).not.toBeNull();
    expect(state.updateUnderlay).not.toHaveBeenCalled();
    typeInto(q('calibrate-distance'), '5');
    act(() => q('calibrate-apply').click());
    expect(state.updateUnderlay).toHaveBeenCalledWith(expect.objectContaining({ cmPerPx: 5, x: 0, y: 0 }));
    expect(state.setUI).toHaveBeenCalledWith({ tool: 'select' });
  });

  it('Esc cancels', () => {
    render();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(state.setUI).toHaveBeenCalledWith({ tool: 'select' });
  });
});
