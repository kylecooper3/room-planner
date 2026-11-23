import type { Page } from '@playwright/test';
import {
  activeRoom, clickImg, dragPlan, expect, floorPlanPng, imgToPlan, open, PLAN, planToScreen, rectCorners, roomByDimensions, state, test,
  traceRoom, TWO, twoRoomPng, uploadPlan, wallLengths,
} from './fixtures';

const clickPlan = async (page: Page, x: number, y: number) => {
  const s = await planToScreen(page, { x, y });
  await page.mouse.click(s.x, s.y);
};
/** Zooms out so rooms drawn beside the first one are on screen. */
const zoomOut = async (page: Page) => { for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom out' }).click(); };
const drawRoom = async (page: Page, pts: [number, number][]) => {
  await page.getByTestId('tool-draw-room').click();
  for (const [x, y] of pts) await clickPlan(page, x, y);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // keep the default name
  await page.keyboard.press('Escape'); // done drawing
};

test('draw tool: links to an adjacent room wall (one shared wall); panning mid-draw keeps the outline', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-draw').click();
  for (const [x, y] of [[0, 0], [300, 0], [300, 300], [0, 300]]) await clickPlan(page, x, y);
  await expect(page.getByTestId('draw-hint')).toContainText('green circle');
  await page.getByTestId('draw-finish').click();
  await page.keyboard.press('Escape'); // keep the default name
  const a = await activeRoom(page);
  await expect(page.getByTestId('plan-room-label')).toHaveCount(1);
  await zoomOut(page);

  // Room 2 starts 3 px (screen) off room 1's top-right inside corner and ends near its bottom-right one: both land on
  // room 1's wall outer face, level with those corners, so room 2's wall is room 1's wall.
  const k = Number(await page.getByTestId('plan-svg').getAttribute('data-px-per-cm'));
  await page.getByTestId('tool-draw-room').click();
  await clickPlan(page, 300 + 3 / k, 2 / k);
  await expect(page.getByTestId('draw-hint')).toContainText('next corner');
  await clickPlan(page, 520, 4);
  // Pan with the middle button mid-draw: no stray corner, and the next click still lands.
  const svg = (await page.getByTestId('plan-svg').boundingBox())!;
  await page.mouse.move(svg.x + 300, svg.y + 300);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(svg.x + 260, svg.y + 280, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await clickPlan(page, 523, 300);
  const corner = await planToScreen(page, { x: 300, y: 300 });
  await page.mouse.move(corner.x - 3, corner.y + 2);
  await expect(page.getByTestId('snap-marker')).toHaveAttribute('data-kind', 'wall');
  await page.mouse.click(corner.x - 3, corner.y + 2);
  expect((await state(page)).project.rooms).toHaveLength(1); // still drawing: 4 corners placed
  await page.keyboard.press('Enter');
  const b = await activeRoom(page);
  expect(b.id).not.toBe(a.id);
  expect(b.points).toHaveLength(4);
  const t = a.wallThickness;
  expect(b.points[0]).toEqual({ x: a.points[1].x + t, y: a.points[1].y }); // exactly on the outer face
  expect(b.points[3]).toEqual({ x: a.points[2].x + t, y: a.points[2].y });
  expect(b.points[1].y).toBe(0);
  expect(b.points[2].x).toBe(b.points[1].x);
});

test('draw tool: corners clicked 3-4 px inside the plan wall snap onto its line; on closing the room fits its inner face', async ({ page }) => {
  await uploadPlan(page, floorPlanPng());
  await page.getByTestId('floorplan-skip-scale').click();
  await page.getByTestId('floorplan-trace').click();
  const { x0, y0, x1, y1 } = PLAN.inner;
  // Wait until the ink mask is ready (the snap marker appears when hovering near a wall face).
  const p = await (await import('./fixtures')).imgToScreen(page, x0 + 4, y0 + 3);
  await expect(async () => {
    await page.mouse.move(p.x + 1, p.y);
    await page.mouse.move(p.x, p.y);
    await expect(page.getByTestId('snap-marker')).toHaveAttribute('data-kind', 'ink', { timeout: 500 });
  }).toPass();
  await expect(page.getByTestId('loupe')).toBeVisible();
  await clickImg(page, x0 + 4, y0 + 3);
  await clickImg(page, x1 - 3, y0 + 4);
  await clickImg(page, x1 - 4, y1 - 3);
  await clickImg(page, x0 + 3, y1 + 0);
  await page.keyboard.press('Enter');
  const room = await activeRoom(page);
  const want = [await imgToPlan(page, x0, y0), await imgToPlan(page, x1, y0), await imgToPlan(page, x1, y1), await imgToPlan(page, x0, y1)];
  room.points.forEach((q, i) => {
    expect(q.x, `corner ${i} x`).toBeCloseTo(want[i].x, 6);
    expect(q.y, `corner ${i} y`).toBeCloseTo(want[i].y, 6);
  });
});

test('tracing on the wall lines: outer-edge and inner-edge clicks both give a room on the inner edge, walls as thick as the lines', async ({ page }) => {
  await uploadPlan(page, floorPlanPng());
  await page.getByTestId('floorplan-skip-scale').click();
  await page.getByTestId('floorplan-trace').click();
  await expect(page.getByTestId('draw-hint')).toContainText("Click on the plan's wall lines at each corner");
  const { x0, y0, x1, y1 } = PLAN.inner, t = PLAN.wall;
  const p = await (await import('./fixtures')).imgToScreen(page, x0 - t, y0 - t);
  await expect(async () => { // the ink mask is ready
    await page.mouse.move(p.x + 1, p.y);
    await page.mouse.move(p.x, p.y);
    await expect(page.getByTestId('snap-marker')).toHaveAttribute('data-kind', 'ink', { timeout: 500 });
  }).toPass();
  await clickImg(page, x0 - t, y0 - t); // outer edges of the lines…
  await clickImg(page, x1 + t, y0 - t);
  await clickImg(page, x1 + t, y1 + t);
  await clickImg(page, x0, y1); // …and once the inner edge
  await clickImg(page, x0 - t, y0 - t); // close on the green circle
  await expect(page.getByTestId('room-name-input')).toBeFocused();
  const room = await activeRoom(page);
  const want = [await imgToPlan(page, x0, y0), await imgToPlan(page, x1, y0), await imgToPlan(page, x1, y1), await imgToPlan(page, x0, y1)];
  room.points.forEach((q, i) => {
    expect(Math.abs(q.x - want[i].x), `corner ${i} x`).toBeLessThan(1);
    expect(Math.abs(q.y - want[i].y), `corner ${i} y`).toBeLessThan(1);
  });
  const line = t * (await state(page)).project.underlay!.cmPerPx;
  expect(Math.abs(room.wallThickness - line), `wall ${room.wallThickness} vs line ${line}`).toBeLessThan(1);
  // Dragging a corner onto the outer edge of the lines snaps it to their middle, then refits it onto the inner edge on release.
  await page.keyboard.press('Escape'); // name popover
  await page.keyboard.press('Escape'); // stop drawing
  await dragPlan(page, want[2], await imgToPlan(page, x1 + t, y1 + t));
  const dropped = (await activeRoom(page)).points[2];
  expect(Math.abs(dropped.x - want[2].x), 'dragged corner x').toBeLessThan(1);
  expect(Math.abs(dropped.y - want[2].y), 'dragged corner y').toBeLessThan(1);
  await page.keyboard.press('Control+z'); // the drag
  await page.keyboard.press('Control+z'); // the fitted room was added in one step
  expect((await state(page)).project.rooms).toHaveLength(0);
});

test('wall editing: click a wall, type its length (one undo step), split it', async ({ page }) => {
  await roomByDimensions(page, '10', '12');
  const before = await activeRoom(page);
  await page.locator('[data-testid=plan-wall][data-wall="0"] polygon').first().click();
  expect((await state(page)).ui.selection).toEqual({ type: 'wall', index: 0 });
  await expect(page.locator('[data-testid=plan-wall][data-selected=true]')).toHaveCount(1);
  await expect(page.getByTestId('wall-length')).toHaveValue(`10' 0"`);
  await page.keyboard.press('Delete'); // a wall cannot be deleted: nothing happens
  expect((await activeRoom(page)).points).toEqual(before.points);

  await page.getByTestId('wall-length').fill(`14' 6"`);
  await page.getByTestId('wall-length').press('Enter');
  const after = await activeRoom(page);
  const ls = wallLengths(after.points);
  expect(ls[0]).toBeCloseTo(14.5 * 30.48, 6);
  expect(ls[1]).toBeCloseTo(12 * 30.48, 6);
  expect(ls[2]).toBeCloseTo(14.5 * 30.48, 6);
  for (let i = 0; i < 4; i++) {
    const a = after.points[i], b = after.points[(i + 1) % 4];
    expect(a.x === b.x || a.y === b.y, `wall ${i} still axis-aligned`).toBe(true);
  }
  await page.getByTestId('wall-length').blur();
  await page.keyboard.press('Control+z');
  expect((await activeRoom(page)).points).toEqual(before.points);

  await page.locator('[data-testid=plan-wall][data-wall="1"] polygon').first().click();
  await page.getByTestId('wall-split').click();
  const split = await activeRoom(page);
  expect(split.points).toHaveLength(5);
  expect(split.points[2]).toEqual({ x: before.points[1].x, y: (before.points[1].y + before.points[2].y) / 2 });
  expect((await state(page)).ui.selection).toEqual({ type: 'corner', index: 2 });
});

test('2D shows every room; at plan level a click selects a room and a double-click goes into it; inside, other rooms take no doors', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-draw').click();
  for (const [x, y] of [[0, 0], [300, 0], [300, 300], [0, 300]]) await clickPlan(page, x, y);
  await page.keyboard.press('Enter');
  await zoomOut(page);
  await drawRoom(page, [[330, 0], [530, 0], [530, 300], [330, 300]]);
  const { project } = await state(page);
  expect(project.rooms).toHaveLength(2);
  const [first, second] = project.rooms;
  expect(project.activeRoomId).toBe(second.id);
  await expect(page.getByTestId('plan-other-room')).toHaveCount(1);
  await expect(page.getByTestId('plan-wall')).toHaveCount(4);
  await expect(page.getByTestId('plan-room-label')).toHaveCount(2);
  await expect(page.locator(`[data-testid=plan-room-label][data-room-id="${first.id}"]`)).toContainText(first.name);

  await clickPlan(page, 150, 150);
  expect((await state(page)).project.activeRoomId).toBe(first.id);
  expect((await state(page)).ui.roomOpen).toBe(false);
  const c = await planToScreen(page, { x: 150, y: 150 });
  await page.mouse.dblclick(c.x, c.y);
  expect((await state(page)).ui.roomOpen).toBe(true);
  await expect(page.locator(`[data-other-room="${second.id}"]`)).toHaveCount(1);

  // Inside the first room, the door tool ignores the greyed second room's wall.
  await page.getByTestId('tool-door').click();
  await clickPlan(page, 430, 304);
  const s2 = await state(page);
  expect(s2.project.activeRoomId).toBe(first.id);
  expect(s2.project.rooms.find((r) => r.id === second.id)!.openings).toHaveLength(0);
  // A wall of the open room takes it.
  await clickPlan(page, 150, 300);
  expect((await state(page)).project.rooms.find((r) => r.id === first.id)!.openings).toHaveLength(1);
});

