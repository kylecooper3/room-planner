import { describe, expect, it, vi } from 'vitest';
import type { RGBAImage } from './image';

vi.mock('@huggingface/transformers', () => { throw new Error('offline'); });
vi.mock('../models/presets', () => ({
  defaultColors: () => ({ body: '#b8b8b8', cushion: '#d0d0d0', frame: '#8a6f4d', accent: '#f4a261' }),
}));
const decoded: { img: RGBAImage | null } = { img: null };
vi.mock('./image', () => ({
  decodeImage: async () => { if (!decoded.img) throw new Error('no decode'); return decoded.img; },
  encodePng: async () => new Blob(['png'], { type: 'image/png' }),
}));

import { analyzePhoto, estimateMaterial, extractPalette, heuristicCategory, mapPaletteToParts } from './analyze';
import { classicalSegment, applyMask, maskSane, maskFromU2, U2_SIZE } from './segment';
import { hexToRgb, rgbToHsl } from './color';
import { withStallTimeout, withTimeout } from './ml';
import { downloadMessage } from './analyze';

const W = 64, H = 48;
/** Green rounded blob (with slight shading noise) on white. */
function greenSofa(): RGBAImage {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const inside = x > 10 && x < 54 && y > 14 && y < 40;
    const n = ((x * 7 + y * 13) % 9) - 4;
    const c = inside ? [40 + n, 140 + n, 60 + n] : [250, 250, 250];
    data.set([...c, 255], o);
  }
  return { data, width: W, height: H };
}
function woodTexture(): RGBAImage {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const grain = Math.sin(x * 1.3) * 22 + ((x * 31) % 7) * 2; // varies across x only: directional
    data.set([130 + grain, 82 + grain * 0.7, 45 + grain * 0.4, 255], (y * W + x) * 4);
  }
  return { data, width: W, height: H };
}
const isGreen = (hex: string) => { const [r, g, b] = hexToRgb(hex); return g > r + 40 && g > b + 40; };
const isBrown = (hex: string) => { const [h, s] = rgbToHsl(...hexToRgb(hex)); return h >= 15 && h <= 45 && s > 0.2; };
const HEX = /^#[0-9a-f]{6}$/;

describe('segmentation + palette', () => {
  it('classical segmentation removes the white background', () => {
    const img = greenSofa();
    const mask = classicalSegment(img);
    expect(maskSane(mask)).toBe(true);
    expect(mask[0]).toBe(0);
    expect(mask[25 * W + 30]).toBe(1);
    const pal = extractPalette(applyMask(img, mask).data);
    expect(isGreen(pal[0].hex)).toBe(true);
    expect(pal.some((p) => hexToRgb(p.hex).every((v) => v > 230))).toBe(false);
    expect(pal.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 5);
    expect(isGreen(mapPaletteToParts(pal, 'sofa', 'fabric').body)).toBe(true);
  });

  it('unmasked palette contains white; mask sanity rejects extremes', () => {
    const pal = extractPalette(greenSofa().data);
    expect(pal.some((p) => hexToRgb(p.hex).every((v) => v > 230))).toBe(true);
    expect(maskSane(new Uint8Array(100))).toBe(false);
    expect(maskSane(new Uint8Array(100).fill(1))).toBe(false);
  });

  it('palette is deterministic and ignores transparent pixels', () => {
    const img = greenSofa();
    expect(extractPalette(img.data)).toEqual(extractPalette(img.data));
    expect(extractPalette(new Uint8ClampedArray(16))).toEqual([]);
  });

  it('maskFromU2 upsamples and thresholds a saliency map', () => {
    const pred = new Float32Array(U2_SIZE * U2_SIZE);
    for (let y = 100; y < 220; y++) for (let x = 100; x < 220; x++) pred[y * U2_SIZE + x] = 0.9;
    const m = maskFromU2(pred, 32, 32);
    expect(m[0]).toBe(0);
    expect(m[16 * 32 + 16]).toBe(1);
  });
});

describe('material', () => {
  it('brown grain texture → wood with brown palette', () => {
    const img = woodTexture();
    expect(estimateMaterial(img.data, W, H)).toBe('wood');
    expect(extractPalette(img.data).every((p) => isBrown(p.hex))).toBe(true);
  });
  it('flat saturated colour → plastic; nothing opaque → fabric', () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([220, 30, 40, 255], i * 4);
    expect(estimateMaterial(data, W, H)).toBe('plastic');
    expect(estimateMaterial(new Uint8ClampedArray(W * H * 4), W, H)).toBe('fabric');
  });
});

