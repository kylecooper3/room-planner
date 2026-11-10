import { isFlat } from '../types';
import type { ClearanceZone, FindIssues, Issue, ItemDef, PlacedItem, Polygon } from '../types';
import { clearancePolygon, doorSwingPolygon, itemPolygon, polygonInsideRoom, polygonsIntersect, TOUCH_TOL } from './geometry';

interface Box { x0: number; x1: number; y0: number; y1: number }
const box = (p: Polygon): Box => {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const { x, y } of p) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); }
  return b;
};
const boxesHit = (a: Box, b: Box) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= TOUCH_TOL && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) >= TOUCH_TOL;

interface Solid { item: PlacedItem; def: ItemDef; poly: Polygon; box: Box }
const hits = (poly: Polygon, b: Box, s: Solid) => boxesHit(b, s.box) && polygonsIntersect(poly, s.poly);

export const findIssues: FindIssues = (room, layout, getDef) => {
  const issues: Issue[] = [];
  const all: Solid[] = [];
  for (const item of layout.items) {
    const def = getDef(item.defId);
    if (!def) continue;
    const poly = itemPolygon(item, def.size);
    all.push({ item, def, poly, box: box(poly) });
  }
  const solids = all.filter((s) => !isFlat(s.def));

  for (const s of all) {
    if (!polygonInsideRoom(s.poly, room.points)) {
      issues.push({ id: `outside-room:${s.item.id}`, kind: 'outside-room', itemIds: [s.item.id], message: `${s.def.name} crosses a wall` });
    }
  }

  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i], b = solids[j];
      if (!hits(a.poly, a.box, b)) continue;
      issues.push({
        id: `overlap:${a.item.id}:${b.item.id}`, kind: 'overlap', itemIds: [a.item.id, b.item.id],
        message: `${a.def.name} overlaps ${b.def.name}`,
      });
    }
  }

  for (const owner of solids) {
    const zones = owner.def.clearances.map((z: ClearanceZone) => {
      const poly = clearancePolygon(owner.item, owner.def.size, z);
      return { z, poly, box: box(poly) };
    });
    // one issue per (owner, blocker) pair and one per owner for walls: the first blocked zone is reported
    const blockedBy = new Set<string>();
    let wallReported = false;
    for (const { z, poly, box: zb } of zones) {
      for (const other of solids) {
        if (other === owner || blockedBy.has(other.item.id) || !hits(poly, zb, other)) continue;
        blockedBy.add(other.item.id);
        issues.push({
          id: `clearance-blocked:${owner.item.id}:${other.item.id}`, kind: 'clearance-blocked',
          itemIds: [other.item.id, owner.item.id], message: `${other.def.name} blocks ${owner.def.name}'s ${z.label}`, zone: poly,
        });
      }
      if (!wallReported && z.kind !== 'walkway' && !polygonInsideRoom(poly, room.points)) {
        wallReported = true;
        issues.push({
          id: `clearance-blocked:${owner.item.id}:wall`, kind: 'clearance-blocked', itemIds: [owner.item.id],
          message: `${owner.def.name}'s ${z.label} hits a wall`, zone: poly,
        });
      }
    }
  }

  for (const o of room.openings) {
    if (o.kind !== 'door' || (o.swing?.side ?? 'in') !== 'in') continue;
    const swing = doorSwingPolygon(room.points, o);
    if (!swing) continue;
    const sb = box(swing);
    for (const s of solids) {
      if (!hits(swing, sb, s)) continue;
      issues.push({
        id: `door-swing-blocked:${o.id}:${s.item.id}`, kind: 'door-swing-blocked', itemIds: [s.item.id], openingId: o.id,
        message: `${s.def.name} blocks the door swing`, zone: swing,
      });
    }
  }
  return issues;
};
