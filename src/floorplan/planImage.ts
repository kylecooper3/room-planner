import { useStore } from '../store/store';
import { putBlob } from '../store/blobs';
import { defaultCmPerPx, freshSession, useTrace } from './traceSession';

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

