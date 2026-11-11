import { useStore } from '../store/store';
import { putBlob } from '../store/blobs';
import type { Underlay, Vec2 } from '../types';
import { detectRooms } from './detectWalls';
import { loadImageData } from './inkMask';
import { defaultCmPerPx, freshSession, useTrace } from './traceSession';

const MAX_DETECT_SIDE = 1000;

/** Stores an image file as the project's floor-plan underlay (replacing any previous one). Returns an error message or null. */
export async function addPlanImage(file: File): Promise<string | null> {
  if (file.type && !file.type.startsWith('image/')) return 'That is not an image. Use a PNG or JPG screenshot of the plan.';
  try {
    const bmp = await createImageBitmap(file);
    const { width, height } = bmp;
    bmp.close();
    const imageId = await putBlob(file);
    const st = useStore.getState();
    st.setUnderlay({ imageId, widthPx: width, heightPx: height, cmPerPx: defaultCmPerPx(width), x: 0, y: 0, opacity: 0.6, visible: true });
    useTrace.setState({ ...freshSession(), step: 2 });
    return null;
  } catch {
    return "Couldn't read that image. Try a PNG or JPG screenshot.";
  }
}

/** Every enclosed room-sized region of the underlay image, in plan cm. */
export async function detectPlanRooms(u: Underlay): Promise<Vec2[][]> {
  const r = await loadImageData(u.imageId, MAX_DETECT_SIDE);
  if (!r) return [];
  const k = r.scale * u.cmPerPx;
  return detectRooms(r.image).map((poly) => poly.map((p) => ({ x: u.x + p.x * k, y: u.y + p.y * k })));
}
