import { useEffect, useState } from 'react';
import { del, get, set } from 'idb-keyval';
import type { DeleteBlob, GetBlob, PutBlob } from '../types';

const key = (id: string) => `room-planner/blob/${id}`;
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
