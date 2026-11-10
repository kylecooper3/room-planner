import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { activeItems, activeRoom, dragPlan, expect, expectCanvasRendered, loadDemo, open, sofaPng, state, test } from './fixtures';

test('layouts: add, duplicate, rename, switch, compare', async ({ page }) => {
  await loadDemo(page);
  const tabs = page.getByTestId('layout-tab');
  await page.getByTestId('layout-add').click();
  await expect(tabs).toHaveCount(2);
  await expect(page.getByTestId('plan-item')).toHaveCount(0);
  await tabs.first().click();
  await expect(page.getByTestId('plan-item')).toHaveCount(6);
  await page.getByTestId('layout-duplicate').click();
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(2)).toHaveText('Layout 1 copy');
  await expect(tabs.nth(2)).toHaveAttribute('aria-pressed', 'true');
  const plant = (await activeItems(page)).find((i) => i.defId === 'preset-plant-floor')!;
  await dragPlan(page, plant, { x: 150, y: 300 });

  await tabs.nth(2).dblclick();
  await page.getByLabel('Layout name').fill('Cosy');
  await page.getByLabel('Layout name').press('Enter');
  await expect(tabs.nth(2)).toHaveText('Cosy');
  const room = await activeRoom(page);
  const cosy = room.layouts.find((l) => l.name === 'Cosy')!;
  expect(room.activeLayoutId).toBe(cosy.id);

  await tabs.first().click();
  expect((await activeRoom(page)).activeLayoutId).toBe(room.layouts[0].id);

  await page.getByTestId('view-compare').click();
  await page.getByTestId('compare-layout').selectOption(cosy.id);
  await expect(page.locator('.app-pane-label')).toHaveText(['Layout 1', 'Cosy']);
  const panes = page.getByTestId('plan-svg');
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(1)).toHaveAttribute('data-readonly', 'true');
  const plantTransform = (i: number) => panes.nth(i).locator(`[data-testid=plan-item]`).evaluateAll(
    (els) => els.map((e) => e.querySelector('g')!.getAttribute('transform')));
  expect(await plantTransform(0)).not.toEqual(await plantTransform(1));
  await page.screenshot({ path: 'docs/screenshots/compare.png' });

  await page.getByTestId('compare-3d').click();
  const canvases = page.locator('[data-testid=view3d] canvas');
  await expect(canvases).toHaveCount(2);
  await expectCanvasRendered(page, canvases.nth(0));
  await expectCanvasRendered(page, canvases.nth(1));
});

async function download(page: Page, testId: string) {
  await page.getByTestId('file-menu').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  return { name: dl.suggestedFilename(), bytes: readFileSync((await dl.path())!) };
}

test('persistence: autosave + reload, export/import with photo blob, PNG exports', async ({ page, browser }) => {
  await page.route(/huggingface\.co|hf\.co/, (r) => r.abort());
  await loadDemo(page);
  // A photo item so the archive carries a blob.
  await page.getByTestId('tab-my-stuff').click();
  await page.getByTestId('new-from-photo').click();
  await page.getByTestId('photo-file').setInputFiles({ name: 'sofa.png', mimeType: 'image/png', buffer: sofaPng() });
  await page.getByTestId('item-name').fill('My sofa');
  for (const k of ['w', 'd', 'h']) await page.getByTestId(`dim-${k}`).fill('30');
  await page.getByTestId('analyze-btn').click();
  await page.getByTestId('save-item').click();
  await page.locator('[data-testid=my-item]').getByTestId('my-item-place').click();
  await page.getByTestId('layout-add').click();

  const before = (await state(page)).project;
  expect(before.library).toHaveLength(1);
  await page.waitForTimeout(1000); // autosave is debounced (400 ms)
  await page.reload();
  await expect(page.getByTestId('app')).toBeVisible();
  expect((await state(page)).project).toEqual(before);

  const archive = await download(page, 'file-export');
  expect(archive.name).toMatch(/\.roomplan$/);
  expect(archive.bytes.subarray(0, 2).toString()).toBe('PK');

  for (const [id, view] of [['export-plan-png', 'plan'], ['export-3d-png', '3d']] as const) {
    await page.getByTestId(`view-${view}`).click();
    if (view === '3d') await expectCanvasRendered(page, page.locator('[data-testid=view3d] canvas'));
    const png = await download(page, id);
    expect(png.name).toMatch(/\.png$/);
    expect(png.bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(png.bytes.length).toBeGreaterThan(5000);
  }

  // Fresh context = empty IndexedDB.
  const ctx = await browser.newContext();
  const fresh = await ctx.newPage();
  const errors: string[] = [];
  fresh.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  fresh.on('pageerror', (e) => errors.push(e.message));
  await open(fresh);
  expect((await state(fresh)).project.rooms).toHaveLength(0);
  await fresh.getByTestId('import-file').setInputFiles({ name: 'home.roomplan', mimeType: 'application/zip', buffer: archive.bytes });
  await expect(fresh.getByTestId('toolbar-note')).toContainText('Opened home.roomplan');
  const imported = (await state(fresh)).project;
  expect(imported.rooms).toEqual(before.rooms);
  expect(imported.library).toEqual(before.library);
  const photoId = before.library[0].photoId!;
  const blobSize = await fresh.evaluate((id) => new Promise<number>((res, rej) => {
    const req = indexedDB.open('keyval-store');
    req.onerror = () => rej(req.error);
    req.onsuccess = () => {
      const get = req.result.transaction('keyval').objectStore('keyval').get(`room-planner/blob/${id}`);
      get.onsuccess = () => res((get.result as { data: ArrayBuffer } | undefined)?.data.byteLength ?? 0);
      get.onerror = () => rej(get.error);
    };
  }), photoId);
  expect(blobSize).toBe(sofaPng().length);
  // The photo shows again when editing the imported item.
  await fresh.getByTestId('tab-my-stuff').click();
  await fresh.getByTestId('my-item-edit').click();
  await expect(fresh.locator('.ic-photo img')).toHaveAttribute('src', /^blob:/);
  expect(errors).toEqual([]);
  await ctx.close();
});
