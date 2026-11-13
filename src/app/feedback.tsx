import { X } from 'lucide-react';
import { create } from 'zustand';

/** One transient status line (export/import results and failures), shown under the top bar. */
export const useNote = create<{ note: { text: string; error?: boolean } | null }>(() => ({ note: null }));
export const say = (text: string, error = false) => useNote.setState({ note: { text, error } });

/** Runs an async job; a failure becomes an error note instead of an unhandled rejection. */
export async function attempt<T>(what: string, job: () => Promise<T>): Promise<T | undefined> {
  try { return await job(); } catch (err) {
    say(`${what} failed: ${err instanceof Error ? err.message : String(err)}`, true);
    return undefined;
  }
}

export function Note() {
  const note = useNote((s) => s.note);
  if (!note) return null;
  return (
    <div className={`note app-tb-note${note.error ? ' error' : ''}`} role="status" data-testid="toolbar-note">
      {note.text}
      <button className="app-link" onClick={() => useNote.setState({ note: null })} aria-label="Dismiss" title="Dismiss"><X size={14} /></button>
    </div>
  );
}
