/** The only browser-dependent image code (decode / encode). Everything else in src/photo is pure. */
export interface RGBAImage { data: Uint8ClampedArray; width: number; height: number }

const MAX_SIDE = 512;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { c, ctx };
}

/** Decodes a photo and downscales it so the longer side is ≤ 512 px. */
export async function decodeImage(blob: Blob): Promise<RGBAImage> {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const { ctx } = canvas(w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}

/** Encodes RGBA (with transparency) as a PNG blob. */
export function encodePng(img: RGBAImage): Promise<Blob> {
  const { c, ctx } = canvas(img.width, img.height);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
}
