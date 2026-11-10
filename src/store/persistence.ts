import { get, set } from 'idb-keyval';
import type { Project } from '../types';
import { useStore } from './store';
import { isProject } from './projectFile';

const KEY = 'room-planner/project';
const DEBOUNCE_MS = 400;

let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Project | null = null;

const flush = () => {
  clearTimeout(timer);
  if (pending) set(KEY, pending).catch((e) => console.error('Autosave failed', e));
  pending = null;
};

/** Loads the autosaved project from IndexedDB into the store (sets hydrated=true), then autosaves on every project change (debounced). */
export const initPersistence = async (): Promise<void> => {
  unsubscribe?.();
  try {
    const saved = await get<unknown>(KEY);
    if (isProject(saved)) useStore.getState().replaceProject(saved);
  } catch (e) {
    console.error('Could not load the saved project', e);
  }
  useStore.setState({ hydrated: true });
  unsubscribe = useStore.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    pending = s.project;
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  });
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);
};
