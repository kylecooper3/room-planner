import { useStore } from '../store/store';
import { MOUSE_GESTURES, SHORTCUTS } from './shortcuts';

export function HelpOverlay() {
  const close = () => useStore.getState().setUI({ dialog: 'none' });
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog app-help" role="dialog" aria-modal="true" aria-label="Help" data-testid="help-overlay">
        <h2>🛋️ How to use Room Planner</h2>
        <div className="app-help-cols">
          <section>
            <h3>Keyboard</h3>
            <table><tbody>
              {SHORTCUTS.map((s) => <tr key={s.keys}><td><kbd>{s.keys}</kbd></td><td>{s.label}</td></tr>)}
            </tbody></table>
          </section>
          <section>
            <h3>Mouse</h3>
            <table><tbody>
              {MOUSE_GESTURES.map(([g, what]) => <tr key={g}><td><kbd>{g}</kbd></td><td>{what}</td></tr>)}
            </tbody></table>
          </section>
        </div>
        <div className="dialog-actions"><button className="btn primary" onClick={close} autoFocus>Got it</button></div>
      </div>
    </div>
  );
}
