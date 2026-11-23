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
  await expect.poll(() => scale(page)).toBeGreaterThan(plan * 1.5);

  await page.keyboard.press('Escape');
  expect((await state(page)).ui.roomOpen).toBe(false);
  await expect.poll(() => scale(page)).toBeCloseTo(plan, 5); // refits again once the layout tabs are gone (pane resize)
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

test('openings: drag either end handle of a selected opening to resize it; one undo restores it', async ({ page }) => {
  await open(page);
  await addRoom(page, 'A', box(0, 0, 400, 300));
  await enterRoom(page, 'A');
  const id = await page.evaluate(() => window.__store.getState().addOpening({ kind: 'open', wall: 0, offset: 200, width: 90, height: 0, sill: 0 }));
  await page.evaluate((id) => window.__store.getState().select({ type: 'opening', id }), id);
  await expect(page.getByTestId('opening-handle')).toHaveCount(2);
  await dragPlan(page, { x: 245, y: 0 }, { x: 330, y: 0 }, 8); // the right end, 245 → 330
  let o = (await activeRoom(page)).openings[0];
  expect(o.width).toBeCloseTo(175, 0);
  expect(o.offset - o.width / 2).toBeCloseTo(155, 0); // the left end stayed
  await dragPlan(page, { x: 155, y: 0 }, { x: -50, y: 0 }, 8); // the left end, past the wall's start: stops at it
  o = (await activeRoom(page)).openings[0];
  expect(o.offset - o.width / 2).toBeCloseTo(0, 0);
  expect(o.offset + o.width / 2).toBeCloseTo(330, 0);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  o = (await activeRoom(page)).openings[0];
  expect([o.offset, o.width]).toEqual([200, 90]);
});

// ── shared walls: B on A's right wall outer face (x = 412, walls are 12 cm) ──
/** Wall bands drawn over plan point p (any room). */
const bandsAt = (page: Page, p: Vec2) => page.evaluate(({ x, y }) =>
  [...document.querySelectorAll<SVGPolygonElement>('[data-testid=plan-svg] polygon[data-band]')].filter((el) => el.isPointInFill(new DOMPoint(x, y))).length, p);
const sharedRooms = async (page: Page) => {
  await open(page);
  await addRoom(page, 'A', box(0, 0, 400, 300));
  await addRoom(page, 'B', box(412, 0, 700, 300));
};

test("drawing along a neighbour's wall makes one wall; the shared wall is drawn once", async ({ page }) => {
  await open(page);
  await addRoom(page, 'A', box(0, 0, 400, 300));
  await page.evaluate(() => window.__store.getState().setUI({ tool: 'draw-room' }));
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom out' }).click(); // room for B beside A
  const click = async (p: Vec2) => { const q = await planToScreen(page, p); await page.mouse.click(q.x, q.y); };
  for (const y of [50, 100, 200, 250]) await click({ x: 412, y });
  await expect(page.getByTestId('draw-close-target')).toHaveCount(0); // still one straight wall: 2 points, nothing to close yet
  for (const p of [{ x: 700, y: 250 }, { x: 700, y: 50 }, { x: 412, y: 50 }]) await click(p);
  await expect(page.getByTestId('room-name-input')).toBeFocused();
  const b = (await state(page)).project.rooms[1];
  expect(b.points).toHaveLength(4);
  expect(b.points.filter((p) => Math.abs(p.x - 412) < 0.01)).toHaveLength(2);
  expect(await bandsAt(page, { x: 406, y: 150 })).toBe(1);
  expect(await bandsAt(page, { x: 706, y: 150 })).toBe(1); // (B's own wall elsewhere is still drawn)
});

test('dragging a shared wall moves both rooms; one undo restores both; the inspector names the other room', async ({ page }) => {
  await sharedRooms(page);
  await expect(page.getByTestId('plan-wall-gap')).toHaveCount(0);
  await page.getByTestId('plan-fit').click();
  await page.screenshot({ path: 'test-results/shared-walls.png' });
  await dragPlan(page, { x: 406, y: 150 }, { x: 456, y: 150 }, 8); // B is active: its shared left wall
  const a = await roomNamed(page, 'A'), b = await roomNamed(page, 'B');
  expect(a.points[1].x).toBeCloseTo(450, 0);
  expect(a.points[2].x).toBeCloseTo(450, 0);
  expect(b.points[0].x).toBeCloseTo(462, 0);
  expect(b.points[3].x).toBeCloseTo(462, 0);
  await expect(page.getByTestId('wall-shared')).toHaveText('Shared with A');
  await page.keyboard.press('Control+z');
  expect((await roomNamed(page, 'A')).points).toEqual(box(0, 0, 400, 300));
  expect((await roomNamed(page, 'B')).points).toEqual(box(412, 0, 700, 300));
});