describe('material from colour (flat and lightly textured inputs)', () => {
  /** Fills a W×H image from a per-pixel colour function. */
  const img = (fn: (x: number, y: number) => [number, number, number]) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([...fn(x, y), 255], (y * W + x) * 4);
    return data;
  };
  const flat = (c: [number, number, number]) => img(() => c);
  const noise = (x: number, y: number) => ((x * 7 + y * 13) % 9) - 4;
  /** Base colour with a small bright highlight blob (specular). */
  const withHighlight = (c: [number, number, number], hl: [number, number, number]) =>
    img((x, y) => ((x - 20) ** 2 + (y - 12) ** 2 < 16 ? hl : c));
  it.each([
    ['flat brown → wood', flat([139, 90, 43]), 'wood'],
    ['flat tan → wood', flat([196, 160, 110]), 'wood'],
    ['flat green → fabric', flat([56, 142, 60]), 'fabric'],
    ['noisy blue → fabric', img((x, y) => [60 + noise(x, y), 90 + noise(x, y), 160 + noise(x, y)]), 'fabric'],
    ['flat grey → metal', flat([150, 152, 155]), 'metal'],
    ['silver with highlight → metal', withHighlight([170, 172, 176], [250, 250, 250]), 'metal'],
    ['dark brown with highlight → leather', withHighlight([60, 38, 25], [245, 242, 238]), 'leather'],
    ['black with highlight → leather', withHighlight([25, 25, 28], [230, 230, 230]), 'leather'],
    ['bright saturated red → plastic', flat([220, 30, 40]), 'plastic'],
    ['bright saturated yellow → plastic', flat([250, 200, 20]), 'plastic'],
  ] as const)('%s', (_n, data, want) => {
    expect(estimateMaterial(data, W, H)).toBe(want);
  });
});

describe('mapPaletteToParts', () => {
  it('green sofa: lighter green → cushion, darkest → frame', () => {
    const pal = [
      { hex: '#338437', weight: 0.5 }, // mid-green body
      { hex: '#1b5e20', weight: 0.25 }, // dark green shadows/arms
      { hex: '#50b053', weight: 0.15 }, // lighter green cushions
      { hex: '#4c3632', weight: 0.1 }, // dark brown legs
    ];
    const c = mapPaletteToParts(pal, 'sofa', 'fabric');
    expect(c.body).toBe('#338437');
    expect(c.cushion).toBe('#50b053');
    expect(['#1b5e20', '#4c3632']).toContain(c.frame);
    const pal2 = pal.slice(0, 3); // no legs: the darkest remaining colour is the frame
    expect(mapPaletteToParts(pal2, 'sofa', 'fabric')).toMatchObject({ cushion: '#50b053', frame: '#1b5e20' });
  });
});

describe('heuristicCategory', () => {
  const top = (w: number, d: number, h: number) => heuristicCategory({ w, d, h })[0]?.category;
  it('84×36×34 in → sofa', () => expect(top(213.36, 91.44, 86.36)).toBe('sofa'));
  it('rug, lamp, bed', () => {
    expect(top(240, 170, 1)).toBe('rug');
    expect(top(30, 30, 150)).toBe('lamp');
    expect(top(152, 203, 60)).toBe('bed');
  });
  it('invalid size → empty', () => expect(heuristicCategory({ w: 0, d: 1, h: 1 })).toEqual([]));
});

