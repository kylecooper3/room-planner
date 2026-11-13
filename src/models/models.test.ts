import { describe, expect, it } from 'vitest';
import { CATEGORIES, WALKWAY_CM } from '../types';
import type { Category, ModelPart, ParametricModel, Size3, StyleParams } from '../types';
import { STYLE_SCHEMA, defaultStyle, generateModel, visibleRoles, withItemColors } from './generate';
import { PRESETS, defaultClearances, defaultColors } from './presets';

const SIZES: Size3[] = [
  { w: 2, d: 2, h: 1 }, { w: 80, d: 60, h: 90 }, { w: 600, d: 400, h: 300 },
  { w: 400, d: 10, h: 20 }, { w: 10, d: 400, h: 20 }, { w: 15, d: 15, h: 300 }, { w: 300, d: 300, h: 0.5 },
];

const model = (category: Category, style: StyleParams = {}): ParametricModel =>
  ({ kind: 'parametric', category, style, colors: defaultColors(category), material: 'fabric' });

const variants = (category: Category): StyleParams[] => {
  const out: StyleParams[] = [{}];
  for (const d of STYLE_SCHEMA[category]) {
    if (d.type === 'select') for (const o of d.options ?? []) out.push({ [d.key]: o });
    if (d.type === 'boolean') out.push({ [d.key]: true }, { [d.key]: false });
    if (d.type === 'number') out.push({ [d.key]: d.min! }, { [d.key]: d.max! });
  }
  // a few combined extremes
  out.push(Object.fromEntries(STYLE_SCHEMA[category].map((d) => [d.key, d.type === 'number' ? d.max! : d.type === 'boolean' ? true : d.options!.at(-1)!])));
  out.push(Object.fromEntries(STYLE_SCHEMA[category].map((d) => [d.key, d.type === 'number' ? d.min! : d.type === 'boolean' ? false : d.options![1] ?? d.options![0]])));
  return out;
};

const checkBounds = (parts: ModelPart[], s: Size3) => {
  expect(parts.length).toBeGreaterThan(0);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let a = 0; a < 3; a++) {
      expect(Number.isFinite(p.size[a]) && p.size[a] > 0).toBe(true);
      expect(Number.isFinite(p.position[a])).toBe(true);
      lo[a] = Math.min(lo[a], p.position[a] - p.size[a] / 2);
      hi[a] = Math.max(hi[a], p.position[a] + p.size[a] / 2);
    }
    if (p.round !== undefined) expect(p.round > 0 && p.round < Math.min(...p.size) / 2).toBe(true);
  }
  const want = [[-s.w / 2, s.w / 2], [0, s.h], [-s.d / 2, s.d / 2]];
  for (let a = 0; a < 3; a++) {
    expect(Math.abs(lo[a] - want[a][0])).toBeLessThan(0.01);
    expect(Math.abs(hi[a] - want[a][1])).toBeLessThan(0.01);
  }
};

describe('generateModel', () => {
  for (const c of CATEGORIES) {
    it(`${c}: AABB invariant for all sizes and style variants`, () => {
      for (const s of SIZES) for (const v of variants(c)) checkBounds(generateModel(model(c, v), s), s);
    });
  }
  it('typical part counts stay low-poly', () => {
    for (const c of CATEGORIES) {
      const n = generateModel(model(c), { w: 100, d: 80, h: 90 }).length;
      expect(n).toBeLessThanOrEqual(40);
    }
  });
  it('tolerates garbage style values', () => {
    const junk: StyleParams = { armStyle: 42, legHeight: 'tall', cushionCount: NaN, roundness: Infinity, shelfCount: -9, arms: 'yes', drawerRows: 1e9 };
    for (const c of CATEGORIES) {
      const s = { w: 100, d: 50, h: 80 };
      expect(() => checkBounds(generateModel(model(c, junk), s), s)).not.toThrow();
    }
  });
});

describe('defaultStyle', () => {
  it('matches schema defaults', () => {
    for (const c of CATEGORIES) {
      const d = defaultStyle(c);
      expect(Object.keys(d).length).toBe(STYLE_SCHEMA[c].length);
      for (const p of STYLE_SCHEMA[c]) {
        expect(d[p.key]).toBe(p.default);
        if (p.type === 'select') expect(p.options).toContain(p.default);
        if (p.type === 'number') expect(p.default as number).toBeGreaterThanOrEqual(p.min!), expect(p.default as number).toBeLessThanOrEqual(p.max!);
      }
    }
  });
});

