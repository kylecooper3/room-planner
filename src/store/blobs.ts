import { useEffect, useState } from 'react';
import { del, get, keys, set } from 'idb-keyval';
import type { DeleteBlob, GetBlob, PutBlob } from '../types';

const PREFIX = 'room-planner/blob/';
const key = (id: string) => `${PREFIX}${id}`;
// Stored as bytes + type: structured cloning of Blob is not reliable across all IndexedDB implementations.
interface StoredBlob { type: string; data: ArrayBuffer }

/** Stores a blob under a given id (used by import to keep ids stable). */
export const putBlobWithId = async (id: string, blob: Blob): Promise<void> => {
  const stored: StoredBlob = { type: blob.type, data: await blob.arrayBuffer() };
  await set(key(id), stored);
};
export const putBlob: PutBlob = async (blob) => {
  const id = crypto.randomUUID();
  await putBlobWithId(id, blob);
  return id;
};
export const getBlob: GetBlob = async (id) => {
  const stored = await get<StoredBlob>(key(id));
  return stored ? new Blob([stored.data], { type: stored.type }) : undefined;
};
export const deleteBlob: DeleteBlob = (id) => del(key(id));

/** Ids of stored blobs (from IndexedDB keys) that `referenced` does not mention. */
export const orphanBlobIds = (storeKeys: IDBValidKey[], referenced: string[]): string[] => {
  const keep = new Set(referenced);
  return storeKeys.flatMap((k) => (typeof k === 'string' && k.startsWith(PREFIX) && !keep.has(k.slice(PREFIX.length)) ? [k.slice(PREFIX.length)] : []));
};
/** Deletes every stored blob not in `referenced`. Only safe when nothing else (undo history, another tab) can refer to a blob. */
export const deleteOrphanBlobs = async (referenced: string[]): Promise<void> => {
  for (const id of orphanBlobIds(await keys(), referenced)) await deleteBlob(id);
};

/** Object URL for a stored blob (undefined while loading / when missing). Revoked automatically. */
export const useBlobUrl = (id: string | undefined | null): string | undefined => {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(undefined);
    if (!id) return;
    let cancelled = false;
    let created: string | undefined;
    getBlob(id).then((b) => {
      if (cancelled || !b) return;
      created = URL.createObjectURL(b);
      setUrl(created);
    }, () => {});
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [id]);
  return url;
};
