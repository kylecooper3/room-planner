import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('../editor2d/PlanEditor', () => ({ PlanEditor: () => <div data-testid="plan-svg" /> }));
vi.mock('../view3d/View3D', () => ({ View3D: () => <div data-testid="view3d" /> }));
vi.mock('../floorplan/TracePanel', () => ({ TracePanel: () => <div data-testid="floorplan-panel" />, PickImage: () => null }));
vi.mock('../photo/ItemCreator', () => ({ ItemCreator: () => null }));
vi.mock('../editor2d/exportPng', () => ({ exportPlanPng: vi.fn() }));
vi.mock('../view3d/exportPng', () => ({ exportView3dPng: vi.fn() }));

const { App } = await import('./App');
const { useStore } = await import('../store/store');
const { useFloorPlans } = await import('../store/floorPlans');
const PLAN = { id: 'p1', name: 'Home', createdAt: 0, updatedAt: Date.now(), roomCount: 0, areaCm2: 0, thumbnailSvg: '' };
useFloorPlans.setState({ ready: true, activeId: 'p1', plans: [PLAN] });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
afterEach(() => container?.remove());

async function render() {
  container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  await act(async () => root.render(<App />));
  return root;
}
const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

test('shows the splash until hydrated', async () => {
  useStore.setState({ hydrated: false });
  await render();
  expect(q('splash')).not.toBeNull();
});

test('no open plan shows the floor-plan library; first launch shows the empty state', async () => {
  useStore.setState({ hydrated: true });
  useFloorPlans.setState({ activeId: null, plans: [] });
  await render();
  for (const id of ['home', 'home-empty', 'home-demo', 'home-start-dimensions', 'home-import']) expect(q(id), id).not.toBeNull();
  expect(q('app')).toBeNull();
  container.remove();
  useFloorPlans.setState({ plans: [PLAN, { ...PLAN, id: 'p2', name: 'Flat', roomCount: 3, areaCm2: 500000 }] });
  await render();
  expect(container.querySelectorAll('[data-testid=plan-card]').length).toBe(2);
  expect(container.textContent).toContain('3 rooms');
  useFloorPlans.setState({ activeId: 'p1', plans: [PLAN] });
});

test('welcome state offers the three starts and the demo', async () => {
  const setUI = vi.fn();
  const loadDemo = vi.fn();
  useStore.setState({ hydrated: true, setUI, loadDemo });
  await render();
  for (const id of ['start-dimensions', 'start-draw', 'start-floorplan', 'load-demo', 'plan-svg', 'units-toggle', 'tab-my-stuff']) {
    expect(q(id), id).not.toBeNull();
  }
  await act(async () => q('start-dimensions')!.click());
  expect(setUI).toHaveBeenCalledWith({ dialog: 'room-setup' });
  await act(async () => q('start-draw')!.click());
  expect(setUI).toHaveBeenCalledWith({ tool: 'draw-room', view: 'plan' });
  await act(async () => q('load-demo')!.click());
  expect(loadDemo).toHaveBeenCalled();
  expect((q('undo') as HTMLButtonElement).disabled).toBe(true);
});

test('welcome card hides while drawing a room', async () => {
  useStore.setState({ hydrated: true, ui: { ...useStore.getState().ui, tool: 'draw-room' } });
  await render();
  expect(q('welcome')).toBeNull();
});

test('Import a floor plan opens the docked tracing panel with a drop zone, not a modal', async () => {
  useStore.setState({ hydrated: true, setUI: useStore.getInitialState().setUI, ui: { ...useStore.getState().ui, tool: 'select', dialog: 'none' } });
  await render();
  await act(async () => q('start-floorplan')!.click());
  expect(useStore.getState().ui.dialog).toBe('floorplan');
  expect(q('floorplan-panel')).not.toBeNull();
  expect(q('floorplan-dropzone')).not.toBeNull();
  expect(q('welcome')).toBeNull();
  expect(container.querySelector('.dialog-backdrop')).toBeNull();
});
