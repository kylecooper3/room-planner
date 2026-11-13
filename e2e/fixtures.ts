import { test as base, expect, type Page } from '@playwright/test';
import { deflateSync, crc32 } from 'node:zlib';
import type { AppState, Vec2 } from '../src/types';

declare global {
  interface Window {
    __store: { getState(): AppState; setState(p: Partial<AppState>): void };
    __floorPlans: { getState(): { plans: { id: string; name: string; roomCount: number }[]; activeId: string | null; ready: boolean } };
  }
}

/**
 * Console messages that are NOT failures. Only `error`-level messages and uncaught page errors fail a test; warnings
 * (e.g. three.js "THREE.Clock deprecated", Chrome's "GPU stall due to ReadPixels" driver notes) are logged by
 * third-party code and never fail. The list below covers error-level messages that are expected by a test itself.
 */
const BENIGN: RegExp[] = [
  // Requests a test deliberately blocks (page.route(...).abort()) are reported by Chrome as console errors.
  /net::ERR_FAILED|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/,
];

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' && !BENIGN.some((r) => r.test(m.text()))) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await use(errors);
    expect(errors, 'console errors / uncaught page errors').toEqual([]);
  }, { auto: true }],
});
export { expect };

export const state = (page: Page) => page.evaluate(() => {
  const s = window.__store.getState();
  return { project: s.project, ui: s.ui, canUndo: s.canUndo, canRedo: s.canRedo };
});
export const activeRoom = async (page: Page) => {
  const { project } = await state(page);
  return project.rooms.find((r) => r.id === project.activeRoomId)!;
};
export const activeItems = async (page: Page) => {
  const r = await activeRoom(page);
  return r.layouts.find((l) => l.id === r.activeLayoutId)!.items;
};

export const floorPlans = (page: Page) => page.evaluate(() => {
  const f = window.__floorPlans.getState();
  return { plans: f.plans.map((p) => ({ id: p.id, name: p.name, roomCount: p.roomCount })), activeId: f.activeId };
});

/** Fresh app (IndexedDB is per-context, so every test starts empty): the home screen, then a new blank floor plan. */
export async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('home-empty')).toBeVisible();
  await page.getByTestId('home-new-blank-empty').click();
  await expect(page.getByTestId('app')).toBeVisible();
}

/** Clicks a display toggle (grid, snapping, clearances, cutaway, walk) in the tool rail's Display menu, then closes it. */
export async function displayToggle(page: Page, testId: string) {
  if (!(await page.getByTestId(testId).isVisible())) await page.getByTestId('display-menu').click();
  await page.getByTestId(testId).click();
  await page.getByTestId('display-menu').click(); // closes it (Esc would go to walk mode once that has the focus)
  await expect(page.getByTestId(testId)).toHaveCount(0);
}
export async function loadDemo(page: Page) {
  await open(page);
  await page.getByTestId('load-demo').click();
  await expect(page.getByTestId('plan-item').first()).toBeVisible();
}

/** Creates a rectangular room through the "Enter dimensions" dialog (bare numbers are feet). */
export async function roomByDimensions(page: Page, w = '10', l = '12', h = '8') {
  await open(page);
  await page.getByTestId('start-dimensions').click();
  await page.getByTestId('room-width').fill(w);
  await page.getByTestId('room-length').fill(l);
  await page.getByTestId('room-height').fill(h);
  await page.getByTestId('room-create').click();
  await expect(page.getByTestId('plan-wall').first()).toBeVisible();
}

/** Plan point (cm) → page coordinates in the (first editable) plan SVG. */
export const planToScreen = (page: Page, p: Vec2) => page.evaluate(({ x, y }) => {
  const g = document.querySelector<SVGGElement>('svg[data-testid="plan-svg"][data-readonly="false"] [data-plan-root]')!;
  const m = g.getScreenCTM()!;
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}, p);

/** Drags with real mouse events from plan point a to plan point b (cm). */
export async function dragPlan(page: Page, a: Vec2, b: Vec2, steps = 12) {
  const s = await planToScreen(page, a), e = await planToScreen(page, b);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps });
  await page.mouse.up();
}

/**
 * Fraction of sampled pixels of a PNG that differ from its most common colour (0 = blank). Decoded in the page (2D canvas),
 * so it works on element screenshots of WebGL canvases, whose drawing buffer cannot be read back directly.
 */
export const pngVariety = (page: Page, png: Buffer) => page.evaluate(async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `data:image/png;base64,${b64}`; });
  const o = document.createElement('canvas'); o.width = 64; o.height = 64;
  const x = o.getContext('2d')!; x.drawImage(img, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data;
  const counts = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4) { const k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3); counts.set(k, (counts.get(k) ?? 0) + 1); }
  return 1 - Math.max(...counts.values()) / (64 * 64);
}, png.toString('base64'));

/** Screenshot of a 3D canvas once it has drawn something, with its pixel variety. */
export async function expectCanvasRendered(page: Page, canvas: ReturnType<Page['locator']>, path?: string) {
  await expect(canvas).toBeVisible();
  await expect.poll(async () => pngVariety(page, await canvas.screenshot()), { timeout: 15_000 }).toBeGreaterThan(0.1);
  if (path) await canvas.screenshot({ path });
}

