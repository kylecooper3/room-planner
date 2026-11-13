// The floor-plan library. A floor plan is one `Project` (it holds many rooms). The library keeps many of them in
// IndexedDB and opens one at a time into the main store (useStore). Also owns startup + autosave (persistence.ts re-exports).
//
// Storage (idb-keyval, default store):
//   room-planner/plans        FloorPlanMeta[]    the library index
//   room-planner/plan/<id>    Project            one record per plan
//   room-planner/last-open    string             plan to reopen on startup (absent = start on the library)
//   room-planner/blob/<id>    blobs, shared by every plan (orphan cleanup uses the union of all plans' references)
//   room-planner/plans-backup a damaged index, kept when the index is rebuilt from the plan records
//   room-planner/project      legacy single project: migrated into the first plan, then kept (so an older version still opens it)
import { create } from 'zustand';
import { del, get, keys, set } from 'idb-keyval';
import type { ItemDef, Project, Vec2 } from '../types';
import { THEME } from '../theme';
import { emptyProject, useStore } from './store';
import { exportProject, importProject, isProject, referencedBlobIds } from './projectFile';
import { deleteBlob, deleteOrphanBlobs } from './blobs';

export interface FloorPlanMeta {
  id: string;
  name: string;
  /** ms since epoch, last saved change. */
  updatedAt: number;
  createdAt: number;
  roomCount: number;
  /** Total floor area of all rooms, cm². */
  areaCm2: number;
  /** Small self-contained SVG markup of the room outlines (no external refs), for cards. Empty string if no rooms. */
  thumbnailSvg: string;
}

export interface FloorPlansState {
  /** Most recently updated first. */
  plans: FloorPlanMeta[];
  /** Plan currently open in the editor; null = the floor-plan library (home screen) is showing. */
  activeId: string | null;
  /** False until the library index has loaded from IndexedDB. */
  ready: boolean;
}

export const useFloorPlans = create<FloorPlansState>(() => ({ plans: [], activeId: null, ready: false }));

/** Persistence status shown by the app shell (not part of the project, never persisted). */
export const usePersistence = create<{ readOnly: boolean; notice: string | null }>(() => ({ readOnly: false, notice: null }));

const INDEX = 'room-planner/plans';
const INDEX_BACKUP = 'room-planner/plans-backup';
const PLAN = (id: string) => `room-planner/plan/${id}`;
const LAST = 'room-planner/last-open';
const LEGACY = 'room-planner/project';
/** "My stuff": the user's own furniture, shared by every floor plan (each plan record also keeps the defs it uses). */
const STUFF = 'room-planner/my-stuff';
/** Where a stored project that fails validation is kept instead of being overwritten. */
export const BACKUP_KEY = 'room-planner/project-backup';
const LOCK = 'room-planner/editor';
const DEBOUNCE_MS = 400;
const UNTITLED = 'Untitled floor plan';

