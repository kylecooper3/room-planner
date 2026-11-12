/**
 * Client-side ML via transformers.js, loaded only through dynamic import() so it stays out of the main bundle.
 * Models download once from the HF hub (cached in the Cache API); the ONNX runtime WASM is served from /ort.
 */
import type { CategorySuggestion } from '../types';
import { CLIP_PROMPTS, suggestionsFromClip } from './classify';
import type { RGBAImage } from './image';
import { maskFromU2, toU2Input, U2_SIZE, type Mask } from './segment';

type TF = typeof import('@huggingface/transformers');
/** Download progress: fraction 0..1 and bytes, when known. */
export interface LoadProgress { progress?: number; loaded?: number; total?: number }
export type OnLoad = (p: LoadProgress) => void;

/** Verified against the hub + transformers.js 4.3.2: config model_type 'u2net' has no dedicated class, so AutoModel builds the
 * base PreTrainedModel over onnx/model.onnx (fp32 only, ~4.6 MB). Input 'input.1' [1,3,320,320]; first output = sigmoid saliency. */
export const SEGMENT_MODEL = 'BritishWerewolf/U-2-Netp';
/** Zero-shot CLIP, quantized (onnx/model_quantized.onnx via dtype 'q8'). */
export const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';
/** A model load fails only when nothing has happened for STALL_MS (slow connections are fine), or after LOAD_CAP_MS overall. */
export const STALL_MS = 30_000;
export const LOAD_CAP_MS = 10 * 60_000;
export const RUN_TIMEOUT_MS = 20_000;

/** Like withTimeout, but the clock restarts whenever `lastActivity()` (a Date.now() stamp) moves; hard cap `capMs`. */
export function withStallTimeout<T>(p: Promise<T>, lastActivity: () => number, stallMs: number, capMs: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const start = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      if (now - lastActivity() > stallMs) { clearInterval(t); rej(new Error(`${what} download stalled`)); }
      else if (now - start > capMs) { clearInterval(t); rej(new Error(`${what} timed out`)); }
    }, Math.min(1000, stallMs / 4));
    p.then((v) => { clearInterval(t); res(v); }, (e) => { clearInterval(t); rej(e); });
  });
}

/** Rejects after `ms`; the underlying work keeps running (and its result stays cached for next time). */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${what} timed out`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

/** Module-level promise cache: each thing loads once; a failed load is forgotten so a later attempt can retry. */
function once<T>(load: () => Promise<T>) {
  let p: Promise<T> | null = null;
  return () => {
    if (!p) {
      p = load();
      p.catch(() => { p = null; });
    }
    return p;
  };
}

type Info = { status: string; progress?: number; loaded?: number; total?: number };
/**
 * A model that loads once, shared by every caller. Each call waits with a stall timeout; a call that gives up (or is
 * abandoned) leaves the download running, so the model is cached for next time. Listeners get live byte progress.
 */
function modelLoader<T>(what: string, load: (cb: (info: Info) => void) => Promise<T>) {
  let last = 0;
  const listeners = new Set<OnLoad>();
  const cb = (info: Info) => {
    last = Date.now();
    if (info.status !== 'progress_total' && info.status !== 'progress') return;
    const p: LoadProgress = { progress: (info.progress ?? 0) / 100, loaded: info.loaded, total: info.total };
    listeners.forEach((l) => { try { l(p); } catch { /* UI errors must not break loading */ } });
  };
  const get = once(() => { last = Date.now(); return load(cb); });
  return async (onLoad?: OnLoad): Promise<T> => {
    const p = get();
    if (onLoad) listeners.add(onLoad);
    try { return await withStallTimeout(p, () => last, STALL_MS, LOAD_CAP_MS, what); }
    finally { if (onLoad) listeners.delete(onLoad); }
  };
}

const loadTF = once(async () => {
  const tf: TF = await import('@huggingface/transformers');
  // Desktop (Tauri) build: models ship in /models (scripts/fetch-models.mjs) and are read from there, never from the network.
  const desktop = '__TAURI_INTERNALS__' in window;
  tf.env.allowLocalModels = desktop;
  tf.env.allowRemoteModels = !desktop;
  tf.env.useBrowserCache = !desktop; // already local files: no second copy in the Cache API
  tf.env.localModelPath = import.meta.env.BASE_URL + 'models/';
  const wasm = tf.env.backends.onnx.wasm;
  if (wasm) {
    // Explicit, absolute URLs of the one runtime pair scripts/copy-ort.mjs ships (the vite config selects ORT's
    // extern-wasm build, so nothing is embedded). Absolute: the dev server rejects `import('/public-file?import')`.
    const base = new URL(import.meta.env.BASE_URL + 'ort/', location.href).href;
    wasm.wasmPaths = { mjs: base + 'ort-wasm-simd-threaded.asyncify.mjs', wasm: base + 'ort-wasm-simd-threaded.asyncify.wasm' };
  }
  return tf;
});

const loadSegmenter = modelLoader('Background-removal model', async (cb) => {
  const tf = await loadTF();
  return tf.AutoModel.from_pretrained(SEGMENT_MODEL, { dtype: 'fp32', device: 'wasm', progress_callback: cb });
});

const loadClip = modelLoader('Recognition model', async (cb) => {
  const tf = await loadTF();
  return tf.pipeline('zero-shot-image-classification', CLIP_MODEL, { dtype: 'q8', device: 'wasm', progress_callback: cb });
});

/** U-2-Netp foreground mask at the image's resolution. Throws on load/inference failure or timeout. */
export async function mlSegment(img: RGBAImage, onLoad?: OnLoad): Promise<Mask> {
  const model = await loadSegmenter(onLoad);
  const tf = await loadTF();
  const session = model.sessions.model;
  const input = new tf.Tensor('float32', toU2Input(img), [1, 3, U2_SIZE, U2_SIZE]);
  const out = await withTimeout<Record<string, { data: ArrayLike<number> }>>(
    model({ [session.inputNames[0]]: input }), RUN_TIMEOUT_MS, 'Background removal');
  const pred = out[session.outputNames[0]];
  if (!pred || pred.data.length < U2_SIZE * U2_SIZE) throw new Error('Unexpected segmentation output');
  return maskFromU2(pred.data, img.width, img.height);
}

/** Zero-shot CLIP category ranking. Throws on load/inference failure or timeout. */
export async function mlClassify(img: RGBAImage, onLoad?: OnLoad): Promise<CategorySuggestion[]> {
  const classify = await loadClip(onLoad);
  const tf = await loadTF();
  const image = new tf.RawImage(new Uint8ClampedArray(img.data), img.width, img.height, 4).rgb();
  const out = await withTimeout(classify(image, Object.values(CLIP_PROMPTS), { hypothesis_template: '{}' }), RUN_TIMEOUT_MS, 'Recognition');
  const list = suggestionsFromClip(out as { label: string; score: number }[], Infinity); // all: analyze re-weighs by size
  if (!list.length) throw new Error('Empty classification');
  return list;
}
