const MARGIN_CM = 40;

/** Renders the current 2D plan (active room + layout, no UI chrome) to a PNG. */
export const exportPlanPng = async (): Promise<Blob> => {
  const svg = document.querySelector<SVGSVGElement>('svg[data-testid="plan-svg"]:not([data-readonly="true"])');
  const bounds = svg?.getAttribute('data-bounds');
  if (!svg || !bounds) throw new Error('No room to export');
  const [minX, minY, maxX, maxY] = bounds.split(' ').map(Number);
  const k = Number(svg.getAttribute('data-px-per-cm')) || 1; // keep labels/strokes at the on-screen size
  const vx = minX - MARGIN_CM, vy = minY - MARGIN_CM, vw = maxX - minX + 2 * MARGIN_CM, vh = maxY - minY + 2 * MARGIN_CM;
  const w = Math.round(vw * k), h = Math.round(vh * k);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-chrome]').forEach((el) => el.remove());
  clone.querySelector('[data-plan-root]')?.removeAttribute('transform');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the plan'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    const s = Math.min(2, 8192 / Math.max(w, h)); // 2x, but stay within browser canvas limits
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    const c = canvas.getContext('2d');
    if (!c) throw new Error('Canvas unavailable');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
};
