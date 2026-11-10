import type { Category, CategorySuggestion, Size3 } from '../types';

/** Typical sizes (cm): [footprint long side, footprint short side, height]. */
const PROTOTYPES: Record<Category, [number, number, number]> = {
  sofa: [210, 90, 85], armchair: [85, 85, 90], chair: [50, 45, 85], bed: [200, 150, 55],
  table: [160, 90, 75], desk: [130, 65, 75], dresser: [120, 50, 85], shelf: [80, 30, 180],
  nightstand: [50, 40, 55], lamp: [40, 40, 160], rug: [200, 150, 1.5], plant: [45, 45, 100],
  tv: [120, 8, 70], box: [40, 30, 30],
};

/** Fallback classifier: ranks categories by log-ratio distance of W×D×H to typical sizes (footprint orientation-free). */
export function heuristicCategory(size: Size3): CategorySuggestion[] {
  const { w, d, h } = size;
  if (!(w > 0 && d > 0 && h > 0)) return [];
  const a = Math.max(w, d), b = Math.min(w, d);
  const ranked = (Object.keys(PROTOTYPES) as Category[]).map((category) => {
    const [pa, pb, ph] = PROTOTYPES[category];
    const dist = Math.log(a / pa) ** 2 + Math.log(b / pb) ** 2 + 1.5 * Math.log(h / ph) ** 2;
    return { category, raw: Math.exp(-2 * dist) };
  });
  const sum = ranked.reduce((s, r) => s + r.raw, 0) || 1;
  return ranked
    .map((r) => ({ category: r.category, score: r.raw / sum }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 5);
}

/** One zero-shot CLIP prompt per category. */
export const CLIP_PROMPTS: Record<Category, string> = {
  sofa: 'a photo of a sofa', armchair: 'a photo of an armchair', chair: 'a photo of a chair', bed: 'a photo of a bed',
  table: 'a photo of a table', desk: 'a photo of a desk', dresser: 'a photo of a dresser', shelf: 'a photo of a bookshelf',
  nightstand: 'a photo of a nightstand', lamp: 'a photo of a lamp', rug: 'a photo of a rug', plant: 'a photo of a potted plant',
  tv: 'a photo of a television on a media console', box: 'a photo of a storage box',
};

/** Maps CLIP {label, score} output back to sorted category suggestions. */
export function suggestionsFromClip(out: { label: string; score: number }[], limit = 5): CategorySuggestion[] {
  const byPrompt = new Map(Object.entries(CLIP_PROMPTS).map(([c, p]) => [p, c as Category]));
  return out
    .filter((o) => byPrompt.has(o.label))
    .map((o) => ({ category: byPrompt.get(o.label)!, score: o.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Re-weights CLIP suggestions by how plausible each category is for the entered W×D×H (the photo alone can't tell an
 * 86 cm tall sofa from a rug). Categories outside the size heuristic's top 5 keep a small floor weight.
 */
export function weighBySize(clip: CategorySuggestion[], size: Size3): CategorySuggestion[] {
  const prior = new Map(heuristicCategory(size).map((s) => [s.category, s.score]));
  const raw = clip.map((s) => ({ category: s.category, score: s.score * ((prior.get(s.category) ?? 0) + 0.02) }));
  const sum = raw.reduce((a, s) => a + s.score, 0);
  return sum > 0 ? raw.map((s) => ({ ...s, score: s.score / sum })).sort((a, b) => b.score - a.score).slice(0, 5) : clip.slice(0, 5);
}