// ───────── derived meta ─────────
const area = (pts: Vec2[]) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Room outlines fitted to a viewBox. Numbers only (no names/text), so it is safe to inject as markup. */
export const floorPlanThumbnail = (p: Pick<Project, 'rooms'>): string => {
  const pts = p.rooms.flatMap((r) => r.points).filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
  if (!pts.length) return '';
  const xs = pts.map((v) => v.x), ys = pts.map((v) => v.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  const size = Math.max(w, h, 1), pad = size * 0.06;
  const polys = p.rooms.map((r) => `<polygon points="${r.points.map((v) => `${r1(v.x)},${r1(v.y)}`).join(' ')}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r1(x0 - pad)} ${r1(y0 - pad)} ${r1(w + 2 * pad)} ${r1(h + 2 * pad)}"`
    + ` preserveAspectRatio="xMidYMid meet"><g fill="${THEME.planFloor}" stroke="${THEME.planWall}" stroke-width="${r1(size * 0.015)}"`
    + ` stroke-linejoin="round">${polys}</g></svg>`;
};

const metaOf = (id: string, p: Project, createdAt: number, now = Date.now()): FloorPlanMeta => ({
  id, name: p.name, createdAt, updatedAt: now, roomCount: p.rooms.length,
  areaCm2: p.rooms.reduce((s, r) => s + area(r.points), 0), thumbnailSvg: floorPlanThumbnail(p),
});

// ───────── state ─────────
let canSave = false;
let stuff: ItemDef[] = [];
let lock: Promise<boolean> | null = null;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: { id: string; project: Project } | null = null;
/** True while the library itself swaps the store's project (opening/closing a plan): not a user edit, not saved. */
let applying = false;
let chain: Promise<unknown> = Promise.resolve();
/** Serialises index read-modify-writes so concurrent saves/renames never drop each other's changes. */
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const r = chain.then(fn);
  chain = r.catch(() => {});
  return r;
};

const writable = () => {
  if (!canSave) throw new Error('This tab is read-only (Room Planner is open in another tab), so changes cannot be saved.');
};
const sortPlans = (plans: FloorPlanMeta[]) => [...plans].sort((a, b) => b.updatedAt - a.updatedAt);
const setPlans = (plans: FloorPlanMeta[]) => {
  useFloorPlans.setState({ plans: sortPlans(plans) });
  return set(INDEX, useFloorPlans.getState().plans);
};
const usesDef = (p: Project, id: string) => p.rooms.some((r) => r.layouts.some((l) => l.items.some((i) => i.defId === id)));
/** The open plan's "My stuff" = the shared list (its version wins) + the plan's own defs that its items use (e.g. imported). */
export const withSharedStuff = (p: Project, shared: ItemDef[]): Project => {
  const ids = new Set(shared.map((d) => d.id));
  return { ...p, library: [...shared, ...p.library.filter((d) => !ids.has(d.id) && usesDef(p, d.id))] };
};

const findMeta = (id: string) => useFloorPlans.getState().plans.find((m) => m.id === id);

const writeMeta = async (id: string, project: Project) => {
  const old = findMeta(id);
  if (old) await setPlans(useFloorPlans.getState().plans.map((m) => (m.id === id ? metaOf(id, project, old.createdAt) : m)));
};

/** Writes a plan record and refreshes its meta. The record write starts synchronously (matters on pagehide). */
const savePlan = (id: string, project: Project): Promise<void> => {
  if (!findMeta(id)) return Promise.resolve(); // deleted meanwhile: never resurrect its record
  const record = set(PLAN(id), project);
  stuff = project.library; // the open plan holds the whole shared list, so its library IS the shared list now
  const shared = set(STUFF, stuff);
  return serial(async () => {
    await record;
    await shared;
    await writeMeta(id, project);
  });
};

const onPageHide = () => void flush();
// The desktop window can close without a pagehide; hidden is the last reliable moment to save.
const onVisibility = () => { if (document.visibilityState === 'hidden') void flush(); };
const flush = (): Promise<void> => {
  clearTimeout(timer);
  const p = pending;
  pending = null;
  return p ? savePlan(p.id, p.project).catch((e) => console.error('Autosave failed', e)) : Promise.resolve();
};

const apply = (project: Project, activeId: string | null) => {
  applying = true;
  try { useStore.getState().replaceProject(project); } finally { applying = false; }
  useFloorPlans.setState({ activeId });
};

/** The project a plan holds right now: the live store for the open plan, else its record (throws if damaged). */
const readPlan = async (id: string): Promise<Project> => {
  if (id === useFloorPlans.getState().activeId) return useStore.getState().project;
  const p = await get<unknown>(PLAN(id));
  if (!isProject(p)) throw new Error('This floor plan could not be read (it looks damaged).');
  return p;
};

/** Adds a new plan record + index entry (does not open it). */
const addPlan = (project: Project): Promise<string> => serial(async () => {
  const id = crypto.randomUUID();
  await set(PLAN(id), project);
  await setPlans([...useFloorPlans.getState().plans, metaOf(id, project, Date.now())]);
  return id;
});

/** Loads a plan into the editor. A damaged record is backed up and replaced by an empty plan (as before, per plan). */
const loadIntoEditor = async (id: string): Promise<void> => {
  const saved = await serial(() => get<unknown>(PLAN(id))); // after any queued rename/save of this record
  let project: Project;
  if (isProject(saved)) project = saved;
  else {
    project = { ...emptyProject(), name: findMeta(id)?.name ?? UNTITLED };
    if (saved !== undefined) {
      let notice = `The floor plan "${project.name}" could not be opened (it looks damaged), so it was reset to an empty plan.`;
      if (!canSave) throw new Error('This floor plan could not be opened (it looks damaged).');
      // shortcut: one backup slot, a second damaged load overwrites it; use timestamped keys if that ever matters.
      try { await set(BACKUP_KEY, saved); notice += ' The damaged copy was kept as a backup.'; } catch {
        throw new Error('This floor plan looks damaged and could not be backed up, so it was not opened.');
      }
      usePersistence.setState({ notice });
    }
  }
  apply(withSharedStuff(project, stuff), id);
  if (canSave) await set(LAST, id);
};

// ───────── public API ─────────
/** Creates a plan (empty unless `project` is given), opens it, returns its id. Name defaults to "Untitled floor plan" (or the given project's name). */
export const createFloorPlan = async (opts?: { name?: string; project?: Project }): Promise<string> => {
  writable();
  await flush();
  const project = withSharedStuff({ ...(opts?.project ?? emptyProject()), name: opts?.name ?? opts?.project?.name ?? UNTITLED }, stuff);
  const id = await addPlan(project);
  apply(project, id);
  await set(LAST, id);
  return id;
};

/** Saves the open plan, loads `id` into the editor (clears undo history), remembers it as last opened. */
export const openFloorPlan = async (id: string): Promise<void> => {
  if (id === useFloorPlans.getState().activeId) return;
  if (!findMeta(id)) throw new Error('That floor plan no longer exists.');
  await flush();
  await loadIntoEditor(id);
};

/** Saves the open plan and shows the library (activeId = null). */
export const closeFloorPlan = async (): Promise<void> => {
  await flush();
  apply(emptyProject(), null);
  if (canSave) await del(LAST);
};

export const renameFloorPlan = async (id: string, name: string): Promise<void> => {
  writable();
  const next = name.trim() || UNTITLED;
  if (id === useFloorPlans.getState().activeId) {
    useStore.getState().setProjectName(next); // an undo step; autosave writes record + meta
    await flush();
    return;
  }
  // One serial job (read + write), so an Open queued right after reads the new name.
  await serial(async () => {
    const project = { ...(await readPlan(id)), name: next };
    await set(PLAN(id), project);
    await writeMeta(id, project);
  });
};

/** Copies a plan (incl. its images) as "<name> copy"; does not open it. Returns the new id. */
export const duplicateFloorPlan = async (id: string): Promise<string> => {
  writable();
  await flush();
  const p = await readPlan(id);
  // Blob ids are shared with the original: cleanup keeps any blob referenced by ANY plan.
  return addPlan({ ...p, name: `${p.name} copy` });
};

/** Deletes a plan and the images only it used. If it is open, shows the library afterwards. */
export const deleteFloorPlan = async (id: string): Promise<void> => {
  writable();
  if (id === useFloorPlans.getState().activeId) await closeFloorPlan();
  if (pending?.id === id) { clearTimeout(timer); pending = null; } // an edit made while closing must not recreate it
  const gone = await get<unknown>(PLAN(id));
  await serial(async () => {
    await del(PLAN(id));
    await setPlans(useFloorPlans.getState().plans.filter((m) => m.id !== id));
    if ((await get(LAST)) === id) await del(LAST);
  });
  // With a plan open, its undo history may still point at a shared blob: leave those to the startup sweep.
  if (!isProject(gone) || useFloorPlans.getState().activeId !== null) return;
  // Another plan's record is damaged (its images may still be wanted): skip cleanup, the delete itself succeeded.
  const keep = await referencedByAllPlans().then((ids) => new Set(ids), () => null);
  if (!keep) return;
  for (const b of referencedBlobIds(gone)) if (!keep.has(b)) await deleteBlob(b);
};

/** Reads a .roomplan file and adds it as a NEW plan (never replaces another); does not open it. Returns the new id. */
export const importFloorPlan = async (file: File): Promise<string> => {
  writable();
  return addPlan(await importProject(file)); // validates (isProject) and writes its blobs
};

/** .roomplan file of any plan (open or not). */
export const exportFloorPlan = async (id: string): Promise<Blob> => exportProject(await readPlan(id));

/** Union of blob ids referenced by every plan record and the shared "My stuff"; rejects if some record is damaged (its images may still be wanted). */
const referencedByAllPlans = async (): Promise<string[]> => {
  const ids = referencedBlobIds({ ...emptyProject(), library: stuff });
  for (const m of useFloorPlans.getState().plans) {
    const p = await get<unknown>(PLAN(m.id));
    if (!isProject(p)) throw new Error(`Floor plan ${m.id} is damaged`);
    ids.push(...referencedBlobIds(p));
  }
  return ids;
};

// ───────── startup ─────────
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

/** Moves a pre-library single project into the first plan. Returns a notice when it was damaged. */
const migrateLegacy = async (): Promise<string | null> => {
  const old = await get<unknown>(LEGACY);
  if (old === undefined) return null;
  if (isProject(old)) {
    const id = crypto.randomUUID();
    await set(PLAN(id), old);
    await set(INDEX, [metaOf(id, old, Date.now())]);
    await set(LAST, id); // LEGACY is kept for downgrades; the index now exists, so this never runs again
    return null;
  }
  let notice = 'Your saved project could not be opened (it looks damaged).';
  try {
    await set(BACKUP_KEY, old);
    await set(INDEX, []);
    await del(LEGACY); // damaged: already in BACKUP_KEY, nothing for an older version to open
    notice += ' The damaged copy was kept as a backup.';
  } catch {
    canSave = false;
    notice += ' It could not be backed up, so changes in this tab will not be saved.';
  }
  return notice;
};

/**
 * Loads the library index (migrating a legacy project), reopens the last-opened plan, then autosaves the open plan on
 * every project change (debounced) — only in the tab that holds the edit lock. Sets hydrated and ready either way.
 */
export const initPersistence = async (): Promise<void> => {
  unsubscribe?.();
  clearTimeout(timer);
  pending = null;
  const owner = await (lock ??= acquireEditLock());
  canSave = owner;
  stuff = [];
  let notice: string | null = null;
  try {
    let index = await get<unknown>(INDEX);
    const recordIds = (await keys()).flatMap((k) => (typeof k === 'string' && k.startsWith(PLAN('')) ? [k.slice(PLAN('').length)] : []));
    if (index === undefined && owner && !recordIds.length) {
      notice = await migrateLegacy();
      index = await get<unknown>(INDEX);
    }
    const plans = Array.isArray(index) ? (index as FloorPlanMeta[]).filter((m) => m && typeof m.id === 'string') : [];
    const damaged = index !== undefined && (!Array.isArray(index) || plans.length < index.length);
    // A damaged or missing index: rebuild it from the plan records instead of showing (and sweeping) an empty library.
    const rebuild = damaged || (index === undefined && recordIds.length > 0);
    if (rebuild) {
      const have = new Set(plans.map((m) => m.id));
      for (const id of recordIds) {
        const p = have.has(id) ? undefined : await get<unknown>(PLAN(id));
        if (isProject(p)) plans.push(metaOf(id, p, Date.now()));
      }
      notice = 'The list of floor plans was damaged or missing, so it was rebuilt from your saved plans.';
      if (damaged && canSave) {
        // shortcut: one backup slot, a second rebuild overwrites it.
        await set(INDEX_BACKUP, index).then(() => { notice += ' The damaged list was kept as a backup.'; }, () => { canSave = false; });
      }
      if (canSave) await set(INDEX, sortPlans(plans));
    }
    useFloorPlans.setState({ plans: sortPlans(plans), activeId: null });
    const savedStuff = await get<unknown>(STUFF);
    // Validated like a plan (a damaged list is rebuilt from the plans instead of crashing the editor).
    if (isProject({ ...emptyProject(), library: savedStuff })) stuff = savedStuff as ItemDef[];
    else {
      // First run with a shared list: start from every plan's own "My stuff" (most recently edited plan wins on a clash).
      const seen = new Set<string>();
      stuff = [];
      for (const m of useFloorPlans.getState().plans) {
        const p = await get<unknown>(PLAN(m.id));
        if (isProject(p)) for (const d of p.library) if (!seen.has(d.id)) { seen.add(d.id); stuff.push(d); }
      }
      if (canSave) await set(STUFF, stuff);
    }
    // Runs before hydrated=true and before any plan is open (empty undo history), so the union of all plans' references
    // is everything that can still point at a blob. Skipped while a damaged backup exists, a record is damaged, or the
    // index had to be rebuilt (some plan may be missing from it).
    if (canSave && !rebuild && notice === null && (await get(BACKUP_KEY)) === undefined) {
      await referencedByAllPlans().then(deleteOrphanBlobs, () => {});
    }
    const last = await get<unknown>(LAST);
    if (typeof last === 'string' && findMeta(last)) {
      await loadIntoEditor(last).catch((e: Error) => { notice = e.message; });
    }
  } catch (e) {
    console.error('Could not load the saved floor plans', e);
  }
  usePersistence.setState({ readOnly: !owner, notice: notice ?? usePersistence.getState().notice });
  useFloorPlans.setState({ ready: true });
  useStore.setState({ hydrated: true });
  if (!canSave) return;
  unsubscribe = useStore.subscribe((s, prev) => {
    const { activeId } = useFloorPlans.getState();
    if (s.project === prev.project || applying || !activeId) return;
    pending = { id: activeId, project: s.project };
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), DEBOUNCE_MS);
  });
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
};
