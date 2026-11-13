import { ImageUp, PenLine, Ruler, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { createFloorPlan } from '../store/floorPlans';
import { useStore } from '../store/store';
import type { UIState, ViewMode } from '../types';
import { attempt } from './feedback';

export type StartId = 'dimensions' | 'draw' | 'floorplan';
export interface StartOption { id: StartId; icon: ReactNode; label: string; hint: string; run: () => void }

/** The three ways to start a room (welcome card, the Rooms "Add room" menu and the home screen's "New floor plan"). */
export const startOptions = (view: ViewMode): StartOption[] => {
  const planOrSplit: ViewMode = view === 'split' ? 'split' : 'plan';
  const setUI = (patch: Partial<UIState>) => useStore.getState().setUI(patch);
  return [
    { id: 'dimensions', icon: <Ruler size={18} />, label: 'Enter dimensions', hint: 'Type width and length', run: () => setUI({ dialog: 'room-setup' }) },
    { id: 'draw', icon: <PenLine size={18} />, label: 'Draw it', hint: 'Click the corners on a grid', run: () => setUI({ tool: 'draw-room', view: planOrSplit }) },
    { id: 'floorplan', icon: <ImageUp size={18} />, label: 'Trace an image', hint: 'Upload a floor-plan picture', run: () => setUI({ dialog: 'floorplan', view: planOrSplit }) },
  ];
};

/** Creates (and opens) a new floor plan, then starts the chosen way of adding its first room. */
export const newFloorPlan = (start?: StartId) => attempt('Creating the floor plan', async () => {
  await createFloorPlan();
  startOptions('plan').find((o) => o.id === start)?.run();
});

/** First-run hint over an empty plan: the three ways to start. Not modal: the canvas stays usable around it. */
export function WelcomeCard() {
  // A plan is open here, so the demo replaces this (empty) plan and is saved; it renames the plan "Demo bedroom".
  const loadDemo = () => useStore.getState().loadDemo();
  return (
    <div className="app-welcome" data-testid="welcome" role="region" aria-label="Get started">
      <h1>Add your first room</h1>
      <p>Recreate your space at real scale, furnish it, and check that everything fits.</p>
      <div className="app-welcome-options">
        {startOptions('plan').map((o) => (
          <button key={o.id} className="app-option" data-testid={`start-${o.id}`} onClick={o.run}>
            <span className="app-option-icon" aria-hidden>{o.icon}</span>
            <strong>{o.label}</strong>
            <small>{o.hint}</small>
          </button>
        ))}
      </div>
      <div className="app-welcome-foot">
        Just looking around?
        <button className="app-text-btn" data-testid="load-demo" onClick={loadDemo}><Sparkles size={14} /> Load the demo bedroom</button>
      </div>
    </div>
  );
}
