import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { CATEGORIES, MATERIALS, PART_ROLES, type ExportProject, type ImportProject, type Project } from '../types';
import { getBlob, putBlobWithId } from './blobs';

export const PROJECT_FILE_EXTENSION = '.roomplan';
const FORMAT = 'room-planner';
const VERSION = 1;

interface ProjectFileJson { format: string; version: number; project: Project; blobTypes: Record<string, string> }

// Deep enough that nothing in the render path (2D, 3D, issues) can crash on data from a file or storage.
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pos = (v: unknown): v is number => num(v) && v > 0;
const str = (v: unknown): v is string => typeof v === 'string';
const arr = (v: unknown, f: (x: unknown) => boolean): v is unknown[] => Array.isArray(v) && v.every(f);
const oneOf = <T extends string>(v: unknown, xs: readonly T[]): v is T => xs.includes(v as T);
const isVec = (v: unknown) => isObj(v) && num(v.x) && num(v.y);
const isOpening = (n: number) => (v: unknown) => isObj(v) && str(v.id) && oneOf(v.kind, ['door', 'window', 'outlet', 'radiator', 'open'] as const)
  && Number.isInteger(v.wall) && (v.wall as number) >= 0 && (v.wall as number) < n
  && num(v.offset) && pos(v.width) && num(v.height) && num(v.sill)
  && (v.swing === undefined || (isObj(v.swing) && oneOf(v.swing.hinge, ['start', 'end'] as const) && oneOf(v.swing.side, ['in', 'out'] as const)));
const hex = (v: unknown) => str(v) && /^#[0-9a-f]{6}$/i.test(v);
const isItem = (v: unknown) => isObj(v) && str(v.id) && str(v.defId) && num(v.x) && num(v.y) && num(v.rotation)
  && (v.colors === undefined || (isObj(v.colors) && Object.entries(v.colors).every(([k, c]) => oneOf(k, PART_ROLES) && hex(c))));
const isLayout = (v: unknown) => isObj(v) && str(v.id) && str(v.name) && arr(v.items, isItem);
const isRoom = (v: unknown) => isObj(v) && str(v.id) && str(v.name) && arr(v.points, isVec) && v.points.length >= 3
  && pos(v.ceilingHeight) && num(v.wallThickness) && v.wallThickness >= 0 && str(v.wallColor)
  && oneOf(v.floor, ['wood', 'carpet', 'tile'] as const)
  && arr(v.openings, isOpening(v.points.length)) && arr(v.layouts, isLayout) && v.layouts.length >= 1 && str(v.activeLayoutId);
const isModel = (v: unknown) => isObj(v) && (v.kind === 'mesh' ? str(v.meshId)
  : v.kind === 'parametric' && oneOf(v.category, CATEGORIES) && oneOf(v.material, MATERIALS)
    && isObj(v.style) && Object.values(v.style).every((x) => ['number', 'string', 'boolean'].includes(typeof x))
    && isObj(v.colors) && PART_ROLES.every((r) => str((v.colors as Obj)[r])));
const isClearance = (v: unknown) => isObj(v) && oneOf(v.kind, ['drawer', 'chair', 'walkway', 'access'] as const)
  && oneOf(v.side, ['front', 'back', 'left', 'right'] as const) && num(v.depth) && str(v.label);
const isDef = (v: unknown) => isObj(v) && str(v.id) && str(v.name) && isObj(v.size) && pos(v.size.w) && pos(v.size.d) && pos(v.size.h)
  && isModel(v.model) && arr(v.clearances, isClearance) && oneOf(v.source, ['preset', 'user'] as const)
  && (v.photoId === undefined || str(v.photoId));
const isUnderlay = (v: unknown) => v === null || (isObj(v) && str(v.imageId) && pos(v.widthPx) && pos(v.heightPx) && pos(v.cmPerPx)
  && num(v.x) && num(v.y) && num(v.opacity) && typeof v.visible === 'boolean');

/** Shape check for a project coming from outside (file or storage). Placed items whose def is missing are skipped by renderers. */
export const isProject = (p: unknown): p is Project => isObj(p) && p.version === 1 && str(p.name)
  && oneOf(p.units, ['imperial', 'metric'] as const) && arr(p.rooms, isRoom) && arr(p.library, isDef)
  && (p.activeRoomId === null || str(p.activeRoomId)) && (p.underlay === undefined || isUnderlay(p.underlay));

/** Every blob-store id a project refers to (underlay image, photos and meshes of "My stuff" items). */
export const referencedBlobIds = (p: Project): string[] => [
  ...new Set([p.underlay?.imageId, ...p.library.flatMap((d) => [d.photoId, d.model.kind === 'mesh' ? d.model.meshId : undefined])]
    .filter((id): id is string => !!id)),
];

export const exportProject: ExportProject = async (project) => {
  const files: Record<string, Uint8Array> = {};
  const blobTypes: Record<string, string> = {};
  for (const id of referencedBlobIds(project)) {
    const blob = await getBlob(id);
    if (!blob) continue;
    files[`blobs/${id}`] = new Uint8Array(await blob.arrayBuffer());
    blobTypes[id] = blob.type;
  }
  const json: ProjectFileJson = { format: FORMAT, version: VERSION, project, blobTypes };
  files['project.json'] = strToU8(JSON.stringify(json));
  return new Blob([zipSync(files)], { type: 'application/zip' });
};

export const importProject: ImportProject = async (file) => {
  let files: Record<string, Uint8Array>;
  let json: Partial<ProjectFileJson>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    json = JSON.parse(strFromU8(files['project.json']));
  } catch {
    throw new Error('This is not a Room Planner file (could not read the archive).');
  }
  if (json?.format !== FORMAT) throw new Error('This is not a Room Planner file.');
  if (json.version !== VERSION) throw new Error(`Unsupported Room Planner file version: ${String(json.version)}.`);
  if (!isProject(json.project)) throw new Error('The Room Planner file is damaged (invalid project data).');
  const types = json.blobTypes ?? {};
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith('blobs/')) continue;
    const id = path.slice('blobs/'.length);
    await putBlobWithId(id, new Blob([new Uint8Array(bytes)], { type: types[id] ?? '' }));
  }
  return json.project;
};
