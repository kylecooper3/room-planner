import type { Page } from '@playwright/test';
import { enterRoom, expect, open, planToScreen, state, test } from './fixtures';

const zoomOut = async (page: Page) => { for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom out' }).click(); };

const clickPlan = async (page: Page, x: number, y: number) => {
  const s = await planToScreen(page, { x, y });
  await page.mouse.click(s.x, s.y);
};
const drawSquare = async (page: Page, x0: number, size = 300) => {
  await page.getByTestId('tool-draw-room').click();
  for (const [x, y] of [[x0, 0], [x0 + size, 0], [x0 + size, size], [x0, size]]) await clickPlan(page, x, y);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // keep the default name
  await page.keyboard.press('Escape'); // done drawing
};
const planLevel = async (page: Page) => {
  await expect(page.getByTestId('rooms-list')).toBeVisible();
  await expect(page.getByTestId('tab-furniture')).toHaveCount(0);
  await expect(page.getByTestId('layout-tab')).toHaveCount(0);
  await expect(page.getByTestId('room-crumb')).toHaveCount(0);
};

test('demo: plan level → room → back to plan → back home', async ({ page }) => {
  await open(page);
  await page.getByTestId('load-demo').click();
  await planLevel(page);
  const name = (await page.getByTestId('room-row').first().locator('.app-row-name').textContent())!;
  await enterRoom(page, name);
  await expect(page.getByTestId('tab-furniture')).toBeVisible();
  await expect(page.getByTestId('layout-tab').first()).toBeVisible();
  await expect(page.getByTestId('rooms-list')).toHaveCount(0);
  await expect(page.getByTestId('tool-draw-room')).toHaveCount(0);
  await page.getByTestId('nav-back').click();
  await planLevel(page);
  await page.getByTestId('nav-back').click();
  await expect(page.getByTestId('home')).toBeVisible();
});

test('empty plan shows the empty state; drawing rooms stays at plan level; click selects, Open / double-click enters; others greyed inside', async ({ page }) => {
  await open(page);
  await planLevel(page);
  await expect(page.getByText('No rooms yet — add one to start.')).toBeVisible();
  await drawSquare(page, 0);
  await zoomOut(page);
  await drawSquare(page, 330, 200);
  await planLevel(page);
  await expect(page.getByTestId('room-row')).toHaveCount(2);

  // One click inside the first room only highlights it; its Open button (or a double-click) goes in.
  const { project } = await state(page);
  await clickPlan(page, 150, 150);
  expect((await state(page)).project.activeRoomId).toBe(project.rooms[0].id);
  expect((await state(page)).ui.roomOpen).toBe(false);
  await page.getByTestId('plan-open-room').click();
  await expect(page.getByTestId('room-crumb')).toHaveText(project.rooms[0].name);
  expect((await state(page)).project.activeRoomId).toBe(project.rooms[0].id);

  // The other room is greyed and not clickable.
  await expect(page.getByTestId('plan-other-room')).toHaveAttribute('pointer-events', 'none');
  await clickPlan(page, 430, 100);
  expect((await state(page)).project.activeRoomId).toBe(project.rooms[0].id);
  await expect(page.getByTestId('room-crumb')).toHaveText(project.rooms[0].name);

  // The room crumb renames the room; the plan crumb goes back to plan level.
  await page.getByTestId('room-crumb').click();
  await page.getByLabel('Room name').fill('Office');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('room-crumb')).toHaveText('Office');
  await page.getByTestId('plan-name').click();
  await planLevel(page);
  await expect(page.getByTestId('room-row').first()).toContainText('Office');
});

test('deleting the open room through undo drops to plan level', async ({ page }) => {
  await open(page);
  await drawSquare(page, 0);
  await enterRoom(page);
  await page.getByTestId('undo').click();
  await planLevel(page);
  expect((await state(page)).ui.roomOpen).toBe(false);
});
