import type { Page } from '@playwright/test';
import { activeItems, activeRoom, dragPlan, expect, loadDemo, open, planToScreen, roomByDimensions, state, test } from './fixtures';

const clickPlan = async (page: Page, x: number, y: number) => {
  const s = await planToScreen(page, { x, y });
  await page.mouse.click(s.x, s.y);
};
const overlayCount = (page: Page) => page.locator('polygon[fill="#6bb3d6"], polygon[fill="#f2b880"]').count();

test('clearance: a dresser in the door swing is flagged and explained, and clears when moved', async ({ page }) => {
  await roomByDimensions(page);
  await page.getByTestId('tool-door').click();
  await clickPlan(page, -4, 200); // on the left wall
  const room = await activeRoom(page);
  expect(room.openings).toHaveLength(1);
  const door = room.openings[0];
  expect(door).toMatchObject({ kind: 'door', wall: 3, swing: { hinge: 'start', side: 'in' } });
  expect((await state(page)).ui.tool).toBe('select');

  await page.locator('[data-testid=lib-item][data-def-id=preset-dresser]').click();
  const [dresser] = await activeItems(page);
  const item = page.locator(`[data-item-id="${dresser.id}"]`);
  await expect(item).toHaveAttribute('data-issue', 'false');

  await page.keyboard.down('Alt'); // no snapping: land exactly where dropped
  await dragPlan(page, { x: dresser.x, y: dresser.y }, { x: 100, y: 200 });
  await page.keyboard.up('Alt');
  await expect(item).toHaveAttribute('data-issue', 'true');
  await expect(page.getByTestId('issue-callout')).toContainText(/door swing/i); // selected → callout shown
  await expect(page.locator('.app-inspector .note.error')).toContainText(/door swing/i);
  await page.mouse.click(5, 300); // deselect (library panel blank area is not the plan) → room inspector issue list
  await page.getByTestId('plan-svg').click({ position: { x: 20, y: 20 } });
  await expect(page.getByTestId('issues-list')).toContainText(/door swing/i);
  await expect(page.getByTestId('issue-callout')).toHaveCount(0);
  await item.locator('rect').first().hover();
  await expect(page.getByTestId('issue-callout')).toContainText(/door swing/i); // hover → callout

  await page.keyboard.down('Alt');
  await dragPlan(page, { x: 100, y: 200 }, { x: 200, y: 250 });
  await page.keyboard.up('Alt');
  await expect(item).toHaveAttribute('data-issue', 'false');
  await page.getByTestId('plan-svg').click({ position: { x: 20, y: 20 } });
  await expect(page.getByTestId('all-fits')).toBeVisible();

  expect(await overlayCount(page)).toBeGreaterThanOrEqual(2); // dresser drawer zone + door swing
  await page.getByTestId('toggle-clearances').click();
  expect(await overlayCount(page)).toBe(0);
  await page.getByTestId('toggle-clearances').click();
  expect(await overlayCount(page)).toBeGreaterThanOrEqual(2);
});

