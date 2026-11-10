import type {
  AnalyzePhoto, Category, CategorySuggestion, EstimateMaterial, ExtractPalette, MapPaletteToParts, PartColors,
  PhotoAnalysis, PhotoProgress, Size3, StageStatus,
} from '../types';
import { defaultColors } from '../models/presets';
import { HEX_RE, hexToRgb, rgbToHsl, rgbToLab, shade, tint } from './color';
import { heuristicCategory, weighBySize } from './classify';
import { decodeImage, encodePng, type RGBAImage } from './image';
import { estimateMaterial as estimateMaterialImpl } from './material';
import { mlClassify, mlSegment, type LoadProgress } from './ml';
import { extractPalette as extractPaletteImpl } from './palette';
import { applyMask, classicalSegment, maskSane, type Mask } from './segment';

export { heuristicCategory };
export const extractPalette: ExtractPalette = extractPaletteImpl;
export const estimateMaterial: EstimateMaterial = estimateMaterialImpl;

const FALLBACK_COLORS: PartColors = { body: '#b8b8b8', cushion: '#d0d0d0', frame: '#8a6f4d', accent: '#f4a261' };
const WOODEN: Category[] = ['table', 'desk', 'dresser', 'shelf', 'nightstand'];

const info = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return { hex, h, s, l, L: rgbToLab(r, g, b)[0], wood: h >= 15 && h <= 45 && s >= 0.2 && s <= 0.75 && l <= 0.6 };
};

function safeDefaults(category: Category): PartColors {
  let d: Partial<PartColors> = {};
  try { d = defaultColors(category) ?? {}; } catch { /* models module unavailable */ }
  const out = { ...FALLBACK_COLORS };
  for (const k of Object.keys(out) as (keyof PartColors)[]) {
    const v = d[k]?.toLowerCase();
    if (v && HEX_RE.test(v)) out[k] = v;
  }
  return out;
}

/** Dominant → body, lightest same-hue colour (else 2nd) → cushion, darkest/wood-like minor → frame, most saturated remaining → accent. Always 4 valid hexes. */
export const mapPaletteToParts: MapPaletteToParts = (palette, category, material) => {
  const defs = safeDefaults(category);
  const cols = palette.map((p) => p.hex.toLowerCase()).filter((h) => HEX_RE.test(h)).map(info);
  if (!cols.length) return defs;

  if (category === 'plant') {
    const greens = cols.filter((c) => c.h >= 70 && c.h <= 170 && c.s > 0.15);
    const leaf = greens.sort((a, b) => b.s - a.s)[0];
    const pot = cols.find((c) => c !== leaf);
    const body = pot?.hex ?? defs.body;
    // Generator roles: body = pot, frame = rim/trunk, cushion = main foliage, accent = top foliage.
    return { body, cushion: leaf?.hex ?? defs.cushion, frame: shade(body, 0.3), accent: leaf ? tint(leaf.hex, 0.25) : defs.accent };
  }

  const [main, ...rest] = cols;
  const body = main.hex;
  // Cushion: the lightest non-dominant colour close in hue to the body (shadows/arms are the darker ones), else the 2nd.
  const hueGap = (c: typeof main) => { const d = Math.abs(c.h - main.h) % 360; return Math.min(d, 360 - d); };
  const sameHue = rest.filter((c) => hueGap(c) <= 30 && c.s > 0.1 === main.s > 0.1);
  const cushionPick = sameHue.length ? sameHue.reduce((a, c) => (c.L > a.L ? c : a)) : rest[0];
  const cushion = cushionPick?.hex ?? tint(body, 0.25);
  const minors = rest.filter((c) => c !== cushionPick);
  let frame: string;
  if (WOODEN.includes(category)) frame = shade(body, 0.3);
  else {
    const wood = minors.find((c) => c.wood);
    const darkest = [...minors].sort((a, b) => a.L - b.L)[0];
    const pick = wood ?? (darkest && darkest.L < main.L - 10 ? darkest : undefined);
    frame = pick?.hex ?? (material === 'wood' ? shade(body, 0.3) : defs.frame);
  }
  const accentPick = minors.filter((c) => c.hex !== frame).sort((a, b) => b.s - a.s)[0];
  return { body, cushion, frame, accent: accentPick?.hex ?? tint(body, 0.45) };
};

type Notes = string[];

const MB = (b: number) => (b / 1e6).toFixed(b < 1e7 ? 1 : 0);
/** "Downloading the recognition model (one-time): 34% · 30 / 88 MB". */
export function downloadMessage(what: string, p: LoadProgress): string {
  const pct = p.progress !== undefined ? ` ${Math.round(p.progress * 100)}%` : '';
  const bytes = p.total ? ` · ${MB(p.loaded ?? 0)} / ${MB(p.total)} MB` : '';
  return `Downloading the ${what} (one-time):${pct}${bytes}`;
}

