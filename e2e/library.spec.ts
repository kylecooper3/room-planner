import type { Page } from '@playwright/test';
import { expect, floorPlans, state, test } from './fixtures';

const card = (page: Page, name: string) => page.getByTestId('plan-card').filter({ has: page.getByTestId('plan-card-name').getByText(name, { exact: true }) });
const roomNames = async (page: Page) => (await state(page)).project.rooms.map((r) => r.name);

test('floor-plan library: demo, new plan from dimensions, switch, rename, delete, reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-empty')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/home-empty.png' });

  // The demo becomes a saved plan of its own.
  await page.getByTestId('home-demo').click();
  await expect(page.getByTestId('plan-item')).toHaveCount(6);
  await expect(page.getByTestId('plan-name')).toHaveText('Demo bedroom');
  await expect(page.getByTestId('room-row')).toHaveCount(1);

  // Back to the library: one card, with its room count.
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('plan-card')).toHaveCount(1);
  await expect(card(page, 'Demo bedroom').getByTestId('plan-card-meta')).toContainText('1 room');

  // New plan, starting from dimensions: the editor opens with the room-size dialog.
  await page.getByTestId('home-new').click();
  await page.getByTestId('home-new-dimensions').click();
  await expect(page.getByRole('dialog', { name: 'Room dimensions' })).toBeVisible();
  await page.getByTestId('room-width').fill('14');
  await page.getByTestId('room-length').fill('11');
  await page.getByTestId('room-create').click();
  await expect(page.getByTestId('plan-name')).toHaveText('Untitled floor plan');
  // A second room in the same plan.
  await page.getByTestId('new-room').click();
  await page.getByTestId('new-room-dimensions').click();
  await page.getByTestId('room-width').fill('8');
  await page.getByTestId('room-length').fill('9');
  await page.getByTestId('room-create').click();
  await expect(page.getByTestId('room-row')).toHaveCount(2);
  expect(await roomNames(page)).toEqual(['My room', 'Room 2']);

  // Rename inline from the breadcrumb.
  await page.getByTestId('plan-name').click();
  await page.getByRole('textbox', { name: 'Floor plan name' }).fill('Our flat');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('plan-name')).toHaveText('Our flat');

  // Switch between the two plans: each keeps its own rooms.
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('plan-card')).toHaveCount(2);
  await expect(card(page, 'Our flat').getByTestId('plan-card-meta')).toContainText('2 rooms');
  await page.screenshot({ path: 'docs/screenshots/home.png' });
  await card(page, 'Demo bedroom').getByTestId('plan-card-open').click();
  await expect(page.getByTestId('plan-name')).toHaveText('Demo bedroom');
  expect(await roomNames(page)).toEqual(['Bedroom']);
  await page.getByTestId('nav-home').click();
  await card(page, 'Our flat').getByTestId('plan-card-open').click();
  await expect(page.getByTestId('room-row')).toHaveCount(2);
  expect(await roomNames(page)).toEqual(['My room', 'Room 2']);
  expect((await state(page)).canUndo).toBe(false); // opening a plan starts a fresh undo history

  // Reload reopens the last plan.
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByTestId('plan-name')).toHaveText('Our flat');
  expect(await roomNames(page)).toEqual(['My room', 'Room 2']);

  // Rename and duplicate from the card menu.
  await page.getByTestId('nav-home').click();
  await card(page, 'Demo bedroom').getByTestId('plan-card-menu').click();
  await page.getByTestId('plan-card-rename').click();
  await page.getByRole('textbox', { name: 'Floor plan name' }).fill('Guest room');
  await page.keyboard.press('Enter');
  await expect(card(page, 'Guest room')).toHaveCount(1);
  await card(page, 'Guest room').getByTestId('plan-card-menu').click();
  await page.getByTestId('plan-card-duplicate').click();
  await expect(card(page, 'Guest room copy')).toHaveCount(1);

  // Delete (after confirming) removes exactly that plan.
  page.once('dialog', (d) => d.accept());
  await card(page, 'Guest room copy').getByTestId('plan-card-menu').click();
  await page.getByTestId('plan-card-delete').click();
  await expect(page.getByTestId('plan-card')).toHaveCount(2);
  expect((await floorPlans(page)).plans.map((p) => p.name).sort()).toEqual(['Guest room', 'Our flat']);
});

test('menus are keyboard operable and Esc closes them', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-demo').click();
  await expect(page.getByTestId('plan-item').first()).toBeVisible();
  await page.getByTestId('file-menu').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('file-new')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('file-home')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('file-new')).toHaveCount(0);
  await expect(page.getByTestId('file-menu')).toBeFocused();
  expect((await state(page)).ui.tool).toBe('select');
});

test('"My stuff" is shared by every floor plan, and survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-demo').click();
  await expect(page.getByTestId('plan-name')).toHaveText('Demo bedroom');
  await page.evaluate(() => window.__store!.getState().saveDef({
    id: 'u-armchair', name: 'Grandma armchair', size: { w: 80, d: 80, h: 90 }, clearances: [], source: 'user',
    model: { kind: 'mesh', meshId: 'm' },
  }));
  // A brand-new plan shows it straight away.
  await page.getByTestId('nav-home').click();
  await page.getByTestId('home-new').click();
  await page.getByTestId('home-new-dimensions').click();
  await page.getByTestId('room-width').fill('10');
  await page.getByTestId('room-length').fill('10');
  await page.getByTestId('room-create').click();
  await page.getByTestId('tab-my-stuff').click();
  await expect(page.getByTestId('my-item')).toHaveText(/Grandma armchair/);
  await page.reload();
  await page.getByTestId('tab-my-stuff').click();
  await expect(page.getByTestId('my-item')).toHaveText(/Grandma armchair/);
});
