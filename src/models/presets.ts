import { WALKWAY_CM } from '../types';
import type { Category, ClearanceZone, DefaultClearances, DefaultColors, ItemDef, Material, PartColors, Size3, StyleParams } from '../types';
import { defaultStyle } from './generate';

const COLORS: Record<Category, PartColors> = {
  sofa: { body: '#7fa3a0', cushion: '#a9c8c0', frame: '#6b4f3a', accent: '#f2c57c' },
  armchair: { body: '#d98c5f', cushion: '#efb995', frame: '#6b4f3a', accent: '#f6e3b4' },
  chair: { body: '#c69c6d', cushion: '#e7cfa6', frame: '#8b6b4a', accent: '#4a4a4a' },
  bed: { body: '#8fa9c7', cushion: '#f6f1e7', frame: '#a0785a', accent: '#ffffff' },
  table: { body: '#c49a6c', cushion: '#e8d5b5', frame: '#8b6b4a', accent: '#f4a261' },
  desk: { body: '#d8b48a', cushion: '#efe3cf', frame: '#7d5f45', accent: '#4a4a4a' },
  dresser: { body: '#b98b5e', cushion: '#efe3cf', frame: '#ecdfc8', accent: '#5a4636' },
  shelf: { body: '#d2ae84', cushion: '#efe3cf', frame: '#8b6b4a', accent: '#e76f51' },
  nightstand: { body: '#b98b5e', cushion: '#efe3cf', frame: '#ecdfc8', accent: '#5a4636' },
  lamp: { body: '#e9c46a', cushion: '#fff1d0', frame: '#5c5c5c', accent: '#fff1d0' },
  rug: { body: '#e9c9a8', cushion: '#f3e1cc', frame: '#c0694e', accent: '#c0694e' },
  plant: { body: '#d67a52', cushion: '#6aa864', frame: '#5a3e2b', accent: '#8cc97a' },
  tv: { body: '#2f3136', cushion: '#44474e', frame: '#8a6f4d', accent: '#5b6170' },
  box: { body: '#c9b79c', cushion: '#e3d6c2', frame: '#8b6b4a', accent: '#f4a261' },
};

export const defaultColors: DefaultColors = (category) => ({ ...(COLORS[category] ?? COLORS.box) });

export const defaultClearances: DefaultClearances = (category, _size, units) => {
  // Never put a zone where another item normally sits (beside a bed, in front of a sofa, at a desk/table).
  switch (category) {
    case 'dresser': return [{ kind: 'drawer', side: 'front', depth: 50, label: 'drawer pull-out' }];
    case 'nightstand': return [{ kind: 'drawer', side: 'front', depth: 30, label: 'drawer pull-out' }];
    case 'chair': return [{ kind: 'chair', side: 'back', depth: 45, label: 'chair push-back' }];
    case 'bed': return [{ kind: 'walkway', side: 'front', depth: WALKWAY_CM[units], label: 'walkway' }];
    case 'shelf': return [{ kind: 'access', side: 'front', depth: 60, label: 'access space' }];
    default: return [];
  }
};

const IN = 2.54;
const preset = (id: string, name: string, category: Category, size: Size3, style: StyleParams = {}, opts: {
  colors?: Partial<PartColors>; material?: Material; clearances?: ClearanceZone[];
} = {}): ItemDef => ({
  id: `preset-${id}`,
  name,
  size,
  model: {
    kind: 'parametric', category, style: { ...defaultStyle(category), ...style },
    colors: { ...defaultColors(category), ...opts.colors }, material: opts.material ?? 'fabric',
  },
  clearances: opts.clearances ?? defaultClearances(category, size, 'imperial'),
  source: 'preset',
});

