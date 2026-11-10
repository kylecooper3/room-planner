import { lazy, Suspense, useEffect } from 'react';
import { useStore } from '../store/store';
import { HelpOverlay } from './HelpOverlay';
import { Inspector } from './Inspector';
import { LayoutsBar } from './LayoutsBar';
import { LibraryPanel } from './LibraryPanel';
import { RoomSetupDialog } from './RoomSetupDialog';
import { handleShortcut } from './shortcuts';
import { Toolbar } from './Toolbar';
import { ViewArea } from './ViewArea';
import './styles.css';

// The photo pipeline (ML) is only loaded when the dialog opens.
const ItemCreator = lazy(() => import('../photo/ItemCreator').then((m) => ({ default: m.ItemCreator })));

function DialogHost() {
  const dialog = useStore((s) => s.ui.dialog);
  switch (dialog) {
    // 'floorplan' is the docked tracing panel, rendered beside the plan by ViewArea (not modal).
    case 'item-creator': return <Suspense fallback={<div className="dialog-backdrop"><div className="dialog">Loading the photo studio…</div></div>}><ItemCreator /></Suspense>;
    case 'help': return <HelpOverlay />;
    case 'room-setup': return <RoomSetupDialog />;
    default: return null;
  }
}

export function App() {
  const hydrated = useStore((s) => s.hydrated);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (handleShortcut(e, useStore.getState())) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!hydrated) {
    return <div className="app-splash" data-testid="splash"><span className="app-splash-icon" aria-hidden>🏠</span>Room Planner<small>Unpacking your rooms…</small></div>;
  }
  return (
    <div className="app" data-testid="app">
      <Toolbar />
      <div className="app-body">
        <LibraryPanel />
        <div className="app-center">
          <LayoutsBar />
          <ViewArea />
        </div>
        <Inspector />
      </div>
      <DialogHost />
    </div>
  );
}
