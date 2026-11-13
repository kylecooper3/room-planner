import type { Page } from '@playwright/test';
import {
  activeRoom, clickImg, expect, floorPlanPng, imgToScreen, open, PLAN, planToScreen, rectCorners, state, test, traceRoom,
  TWO, twoRoomPng, uploadPlan, wallLengths,
} from './fixtures';

const near = (got: number, want: number, what: string) => expect(Math.abs(got - want) / want, `${what}: ${got} vs ${want}`).toBeLessThan(0.02);

test('floor plan: upload, calibrate by known length, trace + name a room, underlay stays visible', async ({ page }) => {
  const { x0, y0, x1, y1 } = PLAN.inner;
  const REAL_W = 609.6; // the 600 px inner width is 20 ft
  const REAL_H = REAL_W * (y1 - y0) / (x1 - x0);

  await open(page);
  await page.getByTestId('start-floorplan').click();
  // Entry state: docked panel (not a modal) + a big drop zone over the plan.
  await expect(page.getByTestId('floorplan-panel')).toBeVisible();
  await expect(page.getByTestId('floorplan-dropzone')).toBeVisible();
  await expect(page.locator('.dialog-backdrop')).toHaveCount(0);
  await expect(page.getByTestId('floorplan-step-1')).toHaveAttribute('aria-current', 'step');
  await page.getByTestId('floorplan-file').setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: floorPlanPng() });
  await expect(page.getByTestId('underlay-image')).toHaveCount(1);
  expect((await state(page)).project.underlay).toMatchObject({ widthPx: PLAN.w, heightPx: PLAN.h });
  await expect(page.getByTestId('floorplan-step-2')).toHaveAttribute('aria-current', 'step');

  // Opacity slider (step 1): one drag = one undo step.
  await page.getByTestId('floorplan-step-1').getByRole('button').first().click();
  const undoDepthBefore = (await state(page)).canUndo;
  const slider = (await page.getByTestId('floorplan-opacity').boundingBox())!;
  await page.mouse.move(slider.x + slider.width * 0.6, slider.y + slider.height / 2);
  await page.mouse.down();
  await page.mouse.move(slider.x + slider.width * 0.9, slider.y + slider.height / 2, { steps: 6 });
  await page.mouse.move(slider.x + slider.width * 0.3, slider.y + slider.height / 2, { steps: 6 });
  await page.mouse.up();
  expect((await state(page)).project.underlay!.opacity).not.toBe(0.6);
  await page.evaluate(() => window.__store.getState().undo());
  expect((await state(page)).project.underlay!.opacity).toBe(0.6);
  expect((await state(page)).canUndo).toBe(undoDepthBefore);
  await page.getByTestId('floorplan-next-1').click();

  // Step 2a: measure a known length.
  await expect(page.getByTestId('floorplan-scale')).toContainText('not set');
  await page.getByTestId('floorplan-calibrate').click();
  expect((await state(page)).ui.tool).toBe('calibrate');
  await clickImg(page, x0, y0);
  await clickImg(page, x1, y0);
  await page.getByTestId('calibrate-distance').fill('20');
  await page.getByTestId('calibrate-apply').click();
  expect((await state(page)).ui.tool).toBe('select');
  expect((await state(page)).project.underlay!.cmPerPx).toBeCloseTo(REAL_W / (x1 - x0), 1);
  await expect(page.getByTestId('floorplan-step-3')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('floorplan-step-2').locator('.fp-badge')).toHaveText('✓');

  // Step 3: trace, then name it with a chip.
  await traceRoom(page, rectCorners(PLAN.inner));
  expect((await state(page)).ui.tool).toBe('select');
  await page.getByTestId('floorplan-name-chip').filter({ hasText: 'Bedroom' }).click();
  const traced = await activeRoom(page);
  expect(traced.name).toBe('Bedroom');
  expect(traced.points).toHaveLength(4);
  const want = [REAL_W, REAL_H, REAL_W, REAL_H];
  wallLengths(traced.points).forEach((l, i) => near(l, want[i], `traced wall ${i}`));
  await expect(page.getByTestId('floorplan-room-row')).toHaveCount(1);
  await expect(page.getByTestId('floorplan-total')).toContainText('sq ft');
  await expect(page.getByTestId('plan-room-label')).toContainText('Bedroom');

  // Regression: the underlay stays visible through the traced room and the opacity slider visibly changes it.
  const c = await planToScreen(page, { x: traced.points.reduce((a, p) => a + p.x, 0) / 4, y: traced.points.reduce((a, p) => a + p.y, 0) / 4 + 60 });
  const pixel = async (opacity: number) => {
    await page.evaluate((o) => window.__store.getState().updateUnderlay({ opacity: o }), opacity);
    const png = await page.screenshot({ clip: { x: c.x - 2, y: c.y - 2, width: 4, height: 4 } });
    return page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = `data:image/png;base64,${b64}`; });
      const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
      const x = cv.getContext('2d')!; x.drawImage(img, 0, 0, 1, 1);
      return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3));
    }, png.toString('base64'));
  };
  const opaque = await pixel(1);
  expect(opaque.every((v) => v > 245), `plan's white interior shows at opacity 1: ${opaque}`).toBe(true);
  // The neutral plan floor is nearly as white as the paper, so check the rendered opacity rather than a pixel.
  await page.evaluate(() => window.__store.getState().updateUnderlay({ opacity: 0.1 }));
  await expect(page.getByTestId('underlay-image')).toHaveAttribute('opacity', '0.1');
  await page.evaluate(() => window.__store.getState().updateUnderlay({ opacity: 0.6 }));

  // Done tracing → doors step; Finish closes the panel (the toolbar button reopens it).
  await page.getByTestId('floorplan-done-tracing').click();
  await expect(page.getByTestId('floorplan-step-4')).toHaveAttribute('aria-current', 'step');
  await page.getByTestId('floorplan-add-door').click();
  expect((await state(page)).ui).toMatchObject({ tool: 'place-opening', openingKind: 'door' });
  await clickImg(page, (x0 + x1) / 2, y1 + 6); // in the bottom wall
  expect((await activeRoom(page)).openings).toHaveLength(1);
  await expect(page.getByTestId('floorplan-step-4').locator('.fp-badge')).toHaveText('4'); // current step shows its number
  await page.getByTestId('floorplan-next-4').click();
  await page.getByTestId('floorplan-finish').click();
  await expect(page.getByTestId('floorplan-panel')).toHaveCount(0);
  await page.getByTestId('open-floorplan').click();
  await expect(page.getByTestId('floorplan-panel')).toBeVisible();
});