const REQUIRED = ['bed-twin', 'bed-full', 'bed-queen', 'bed-king', 'sofa-3seat', 'loveseat', 'armchair', 'desk', 'office-chair', 'dresser',
  'nightstand', 'bookshelf', 'tv-stand', 'dining-table', 'dining-chair', 'coffee-table', 'side-table', 'rug-small', 'rug-large',
  'floor-lamp', 'table-lamp', 'plant-floor', 'plant-small', 'wardrobe', 'tv'].map((s) => `preset-${s}`);

describe('PRESETS', () => {
  it('has the required unique ids', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of REQUIRED) expect(ids).toContain(id);
  });
  it('generates valid, plausible models', () => {
    for (const p of PRESETS) {
      expect(p.source).toBe('preset');
      expect(p.model.kind).toBe('parametric');
      for (const v of [p.size.w, p.size.d, p.size.h]) expect(v > 0.5 && v <= 320).toBe(true);
      if (p.model.kind === 'parametric') checkBounds(generateModel(p.model, p.size), p.size);
    }
  });
  it('queen bed is 152.4 x 203.2; rugs are 5x8 and 8x10 ft', () => {
    const get = (id: string) => PRESETS.find((p) => p.id === id)!.size;
    expect(get('preset-bed-queen')).toMatchObject({ w: 152.4, d: 203.2 });
    expect(get('preset-rug-small').w).toBeCloseTo(152.4);
    expect(get('preset-rug-small').d).toBeCloseTo(243.84);
    expect(get('preset-rug-large').w).toBeCloseTo(243.84);
    expect(get('preset-rug-large').d).toBeCloseTo(304.8);
  });
  it('wardrobe has a door swing zone', () => {
    const w = PRESETS.find((p) => p.id === 'preset-wardrobe')!;
    expect(w.clearances).toEqual([expect.objectContaining({ side: 'front', label: 'door swing space' })]);
  });
});

describe('defaultClearances', () => {
  const s = { w: 100, d: 50, h: 80 };
  it('follows the zone rules', () => {
    expect(defaultClearances('dresser', s, 'metric')).toEqual([{ kind: 'drawer', side: 'front', depth: 50, label: 'drawer pull-out' }]);
    expect(defaultClearances('nightstand', s, 'metric')).toEqual([expect.objectContaining({ kind: 'drawer', side: 'front', depth: 30 })]);
    expect(defaultClearances('chair', s, 'metric')).toEqual([{ kind: 'chair', side: 'back', depth: 45, label: 'chair push-back' }]);
    expect(defaultClearances('bed', s, 'imperial')).toEqual([{ kind: 'walkway', side: 'front', depth: WALKWAY_CM.imperial, label: 'walkway' }]);
    expect(defaultClearances('bed', s, 'metric')[0].depth).toBe(90);
    expect(defaultClearances('shelf', s, 'metric')).toEqual([{ kind: 'access', side: 'front', depth: 60, label: 'access space' }]);
    for (const c of ['desk', 'sofa', 'armchair', 'table', 'rug', 'lamp', 'plant', 'tv', 'box'] as Category[]) {
      expect(defaultClearances(c, s, 'metric')).toEqual([]);
    }
  });
});

describe('per-item colours', () => {
  const bed = PRESETS.find((d) => d.id === 'preset-bed-queen')!;
  it('withItemColors merges overrides over the def colours and leaves the def alone without overrides', () => {
    expect(withItemColors(bed, undefined)).toBe(bed);
    const look = withItemColors(bed, { body: '#123456' });
    expect(look.model.kind === 'parametric' && look.model.colors).toEqual({ ...(bed.model.kind === 'parametric' && bed.model.colors), body: '#123456' });
  });
  it('visibleRoles lists only roles whose colour shows (the TV screen has a fixed colour)', () => {
    expect(visibleRoles(bed)).toEqual(['body', 'cushion', 'frame', 'accent']);
    expect(visibleRoles({ ...bed, model: model('box') })).toEqual(['body']);
    expect(visibleRoles({ ...bed, model: model('tv', { mount: 'stand' }) })).toEqual(['body', 'frame']);
  });
});