test('open gaps: place an opening like a door, then open and close a whole wall', async ({ page }) => {
  await roomByDimensions(page, '10', '12');
  await page.getByTestId('tool-open').click();
  await clickPlan(page, 150, -6); // on wall 0 (y = 0, wall drawn outside the room)
  let r = await activeRoom(page);
  expect(r.openings).toEqual([expect.objectContaining({ kind: 'open', wall: 0, width: 90 })]);
  expect((await state(page)).ui.selection).toEqual({ type: 'opening', id: r.openings[0].id });
  await expect(page.locator('[data-testid=plan-opening] [data-open-gap]')).toHaveCount(1);
  await expect(page.locator('.app-inspector h2')).toHaveText('Opening');
  await expect(page.getByTestId('opening-height')).toHaveCount(0); // always floor to ceiling
  // A second gap overlapping the first is refused.
  await page.getByTestId('tool-open').click();
  await clickPlan(page, 170, -6);
  expect((await activeRoom(page)).openings).toHaveLength(1);
  await page.keyboard.press('Escape');

  await page.locator('[data-testid=plan-wall][data-wall="1"] polygon').first().click();
  await expect(page.getByTestId('wall-open-toggle')).toHaveText(/Open this wall/);
  await page.getByTestId('wall-open-toggle').click();
  r = await activeRoom(page);
  const len = Math.hypot(r.points[2].x - r.points[1].x, r.points[2].y - r.points[1].y);
  const full = r.openings.find((o) => o.wall === 1)!;
  expect(full).toMatchObject({ kind: 'open' });
  expect(full.width).toBeCloseTo(len, 6);
  expect(full.offset).toBeCloseTo(len / 2, 6);
  await expect(page.locator('[data-testid=plan-opening] [data-open-gap]')).toHaveCount(2);
  await expect(page.getByTestId('wall-open-toggle')).toHaveText(/Close this wall/);
  await page.getByTestId('wall-open-toggle').click();
  expect((await activeRoom(page)).openings.filter((o) => o.wall === 1)).toHaveLength(0);
  await page.keyboard.press('Control+z');
  expect((await activeRoom(page)).openings.filter((o) => o.wall === 1)).toHaveLength(1);
});

