import { mkdirSync } from 'node:fs';
import { activeItems, activeRoom, dragPlan, expect, expectCanvasRendered, loadDemo, open, state, test } from './fixtures';

const SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });

test('welcome → demo room in plan, 3D and split views', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByTestId('load-demo').click();
  await expect(page.getByTestId('welcome')).toBeHidden();
  await expect(page.getByTestId('plan-item')).toHaveCount(6);
  await expect(page.locator('[data-testid=plan-item][data-issue=true]')).toHaveCount(0);
  await expect(page.getByTestId('all-fits')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/plan.png` });

  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('plan-svg')).toHaveCount(0);
  await expectCanvasRendered(page, page.locator('[data-testid=view3d] canvas'));
  await page.screenshot({ path: `${SHOTS}/view3d.png` });

  await page.getByTestId('view-split').click();
  await expect(page.getByTestId('plan-svg')).toBeVisible();
  await expectCanvasRendered(page, page.locator('[data-testid=view3d] canvas'));
  await page.screenshot({ path: `${SHOTS}/split.png` });
});

test('room by dimensions, bed snaps flush to a wall, units toggle is display-only', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-dimensions').click();
  await page.getByTestId('room-width').fill('10');
  await page.getByTestId('room-length').fill('12');
  await page.getByTestId('room-height').fill('8');
  await page.getByTestId('room-create').click();
  const room = await activeRoom(page);
  const xs = room.points.map((p) => p.x), ys = room.points.map((p) => p.y);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(304.8, 6);
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(365.76, 6);
  expect(room.ceilingHeight).toBeCloseTo(243.84, 6);

  await page.locator('[data-testid=lib-item][data-def-id=preset-bed-queen]').click();
  const [bed] = await activeItems(page);
  expect(bed.defId).toBe('preset-bed-queen');
  // Drag so the headboard ends up 3 cm short of the top wall: it must snap flush (y = depth / 2).
  await dragPlan(page, { x: bed.x, y: bed.y }, { x: bed.x, y: 203.2 / 2 + 3 });
  const [moved] = await activeItems(page);
  expect(Math.abs(moved.y - 203.2 / 2)).toBeLessThan(0.01);
  await expect(page.locator('[data-testid=plan-item]').first()).toHaveAttribute('data-issue', 'false');

  const labels = page.locator('[data-testid=plan-wall] text');
  await expect(labels.first()).toHaveText(`10' 0"`);
  await page.getByTestId('units-toggle').click();
  await expect(labels.first()).toHaveText('305 cm');
  const after = await state(page);
  expect(after.project.units).toBe('metric');
  expect((await activeRoom(page)).points).toEqual(room.points);
  await page.getByTestId('units-toggle').click();
  await expect(labels.first()).toHaveText(`10' 0"`);

  await page.getByTestId('view-3d').click();
  await expectCanvasRendered(page, page.locator('[data-testid=view3d] canvas'));
});
