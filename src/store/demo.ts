import type { PlacedItem, Project, Size3 } from '../types';
import { rectRoomPoints } from '../core/geometry';
import { PRESETS } from '../models/presets';

const W = 304.8;   // 10 ft (x)
const L = 365.76;  // 12 ft (y)
const GAP = 2;
const DOOR_W = 81;

const sizeOf = (id: string, fallback: Size3): Size3 => PRESETS.find((d) => d.id === id)?.size ?? fallback;

/**
 * 10×12 ft bedroom. Walls: 0 top, 1 right, 2 bottom, 3 left.
 * Bed head on the top wall with nightstands, dresser on the bottom wall (facing up) just right of the door swing,
 * plant in the bottom-right corner, door on the left wall near the bottom-left corner, window + radiator on the right wall.
 */
export const buildDemoProject = (): Project => {
  const uid = () => crypto.randomUUID();
  const bed = sizeOf('preset-bed-queen', { w: 152.4, d: 203.2, h: 60 });
  const ns = sizeOf('preset-nightstand', { w: 50, d: 40, h: 60 });
  const dresser = sizeOf('preset-dresser', { w: 150, d: 50, h: 80 });
  const plant = sizeOf('preset-plant-floor', { w: 40, d: 40, h: 120 });
  const large = sizeOf('preset-rug-large', { w: 243.8, d: 304.8, h: 1 });
  const rugId = large.w <= W - 20 && large.d <= L - 20 ? 'preset-rug-large' : 'preset-rug-small';

  const item = (defId: string, x: number, y: number, rotation = 0): PlacedItem => ({ id: uid(), defId, x, y, rotation });
  const items: PlacedItem[] = [
    item(rugId, W / 2, L / 2),
    item('preset-nightstand', GAP + ns.w / 2, GAP + ns.d / 2),
    item('preset-bed-queen', GAP + ns.w + GAP + bed.w / 2, bed.d / 2),
    item('preset-nightstand', GAP + ns.w + 2 * GAP + bed.w + ns.w / 2, GAP + ns.d / 2),
    item('preset-plant-floor', W - GAP - plant.w / 2, L - GAP - plant.d / 2),
    // Starts just past the door swing (radius = door width from the left wall). Rotation 180: drawers face into the room.
    item('preset-dresser', DOOR_W + 5 + dresser.w / 2, L - dresser.d / 2, 180),
  ];

  const layoutId = uid(), roomId = uid();
  return {
    version: 1,
    name: 'Demo bedroom',
    units: 'imperial',
    activeRoomId: roomId,
    library: [],
    underlay: null,
    rooms: [{
      id: roomId,
      name: 'Bedroom',
      points: rectRoomPoints(W, L),
      ceilingHeight: 243.84,
      wallThickness: 12,
      wallColor: '#f2f0ec',
      floor: 'wood',
      openings: [
        // Wall 3 runs from (0,L) up to (0,0): offset 10 + half width puts the door 10 cm from the bottom-left corner.
        { id: uid(), kind: 'door', wall: 3, offset: 10 + DOOR_W / 2, width: DOOR_W, height: 203, sill: 0, swing: { hinge: 'start', side: 'in' } },
        { id: uid(), kind: 'window', wall: 1, offset: L / 2, width: 120, height: 120, sill: 90 },
        { id: uid(), kind: 'radiator', wall: 1, offset: L / 2, width: 100, height: 60, sill: 10 },
        { id: uid(), kind: 'outlet', wall: 0, offset: GAP + ns.w + GAP + bed.w + 20, width: 8, height: 12, sill: 30 },
      ],
      layouts: [{ id: layoutId, name: 'Layout 1', items }],
      activeLayoutId: layoutId,
    }],
  };
};
