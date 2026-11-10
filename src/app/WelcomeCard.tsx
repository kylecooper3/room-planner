import { useStore } from '../store/store';
import type { UIState, ViewMode } from '../types';

/** The three ways to start a room (shared by the welcome card and the toolbar's "+ New room" menu). */
export const startOptions = (view: ViewMode) => {
  const planOrSplit: ViewMode = view === 'split' ? 'split' : 'plan';
  const setUI = (patch: Partial<UIState>) => useStore.getState().setUI(patch);
  return [
    { id: 'dimensions', icon: '📐', label: 'Enter dimensions', hint: 'Type width and length', run: () => setUI({ dialog: 'room-setup' }) },
    { id: 'draw', icon: '✏️', label: 'Draw a room', hint: 'Click the corners', run: () => setUI({ tool: 'draw-room', view: planOrSplit }) },
    { id: 'floorplan', icon: '🗺️', label: 'Import a floor plan', hint: 'Trace over an image', run: () => setUI({ dialog: 'floorplan', view: planOrSplit }) },
  ];
};

export function WelcomeCard() {
  return (
    <div className="app-welcome" data-testid="welcome">
      <h1>Welcome to Room Planner 🏠</h1>
      <p>Recreate your room at real scale, furnish it, and check that everything fits.</p>
      <div className="app-welcome-options">
        {startOptions('plan').map((o) => (
          <button key={o.id} className="btn app-welcome-option" data-testid={`start-${o.id}`} onClick={o.run}>
            <span className="app-welcome-icon" aria-hidden>{o.icon}</span>
            <strong>{o.label}</strong>
            <small>{o.hint}</small>
          </button>
        ))}
      </div>
      <button className="btn primary" data-testid="load-demo" onClick={() => useStore.getState().loadDemo()}>
        ✨ Load demo room
      </button>
    </div>
  );
}