test('floor plan: drag-and-drop an image onto the plan area', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-floorplan').click();
  const zone = page.getByTestId('floorplan-dropzone');
  await expect(zone).toBeVisible();
  const dt = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const d = new DataTransfer();
    d.items.add(new File([bytes], 'plan.png', { type: 'image/png' }));
    return d;
  }, floorPlanPng().toString('base64'));
  await zone.dispatchEvent('dragover', { dataTransfer: dt });
  await expect(zone).toHaveClass(/over/);
  await zone.dispatchEvent('drop', { dataTransfer: dt });
  await expect(page.getByTestId('underlay-image')).toHaveCount(1);
  await expect(zone).toHaveCount(0);
  expect((await state(page)).project.underlay).toMatchObject({ widthPx: PLAN.w, heightPx: PLAN.h });
  await expect(page.getByTestId('floorplan-step-2')).toHaveAttribute('aria-current', 'step');
});

test('floor plan: scale by known total area; trace-next-room loop with naming', async ({ page }) => {
  const TRUE_CM_PER_PX = 1.5;
  const { a, b } = TWO;
  const dims = [a, b].map((r) => [(r.x1 - r.x0) * TRUE_CM_PER_PX, (r.y1 - r.y0) * TRUE_CM_PER_PX]);
  const trueArea = dims.reduce((s, [w, h]) => s + w * h, 0); // cm²

  await uploadPlan(page, twoRoomPng());
  await page.getByTestId('floorplan-area-option').click();
  await page.getByTestId('floorplan-area').fill(`${(trueArea / 1e4).toFixed(3)} m²`);
  await page.getByTestId('floorplan-area-save').click();
  await expect(page.getByTestId('floorplan-step-3')).toHaveAttribute('aria-current', 'step');

  await traceRoom(page, rectCorners(a));
  await page.getByTestId('floorplan-name-chip').filter({ hasText: 'Bedroom' }).click();
  await traceRoom(page, rectCorners(b));
  await page.getByTestId('floorplan-room-name').fill('Living & dining');
  await page.getByTestId('floorplan-done-tracing').click();
  const names = (await state(page)).project.rooms.map((r) => r.name);
  expect(names).toEqual(['Bedroom', 'Living & dining']);
  await page.getByTestId('floorplan-step-3').getByRole('button').first().click();
  await expect(page.getByTestId('floorplan-room-row')).toHaveCount(2);
  await expect(page.getByTestId('floorplan-area-compare')).toContainText('%');

  await page.getByTestId('floorplan-apply-area').click();
  await expect(page.getByTestId('floorplan-area-compare')).toContainText('matches');
  const rooms = (await state(page)).project.rooms;
  rooms.forEach((r, i) => wallLengths(r.points).forEach((l, j) => near(l, dims[i][j % 2], `room ${i} wall ${j}`)));
  expect((await state(page)).project.underlay!.cmPerPx).toBeCloseTo(TRUE_CM_PER_PX, 1);
  await page.keyboard.press('Control+z'); // the whole rescale is one undo step
  expect((await state(page)).project.underlay!.cmPerPx).toBeCloseTo(1000 / TWO.w, 6);
});

