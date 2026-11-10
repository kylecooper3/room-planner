import { useStore } from '../store/store';
import { useBlobUrl } from '../store/blobs';

/** SVG <image> of project.underlay in plan space (rendered by PlanEditor beneath everything). Renders nothing when absent/hidden. */
export function UnderlayLayer() {
  const u = useStore((s) => s.project.underlay);
  const url = useBlobUrl(u?.imageId);
  if (!u || !u.visible || !url) return null;
  return (
    <image
      data-testid="underlay-image"
      href={url}
      x={u.x}
      y={u.y}
      width={u.widthPx * u.cmPerPx}
      height={u.heightPx * u.cmPerPx}
      opacity={u.opacity}
      preserveAspectRatio="none"
      style={{ pointerEvents: 'none' }}
    />
  );
}
