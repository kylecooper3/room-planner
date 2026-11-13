import { Download, RotateCcw, TriangleAlert } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { exportProject, PROJECT_FILE_EXTENSION } from '../store/projectFile';
import { useStore } from '../store/store';
import { download, fileName } from './Toolbar';

/** Last line of defence: a render crash shows a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; exportFailed: boolean }> {
  state = { error: null as Error | null, exportFailed: false };
  static getDerivedStateFromError(error: Error) { return { error }; }

  private exportCurrent = async () => {
    const { project } = useStore.getState();
    try { download(await exportProject(project), fileName(project.name, PROJECT_FILE_EXTENSION)); } catch { this.setState({ exportFailed: true }); }
  };
  private reset = () => {
    if (!confirm('Empty this floor plan? Its rooms will be lost unless you exported it.')) return;
    useStore.getState().newProject();
    this.setState({ error: null, exportFailed: false });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-splash" role="alert" data-testid="crash-screen">
        <TriangleAlert size={36} color="var(--danger)" aria-hidden />Something went wrong
        <small>{this.state.error.message}</small>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn" data-testid="crash-export" onClick={() => void this.exportCurrent()}><Download size={15} /> Export this floor plan</button>
          <button className="btn danger" data-testid="crash-reset" onClick={this.reset}><RotateCcw size={15} /> Reset this floor plan</button>
        </div>
        {this.state.exportFailed && <small className="note error">Export failed too — the project data is probably damaged.</small>}
      </div>
    );
  }
}