test('editing: rotate handle snaps to 15°, duplicate, delete, undo/redo, nudge, zoom and pan', async ({ page }) => {
  await loadDemo(page);
  const plant = (await activeItems(page)).find((i) => i.defId === 'preset-plant-floor')!;
  await page.locator(`[data-item-id="${plant.id}"] rect`).first().click();
  expect((await state(page)).ui.selection).toEqual({ type: 'item', id: plant.id });

  const h = (await page.getByTestId('rotate-handle').boundingBox())!;
  const c = await planToScreen(page, plant);
  const deg = 40, r = 120;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + r * Math.sin(deg * Math.PI / 180), c.y - r * Math.cos(deg * Math.PI / 180), { steps: 8 });
  await page.mouse.up();
  const rotated = (await activeItems(page)).find((i) => i.id === plant.id)!;
  expect(rotated.rotation).toBe(45);
  expect(rotated.rotation % 15).toBe(0);
  await page.keyboard.press('Control+z');
  expect((await activeItems(page)).find((i) => i.id === plant.id)!.rotation).toBe(0); // the whole drag = one undo step
  await page.keyboard.press('Control+Shift+z');
  expect((await activeItems(page)).find((i) => i.id === plant.id)!.rotation).toBe(45);

  await page.keyboard.press('Control+d');
  let items = await activeItems(page);
  expect(items).toHaveLength(7);
  const copy = items[6];
  expect(copy.defId).toBe('preset-plant-floor');
  expect((await state(page)).ui.selection).toEqual({ type: 'item', id: copy.id });
  await page.keyboard.press('Delete');
  expect(await activeItems(page)).toHaveLength(6);
  await page.keyboard.press('Control+z');
  expect(await activeItems(page)).toHaveLength(7);
  await page.keyboard.press('Control+Shift+z');
  expect(await activeItems(page)).toHaveLength(6);

  await page.locator(`[data-item-id="${plant.id}"] rect`).first().click();
  const before = (await activeItems(page)).find((i) => i.id === plant.id)!;
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowUp');
  const nudged = (await activeItems(page)).find((i) => i.id === plant.id)!;
  expect(nudged.x).toBeCloseTo(before.x - 1, 6);
  expect(nudged.y).toBeCloseTo(before.y - 10, 6);

  // Zoom in with the wheel, pan by dragging the background, then items are still draggable.
  const svg = (await page.getByTestId('plan-svg').boundingBox())!;
  const k0 = Number(await page.getByTestId('plan-svg').getAttribute('data-px-per-cm'));
  const at = await planToScreen(page, nudged);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -300); // zooms about the pointer: the plant stays under it
  await expect.poll(async () => Number(await page.getByTestId('plan-svg').getAttribute('data-px-per-cm'))).toBeGreaterThan(k0);
  const p0 = await planToScreen(page, { x: 0, y: 0 });
  // Middle-button drag pans even over items (a left drag here would grab the rug).
  await page.mouse.move(svg.x + 150, svg.y + 150);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(svg.x + 50, svg.y + 100, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  const p1 = await planToScreen(page, { x: 0, y: 0 });
  expect(p1.x - p0.x).toBeCloseTo(-100, 0);
  expect(p1.y - p0.y).toBeCloseTo(-50, 0);
  await page.keyboard.down('Alt');
  await dragPlan(page, nudged, { x: nudged.x - 30, y: nudged.y - 40 });
  await page.keyboard.up('Alt');
  const dragged = (await activeItems(page)).find((i) => i.id === plant.id)!;
  expect(dragged.x).toBeCloseTo(nudged.x - 30, 0);
  expect(dragged.y).toBeCloseTo(nudged.y - 40, 0);

  // Shortcuts must not fire while typing in a field.
  await page.getByTestId('item-x').click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowLeft');
  expect(await activeItems(page)).toHaveLength(6);
});

test('draw tool: L-shaped room with right-angle snapping, Enter closes', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-draw').click();
  const pts = [[0, 0], [400, 6], [397, 200], [200, 205], [204, 400], [3, 397]];
  for (const [x, y] of pts) await clickPlan(page, x, y);
  await page.keyboard.press('Enter');
  const room = await activeRoom(page);
  expect(room.points).toHaveLength(6);
  const n = room.points.length;
  for (let i = 0; i < n; i++) {
    const a = room.points[i], b = room.points[(i + 1) % n];
    expect(a.x === b.x || a.y === b.y, `wall ${i} axis-aligned`).toBe(true);
  }
  expect(room.points.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[0, 0], [400, 0], [400, 200], [200, 200], [200, 400], [0, 400]]);
  expect((await state(page)).ui.tool).toBe('select');
});