test('a door placed on a shared wall goes on the owner room only', async ({ page }) => {
  await sharedRooms(page);
  await page.evaluate(() => window.__store.getState().setUI({ tool: 'place-opening', openingKind: 'door' }));
  const q = await planToScreen(page, { x: 409, y: 150 }); // nearer B's wall line than A's
  await page.mouse.move(q.x, q.y);
  await page.mouse.click(q.x, q.y);
  const a = await roomNamed(page, 'A'), b = await roomNamed(page, 'B');
  expect(a.openings).toEqual([expect.objectContaining({ kind: 'door', wall: 1 })]);
  expect(b.openings).toEqual([]);
  // With B selected, A's door on the shared wall still shows (other rooms' openings are drawn too).
  await page.evaluate((id) => window.__store.getState().focusRoom(id), b.id);
  await expect(page.locator('[data-testid=plan-other-openings] path')).toHaveCount(1); // the door's swing arc
});

test('dragging a wall lines it up with a neighbour wall (guide shown); Alt drags freely', async ({ page }) => {
  await open(page);
  await addRoom(page, 'A', box(0, 0, 400, 300));
  await addRoom(page, 'B', box(10, 312, 300, 600)); // below A, its left wall 10 cm in from A's
  await page.getByTestId('plan-fit').click();
  const k = await scale(page);
  const s = await planToScreen(page, { x: 4, y: 450 }), e = await planToScreen(page, { x: 4 - 13 / k, y: 450 }); // ~4 px short of lining up
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 6 });
  await expect(page.getByTestId('plan-guides')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId('plan-guides')).toHaveCount(0);
  let b = await roomNamed(page, 'B');
  expect(b.points[0].x).toBeCloseTo(0, 5);
  expect(b.points[3].x).toBeCloseTo(0, 5);
  await page.keyboard.press('Control+z');
  // With Alt held the same drag is not pulled into line.
  await page.mouse.move(s.x, s.y);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  b = await roomNamed(page, 'B');
  expect(b.points[0].x).not.toBeCloseTo(0, 1);
});

test('drawing down a neighbour wall stays on its line and meets the room below exactly (no slanted wall)', async ({ page }) => {
  await open(page);
  await addRoom(page, 'A', box(0, 0, 300, 600)); // right wall outer face x = 312
  await addRoom(page, 'C', box(324, 412, 700, 700)); // beside A, top outer face y = 400
  await page.getByTestId('plan-fit').click();
  await page.evaluate(() => window.__store.getState().setUI({ tool: 'draw-room' }));
  const k = await scale(page);
  const click = async (p: Vec2) => { const q = await planToScreen(page, p); await page.mouse.click(q.x, q.y); };
  // Wobbly clicks down A's wall, the last one a few px off, near where it meets C.
  for (const p of [{ x: 312 + 3 / k, y: 100 }, { x: 312 - 4 / k, y: 250 }, { x: 312 + 8 / k, y: 400 - 6 / k }]) await click(p);
  for (const p of [{ x: 500, y: 400 - 2 / k }, { x: 500, y: 100 }]) await click(p);
  await click({ x: 312, y: 100 }); // close
  await expect(page.getByTestId('room-name-input')).toBeFocused();
  const closet = (await state(page)).project.rooms[2];
  expect(closet.points).toHaveLength(4);
  const left = closet.points.filter((p) => p.x < 400);
  expect(left).toHaveLength(2);
  for (const p of left) expect(p.x).toBeCloseTo(312, 5); // straight down A's face
  expect(Math.max(...left.map((p) => p.y))).toBeCloseTo(400, 5); // meets C's top face
});

test('dragging a wall shared along a longer wall moves the whole joined wall: the third room stays attached', async ({ page }) => {
  await open(page);
  await addRoom(page, 'A', box(0, 0, 400, 600)); // its right wall is shared by B (top half) and C (bottom half)
  await addRoom(page, 'C', box(412, 312, 700, 600));
  await addRoom(page, 'B', box(412, 0, 700, 300)); // added last: B is the selected room
  await page.getByTestId('plan-fit').click();
  await dragPlan(page, { x: 406, y: 150 }, { x: 456, y: 150 }, 8); // B's left wall
  const a = await roomNamed(page, 'A'), b = await roomNamed(page, 'B'), c = await roomNamed(page, 'C');
  expect(a.points[1].x).toBeCloseTo(450, 0);
  expect(b.points[0].x).toBeCloseTo(462, 0);
  expect(c.points[0].x).toBeCloseTo(462, 0); // C followed, so it is still joined to A
  expect(c.points[3].x).toBeCloseTo(462, 0);
  await expect(page.getByTestId('plan-wall-gap')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  expect((await roomNamed(page, 'C')).points).toEqual(box(412, 312, 700, 600));
});
