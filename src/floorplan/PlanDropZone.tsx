import { useState, type DragEvent } from 'react';
import { useStore } from '../store/store';
import { addPlanImage } from './planImage';
import { PickImage } from './TracePanel';
import { Map as MapIcon } from 'lucide-react';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** Drag-and-drop of a floor-plan image anywhere on the view area (opens the tracing panel). */
export function usePlanDrop() {
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const handlers = {
    onDragOver: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); },
    onDragLeave: (e: DragEvent) => { if (e.currentTarget === e.target) setOver(false); },
    onDrop: async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(false);
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/')) ?? e.dataTransfer.files[0];
      if (!file) return;
      useStore.getState().setUI({ dialog: 'floorplan', view: 'plan' });
      setError((await addPlanImage(file)) ?? '');
    },
  };
  return { over, error, setError, handlers };
}

/** Big drop target over the plan while the tracing panel is open and no image has been added yet. */
export function PlanDropZone({ over, error, onError }: { over: boolean; error: string; onError(e: string): void }) {
  return (
    <div className={`fp-drop${over ? ' over' : ''}`} data-testid="floorplan-dropzone">
      <div className="fp-drop-card">
        <span className="fp-drop-icon" aria-hidden><MapIcon size={32} strokeWidth={1.5} /></span>
        <strong>Drop your floor-plan image here</strong>
        <span>a screenshot or photo of the plan (PNG or JPG)</span>
        <PickImage label="or choose a file…" primary testId="floorplan-dropzone-file" onError={onError} />
        {error && <div className="note error" role="alert">{error}</div>}
      </div>
    </div>
  );
}
