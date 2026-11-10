import type { Camera, Scene, WebGLRenderer } from 'three';

interface Entry { readOnly: boolean; get: () => { gl: WebGLRenderer; scene: Scene; camera: Camera } }
const registry: Entry[] = [];

/** Called by each mounted View3D canvas; returns the unregister function. */
export function registerView3d(entry: Entry): () => void {
  registry.push(entry);
  return () => { const i = registry.indexOf(entry); if (i >= 0) registry.splice(i, 1); };
}

/** Captures the (first mounted) 3D view as a PNG. Rejects if no 3D view is mounted. */
export const exportView3dPng = async (): Promise<Blob> => {
  const entry = registry.find((e) => !e.readOnly);
  if (!entry) throw new Error('No 3D view is open. Switch to the 3D view to export an image.');
  const { gl, scene, camera } = entry.get();
  gl.render(scene, camera); // fresh frame so the drawing buffer is valid for toBlob
  return new Promise((resolve, reject) =>
    gl.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not capture the 3D view.'))), 'image/png'));
};