/** ~25 built-in items. Ids are stable and prefixed 'preset-'. Beds use mattress width x length. */
export const PRESETS: ItemDef[] = [
  preset('bed-twin', 'Twin bed', 'bed', { w: 38 * IN, d: 75 * IN, h: 95 }, { pillowCount: 1, headboardStyle: 'slatted' }, { material: 'wood' }),
  preset('bed-full', 'Full bed', 'bed', { w: 54 * IN, d: 75 * IN, h: 100 }, { pillowCount: 2 }, { colors: { body: '#c7a6c9' } }),
  preset('bed-queen', 'Queen bed', 'bed', { w: 152.4, d: 203.2, h: 110 }, { headboardStyle: 'tufted', pillowCount: 2 },
    { colors: { body: '#a7b8d6', frame: '#c9b7a3' } }),
  preset('bed-king', 'King bed', 'bed', { w: 76 * IN, d: 80 * IN, h: 115 }, { headboardStyle: 'tufted', pillowCount: 3, footboard: true },
    { colors: { body: '#d2b48c', frame: '#8a6a4f' } }),
  preset('sofa-3seat', '3-seat sofa', 'sofa', { w: 213, d: 91, h: 85 }, { cushionCount: 3 }),
  preset('loveseat', 'Loveseat', 'sofa', { w: 152, d: 89, h: 85 }, { cushionCount: 2, armStyle: 'square', legType: 'block' },
    { colors: { body: '#e0a96d', cushion: '#f1c99a' } }),
  preset('armchair', 'Armchair', 'armchair', { w: 84, d: 86, h: 84 }, {}),
  preset('desk', 'Desk', 'desk', { w: 140, d: 70, h: 75 }, { drawerSide: 'right' }, { material: 'wood' }),
  preset('office-chair', 'Office chair', 'chair', { w: 64, d: 64, h: 105 }, { base: 'swivel', arms: true, backStyle: 'solid', seatHeight: 0.45 },
    { colors: { body: '#3f4a5a', cushion: '#56657a', frame: '#2b2b2b' }, material: 'plastic' }),
  preset('dresser', 'Dresser', 'dresser', { w: 150, d: 50, h: 80 }, { drawerRows: 3, drawerCols: 2 }, { material: 'wood' }),
  preset('nightstand', 'Nightstand', 'nightstand', { w: 50, d: 40, h: 58 }, { drawerCount: 2 }, { material: 'wood' }),
  preset('bookshelf', 'Bookshelf', 'shelf', { w: 80, d: 30, h: 180 }, { shelfCount: 4 }, { material: 'wood' }),
  preset('tv-stand', 'TV stand', 'dresser', { w: 160, d: 45, h: 55 }, { drawerRows: 1, drawerCols: 3, legHeight: 10, handleStyle: 'bar' },
    { material: 'wood', colors: { body: '#8a6a4f', frame: '#d9c4a5' } }),
  preset('dining-table', 'Dining table', 'table', { w: 160, d: 90, h: 75 }, { legType: 'four' }, { material: 'wood' }),
  preset('dining-chair', 'Dining chair', 'chair', { w: 45, d: 52, h: 90 }, { backStyle: 'slatted', seatHeight: 0.5 }, { material: 'wood' }),
  preset('coffee-table', 'Coffee table', 'table', { w: 110, d: 60, h: 45 }, { legType: 'trestle', topThickness: 5 },
    { material: 'wood', colors: { body: '#a87b51' } }),
  preset('side-table', 'Side table', 'table', { w: 50, d: 50, h: 55 }, { topShape: 'round', legType: 'pedestal' },
    { material: 'wood', colors: { body: '#e3c9a0' } }),
  preset('rug-small', 'Rug 5×8 ft', 'rug', { w: 5 * 30.48, d: 8 * 30.48, h: 1 }, {}),
  preset('rug-large', 'Rug 8×10 ft', 'rug', { w: 8 * 30.48, d: 10 * 30.48, h: 1.2 }, { border: false },
    { colors: { body: '#b9cbb0' } }),
  preset('floor-lamp', 'Floor lamp', 'lamp', { w: 45, d: 45, h: 160 }, { lampType: 'floor', shadeShape: 'drum' }, { material: 'metal' }),
  preset('table-lamp', 'Table lamp', 'lamp', { w: 30, d: 30, h: 50 }, { lampType: 'table', shadeShape: 'cone' }),
  preset('plant-floor', 'Floor plant', 'plant', { w: 55, d: 55, h: 150 }, { foliage: 'tall', potShape: 'cylinder' }, { material: 'plastic' }),
  preset('plant-small', 'Small plant', 'plant', { w: 25, d: 25, h: 40 }, { foliage: 'bushy', potShape: 'tapered' }, { material: 'plastic' }),
  preset('wardrobe', 'Wardrobe', 'dresser', { w: 100, d: 60, h: 200 }, { drawerRows: 1, drawerCols: 2, legHeight: 5, handleStyle: 'bar' },
    { material: 'wood', clearances: [{ kind: 'drawer', side: 'front', depth: 55, label: 'door swing space' }] }),
  preset('tv', 'TV 55"', 'tv', { w: 123, d: 27, h: 76 }, { mount: 'stand' }, { material: 'plastic' }),
];
