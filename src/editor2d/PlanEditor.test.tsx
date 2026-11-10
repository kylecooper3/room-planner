import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { Issue, ItemDef, Layout, Room } from '../types';

const room: Room = {
  id: 'r1', name: 'Bedroom', ceilingHeight: 250, wallThickness: 12, wallColor: '#ffffff', floor: 'wood',
  points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }],
  openings: [{ id: 'o1', kind: 'door', wall: 0, offset: 100, width: 81, height: 203, sill: 0, swing: { hinge: 'start', side: 'in' } }],
  layouts: [], activeLayoutId: 'l1',
};
const layout: Layout = { id: 'l1', name: 'A', items: [
  { id: 'i1', defId: 'preset-bed-queen', x: 200, y: 150, rotation: 0 },
  { id: 'i2', defId: 'missing-def', x: 50, y: 50, rotation: 0 },
] };
const bed: ItemDef = {
  id: 'preset-bed-queen', name: 'Queen bed', size: { w: 152, d: 203, h: 60 }, source: 'preset', clearances: [],
  model: { kind: 'parametric', category: 'bed', style: {}, material: 'fabric', colors: { body: '#aabbcc', cushion: '#fff', frame: '#000', accent: '#f00' } },
};
const issues: Issue[] = [{ id: 'x', kind: 'door-swing-blocked', itemIds: ['i1'], openingId: 'o1', message: 'Bed blocks the door swing' }];

vi.mock('../store/selectors', () => ({
  useActiveRoom: () => room,
  useLayout: () => layout,
  useGetDef: () => (id: string) => (id === bed.id ? bed : undefined),
  useIssues: () => issues,
}));
vi.mock('../floorplan/UnderlayLayer', () => ({ UnderlayLayer: () => null }));
vi.mock('../floorplan/CalibrateTool', () => ({ CalibrateTool: () => null }));
vi.mock('../core/units', () => ({ formatLength: (cm: number) => `${Math.round(cm)} cm`, formatArea: (cm2: number) => `${(cm2 / 1e4).toFixed(1)} m²` }));
vi.mock('../core/geometry', () => ({
  getOpeningGeometry: (points: { x: number; y: number }[], o: { wall: number; offset: number; width: number }) => {
    const a = points[o.wall], b = points[(o.wall + 1) % points.length];
    const l = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / l, uy = (b.y - a.y) / l;
    const at = (s: number) => ({ x: a.x + ux * s, y: a.y + uy * s });
    return { a: at(o.offset - o.width / 2), b: at(o.offset + o.width / 2), center: at(o.offset), angle: 0, normalIn: { x: -uy, y: ux } };
  },
  doorSwingPolygon: () => null,
  polygonCentroid: (p: { x: number; y: number }[]) => ({ x: p.reduce((a, q) => a + q.x, 0) / p.length, y: p.reduce((a, q) => a + q.y, 0) / p.length }),
  polygonArea: () => 120000,
  clearancePolygon: () => [],
  projectOnWalls: () => ({ wall: 0, offset: 0, distance: 0, point: { x: 0, y: 0 } }),
  snapRightAngle: (_a: unknown, p: unknown) => p,
  distancesToWalls: () => [],
  snapItem: ({ pose }: { pose: { x: number; y: number } }) => ({ x: pose.x, y: pose.y, guides: [] }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { PlanEditor } = await import('./PlanEditor');
const { useStore } = await import('../store/store');

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });

describe('PlanEditor', () => {
  it('renders walls, an opening and items with issue flags; skips missing defs', () => {
    const select = vi.fn();
    useStore.setState({ select, beginBatch: vi.fn(), endBatch: vi.fn(), updateItem: vi.fn() });
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(<PlanEditor />); });

    expect(host.querySelector('[data-testid="plan-svg"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="plan-wall"]')).toHaveLength(4);
    expect(host.querySelector('[data-testid="plan-opening"]')?.getAttribute('data-opening-id')).toBe('o1');
    const items = host.querySelectorAll('[data-testid="plan-item"]');
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute('data-issue')).toBe('true');
    expect(items[0].querySelector('title')?.textContent).toBe('Bed blocks the door swing');
    expect(host.querySelectorAll('[data-testid="plan-corner"]')).toHaveLength(4);
    expect(host.textContent).toContain('400 cm');

    // selecting the item shows the issue callout and the rotate handle
    const rect = items[0].querySelector('rect')!;
    act(() => { rect.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
    expect(select).toHaveBeenCalledWith({ type: 'item', id: 'i1' });
    act(() => { useStore.setState({ ui: { ...useStore.getState().ui, selection: { type: 'item', id: 'i1' } } }); });
    expect(host.querySelector('[data-testid="issue-callout"]')?.textContent).toContain('Bed blocks the door swing');
    expect(host.querySelector('[data-testid="rotate-handle"]')).not.toBeNull();
  });

  it('shows other rooms dimmed with their name; clicking one activates it; clicking a wall selects it', () => {
    const neighbour: Room = { ...room, id: 'r2', name: 'Kitchen', points: room.points.map((p) => ({ x: p.x + 500, y: p.y })), openings: [] };
    const setActiveRoom = vi.fn(), select = vi.fn();
    useStore.setState({
      select, setActiveRoom,
      project: { ...useStore.getState().project, rooms: [room, neighbour], activeRoomId: 'r1' },
      ui: { ...useStore.getState().ui, selection: null, tool: 'select' },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(<PlanEditor />); });
    const other = host.querySelector('[data-testid="plan-other-room"]')!;
    expect(other.getAttribute('data-other-room')).toBe('r2');
    expect(host.querySelectorAll('[data-testid="plan-wall"]')).toHaveLength(4); // only the active room's walls are editable
    const labels = [...host.querySelectorAll('[data-testid="plan-room-label"]')].map((l) => l.textContent);
    expect(labels).toEqual(expect.arrayContaining([expect.stringContaining('Kitchen'), expect.stringContaining('Bedroom')]));
    act(() => { other.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
    expect(setActiveRoom).toHaveBeenCalledWith('r2');
    const wall = host.querySelectorAll('[data-testid="plan-wall"] polygon')[2];
    act(() => { wall.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
    expect(select).toHaveBeenCalledWith({ type: 'wall', index: 2 });
    act(() => { useStore.setState({ ui: { ...useStore.getState().ui, selection: { type: 'wall', index: 2 } } }); });
    expect(host.querySelector('[data-testid="plan-wall"][data-selected="true"]')?.getAttribute('data-wall')).toBe('2');
  });

  it('draw tool shows the hint bar and mini-toolbar', () => {
    useStore.setState({ ui: { ...useStore.getState().ui, tool: 'draw-room' } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(<PlanEditor />); });
    expect(host.querySelector('[data-testid="draw-hint"]')?.textContent).toContain('Click the first corner');
    expect((host.querySelector('[data-testid="draw-finish"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => { useStore.setState({ ui: { ...useStore.getState().ui, tool: 'select' } }); });
  });

  it('read-only mode hides editing handles', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(<PlanEditor readOnly />); });
    expect(host.querySelector('[data-testid="plan-corner"]')).toBeNull();
    expect(host.querySelector('[data-testid="plan-svg"]')?.getAttribute('data-readonly')).toBe('true');
  });
});