test('openings: window, outlet, radiator; door hinge and swing from the inspector; corner insertion', async ({ page }) => {
  await loadDemo(page);
  const kinds = async () => (await activeRoom(page)).openings.map((o) => o.kind).sort();
  await page.getByTestId('tool-window').click();
  await clickPlan(page, 150, -4); // top wall
  await page.getByTestId('tool-outlet').click();
  await clickPlan(page, 60, 369); // bottom wall
  await page.getByTestId('tool-radiator').click();
  await clickPlan(page, 308, 100); // right wall
  expect(await kinds()).toEqual(['door', 'outlet', 'outlet', 'radiator', 'radiator', 'window', 'window']);
  await expect(page.getByTestId('plan-opening')).toHaveCount(7);

  const door = (await activeRoom(page)).openings.find((o) => o.kind === 'door')!;
  await page.locator(`[data-opening-id="${door.id}"] line`).last().click({ force: true });
  expect((await state(page)).ui.selection).toEqual({ type: 'opening', id: door.id });
  await page.getByTestId('door-hinge').click();
  await page.getByTestId('door-swing').click();
  expect((await activeRoom(page)).openings.find((o) => o.id === door.id)!.swing).toEqual({ hinge: 'end', side: 'out' });

  // Out-of-range door widths are rejected with the allowed range instead of being silently clamped.
  for (const bad of ['9999', '1']) {
    await page.getByTestId('opening-width').fill(bad);
    await page.getByTestId('opening-width').press('Enter');
    await expect(page.getByTestId('opening-width-error')).toContainText('Must be');
    expect((await activeRoom(page)).openings.find((o) => o.id === door.id)!.width).toBe(door.width);
  }
  await page.getByTestId('opening-width').press('Escape');

  // Double-click a wall to insert a corner: later openings are re-indexed, all in ONE undo step.
  const before = await activeRoom(page);
  const wall0 = before.openings.filter((o) => o.wall === 0);
  await page.mouse.click(10, 10); // focus away
  const s = await planToScreen(page, { x: 50, y: -6 }); // left of the new window
  await page.mouse.dblclick(s.x, s.y);
  const after = await activeRoom(page);
  expect(after.points).toHaveLength(5);
  expect(after.points[1].x).toBeCloseTo(50, -1);
  expect((await state(page)).ui.selection).toEqual({ type: 'corner', index: 1 });
  for (const o of before.openings) {
    const a = after.openings.find((x) => x.id === o.id)!;
    if (o.wall > 0) expect(a.wall).toBe(o.wall + 1);
  }
  for (const o of wall0) {
    const a = after.openings.find((x) => x.id === o.id)!;
    if (o.offset > after.points[1].x) expect(a).toMatchObject({ wall: 1, offset: expect.closeTo(o.offset - after.points[1].x, 3) });
    else expect(a).toMatchObject({ wall: 0, offset: o.offset });
  }
  await page.keyboard.press('Control+z');
  expect(await activeRoom(page)).toEqual(before);
});

test('dialogs close; wall colour drag is one undo step; Esc leaves tools', async ({ page }) => {
  await loadDemo(page);
  await page.getByTestId('open-help').click();
  await expect(page.getByTestId('help-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help-overlay')).toHaveCount(0);
  await page.keyboard.press('?');
  await expect(page.getByTestId('help-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByTestId('help-overlay')).toHaveCount(0);

  await page.getByTestId('new-room').click();
  await page.getByTestId('new-room-dimensions').click();
  await expect(page.getByRole('dialog', { name: 'Room dimensions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const color = page.getByTestId('wall-color');
  const before = (await activeRoom(page)).wallColor;
  await color.focus();
  for (const c of ['#aa0000', '#bb1111', '#cc2222']) await color.fill(c);
  await color.blur();
  expect((await activeRoom(page)).wallColor).toBe('#cc2222');
  await page.keyboard.press('Control+z');
  expect((await activeRoom(page)).wallColor).toBe(before);

  await page.getByTestId('tool-window').click();
  await page.keyboard.press('Escape');
  expect((await state(page)).ui.tool).toBe('select');
});
