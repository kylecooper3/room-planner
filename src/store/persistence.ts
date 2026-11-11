import { get, set } from 'idb-keyval';
import { create } from 'zustand';
import type { Project } from '../types';
import { useStore } from './store';
import { isProject, referencedBlobIds } from './projectFile';
import { deleteOrphanBlobs } from './blobs';

const KEY = 'room-planner/project';
/** Where a stored project that fails validation is kept instead of being overwritten. */
export const BACKUP_KEY = 'room-planner/project-backup';
const LOCK = 'room-planner/editor';
const DEBOUNCE_MS = 400;

/** Persistence status shown by the app shell (not part of the project, never persisted). */
export const usePersistence = create<{ readOnly: boolean; notice: string | null }>(() => ({ readOnly: false, notice: null }));

let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Project | null = null;
let lock: Promise<boolean> | null = null;

const flush = () => {
  clearTimeout(timer);
  if (pending) set(KEY, pending).catch((e) => console.error('Autosave failed', e));
  pending = null;
};

/**
 * Takes the editor Web Lock for the rest of the tab's life. Resolves false when another tab holds it (this tab must not
 * save); true when granted or when the Web Locks API is unavailable (then every tab saves, as before).
 */
export const acquireEditLock = (locks: LockManager | undefined = globalThis.navigator?.locks): Promise<boolean> => {
  if (!locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    locks.request(LOCK, { ifAvailable: true }, (l) => {
      resolve(!!l);
      return l ? new Promise<void>(() => {}) : undefined; // never settles: held until the tab closes
    }).catch(() => resolve(true));
  });
};

/**
 * Loads the autosaved project from IndexedDB into the store (sets hydrated=true), then autosaves on every project change
 * (debounced) — only in the tab that holds the edit lock.
 */
export const initPersistence = async (): Promise<void> => {
  unsubscribe?.();
  const owner = await (lock ??= acquireEditLock());
  let canSave = owner;
  let notice: string | null = null;
  try {
    const saved = await get<unknown>(KEY);
    if (isProject(saved)) useStore.getState().replaceProject(saved);
    else if (saved !== undefined) {
      notice = 'Your saved project could not be opened (it looks damaged), so Room Planner started a new one.';
      if (owner) {
        // shortcut: one backup slot, a second damaged load overwrites it; use timestamped keys if that ever matters.
        await set(BACKUP_KEY, saved).then(
          () => { notice += ' The damaged copy was kept as a backup.'; },
          () => { canSave = false; notice += ' It could not be backed up, so changes in this tab will not be saved.'; },
        );
      }
    }
    // Runs before hydrated=true, so no new blob can be in flight; history is empty, so the loaded project is the only
    // reference. Skipped while a damaged backup exists: its images may still be wanted.
    if (canSave && notice === null && (await get(BACKUP_KEY)) === undefined) {
      await deleteOrphanBlobs(referencedBlobIds(useStore.getState().project));
    }
  } catch (e) {
    console.error('Could not load the saved project', e);
  }
  usePersistence.setState({ readOnly: !owner, notice });
  useStore.setState({ hydrated: true });
  if (!canSave) return;
  unsubscribe = useStore.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    pending = s.project;
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  });
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);
};