// ───────── tiny PNG encoder + generated fixtures (no binary files in the repo) ─────────
export function encodePng(w: number, h: number, rgb: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(rgb(x, y), y * (w * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Floor plan: 800×600 white, 12 px black walls; INNER corners at (100,100) and (700,500) → a 600×400 px room. */
export const PLAN = { w: 800, h: 600, inner: { x0: 100, y0: 100, x1: 700, y1: 500 }, wall: 12 };
export const floorPlanPng = () => encodePng(PLAN.w, PLAN.h, (x, y) => {
  const { x0, y0, x1, y1 } = PLAN.inner, t = PLAN.wall;
  const inOuter = x >= x0 - t && x < x1 + t && y >= y0 - t && y < y1 + t;
  const inInner = x >= x0 && x < x1 && y >= y0 && y < y1;
  return inOuter && !inInner ? [0, 0, 0] : [255, 255, 255];
});
const inRoundRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
/** A green sofa-ish shape on white: back, seat, two arms. */
export const sofaPng = () => encodePng(320, 200, (x, y) => {
  const sofa = inRoundRect(x, y, 40, 40, 280, 120, 14) || inRoundRect(x, y, 30, 100, 290, 165, 12);
  const leg = (x > 50 && x < 60 || x > 260 && x < 270) && y >= 165 && y < 180;
  return sofa ? [52, 140, 70] : leg ? [60, 40, 25] : [255, 255, 255];
});
/** A brown wooden table: top + 2 legs, with grain stripes. */
export const tablePng = () => encodePng(320, 220, (x, y) => {
  const top = x >= 30 && x < 290 && y >= 50 && y < 75;
  const leg = ((x >= 45 && x < 62) || (x >= 258 && x < 275)) && y >= 75 && y < 190;
  if (!top && !leg) return [255, 255, 255];
  const grain = (Math.floor((x + y * 0.3) / 6) % 2) ? 0 : 12;
  return [139 - grain, 90 - grain, 43 - grain / 2];
});

export const hue = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return { h: 0, s: 0, l: (mx + mn) / 2 };
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(mx + mn - 1)), l: (mx + mn) / 2 };
};

// ───────── floor-plan tracing helpers ─────────
export interface Rect { x0: number; y0: number; x1: number; y1: number }
/** Plan image: rooms are INNER rectangles; walls (`t` px, black) surround them; `gaps` are cut out (door openings);
 * `paint` may colour paper pixels (floor textures, thin furniture lines). */
export function wallsPng(w: number, h: number, rooms: Rect[], t: number, gaps: Rect[] = [],
  paint?: (x: number, y: number) => [number, number, number] | null) {
  const inR = (x: number, y: number, r: Rect, e = 0) => x >= r.x0 - e && x < r.x1 + e && y >= r.y0 - e && y < r.y1 + e;
  return encodePng(w, h, (x, y) => {
    const wall = rooms.some((r) => inR(x, y, r, t)) && !rooms.some((r) => inR(x, y, r)) && !gaps.some((g) => inR(x, y, g));
    return wall ? [0, 0, 0] : paint?.(x, y) ?? [255, 255, 255];
  });
}
/** Two rooms side by side, 12 px walls, a door in the shared wall (x 450..462, y 250..310). */
export const TWO = { w: 900, h: 600, t: 12, a: { x0: 100, y0: 100, x1: 450, y1: 500 }, b: { x0: 462, y0: 100, x1: 800, y1: 500 } };
export const twoRoomPng = () => wallsPng(TWO.w, TWO.h, [TWO.a, TWO.b], TWO.t, [{ x0: 450, y0: 250, x1: 462, y1: 310 }]);

/** Image pixel → page coordinates, through the underlay <image> currently on screen. */
export const imgToScreen = async (page: Page, px: number, py: number) => {
  const b = await page.getByTestId('underlay-image').boundingBox();
  const u = (await state(page)).project.underlay!;
  return { x: b!.x + (px / u.widthPx) * b!.width, y: b!.y + (py / u.heightPx) * b!.height };
};
export const clickImg = async (page: Page, px: number, py: number) => {
  const p = await imgToScreen(page, px, py);
  await page.mouse.click(p.x, p.y);
};
/** Image pixel → plan cm through the current underlay. */
export const imgToPlan = async (page: Page, px: number, py: number) => {
  const u = (await state(page)).project.underlay!;
  return { x: u.x + px * u.cmPerPx, y: u.y + py * u.cmPerPx };
};
export const wallLengths = (pts: Vec2[]) => pts.map((a, i) => { const b = pts[(i + 1) % pts.length]; return Math.hypot(b.x - a.x, b.y - a.y); });

/** Opens the tracing panel from the welcome card and adds `png` through the file picker. */
export async function uploadPlan(page: Page, png: Buffer) {
  await open(page);
  await page.getByTestId('start-floorplan').click();
  await expect(page.getByTestId('floorplan-panel')).toBeVisible();
  await page.getByTestId('floorplan-file').setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByTestId('underlay-image')).toHaveCount(1);
  await expect(page.getByTestId('floorplan-dropzone')).toHaveCount(0);
}
/** Traces one room by clicking image-pixel corners, closing it on the first corner's green circle. */
export async function traceRoom(page: Page, corners: [number, number][]) {
  const trace = page.getByTestId('floorplan-trace').or(page.getByTestId('floorplan-trace-next'));
  await trace.click();
  await expect(page.getByTestId('draw-hint')).toContainText('first corner');
  for (const [x, y] of corners) await clickImg(page, x, y);
  await expect(page.getByTestId('draw-close-target')).toBeVisible();
  await clickImg(page, corners[0][0], corners[0][1]);
  await expect(page.getByTestId('floorplan-naming')).toBeVisible();
}
export const rectCorners = (r: Rect): [number, number][] => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
