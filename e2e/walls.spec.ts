import type { Page } from '@playwright/test';
import type { Vec2 } from '../src/types';
import { activeRoom, dragPlan, enterRoom, expect, floorPlanPng, open, planToScreen, state, test, uploadPlan, wallLengths } from './fixtures';

const box = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const addRoom = (page: Page, name: string, points: Vec2[]) => page.evaluate(({ name, points }) => window.__store.getState().addRoom({ name, points }), { name, points });
const scale = async (page: Page) => Number(await page.getByTestId('plan-svg').getAttribute('data-px-per-cm'));
/** A, and B with its left wall line 8 cm short of A's right wall outer face (400 + 12): an orange near-miss. */
const twoRooms = async (page: Page) => {
  await open(page);
  await addRoom(page, 'A', box(0, 0, 400, 300));
  await addRoom(page, 'B', box(420, 0, 700, 300));
  await expect(page.getByTestId('plan-wall-gap')).toHaveCount(1);
};
const roomNamed = async (page: Page, name: string) => (await state(page)).project.rooms.find((r) => r.name === name)!;

test('drag a wall: it slides along its normal, the neighbouring walls stretch; one undo restores it', async ({ page }) => {
  await open(page);
  await addRoom(page, 'A', box(0, 0, 400, 300));
  await enterRoom(page, 'A');
  await dragPlan(page, { x: 406, y: 150 }, { x: 456, y: 150 }, 8); // the right wall (its band runs 400..412)
  const pts = (await activeRoom(page)).points;
  expect(pts[1].x).toBeCloseTo(450, 0);
  expect(pts[2].x).toBeCloseTo(450, 0);
  expect(pts[1].y).toBe(0);
  expect(wallLengths(pts)[0]).toBeCloseTo(450, 0);
  expect(wallLengths(pts)[2]).toBeCloseTo(450, 0);
  expect((await state(page)).ui.selection).toEqual({ type: 'wall', index: 1 });
  await page.keyboard.press('Control+z');
  expect((await activeRoom(page)).points).toEqual(box(0, 0, 400, 300));
});

test('drag a wall onto a neighbour: "Attached" while dragging, ends flush, no near-miss mark', async ({ page }) => {
  await twoRooms(page);
  const s = await planToScreen(page, { x: 416, y: 150 }), e = await planToScreen(page, { x: 410, y: 150 }); // B's left wall
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 6 });
  await expect(page.getByTestId('plan-wall-attached')).toHaveCount(1);
  await expect(page.getByTestId('snap-marker')).toContainText('Attached');
  await expect(page.getByTestId('plan-legend')).toContainText('Attached');
  await page.mouse.up();
  const b = await roomNamed(page, 'B');
  expect(b.points[0]).toEqual({ x: 412, y: 0 });
  expect(b.points[3]).toEqual({ x: 412, y: 300 });
  await expect(page.getByTestId('plan-wall-attached')).toHaveCount(0);
  await expect(page.getByTestId('plan-wall-gap')).toHaveCount(0);
  await expect(page.getByTestId('plan-legend')).toHaveCount(0);
});

test('Join walls: clicking the orange mark selects its wall; the button slides it flush (one undo step); legend only while marked', async ({ page }) => {
  await open(page);
  await addRoom(page, 'A', box(0, 0, 400, 300));
  await expect(page.getByTestId('plan-wall')).toHaveCount(4);
  await expect(page.getByTestId('plan-legend')).toHaveCount(0);
  await addRoom(page, 'B', box(420, 0, 700, 300));
  await expect(page.getByTestId('plan-legend')).toContainText('Not joined');

  const m = await planToScreen(page, { x: 404, y: 150 });
  await page.mouse.click(m.x, m.y);
  const st = await state(page);
  expect(st.project.activeRoomId).toBe((await roomNamed(page, 'A')).id);
  expect(st.ui.selection).toEqual({ type: 'wall', index: 1 });
  await expect(page.getByTestId('wall-join')).toBeVisible();
  await expect(page.getByTestId('plan-join-walls')).toBeVisible();
  await page.screenshot({ path: 'test-results/wall-edit.png' });

  await page.getByTestId('plan-join-walls').click();
  expect((await roomNamed(page, 'A')).points).toEqual(box(0, 0, 408, 300));
  await expect(page.getByTestId('plan-wall-gap')).toHaveCount(0);
  await expect(page.getByTestId('plan-legend')).toHaveCount(0);
  await expect(page.getByTestId('wall-join')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  expect((await roomNamed(page, 'A')).points).toEqual(box(0, 0, 400, 300));

  // the inspector's button does the same
  await page.mouse.click(m.x, m.y);
  await page.getByTestId('wall-join').click();
  expect((await roomNamed(page, 'A')).points).toEqual(box(0, 0, 408, 300));
});

test('with a plan image the open room stays accent at room level; the other rooms stay greyed', async ({ page }) => {
  await uploadPlan(page, floorPlanPng());
  await page.getByTestId('floorplan-skip-scale').click();
  await addRoom(page, 'A', box(0, 0, 400, 300));
  await addRoom(page, 'B', box(1000, 0, 1300, 300));
  await page.evaluate(() => window.__store.getState().setUI({ tool: 'select' }));
  await enterRoom(page, 'A');
  await expect(page.locator('[data-testid=plan-wall] polygon').first()).toHaveAttribute('fill', '#2f6bdc'); // THEME.accent
  await expect(page.getByTestId('plan-floor')).toHaveAttribute('fill', '#2f6bdc');
  await expect(page.getByTestId('plan-other-walls').locator('polygon').first()).toHaveAttribute('fill', '#2a2d32'); // THEME.planWall
});

test('leaving a room: the back button and Esc; entering zooms to the room, leaving fits every room again', async ({ page }) => {
  await open(page);
  await addRoom(page, 'A', box(0, 0, 400, 300));
  await addRoom(page, 'B', box(1500, 0, 1800, 300));
  await page.getByTestId('plan-fit').click(); // (adding a room never refits the plan)
  const plan = await scale(page);
  await enterRoom(page, 'A');
  expect(await scale(page)).toBeGreaterThan(plan * 1.5);

  await page.keyboard.press('Escape');
  expect((await state(page)).ui.roomOpen).toBe(false);
  expect(await scale(page)).toBeCloseTo(plan, 5);
  const svg = (await page.getByTestId('plan-svg').boundingBox())!;
  for (const p of [{ x: 0, y: 0 }, { x: 1800, y: 300 }]) {
    const q = await planToScreen(page, p);
    expect(q.x).toBeGreaterThan(svg.x);
    expect(q.x).toBeLessThan(svg.x + svg.width);
    expect(q.y).toBeGreaterThan(svg.y);
    expect(q.y).toBeLessThan(svg.y + svg.height);
  }

  await enterRoom(page, 'B');
  const w = await planToScreen(page, { x: 1650, y: -6 }); // B's top wall
  await page.mouse.click(w.x, w.y); // something selected: Esc only deselects
  expect((await state(page)).ui.selection).toEqual({ type: 'wall', index: 0 });
  await page.keyboard.press('Escape');
  expect((await state(page)).ui).toMatchObject({ roomOpen: true, selection: null });
  await page.getByTestId('layouts-back').click();
  expect((await state(page)).ui.roomOpen).toBe(false);
});
