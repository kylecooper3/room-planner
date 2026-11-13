import { House, X } from 'lucide-react';
import { lazy, Suspense, useEffect } from 'react';
import { useFloorPlans } from '../store/floorPlans';
import { usePersistence } from '../store/persistence';
import { useStore } from '../store/store';
import { ErrorBoundary } from './ErrorBoundary';
import { HelpOverlay } from './HelpOverlay';
import { HomeScreen } from './HomeScreen';
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

function PersistenceBanner() {
  const { readOnly, notice } = usePersistence();
  if (!readOnly && !notice) return null;
  return (
    <div className="app-banner" role="alert" data-testid="persistence-banner">
      {readOnly && <div className="note error" data-testid="read-only-banner">Room Planner is open in another tab, so this tab is read-only. Close the other tab and reload.</div>}
      {notice && (
        <div className="note">
          {notice} <button className="app-link" onClick={() => usePersistence.setState({ notice: null })} aria-label="Dismiss" title="Dismiss"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}

export function App() {
  return <ErrorBoundary><AppShell /></ErrorBoundary>;
}

function AppShell() {
  const hydrated = useStore((s) => s.hydrated);
  const ready = useFloorPlans((f) => f.ready);
  const planOpen = useFloorPlans((f) => f.activeId !== null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useFloorPlans.getState().activeId !== null && handleShortcut(e, useStore.getState())) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!hydrated || !ready) {
    return <div className="app-splash" data-testid="splash"><span className="app-mark" aria-hidden><House size={22} /></span>Room Planner<small>Loading your floor plans…</small></div>;
  }
  if (!planOpen) return <div className="app"><PersistenceBanner /><HomeScreen /></div>;
  return (
    <div className="app" data-testid="app">
      <Toolbar />
      <PersistenceBanner />
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
