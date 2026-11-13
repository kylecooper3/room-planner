import type { Page } from '@playwright/test';
import { expect, expectCanvasRendered, loadDemo, open, state, test } from './fixtures';

const cam = (page: Page) => page.evaluate(() => window.__view3d!.camera());

/** Two rooms traced along the inner wall faces (12 cm apart), a door on A's right wall at y = 150; A is active. */
async function twoRoomHouse(page: Page) {
  await open(page);
  return page.evaluate(() => {
    const s = () => window.__store.getState();
    const a = s().addRoom({ points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }], name: 'A' });
    s().addOpening({ kind: 'door', wall: 1, offset: 150, width: 90, height: 203, sill: 0, swing: { hinge: 'start', side: 'in' } });
    s().placeItem('preset-bed-queen', { x: 120, y: 150 });
    const b = s().addRoom({ points: [{ x: 412, y: 0 }, { x: 812, y: 0 }, { x: 812, y: 300 }, { x: 412, y: 300 }], name: 'B' });
    s().placeItem('preset-sofa-3seat', { x: 612, y: 255 });
    s().placeItem('preset-armchair', { x: 740, y: 70 });
    s().setActiveRoom(a);
    s().select(null);
    s().setUI({ view: '3d' });
    return { a, b };
  });
}

async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test('whole house in 3D: overview top view + pan, walk through the door', async ({ page }) => {
  const { a, b } = await twoRoomHouse(page);
  const canvas = page.locator('[data-testid=view3d] canvas');
  await expectCanvasRendered(page, canvas);
  await expect.poll(() => page.evaluate(() => window.__view3d!.rooms().sort())).toEqual([a, b].sort());
  await page.waitForTimeout(300);
  await canvas.screenshot({ path: 'docs/screenshots/house-3d.png' });

  // Overview: top view animates to straight down and back.
  await expect(page.getByTestId('cam-overview')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('cam-top').click();
  await expect.poll(async () => (await cam(page)).direction[1]).toBeLessThan(-0.99);
  await page.getByTestId('cam-top').click();
  await expect.poll(async () => (await cam(page)).direction[1]).toBeGreaterThan(-0.95);

  // Right-drag pans (moves the orbit target).
  const box = (await canvas.boundingBox())!;
  const t0 = (await cam(page)).target!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  const t1 = (await cam(page)).target!;
  expect(Math.hypot(t1[0] - t0[0], t1[2] - t0[2])).toBeGreaterThan(0.3);

  // Walk: starts just inside A's door, facing into A (-x).
  await page.getByTestId('cam-walk').click();
  expect((await state(page)).ui.walkMode).toBe(true);
  await expect(page.getByTestId('walk-crosshair')).toBeVisible();
  await expect(page.getByTestId('walk-hint')).toContainText('WASD move');
  await expect(page.getByTestId('cam-top')).toHaveCount(0);
  const p0 = await cam(page);
  expect(p0.position[0]).toBeCloseTo(3.4, 1);
  expect(p0.position[1]).toBeCloseTo(1.6, 1);
  expect(p0.position[2]).toBeCloseTo(1.5, 1);
  expect(p0.direction[0]).toBeLessThan(-0.99);

  // Back up (S) through the door into room B; S must not toggle snapping.
  const snap = (await state(page)).ui.snap;
  await hold(page, 's', 2000);
  const p1 = await cam(page);
  expect(p1.position[0]).toBeGreaterThan(4.6); // inside B (B starts at x = 4.12)
  expect((await state(page)).ui.snap).toBe(snap);
  // Keep going: B's far wall (x = 8.12) stops us at the body radius.
  // Hold until the wall stops us rather than for a fixed time: walking speed per wall-clock second drops when frames
  // are slow (the walk step caps dt at 0.1 s), e.g. when the whole suite runs in parallel.
  await page.keyboard.down('s');
  await expect.poll(async () => (await cam(page)).position[0], { timeout: 15_000 }).toBeGreaterThan(7.6);
  await page.waitForTimeout(500); // push against the wall a little longer: it must hold us at the body radius
  await page.keyboard.up('s');
  const p2 = await cam(page);
  expect(p2.position[0]).toBeGreaterThan(7.6);
  expect(p2.position[0]).toBeLessThanOrEqual(8.12 - 0.22 + 0.01);
  // Strafe into the side wall (D = right; facing -x, right is -z): blocked at the top wall (z = 0).
  await hold(page, 'd', 3000);
  expect((await cam(page)).position[2]).toBeGreaterThanOrEqual(0.22 - 0.01);

  // Look around: drag-to-look (pointer lock is usually not granted headless; either way the view turns).
  const d0 = (await cam(page)).direction;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  const d1 = (await cam(page)).direction;
  expect(Math.hypot(d1[0] - d0[0], d1[1] - d0[1], d1[2] - d0[2])).toBeGreaterThan(0.2);

  // O leaves walk mode; the overview camera is back.
  await page.keyboard.press('o');
  expect((await state(page)).ui.walkMode).toBe(false);
  await expect(page.getByTestId('walk-crosshair')).toHaveCount(0);
  expect((await cam(page)).position[1]).toBeGreaterThan(2);
});

type V3 = [number, number, number];
/** Pinhole projection of a world point (m) into the canvas for the orbit camera (fov 50°). */
function project(p: V3, eye: number[], target: number[], w: number, h: number) {
  const sub = (a: number[], b: number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const d = sub(p, eye), z = dot(d, f), t = Math.tan((50 * Math.PI) / 360);
  return { x: w / 2 + (dot(d, r) / (z * t * (w / h))) * (w / 2), y: h / 2 - (dot(d, u) / (z * t)) * (h / 2) };
}

test('double-click the floor in overview drops you into walk mode there', async ({ page }) => {
  await twoRoomHouse(page);
  const canvas = page.locator('[data-testid=view3d] canvas');
  await expectCanvasRendered(page, canvas);
  const box = (await canvas.boundingBox())!;
  const c = await cam(page);
  const at = project([6, 0, 1.2], c.position, c.target!, box.width, box.height); // free floor in room B
  await page.mouse.dblclick(box.x + at.x, box.y + at.y);
  await expect.poll(async () => (await state(page)).ui.walkMode).toBe(true);
  const p = (await cam(page)).position;
  expect(p[0]).toBeCloseTo(6, 1);
  expect(p[1]).toBeCloseTo(1.6, 1);
  expect(p[2]).toBeCloseTo(1.2, 1);
  await page.keyboard.press('Escape'); // the mouse was never captured → one Esc leaves
  expect((await state(page)).ui.walkMode).toBe(false);
});

test('clicking an item in another room makes that room active and selects it', async ({ page }) => {
  const { b } = await twoRoomHouse(page);
  const canvas = page.locator('[data-testid=view3d] canvas');
  await expectCanvasRendered(page, canvas);
  const box = (await canvas.boundingBox())!;
  const c = await cam(page);
  const sofa = (await state(page)).project.rooms.find((r) => r.id === b)!.layouts[0].items.find((i) => i.defId === 'preset-sofa-3seat')!;
  const at = project([sofa.x / 100, 0.4, sofa.y / 100], c.position, c.target!, box.width, box.height);
  await page.mouse.click(box.x + at.x, box.y + at.y);
  const s = await state(page);
  expect(s.project.activeRoomId).toBe(b);
  expect(s.ui.selection).toEqual({ type: 'item', id: sofa.id });
});

test('walk the demo room (screenshot)', async ({ page }) => {
  await loadDemo(page);
  await page.getByTestId('view-3d').click();
  const canvas = page.locator('[data-testid=view3d] canvas');
  await expectCanvasRendered(page, canvas);
  await page.getByTestId('cam-walk').click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid=view3d]').screenshot({ path: 'docs/screenshots/walk.png' });
  await page.getByTestId('cam-overview').click();
  expect((await state(page)).ui.walkMode).toBe(false);
});
