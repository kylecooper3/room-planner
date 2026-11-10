import { expect, test } from 'vitest';
import { findIssues } from '../core/collision';
import { PRESETS } from '../models/presets';
import { buildDemoProject } from './demo';
import { useStore } from './store';
import { selectDef } from './selectors';

// Un-mocked core + models + store: the demo room must be issue-free with the real preset sizes.
test('demo room has zero issues with the real presets', () => {
  const p = buildDemoProject();
  const room = p.rooms[0];
  const getDef = (id: string) => PRESETS.find((d) => d.id === id);
  for (const i of room.layouts[0].items) expect(getDef(i.defId), i.defId).toBeDefined();
  expect(findIssues(room, room.layouts[0], getDef)).toEqual([]);
});

test('loadDemo through the real store resolves every def and has zero issues', () => {
  useStore.getState().loadDemo();
  const s = useStore.getState();
  const room = s.project.rooms[0];
  expect(findIssues(room, room.layouts[0], (id) => selectDef(s, id))).toEqual([]);
});
