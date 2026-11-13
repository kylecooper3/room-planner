import { activeItems, displayToggle, expect, expectCanvasRendered, loadDemo, pngVariety, state, test } from './fixtures';

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Pinhole projection of a world point (m) for a camera at `eye` looking at `target`, vertical fov in degrees. */
function project(p: V3, eye: V3, target: V3, fovDeg: number, w: number, h: number) {
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const d = sub(p, eye), z = dot(d, f), t = Math.tan((fovDeg * Math.PI) / 360);
  return { x: w / 2 + (dot(d, r) / (z * t * (w / h))) * (w / 2), y: h / 2 - (dot(d, u) / (z * t)) * (h / 2) };
}

test('3D: click an item to select it, cutaway and walk mode', async ({ page }) => {
  await loadDemo(page);
  await page.getByTestId('view-3d').click();
  const canvas = page.locator('[data-testid=view3d] canvas');
  await expectCanvasRendered(page, canvas);

  // The orbit camera's initial pose (src/view3d/cameras.tsx: OrbitRig), recomputed from the demo room's bounds.
  const box = (await canvas.boundingBox())!;
  const W = 3.048, L = 3.6576, cx = W / 2, cz = L / 2, span = Math.hypot(W, L), aspect = box.width / box.height;
  const dist = (span * 1.25 + 2) * Math.max(1, 0.8 / aspect), k = dist / Math.hypot(0.7, 0.9, 1);
  const eye: V3 = [cx + 0.7 * k, 0.9 * k, cz + k], target: V3 = [cx, 0.5, cz];
  const bed = (await activeItems(page)).find((i) => i.defId === 'preset-bed-queen')!;
  const at = project([bed.x / 100, 0.5, bed.y / 100], eye, target, 50, box.width, box.height);
  await page.mouse.click(box.x + at.x, box.y + at.y);
  expect((await state(page)).ui.selection).toEqual({ type: 'item', id: bed.id });
  await expect(page.locator('.app-inspector h2')).toHaveText('Queen bed');

  // Empty floor (between the rug and the right wall) deselects.
  const floor = project([2.88, 0, 0.9], eye, target, 50, box.width, box.height);
  await page.mouse.click(box.x + floor.x, box.y + floor.y);
  expect((await state(page)).ui.selection).toBeNull();

  const shot = async () => canvas.screenshot();
  const withCutaway = await shot();
  await displayToggle(page, 'toggle-cutaway');
  expect((await state(page)).ui.cutaway).toBe(false);
  await expect.poll(async () => (await shot()).equals(withCutaway)).toBe(false); // the near walls are back
  await displayToggle(page, 'toggle-cutaway');
  expect((await state(page)).ui.cutaway).toBe(true);

  await displayToggle(page, 'toggle-walk');
  expect((await state(page)).ui.walkMode).toBe(true);
  await expect(page.locator('.v3-hint')).toBeVisible();
  const before = await shot();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } }); // focus the page; clicks never select in walk mode
  // Walk starts facing the headboard wall; back up so the room comes into view.
  await page.keyboard.down('s');
  await page.waitForTimeout(600);
  await page.keyboard.up('s');
  await expect.poll(async () => (await shot()).equals(before), { timeout: 15_000 }).toBe(false);
  expect(await pngVariety(page, await shot())).toBeGreaterThan(0.1);
  expect((await state(page)).ui.selection).toBeNull();
  // The click captured the mouse (pointer lock) where the browser allows it: the first Esc only releases it.
  if (await page.evaluate(() => !!document.pointerLockElement)) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.v3-hint')).toContainText('press Esc again');
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Escape');
  expect((await state(page)).ui.walkMode).toBe(false);
  await expect(page.locator('.v3-hint')).toHaveCount(0);
});

test('3D issue label follows the selection and survives switching views', async ({ page }) => {
  await loadDemo(page);
  await page.locator('[data-testid=lib-item][data-def-id=preset-armchair]').click(); // lands on the bed: overlap
  const chair = (await activeItems(page)).find((i) => i.defId === 'preset-armchair')!;
  await expect(page.locator(`[data-item-id="${chair.id}"]`)).toHaveAttribute('data-issue', 'true');
  for (const view of ['3d', 'plan', 'split', '3d', 'plan'] as const) {
    await page.getByTestId(`view-${view}`).click();
    if (view !== 'plan') await expect(page.locator('.v3-label')).toContainText(/overlaps/);
    else await expect(page.locator('.v3-label')).toHaveCount(0);
  }
  await page.getByTestId('view-3d').click();
  await page.keyboard.press('Escape'); // deselect
  await expect(page.locator('.v3-label')).toHaveCount(0);
});
