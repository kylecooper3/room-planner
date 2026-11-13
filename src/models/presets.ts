import { WALKWAY_CM } from '../types';
import type { Category, ClearanceZone, DefaultClearances, DefaultColors, ItemDef, Material, PartColors, Size3, StyleParams } from '../types';
import { defaultStyle } from './generate';

// Muted, natural finishes: linen, oak, walnut, charcoal, stone. body/cushion/frame/accent per generator roles.
const COLORS: Record<Category, PartColors> = {
  sofa: { body: '#9c968d', cushion: '#a7a197', frame: '#4b3a2d', accent: '#d9d1c4' },
  armchair: { body: '#b09a80', cushion: '#bba68c', frame: '#4b3a2d', accent: '#e2d8c8' },
  chair: { body: '#b48d64', cushion: '#bd986f', frame: '#a37e57', accent: '#2c2c2e' },
  bed: { body: '#8d98a3', cushion: '#f2efe9', frame: '#b8956c', accent: '#f8f6f2' },
  table: { body: '#a98058', cushion: '#e2d6c4', frame: '#8a6646', accent: '#2c2c2e' },
  desk: { body: '#c4a37c', cushion: '#e2d6c4', frame: '#3a3a3c', accent: '#2c2c2e' },
  dresser: { body: '#7c5c42', cushion: '#e2d6c4', frame: '#8b6a4d', accent: '#2c2c2e' },
  shelf: { body: '#c2a27c', cushion: '#e2d6c4', frame: '#6b5a4a', accent: '#7d8b93' },
  nightstand: { body: '#7c5c42', cushion: '#e2d6c4', frame: '#8b6a4d', accent: '#2c2c2e' },
  lamp: { body: '#e3dfd8', cushion: '#f3eee6', frame: '#2f2f31', accent: '#efe7da' },
  rug: { body: '#cdc4b5', cushion: '#ddd5c8', frame: '#8e8170', accent: '#8e8170' },
  plant: { body: '#e0dcd5', cushion: '#56704a', frame: '#4a3b2e', accent: '#6a8559' },
  tv: { body: '#1f2023', cushion: '#3a3b3f', frame: '#2f3033', accent: '#2a2c31' },
  box: { body: '#b9ae9e', cushion: '#d6ccbd', frame: '#7d6650', accent: '#5f6670' },
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
  preset('bed-full', 'Full bed', 'bed', { w: 54 * IN, d: 75 * IN, h: 100 }, { pillowCount: 2 }, { colors: { body: '#a69a8c' } }),
  preset('bed-queen', 'Queen bed', 'bed', { w: 152.4, d: 203.2, h: 110 }, { headboardStyle: 'tufted', pillowCount: 2 },
    { colors: { body: '#7f8b84', frame: '#cfc6b8' } }),
  preset('bed-king', 'King bed', 'bed', { w: 76 * IN, d: 80 * IN, h: 115 }, { headboardStyle: 'tufted', pillowCount: 3, footboard: true },
    { colors: { body: '#b3a48f', frame: '#6b5240' }, material: 'wood' }),
  preset('sofa-3seat', '3-seat sofa', 'sofa', { w: 213, d: 91, h: 85 }, { cushionCount: 3 }),
  preset('loveseat', 'Loveseat', 'sofa', { w: 152, d: 89, h: 85 }, { cushionCount: 2, armStyle: 'square', legType: 'block' },
    { colors: { body: '#7d8270', cushion: '#878c7a' } }),
  preset('armchair', 'Armchair', 'armchair', { w: 84, d: 86, h: 84 }, {}),
  preset('desk', 'Desk', 'desk', { w: 140, d: 70, h: 75 }, { drawerSide: 'right' }, { material: 'wood' }),
  preset('office-chair', 'Office chair', 'chair', { w: 64, d: 64, h: 105 }, { base: 'swivel', arms: true, backStyle: 'solid', seatHeight: 0.45 },
    { colors: { body: '#2f3236', cushion: '#3b3f44', frame: '#9a9da2' }, material: 'plastic' }),
  preset('dresser', 'Dresser', 'dresser', { w: 150, d: 50, h: 80 }, { drawerRows: 3, drawerCols: 2 }, { material: 'wood' }),
  preset('nightstand', 'Nightstand', 'nightstand', { w: 50, d: 40, h: 58 }, { drawerCount: 2 }, { material: 'wood' }),
  preset('bookshelf', 'Bookshelf', 'shelf', { w: 80, d: 30, h: 180 }, { shelfCount: 4 }, { material: 'wood' }),
  preset('tv-stand', 'TV stand', 'dresser', { w: 160, d: 45, h: 55 }, { drawerRows: 1, drawerCols: 3, legHeight: 10, handleStyle: 'bar' },
    { material: 'wood', colors: { body: '#3b3936', frame: '#a98058' } }),
  preset('dining-table', 'Dining table', 'table', { w: 160, d: 90, h: 75 }, { legType: 'four' }, { material: 'wood' }),
  preset('dining-chair', 'Dining chair', 'chair', { w: 45, d: 52, h: 90 }, { backStyle: 'slatted', seatHeight: 0.5 }, { material: 'wood' }),
  preset('coffee-table', 'Coffee table', 'table', { w: 110, d: 60, h: 45 }, { legType: 'trestle', topThickness: 5 },
    { material: 'wood', colors: { body: '#6e523c', frame: '#5e4532' } }),
  preset('side-table', 'Side table', 'table', { w: 50, d: 50, h: 55 }, { topShape: 'round', legType: 'pedestal' },
    { material: 'wood', colors: { body: '#c9ad88', frame: '#b8996f' } }),
  preset('rug-small', 'Rug 5×8 ft', 'rug', { w: 5 * 30.48, d: 8 * 30.48, h: 1 }, {}),
  preset('rug-large', 'Rug 8×10 ft', 'rug', { w: 8 * 30.48, d: 10 * 30.48, h: 1.2 }, { border: false },
    { colors: { body: '#b7b0a2' } }),
  preset('floor-lamp', 'Floor lamp', 'lamp', { w: 45, d: 45, h: 160 }, { lampType: 'floor', shadeShape: 'drum' }, { material: 'metal' }),
  preset('table-lamp', 'Table lamp', 'lamp', { w: 30, d: 30, h: 50 }, { lampType: 'table', shadeShape: 'cone' }),
  preset('plant-floor', 'Floor plant', 'plant', { w: 55, d: 55, h: 150 }, { foliage: 'tall', potShape: 'cylinder' }, { material: 'plastic' }),
  preset('plant-small', 'Small plant', 'plant', { w: 25, d: 25, h: 40 }, { foliage: 'bushy', potShape: 'tapered' }, { material: 'plastic' }),
  preset('wardrobe', 'Wardrobe', 'dresser', { w: 100, d: 60, h: 200 }, { drawerRows: 1, drawerCols: 2, legHeight: 5, handleStyle: 'bar' },
    { material: 'wood', clearances: [{ kind: 'drawer', side: 'front', depth: 55, label: 'door swing space' }] }),
  preset('tv', 'TV 55"', 'tv', { w: 123, d: 27, h: 76 }, { mount: 'stand' }, { material: 'plastic' }),
];