describe('mapPaletteToParts', () => {
  it('empty palette → valid defaults', () => {
    const c = mapPaletteToParts([], 'sofa', 'fabric');
    expect(Object.values(c).every((v) => HEX.test(v))).toBe(true);
    expect(c.frame).toBe('#8a6f4d');
  });
  it('per-category rules', () => {
    const pal = [{ hex: '#8B5A2B', weight: 0.6 }, { hex: '#3c7a3c', weight: 0.3 }, { hex: '#202020', weight: 0.1 }];
    const table = mapPaletteToParts(pal, 'table', 'wood');
    expect(table.body).toBe('#8b5a2b');
    expect(hexToRgb(table.frame)[0]).toBeLessThan(0x8b);
    const plant = mapPaletteToParts(pal, 'plant', 'fabric');
    expect(plant.cushion).toBe('#3c7a3c'); // foliage, as the generator draws leaves with the cushion colour
    expect(plant.body).toBe('#8b5a2b');
    const sofa = mapPaletteToParts(pal, 'sofa', 'fabric');
    expect(sofa).toMatchObject({ body: '#8b5a2b', cushion: '#3c7a3c', frame: '#202020' });
    expect(Object.values(sofa).every((v) => HEX.test(v))).toBe(true);
  });
});

describe('analyzePhoto', () => {
  const size = { w: 213.36, d: 91.44, h: 86.36 };
  it('ML import fails → fallbacks with notes, palette and colours', async () => {
    decoded.img = greenSofa();
    const progress = vi.fn();
    const r = await analyzePhoto(new Blob(['x']), size, progress);
    expect(r.stages).toEqual({ segmentation: 'fallback', palette: 'ok', classification: 'fallback', material: 'ok' });
    expect(r.notes.length).toBe(2);
    expect(r.cutout).toBeInstanceOf(Blob);
    expect(r.suggestions[0].category).toBe('sofa');
    expect(isGreen(r.palette[0].hex)).toBe(true);
    expect(isGreen(r.colors.body)).toBe(true);
    expect(progress).toHaveBeenCalled();
  });
  it('undecodable photo still resolves', async () => {
    decoded.img = null;
    const r = await analyzePhoto(new Blob(['x']), size);
    expect(r.cutout).toBeNull();
    expect(r.palette).toEqual([]);
    expect(Object.values(r.colors).every((v) => HEX.test(v))).toBe(true);
  });
  it('withStallTimeout tolerates slow-but-progressing downloads and rejects only on a stall or the cap', async () => {
    vi.useFakeTimers();
    try {
      let last = Date.now();
      let done!: (v: string) => void;
      const p = withStallTimeout(new Promise<string>((r) => { done = r; }), () => last, 30_000, 600_000, 'CLIP');
      for (let i = 0; i < 12; i++) { await vi.advanceTimersByTimeAsync(10_000); last = Date.now(); } // 2 minutes, progressing
      done('ok');
      await expect(p).resolves.toBe('ok');

      last = Date.now();
      const stalled = withStallTimeout(new Promise(() => {}), () => last, 30_000, 600_000, 'CLIP');
      const check = expect(stalled).rejects.toThrow('stalled');
      await vi.advanceTimersByTimeAsync(31_000);
      await check;

      const capped = withStallTimeout(new Promise(() => {}), () => Date.now(), 30_000, 600_000, 'CLIP');
      const checkCap = expect(capped).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(601_000);
      await checkCap;
    } finally { vi.useRealTimers(); }
  });
  it('download message shows percentage and MB', () => {
    expect(downloadMessage('recognition model', { progress: 0.34, loaded: 30e6, total: 88e6 }))
      .toBe('Downloading the recognition model (one-time): 34% · 30 / 88 MB');
  });
  it('an aborted analysis (Skip) resolves with fallbacks', async () => {
    decoded.img = greenSofa();
    const ctl = new AbortController(); ctl.abort();
    const r = await analyzePhoto(new Blob(['x']), size, undefined, ctl.signal);
    expect(r.stages.classification).toBe('fallback');
    expect(r.notes.some((n) => /skipped/i.test(n))).toBe(true);
  });
  it('withTimeout rejects slow promises', async () => {
    await expect(withTimeout(new Promise(() => {}), 5, 'x')).rejects.toThrow('timed out');
  });
});

describe('weighBySize', () => {
  it('a sofa-sized item is not a rug even when the photo looks like one', async () => {
    const { weighBySize } = await import('./classify');
    const clip = [{ category: 'rug' as const, score: 0.2 }, { category: 'tv' as const, score: 0.14 }, { category: 'sofa' as const, score: 0.08 }];
    const out = weighBySize(clip, { w: 213.36, d: 91.44, h: 86.36 });
    expect(out[0].category).toBe('sofa');
    expect(out.reduce((a, s) => a + s.score, 0)).toBeCloseTo(1, 9);
  });
});
