import { activeItems, expect, loadDemo, state, test } from './fixtures';

const SAGE = '#97a585';
const bedColors = async (page: Parameters<typeof activeItems>[0]) =>
  (await activeItems(page)).find((i) => i.defId === 'preset-bed-queen')!.colors;

test('per-item colour: pick from the inspector palette (one undo step), custom drags collapse, reset, duplicate keeps it', async ({ page }) => {
  await loadDemo(page);
  const bed = (await activeItems(page)).find((i) => i.defId === 'preset-bed-queen')!;
  await page.evaluate((id) => window.__store.getState().select({ type: 'item', id }), bed.id);
  await expect(page.locator('.app-inspector h2')).toHaveText('Queen bed');
  // Only the parts a bed actually has, by their bed names.
  for (const role of ['frame', 'cushion', 'body', 'accent']) await expect(page.getByTestId(`item-color-${role}`)).toBeVisible();
  await expect(page.locator('.app-inspector')).toContainText('Pillows');

  await page.getByTestId('item-color-cushion').click();
  await expect(page.getByTestId('item-color-cushion-swatch')).toHaveCount(16);
  await page.screenshot({ path: 'docs/screenshots/item-colour.png' });
  await page.locator(`[data-testid=item-color-cushion-swatch][data-color="${SAGE}"]`).click();
  await expect(page.getByTestId('item-color-cushion-swatch')).toHaveCount(0); // picking closes the popover
  expect(await bedColors(page)).toEqual({ cushion: SAGE });
  await page.keyboard.press('Control+z');
  expect(await bedColors(page)).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');
  expect(await bedColors(page)).toEqual({ cushion: SAGE });

  // Dragging in the native picker fires many changes: one undo step.
  await page.getByTestId('item-color-cushion').click();
  const custom = page.getByTestId('item-color-cushion-custom');
  await custom.focus();
  for (const c of ['#aa0000', '#bb1111', '#cc2222']) await custom.fill(c);
  await custom.blur();
  expect(await bedColors(page)).toEqual({ cushion: '#cc2222' });
  await page.getByTestId('item-color-cushion').click(); // closes the popover
  await page.keyboard.press('Control+z');
  expect(await bedColors(page)).toEqual({ cushion: SAGE });

  await page.getByTestId('item-color-cushion').click();
  await page.getByTestId('item-color-cushion-reset').click();
  expect(await bedColors(page)).toBeUndefined();
  await page.keyboard.press('Control+z');

  await page.getByTestId('item-duplicate').click();
  const items = await activeItems(page);
  expect(items.filter((i) => i.defId === 'preset-bed-queen').map((i) => i.colors)).toEqual([{ cushion: SAGE }, { cushion: SAGE }]);
  expect((await state(page)).canUndo).toBe(true);
});