test('tracing: a traced room can be renamed from the sidebar after the naming popover is gone (one undo step)', async ({ page }) => {
  const { traceRoom, rectCorners } = await import('./fixtures');
  await uploadPlan(page, floorPlanPng());
  await page.getByTestId('floorplan-skip-scale').click();
  await traceRoom(page, rectCorners(PLAN.inner));
  await page.keyboard.press('Escape'); // dismisses the popover without naming; the room stays
  await expect(page.getByTestId('room-name-popover')).toHaveCount(0);
  const row = page.getByTestId('room-row');
  await row.hover();
  await row.getByTestId('room-rename').click();
  await row.getByRole('textbox', { name: 'Room name' }).fill('Bedroom');
  await row.getByRole('textbox', { name: 'Room name' }).press('Enter');
  await expect(row).toContainText('Bedroom');
  const r = await activeRoom(page);
  expect(r.name).toBe('Bedroom');
  await expect(page.locator(`[data-testid=plan-room-label][data-room-id="${r.id}"]`)).toContainText('Bedroom');
  // Esc cancels a rename.
  await row.getByTestId('room-rename').click();
  await row.getByRole('textbox', { name: 'Room name' }).fill('Nope');
  await row.getByRole('textbox', { name: 'Room name' }).press('Escape');
  await expect(row).toContainText('Bedroom');
  await page.keyboard.press('Control+z');
  expect((await activeRoom(page)).name).toBe('Room 1');
});

