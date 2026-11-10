import { expect, test, vi } from 'vitest';

vi.mock('../core/geometry', () => ({
  rectRoomPoints: (w: number, l: number) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: l }, { x: 0, y: l }],
}));
vi.mock('../models/presets', () => ({ PRESETS: [] }));

import { buildDemoProject } from './demo';

test('demo bedroom has the listed openings and items, footprints inside and non-overlapping', () => {
  const p = buildDemoProject();
  expect(p.units).toBe('imperial');
  const room = p.rooms[0];
  expect(room.name).toBe('Bedroom');
  expect(room.openings.map((o) => o.kind).sort()).toEqual(['door', 'outlet', 'radiator', 'window']);
  expect(room.openings.find((o) => o.kind === 'door')).toMatchObject({ width: 81, height: 203, sill: 0, swing: { hinge: 'start', side: 'in' } });
  const items = room.layouts[0].items;
  expect(room.layouts[0].name).toBe('Layout 1');
  expect(items.map((i) => i.defId).sort()).toEqual([
    'preset-bed-queen', 'preset-dresser', 'preset-nightstand', 'preset-nightstand', 'preset-plant-floor', 'preset-rug-large',
  ]);
  for (const i of items) {
    expect(i.x).toBeGreaterThan(0); expect(i.x).toBeLessThan(304.8);
    expect(i.y).toBeGreaterThan(0); expect(i.y).toBeLessThan(365.76);
  }
  // Fallback sizes (presets mocked empty): axis-aligned footprints of solid items must not overlap.
  const size: Record<string, [number, number]> = {
    'preset-bed-queen': [152.4, 203.2], 'preset-nightstand': [50, 40], 'preset-dresser': [150, 50], 'preset-plant-floor': [40, 40],
  };
  const boxes = items.filter((i) => size[i.defId]).map((i) => {
    const [w, d] = size[i.defId];
    return { x0: i.x - w / 2, x1: i.x + w / 2, y0: i.y - d / 2, y1: i.y + d / 2 };
  });
  for (const b of boxes) {
    expect(b.x0).toBeGreaterThanOrEqual(0); expect(b.x1).toBeLessThanOrEqual(304.8);
    expect(b.y0).toBeGreaterThanOrEqual(0); expect(b.y1).toBeLessThanOrEqual(365.76);
  }
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) =>
    expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true)));
  const bed = items.find((i) => i.defId === 'preset-bed-queen')!;
  expect(bed).toMatchObject({ rotation: 0, y: 203.2 / 2 });
});
