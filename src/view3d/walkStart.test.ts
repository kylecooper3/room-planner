import { describe, expect, it } from 'vitest';
import type { Opening } from '../types';
import { walkStart } from './sceneMath';
import { itemPolygon, pointInPolygon } from '../core/geometry';

const points = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
const door: Opening = { id: 'd', kind: 'door', wall: 0, offset: 100, width: 80, height: 200, sill: 0, swing: { hinge: 'start', side: 'in' } };
const bed = { item: { id: 'b', defId: 'x', x: 200, y: 150, rotation: 0 }, size: { w: 160, d: 200, h: 60 } };

describe('walkStart', () => {
  it('starts just inside an inward door, facing the room centre', () => {
    const { pos, yaw } = walkStart({ points, openings: [door] }, []);
    expect(pos).toEqual({ x: 100, y: 60 });
    // Forward (-sin, -cos) points towards the centroid (200, 150).
    const f = { x: -Math.sin(yaw), y: -Math.cos(yaw) };
    expect(f.x * 100 + f.y * 90).toBeGreaterThan(0.99 * Math.hypot(100, 90));
  });
  it('steps further in when furniture crowds the spot just inside the door', () => {
    const chest = { item: { id: 'c', defId: 'x', x: 140, y: 25, rotation: 0 }, size: { w: 60, d: 50, h: 80 } };
    expect(walkStart({ points, openings: [door] }, [chest]).pos).toEqual({ x: 100, y: 90 });
  });
  it('without a door, faces the room centre from the freest spot', () => {
    const { pos, yaw } = walkStart({ points, openings: [] }, []);
    const c = { x: 200 - pos.x, y: 150 - pos.y }, f = { x: -Math.sin(yaw), y: -Math.cos(yaw) };
    if (Math.hypot(c.x, c.y) > 1) expect(f.x * c.x + f.y * c.y).toBeGreaterThan(0.99 * Math.hypot(c.x, c.y));
  });
  it('avoids furniture: falls back to the freest spot when the door is blocked', () => {
    const blocker = { item: { id: 'c', defId: 'x', x: 100, y: 60, rotation: 0 }, size: { w: 100, d: 100, h: 80 } };
    const { pos } = walkStart({ points, openings: [door] }, [bed, blocker]);
    for (const s of [bed, blocker]) expect(pointInPolygon(pos, itemPolygon(s.item, s.size))).toBe(false);
    expect(pointInPolygon(pos, points)).toBe(true);
  });
  it('without doors, never starts inside a centred bed', () => {
    const { pos } = walkStart({ points, openings: [] }, [bed]);
    expect(pointInPolygon(pos, itemPolygon(bed.item, bed.size))).toBe(false);
  });
});