test('draw tool: holding Alt turns snapping off; the point follows the mouse', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-draw').click();
  for (const [x, y] of [[0, 0], [300, 0], [300, 300], [0, 300]]) await clickPlan(page, x, y);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // keep the default name
  await zoomOut(page);
  await page.getByTestId('tool-draw-room').click();
  const near = await planToScreen(page, { x: 300, y: 0 });
  await page.mouse.move(near.x + 3, near.y - 2);
  await expect(page.getByTestId('snap-marker')).toHaveAttribute('data-kind', 'wall'); // links to the wall's outer face
  await page.keyboard.down('Alt');
  await expect(page.getByTestId('snap-marker')).toHaveCount(0);
  await expect(page.getByTestId('draw-snap-off')).toBeVisible();
  await page.mouse.click(near.x + 3, near.y - 2);
  await page.keyboard.up('Alt');
  const k = Number(await page.getByTestId('plan-svg').getAttribute('data-px-per-cm'));
  await clickPlan(page, 500, 200);
  await clickPlan(page, 300, 200);
  await page.keyboard.press('Enter');
  const b = await activeRoom(page);
  expect(b.points[0].x).not.toBe(300); // landed where clicked, not on the corner
  expect(Math.abs(b.points[0].x - (300 + 3 / k))).toBeLessThan(1 / k);
});

