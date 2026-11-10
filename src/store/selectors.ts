import { useMemo } from 'react';
import type { AppState, Issue, ItemDef, Layout, Room } from '../types';
import { findIssues } from '../core/collision';
import { PRESETS } from '../models/presets';
import { useStore } from './store';

/** Pure selectors (usable outside React via useStore.getState()). */
export const selectActiveRoom = (s: AppState): Room | null =>
  s.project.rooms.find((r) => r.id === s.project.activeRoomId) ?? null;
/** The given layout of the active room, or its active layout when layoutId is omitted. */
export const selectLayout = (s: AppState, layoutId?: string): Layout | null => {
  const room = selectActiveRoom(s);
  const id = layoutId ?? room?.activeLayoutId;
  return room?.layouts.find((l) => l.id === id) ?? null;
};
const lookupDef = (library: ItemDef[], defId: string): ItemDef | undefined =>
  PRESETS.find((d) => d.id === defId) ?? library.find((d) => d.id === defId);
/** Looks a def up in presets, then "My stuff". */
export const selectDef = (s: AppState, defId: string): ItemDef | undefined => lookupDef(s.project.library, defId);

/** React hooks (must return stable references between unrelated store updates). */
export const useActiveRoom = (): Room | null => useStore(selectActiveRoom);
export const useLayout = (layoutId?: string): Layout | null => useStore((s) => selectLayout(s, layoutId));
export const useGetDef = (): ((defId: string) => ItemDef | undefined) => {
  const library = useStore((s) => s.project.library);
  return useMemo(() => (defId: string) => lookupDef(library, defId), [library]);
};
const NO_ISSUES: Issue[] = [];
/** Memoised findIssues() for the given (or active) layout of the active room. */
export const useIssues = (layoutId?: string): Issue[] => {
  const room = useActiveRoom();
  const layout = useLayout(layoutId);
  const getDef = useGetDef();
  return useMemo(() => (room && layout ? findIssues(room, layout, getDef) : NO_ISSUES), [room, layout, getDef]);
};
