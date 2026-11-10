import type { Page } from '@playwright/test';
import {
  activeRoom, clickImg, expect, floorPlanPng, imgToPlan, open, PLAN, planToScreen, roomByDimensions, state, test, uploadPlan,
  wallLengths,
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
};

test('draw tool: snaps to an adjacent room corner exactly; panning mid-draw keeps the outline', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-draw').click();
  for (const [x, y] of [[0, 0], [300, 0], [300, 300], [0, 300]]) await clickPlan(page, x, y);
  await expect(page.getByTestId('draw-hint')).toContainText('green circle');
  await page.getByTestId('draw-finish').click();
  const a = await activeRoom(page);
  await expect(page.getByTestId('plan-room-label')).toHaveCount(1);
  await zoomOut(page);

  // Room 2 starts 3 px (screen) off room 1's top-right corner and ends near its bottom-right one.
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
  await expect(page.getByTestId('snap-marker')).toHaveAttribute('data-kind', 'corner');
  await page.mouse.click(corner.x - 3, corner.y + 2);
  expect((await state(page)).project.rooms).toHaveLength(1); // still drawing: 4 corners placed
  await page.keyboard.press('Enter');
  const b = await activeRoom(page);
  expect(b.id).not.toBe(a.id);
  expect(b.points).toHaveLength(4);
  expect(b.points[0]).toEqual(a.points[1]); // shared corners are exactly equal
  expect(b.points[3]).toEqual(a.points[2]);
  expect(b.points[1].y).toBe(0);
  expect(b.points[2].x).toBe(b.points[1].x);
});

test('draw tool: corners snap onto the plan wall\'s inner face when clicked 3-4 px off it', async ({ page }) => {
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

test('2D shows every room; clicking a dimmed room activates it; doors go on any room', async ({ page }) => {
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
  await expect(page.locator(`[data-other-room="${second.id}"]`)).toHaveCount(1);

  // Door tool on the (now inactive) second room's wall: it is placed there and that room becomes active.
  await page.getByTestId('tool-door').click();
  await clickPlan(page, 430, 304);
  const s2 = await state(page);
  expect(s2.project.activeRoomId).toBe(second.id);
  expect(s2.project.rooms.find((r) => r.id === second.id)!.openings).toHaveLength(1);
});