test('attaching: the linked neighbour wall lights up green; a near-miss gap is marked orange until the corner is dragged onto it', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-draw').click();
  for (const [x, y] of [[0, 0], [300, 0], [300, 300], [0, 300]]) await clickPlan(page, x, y);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // keep the default name
  await zoomOut(page);
  const a = await activeRoom(page);
  const face = 300 + a.wallThickness; // room 1's right wall, outer face
  const k = Number(await page.getByTestId('plan-svg').getAttribute('data-px-per-cm'));

  // 20 screen px off the wall still links to it (and shows "Attached").
  await page.getByTestId('tool-draw-room').click();
  const near = await planToScreen(page, { x: face + 20 / k, y: 150 });
  await page.mouse.move(near.x, near.y);
  await expect(page.getByTestId('snap-marker')).toHaveAttribute('data-kind', 'wall');
  await expect(page.getByTestId('plan-wall-attached')).toHaveCount(1);
  await expect(page.getByTestId('snap-marker')).toContainText('Attached');
  await page.mouse.move(near.x + 200, near.y);
  await expect(page.getByTestId('plan-wall-attached')).toHaveCount(0);

  // A room drawn 8 cm short of the wall with snapping off (Alt): the gap is marked.
  await page.keyboard.down('Alt');
  for (const [x, y] of [[face + 8, 0], [520, 0], [520, 300], [face + 8, 300]]) await clickPlan(page, x, y);
  await page.keyboard.up('Alt');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // keep the default name
  await page.keyboard.press('Escape'); // done drawing
  await expect(page.getByTestId('plan-wall-gap')).toHaveCount(1);
  await expect(page.getByTestId('plan-wall-gap')).toHaveAttribute('data-kind', 'gap');

  // Dragging its corners onto the wall (the strong wall magnet catches them): attached, no mark.
  const b = await activeRoom(page);
  const s0 = await planToScreen(page, b.points[0]), e0 = await planToScreen(page, { x: face + 3 / k, y: 2 / k });
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  await page.mouse.move(e0.x, e0.y, { steps: 8 });
  await expect(page.getByTestId('plan-wall-attached')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId('plan-wall-attached')).toHaveCount(0);
  await dragPlan(page, b.points[3], { x: face + 4 / k, y: 300 - 2 / k }, 8);
  const pts = (await activeRoom(page)).points;
  expect(pts[0]).toEqual({ x: face, y: 0 });
  expect(pts[3]).toEqual({ x: face, y: 300 });
  await expect(page.getByTestId('plan-wall-gap')).toHaveCount(0);
});

test('tracing contrast: over a visible plan image, every drawn room is full strength and its walls use the accent colour', async ({ page }) => {
  await uploadPlan(page, twoRoomPng());
  await page.getByTestId('floorplan-skip-scale').click();
  await traceRoom(page, rectCorners(TWO.a));
  await page.getByTestId('room-name-input').press('Enter');
  await traceRoom(page, rectCorners(TWO.b));
  await page.getByTestId('room-name-input').press('Enter');
  await page.getByTestId('draw-done').click();
  expect((await state(page)).ui.roomOpen).toBe(false);
  const others = page.getByTestId('plan-other-walls');
  await expect(others).toHaveAttribute('opacity', '1');
  await expect(others.locator('polygon').first()).toHaveAttribute('fill', '#2f6bdc'); // THEME.accent
  await expect(page.locator('[data-testid=plan-wall] polygon').first()).toHaveAttribute('fill', '#2f6bdc');
  await page.screenshot({ path: 'test-results/trace-contrast.png' });
});
