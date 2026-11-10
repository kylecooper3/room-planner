import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ItemDef } from '../types';

vi.mock('@react-three/fiber', () => ({ Canvas: () => null, useThree: () => null }));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }));
vi.mock('../models/ItemModelView', () => ({ ItemModelView: () => null }));
vi.mock('../models/generate', () => ({
  STYLE_SCHEMA: new Proxy({}, { get: (_t, k) => (k === 'sofa' ? [{ key: 'arms', label: 'Arms', type: 'boolean', default: true }] : []) }),
  defaultStyle: (c: string) => (c === 'sofa' ? { arms: true } : {}),
}));
vi.mock('../models/presets', () => ({
  defaultColors: () => ({ body: '#b8b8b8', cushion: '#d0d0d0', frame: '#8a6f4d', accent: '#f4a261' }),
  defaultClearances: () => [],
}));
vi.mock('../core/units', () => ({
  parseLength: (t: string) => (Number(t) > 0 ? Number(t) * 2.54 : null),
  formatLength: (cm: number) => String(cm / 2.54),
}));
const { saved, setUI } = vi.hoisted(() => ({ saved: [] as ItemDef[], setUI: vi.fn() }));
vi.mock('../store/store', async () => {
  const { create } = await import('zustand');
  const useStore = create(() => ({
    project: { units: 'imperial', library: [] as ItemDef[] },
    ui: { editingDefId: null as string | null },
    saveDef: (d: ItemDef) => saved.push(d),
    setUI,
  }));
  return { useStore };
});
vi.mock('../store/blobs', () => ({ putBlob: async () => 'blob-1', useBlobUrl: () => undefined }));

import { ItemCreator } from './ItemCreator';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

describe('ItemCreator', () => {
  it('skip photo → edit → save', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(<ItemCreator />));
    const q = <T extends Element>(id: string) => div.querySelector<T>(`[data-testid="${id}"]`)!;
    await act(async () => {
      setValue(q<HTMLInputElement>('item-name'), 'Couch');
      setValue(q<HTMLInputElement>('dim-w'), '84');
      setValue(q<HTMLInputElement>('dim-d'), '36');
      setValue(q<HTMLInputElement>('dim-h'), '34');
    });
    expect(q<HTMLButtonElement>('analyze-btn').disabled).toBe(true); // no photo yet
    await act(async () => [...div.querySelectorAll('button')].find((b) => b.textContent === 'Skip photo')!.click());
    await act(async () => setValue(q<HTMLSelectElement>('category-select'), 'sofa'));
    expect(div.textContent).toContain('Arms');
    await act(async () => setValue(q<HTMLInputElement>('color-body'), '#336699'));
    await act(async () => q<HTMLButtonElement>('save-item').click());
    expect(saved[0]).toMatchObject({
      name: 'Couch', source: 'user', size: { w: 84 * 2.54, d: 36 * 2.54, h: 34 * 2.54 },
      model: { kind: 'parametric', category: 'sofa', style: { arms: true }, material: 'fabric' },
    });
    expect(saved[0].model.kind === 'parametric' && saved[0].model.colors.body).toBe('#336699');
    expect(setUI).toHaveBeenCalledWith({ dialog: 'none', editingDefId: null });
    act(() => root.unmount());
  });
});
