import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { ExportProject, ImportProject, Project } from '../types';
import { getBlob, putBlobWithId } from './blobs';

export const PROJECT_FILE_EXTENSION = '.roomplan';
const FORMAT = 'room-planner';
const VERSION = 1;

interface ProjectFileJson { format: string; version: number; project: Project; blobTypes: Record<string, string> }

/** Basic shape check for a project coming from outside (file or storage). */
export const isProject = (p: unknown): p is Project => {
  const o = p as Partial<Project> | null;
  return !!o && typeof o === 'object' && o.version === 1 && Array.isArray(o.rooms) && Array.isArray(o.library)
    && (o.units === 'imperial' || o.units === 'metric');
};

const referencedBlobIds = (p: Project): string[] => [
  ...new Set([p.underlay?.imageId, ...p.library.map((d) => d.photoId)].filter((id): id is string => !!id)),
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
