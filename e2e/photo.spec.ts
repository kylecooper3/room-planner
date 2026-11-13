import type { Page } from '@playwright/test';
import { activeItems, expect, expectCanvasRendered, hue, loadDemo, sofaPng, state, tablePng, test } from './fixtures';

const HUB = /huggingface\.co|hf\.co/;

interface Case {
  name: string; file: () => Buffer; dims: [string, string, string]; cm: [number, number, number]; category: string; material: string;
  bodyOk: (c: { h: number; s: number; l: number }) => boolean;
}
const CASES: Case[] = [
  {
    name: 'Green sofa', file: sofaPng, dims: ['84', '36', '34'], cm: [213.36, 91.44, 86.36], category: 'sofa', material: 'fabric',
    bodyOk: ({ h, s }) => h >= 90 && h <= 160 && s > 0.2,
  },
  {
    name: 'Oak table', file: tablePng, dims: ['63', '35', '30'], cm: [160.02, 88.9, 76.2], category: 'table', material: 'wood',
    bodyOk: ({ h, s, l }) => h >= 15 && h <= 45 && s > 0.2 && l < 0.6, // wood-ish brown
  },
];

async function photoFlow(page: Page, c: Case, offline: boolean, shot?: string) {
  const ortFromCdn: string[] = [];
  page.on('request', (r) => { if (/ort-wasm|onnxruntime/.test(r.url()) && !r.url().startsWith('http://localhost')) ortFromCdn.push(r.url()); });
  await loadDemo(page);
  await page.getByTestId('tab-my-stuff').click();
  await page.getByTestId('new-from-photo').click();
  await page.getByTestId('photo-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: c.file() });
  await page.getByTestId('item-name').fill(c.name);
  for (const [i, k] of (['w', 'd', 'h'] as const).entries()) await page.getByTestId(`dim-${k}`).fill(c.dims[i]);
  await page.getByTestId('analyze-btn').click();

  const category = page.getByTestId('category-select');
  await expect(category).toBeVisible({ timeout: offline ? 30_000 : 240_000 });
  await expect(category).toHaveValue(c.category);
  await expect(page.getByTestId('material-select')).toHaveValue(c.material);
  const body = await page.getByTestId('color-body').inputValue();
  expect(c.bodyOk(hue(body)), `body colour ${body}`).toBe(true);
  const notes = page.locator('.ic-form > .note');
  if (offline) await expect(notes.filter({ hasText: /unavailable/i }).first()).toBeVisible();
  else {
    // U-2-Net really ran on the locally served ONNX runtime. CLIP (~90 MB) loads with a stall timeout, so it normally
    // succeeds even on a cold download; record which path was taken.
    await expect(notes.filter({ hasText: /background removal unavailable/i })).toHaveCount(0);
    const clipFallback = await notes.filter({ hasText: /recognition unavailable/i }).count();
    test.info().annotations.push({ type: 'classification', description: clipFallback ? 'fallback (CLIP load timed out)' : 'CLIP' });
  }
  await expectCanvasRendered(page, page.locator('.ic-preview canvas'));

  // Tweak a style parameter and a colour.
  const firstSelect = page.locator('.ic-style select').first();
  const opts = await firstSelect.locator('option').allTextContents();
  const [styleValue] = await firstSelect.selectOption({ index: opts.length - 1 });
  await page.getByTestId('color-accent').fill('#ff0000');
  if (shot) {
    await page.locator('.ic-body').evaluate((el) => { for (let e: Element | null = el; e; e = e.parentElement) e.scrollTop = 0; });
    await page.screenshot({ path: shot });
  }
  await page.getByTestId('save-item').click();
  await expect(page.getByTestId('save-item')).toHaveCount(0);

  const def = (await state(page)).project.library.find((d) => d.name === c.name)!;
  expect(def).toBeDefined();
  expect(def.size.w).toBeCloseTo(c.cm[0], 9);
  expect(def.size.d).toBeCloseTo(c.cm[1], 9);
  expect(def.size.h).toBeCloseTo(c.cm[2], 9);
  expect(def.photoId).toBeTruthy();
  expect(Object.values((def.model as { style: Record<string, unknown> }).style)).toContain(styleValue);
  expect(def.model).toMatchObject({ kind: 'parametric', category: c.category, colors: { accent: '#ff0000' } });
  const row = page.locator(`[data-testid=my-item][data-def-id="${def.id}"]`);
  await expect(row).toContainText(c.name);

  await row.getByTestId('my-item-place').click();
  expect((await activeItems(page)).filter((i) => i.defId === def.id)).toHaveLength(1);
  await expect(page.locator('[data-testid=plan-item]')).toHaveCount(7);

  await row.getByTestId('my-item-edit').click();
  await page.getByTestId('item-name').fill(`${c.name} (edited)`);
  await page.getByTestId('save-item').click();
  await expect(row).toContainText(`${c.name} (edited)`);
  expect((await state(page)).project.library.find((d) => d.id === def.id)!.photoId).toBe(def.photoId);

  page.once('dialog', (d) => d.accept());
  await row.getByTestId('my-item-delete').click();
  await expect(row).toHaveCount(0);
  expect((await activeItems(page)).filter((i) => i.defId === def.id)).toHaveLength(0);
  expect(ortFromCdn, 'ONNX runtime must be served locally').toEqual([]);
}

test.describe('photo items, hub blocked (fallbacks)', () => {
  test.beforeEach(async ({ page }) => { await page.route(HUB, (r) => r.abort()); });
  for (const [i, c] of CASES.entries()) {
    test(`${c.name} from a photo`, async ({ page }) => {
      await photoFlow(page, c, true, i === 0 ? 'docs/screenshots/item-creator.png' : undefined);
    });
  }
});

test('slow model download: progress shows and Skip goes straight to editing', async ({ page }) => {
  // Hub requests hang (never answered): the "Skip" button must not wait for them.
  await page.route(HUB, () => {});
  await loadDemo(page);
  await page.getByTestId('tab-my-stuff').click();
  await page.getByTestId('new-from-photo').click();
  await page.getByTestId('photo-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: sofaPng() });
  for (const [k, v] of [['w', '84'], ['d', '36'], ['h', '34']] as const) await page.getByTestId(`dim-${k}`).fill(v);
  await page.getByTestId('analyze-btn').click();
  await page.getByTestId('skip-analysis').click();
  await expect(page.getByTestId('category-select')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('category-select')).toHaveValue('sofa'); // size heuristic
  await expect(page.locator('.ic-form > .note').filter({ hasText: /skipped/i })).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test.describe('photo items, live ML from the hub', () => {
  test.beforeAll(async () => {
    const ok = await fetch('https://huggingface.co/api/models/Xenova/clip-vit-base-patch32', { signal: AbortSignal.timeout(8000) })
      .then((r) => r.ok, () => false);
    test.skip(!ok, 'Hugging Face hub unreachable: live ML path not testable here');
  });
  for (const c of CASES) {
    test(`${c.name} from a photo (ML)`, async ({ page }) => {
      test.setTimeout(300_000);
      await photoFlow(page, c, false);
    });
  }
});