/** Resolves like `p`, or rejects as soon as `signal` aborts (the work itself keeps running; its outcome is ignored). */
function unlessAborted<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) { p.catch(() => {}); return Promise.reject(new Error('skipped')); }
  return Promise.race([p, new Promise<never>((_, rej) => signal.addEventListener('abort', () => rej(new Error('skipped')), { once: true }))]);
}

async function runSegmentation(img: RGBAImage, notes: Notes, report: (p: PhotoProgress) => void, signal?: AbortSignal): Promise<{ mask: Mask | null; status: StageStatus }> {
  report({ stage: 'segmentation', message: 'Removing the background…' });
  try {
    const mask = await unlessAborted(mlSegment(img, (p) =>
      report({ stage: 'segmentation', progress: p.progress, message: downloadMessage('background-removal model', p) })), signal);
    if (maskSane(mask)) return { mask, status: 'ok' };
  } catch { /* fall through to the classical method */ }
  try {
    const mask = classicalSegment(img);
    if (maskSane(mask)) {
      notes.push('Smart background removal unavailable — used a simpler colour-based cut-out.');
      return { mask, status: 'fallback' };
    }
  } catch { /* fall through */ }
  notes.push('Background removal unavailable — using the whole photo.');
  return { mask: null, status: 'skipped' };
}

async function runClassification(img: RGBAImage, size: Parameters<AnalyzePhoto>[1], notes: Notes, report: (p: PhotoProgress) => void,
  signal?: AbortSignal): Promise<{ suggestions: CategorySuggestion[]; status: StageStatus }> {
  report({ stage: 'classification', message: 'Recognising the item…' });
  try {
    const suggestions = await unlessAborted(mlClassify(img, (p) =>
      report({ stage: 'classification', progress: p.progress, message: downloadMessage('recognition model', p) })), signal);
    return { suggestions: weighBySize(suggestions, size), status: 'ok' };
  } catch { /* fall back */ }
  const suggestions = heuristicCategory(size);
  if (suggestions.length) {
    notes.push(signal?.aborted
      ? 'Recognition skipped — guessed the type from the dimensions. Please check the category.'
      : 'Photo recognition unavailable — guessed the type from the dimensions.');
    return { suggestions, status: 'fallback' };
  }
  notes.push('Could not guess the type — please pick a category.');
  return { suggestions: [], status: 'skipped' };
}

/** `signal` = the user's "Skip": unfinished ML stages fall back at once; downloads keep going in the background. */
export const analyzePhoto = async (photo: Blob, size: Size3, onProgress?: (p: PhotoProgress) => void, signal?: AbortSignal): Promise<PhotoAnalysis> => {
  const report = (p: PhotoProgress) => { try { onProgress?.(p); } catch { /* UI callback errors must not break analysis */ } };
  const notes: Notes = [];
  let img: RGBAImage;
  try {
    img = await decodeImage(photo);
  } catch {
    const suggestions = heuristicCategory(size);
    notes.push('Could not read that photo — using defaults.');
    return {
      cutout: null, palette: [], suggestions, material: 'fabric',
      colors: mapPaletteToParts([], suggestions[0]?.category ?? 'box', 'fabric'),
      stages: { segmentation: 'skipped', palette: 'skipped', classification: suggestions.length ? 'fallback' : 'skipped', material: 'skipped' },
      notes,
    };
  }

  // Stages 1 and 3 run concurrently and independently: neither can block or fail the other.
  const segNotes: Notes = [], clsNotes: Notes = [];
  const [seg, cls] = await Promise.all([runSegmentation(img, segNotes, report, signal), runClassification(img, size, clsNotes, report, signal)]);
  notes.push(...segNotes, ...clsNotes);

  const item = seg.mask ? applyMask(img, seg.mask) : img;
  let cutout: Blob | null = null;
  if (seg.mask) {
    try { cutout = await encodePng(item); } catch { /* keep going without a cut-out image */ }
  }

  report({ stage: 'palette', message: 'Picking colours…' });
  const palette = extractPalette(item.data, 5);
  report({ stage: 'material', message: 'Guessing the material…' });
  const material = estimateMaterial(item.data, item.width, item.height);

  const result: PhotoAnalysis = {
    cutout, palette, suggestions: cls.suggestions, material,
    colors: mapPaletteToParts(palette, cls.suggestions[0]?.category ?? 'box', material),
    stages: { segmentation: seg.status, palette: 'ok', classification: cls.status, material: 'ok' },
    notes,
  };
  return result;
};
analyzePhoto satisfies AnalyzePhoto;
