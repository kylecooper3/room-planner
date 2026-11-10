import type { Category, GenerateModel, ModelPart, StyleParamDef, StyleParams, StyleSchema } from '../types';
import { GENERATORS } from './generators';

const sel = (key: string, label: string, options: string[], def = options[0]): StyleParamDef =>
  ({ key, label, type: 'select', options, default: def });
const n = (key: string, label: string, def: number, min: number, max: number, step: number): StyleParamDef =>
  ({ key, label, type: 'number', default: def, min, max, step });
const b = (key: string, label: string, def: boolean): StyleParamDef => ({ key, label, type: 'boolean', default: def });

const ARM = sel('armStyle', 'Arms', ['square', 'rounded', 'slim', 'none'], 'rounded');
const LEG = sel('legType', 'Legs', ['block', 'tapered', 'none'], 'tapered');
const LEG_H = n('legHeight', 'Leg height (cm)', 10, 0, 30, 1);
const ROUND = n('roundness', 'Roundness', 0.5, 0, 1, 0.05);
const HANDLE = sel('handleStyle', 'Handles', ['knob', 'bar', 'none']);

/** Style parameters per category (drives the editor UI). */
export const STYLE_SCHEMA: StyleSchema = {
  sofa: [ARM, LEG, LEG_H, n('cushionCount', 'Cushions', 3, 1, 4, 1), n('backHeight', 'Back height', 0.5, 0.3, 0.65, 0.05), ROUND],
  armchair: [ARM, LEG, LEG_H, ROUND],
  chair: [sel('backStyle', 'Back', ['solid', 'slatted', 'none']), b('arms', 'Arms', false), sel('base', 'Base', ['legs', 'swivel']),
    n('seatHeight', 'Seat height', 0.5, 0.3, 0.7, 0.05)],
  bed: [sel('headboardStyle', 'Headboard', ['panel', 'slatted', 'tufted', 'none']), n('headboardHeight', 'Headboard height', 0.45, 0.2, 0.65, 0.05),
    b('footboard', 'Footboard', false), n('legHeight', 'Leg height (cm)', 8, 0, 40, 1), n('pillowCount', 'Pillows', 2, 1, 4, 1), b('blanket', 'Blanket', true)],
  table: [sel('topShape', 'Top', ['rect', 'round']), sel('legType', 'Legs', ['four', 'pedestal', 'trestle']), n('topThickness', 'Top thickness (cm)', 4, 1, 10, 0.5)],
  desk: [sel('drawerSide', 'Drawers', ['none', 'left', 'right', 'both'], 'right'), sel('legType', 'Legs', ['panel', 'four'], 'four'),
    n('topThickness', 'Top thickness (cm)', 3, 1, 10, 0.5)],
  dresser: [n('drawerRows', 'Drawer rows', 3, 1, 6, 1), n('drawerCols', 'Drawer columns', 2, 1, 4, 1), n('legHeight', 'Leg height (cm)', 6, 0, 30, 1), HANDLE],
  shelf: [n('shelfCount', 'Shelves', 3, 0, 8, 1), b('backPanel', 'Back panel', true), b('sidePanels', 'Side panels', true)],
  nightstand: [n('drawerCount', 'Drawers', 2, 1, 4, 1), n('legHeight', 'Leg height (cm)', 8, 0, 30, 1), HANDLE],
  lamp: [sel('lampType', 'Type', ['floor', 'table']), sel('shadeShape', 'Shade', ['cone', 'drum', 'globe'], 'drum')],
  rug: [sel('shape', 'Shape', ['rect', 'round']), b('border', 'Border', true)],
  plant: [sel('potShape', 'Pot', ['cylinder', 'tapered', 'square'], 'tapered'), sel('foliage', 'Foliage', ['bushy', 'tall', 'leafy'])],
  tv: [sel('mount', 'Mount', ['stand', 'media-unit'])],
  box: [n('roundness', 'Roundness', 0.15, 0, 1, 0.05)],
};

/** Schema defaults for a category. */
export const defaultStyle = (category: Category): StyleParams =>
  Object.fromEntries((STYLE_SCHEMA[category] ?? []).map((d) => [d.key, d.default]));

/** Style with every schema key present and valid (missing/invalid -> default, numbers clamped and snapped to integer steps). */
export const resolveStyle = (category: Category, style: StyleParams | undefined): StyleParams => {
  const out: StyleParams = {};
  for (const d of STYLE_SCHEMA[category] ?? []) {
    const v = style?.[d.key];
    if (d.type === 'number') {
      let x = typeof v === 'number' && Number.isFinite(v) ? Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, v)) : (d.default as number);
      if (d.step !== undefined && Number.isInteger(d.step)) x = Math.round(x);
      out[d.key] = x;
    } else if (d.type === 'select') out[d.key] = typeof v === 'string' && d.options?.includes(v) ? v : d.default;
    else out[d.key] = typeof v === 'boolean' ? v : d.default;
  }
  return out;
};

const safe = (v: number) => (Number.isFinite(v) && v > 0 ? v : 1);

/**
 * Rescales/offsets parts so their union AABB is exactly the item box. Rotations are ignored: generators only use
 * rotations that leave a part's AABB unchanged (half turns of symmetric shapes).
 */
export const fitParts = (parts: ModelPart[], W: number, H: number, D: number): ModelPart[] => {
  const ok = parts.filter((p) => p.size.every((s) => Number.isFinite(s) && s > 1e-6) && p.position.every(Number.isFinite));
  if (!ok.length) return [{ role: 'body', shape: 'box', size: [W, H, D], position: [0, H / 2, 0] }];
  const target: [number, number][] = [[-W / 2, W / 2], [0, H], [-D / 2, D / 2]];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of ok) for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(lo[a], p.position[a] - p.size[a] / 2);
    hi[a] = Math.max(hi[a], p.position[a] + p.size[a] / 2);
  }
  const k = [0, 1, 2].map((a) => (target[a][1] - target[a][0]) / (hi[a] - lo[a]));
  const kMin = Math.min(...k);
  return ok.map((p) => {
    const size = p.size.map((s, a) => s * k[a]) as [number, number, number];
    const position = p.position.map((c, a) => (c - lo[a]) * k[a] + target[a][0]) as [number, number, number];
    const { round: r0, ...rest } = p;
    const round = Math.min((r0 ?? 0) * kMin, Math.min(...size) * 0.45);
    return { ...rest, size, position, ...(round > 0.05 ? { round } : {}) };
  });
};

export const generateModel: GenerateModel = (model, size) => {
  const W = safe(size.w);
  const H = safe(size.h);
  const D = safe(size.d);
  const category: Category = model.category in GENERATORS ? model.category : 'box';
  return fitParts(GENERATORS[category](resolveStyle(category, model.style), W, H, D), W, H, D);
};