// ───────── screenshots for the README: a 1-bedroom apartment ─────────
const APT = {
  living: { x0: 80, y0: 80, x1: 560, y1: 440 }, kitchen: { x0: 572, y0: 80, x1: 800, y1: 280 },
  bath: { x0: 812, y0: 80, x1: 940, y1: 280 }, bedroom: { x0: 572, y0: 292, x1: 940, y1: 620 },
  closet: { x0: 412, y0: 452, x1: 560, y1: 620 }, balcony: { x0: 80, y0: 452, x1: 400, y1: 620 },
};
const aptPng = async () => {
  const { wallsPng } = await import('./fixtures');
  const gaps = [
    { x0: 560, y0: 150, x1: 572, y1: 230 }, { x0: 560, y0: 340, x1: 572, y1: 410 }, { x0: 850, y0: 280, x1: 900, y1: 292 },
    { x0: 560, y0: 510, x1: 572, y1: 570 }, { x0: 150, y0: 440, x1: 330, y1: 452 },
  ];
  const inR = (x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
  return wallsPng(1020, 700, Object.values(APT), 12, gaps, (x, y) => {
    if (inR(x, y, { x0: 640, y0: 380, x1: 860, y1: 600 }) && (x === 640 || x === 859 || y === 380 || y === 599)) return [90, 90, 90]; // bed outline
    if (inR(x, y, { x0: 140, y0: 120, x1: 380, y1: 200 }) && (x === 140 || x === 379 || y === 120 || y === 199)) return [90, 90, 90]; // sofa outline
    if (inR(x, y, APT.living)) return (Math.floor(x / 18) % 2) ? [238, 226, 206] : [232, 218, 196]; // wood floor
    if (inR(x, y, APT.bath) || inR(x, y, APT.kitchen)) return ((x >> 4) + (y >> 4)) % 2 ? [228, 232, 236] : [240, 242, 244]; // tiles
    return null;
  });
};

async function traceNamed(page: Page, r: { x0: number; y0: number; x1: number; y1: number }, name: string) {
  await traceRoom(page, rectCorners(r));
  const chip = page.getByTestId('floorplan-name-chip').filter({ hasText: name });
  if (await chip.count()) await chip.click();
  else await page.getByTestId('floorplan-room-name').fill(name);
}

test('floor plan: screenshots of tracing an apartment', async ({ page }) => {
  await uploadPlan(page, await aptPng());
  await page.getByTestId('floorplan-area-option').click();
  await page.getByTestId('floorplan-area').fill('531 sq ft');
  await page.getByTestId('floorplan-area-save').click();
  await traceNamed(page, APT.living, 'Living room');
  await traceNamed(page, APT.kitchen, 'Kitchen');
  // Mid-trace: three corners of the bedroom placed, hovering near the fourth.
  await page.getByTestId('floorplan-trace-next').click();
  for (const [x, y] of rectCorners(APT.bedroom).slice(0, 3)) await clickImg(page, x, y);
  const p = await imgToScreen(page, APT.bedroom.x0 + 3, APT.bedroom.y1 - 2);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await expect(page.getByTestId('loupe')).toBeVisible();
  await expect(page.getByTestId('draw-hint')).toContainText('green circle');
  await page.screenshot({ path: 'docs/screenshots/floorplan.png' });
  await page.keyboard.press('Escape');

  await traceNamed(page, APT.bedroom, 'Bedroom');
  await traceNamed(page, APT.bath, 'Bathroom');
  await traceNamed(page, APT.closet, 'Walk-in closet');
  await traceNamed(page, APT.balcony, 'Balcony');
  await page.getByTestId('floorplan-room-name').blur();
  await page.getByTestId('floorplan-done-tracing').click();
  await page.getByTestId('floorplan-step-3').getByRole('button').first().click();
  const { project } = await state(page);
  expect(project.rooms.map((r) => r.name)).toEqual(['Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'Walk-in closet', 'Balcony']);
  await expect(page.getByTestId('floorplan-room-counted').last()).not.toBeChecked(); // balcony excluded from the listed area
  await page.getByTestId('floorplan-apply-area').click();
  await page.mouse.move(5, 5);
  await expect(page.getByTestId('plan-room-label')).toHaveCount(6);
  await page.screenshot({ path: 'docs/screenshots/floorplan-done.png' });
});
