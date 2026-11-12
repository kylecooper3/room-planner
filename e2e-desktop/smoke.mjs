// Smoke test of the built desktop app (run `npm run dist:win` first). Launches the release exe with WebView2 remote
// debugging on, drives it over CDP with Playwright, and checks: toolbar + WebGL 3D view render, an edit survives closing
// and relaunching, photo ML runs from the bundled models, project export downloads a file, and no request leaves the machine.
// Uses its own WebView2 data folder (WEBVIEW2_USER_DATA_FOLDER), so the real app data is never touched.
import { chromium } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { sofaPng } from '../e2e/fixtures.ts';

const EXE = join(import.meta.dirname, '..', 'src-tauri', 'target', 'release', 'room-planner.exe');
const PORT = 9223;
const dataDir = mkdtempSync(join(tmpdir(), 'room-planner-smoke-'));
const offHost = []; // every http(s) request to a host other than the app's own
const LOCAL = /^https?:\/\/(tauri|ipc)\.localhost\//;

async function launch() {
  const proc = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: dataDir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.ok, () => false)); i++) {
    await new Promise((r) => setTimeout(r, 300));
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const context = browser.contexts()[0];
  context.on('request', (r) => { if (/^https?:/.test(r.url()) && !LOCAL.test(r.url())) offHost.push(r.url()); });
  let page;
  for (let i = 0; i < 100 && !(page = context.pages().find((p) => p.url().includes('tauri.localhost'))); i++) {
    await new Promise((r) => setTimeout(r, 300)); // the window starts on about:blank before navigating to the app
  }
  assert.ok(page, 'app page appeared');
  await page.waitForLoadState('load');
  await page.reload(); // so every request of this session is observed from the start
  await page.getByTestId('app').waitFor({ timeout: 30_000 });
  return { proc, browser, page };
}

async function close({ proc, browser, page }) {
  // Requests the page made that CDP might have missed (e.g. before we attached).
  const entries = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
  offHost.push(...entries.filter((u) => /^https?:/.test(u) && !/^https?:\/\/(tauri|ipc)\.localhost\//.test(u)));
  await browser.close(); // disconnects only
  execSync(`taskkill /pid ${proc.pid}`, { stdio: 'ignore' }); // WM_CLOSE: a normal window close
  for (let i = 0; i < 50 && proc.exitCode === null; i++) await new Promise((r) => setTimeout(r, 200));
  if (proc.exitCode === null) execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
}

const step = (s) => console.log(`smoke: ${s}`);
assert.ok(existsSync(EXE), `${EXE} missing: run npm run dist:win first`);
try {
  // Launch 1: render, 3D, edit.
  let app = await launch();
  let { page } = app;
  assert.equal(await page.evaluate(() => 'serviceWorker' in navigator && navigator.serviceWorker.controller), null, 'no service worker');
  await page.getByTestId('file-menu').waitFor();
  step('toolbar rendered');
  await page.getByTestId('load-demo').click();
  await page.getByTestId('plan-item').first().waitFor();
  const before = await page.getByTestId('plan-item').count();
  await page.getByTestId('view-3d').click();
  const canvas = page.locator('[data-testid=view3d] canvas');
  await canvas.waitFor();
  assert.ok(await canvas.evaluate((c) => !!c.getContext('webgl2')), '3D canvas has a WebGL2 context');
  step('3D view renders with WebGL2');
  await page.getByTestId('view-plan').click();
  await page.getByTestId('plan-item').first().click({ force: true }); // may sit under another item (rug); any item will do
  await page.keyboard.press('Delete');
  assert.equal(await page.getByTestId('plan-item').count(), before - 1);
  await page.waitForTimeout(2000); // autosave runs ~0.5 s after a change
  step(`edit made (${before} -> ${before - 1} items)`);

  // Export: <a download> must complete a download. Playwright reroutes downloads to its own temp folder while attached,
  // so check the download itself rather than the user's Downloads folder (where WebView2 saves it normally).
  await page.getByTestId('file-menu').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('file-export').click()]);
  assert.equal(await dl.failure(), null, 'export download completed');
  const size = statSync(await dl.path()).size;
  assert.ok(dl.suggestedFilename().endsWith('.roomplan') && size > 0, 'export produced a .roomplan file');
  step(`export downloaded ${dl.suggestedFilename()} (${size} bytes)`);
  await close(app);

  // Launch 2: the edit persisted; photo ML runs from the bundled models.
  app = await launch();
  ({ page } = app);
  await page.getByTestId('plan-item').first().waitFor();
  assert.equal(await page.getByTestId('plan-item').count(), before - 1, 'edit persisted across relaunch');
  step('edit persisted after relaunch');
  await page.getByTestId('tab-my-stuff').click();
  await page.getByTestId('new-from-photo').click();
  await page.getByTestId('photo-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: sofaPng() });
  await page.getByTestId('item-name').fill('Sofa');
  for (const [k, v] of [['w', '84'], ['d', '36'], ['h', '34']]) await page.getByTestId(`dim-${k}`).fill(v);
  await page.getByTestId('analyze-btn').click();
  await page.getByTestId('category-select').waitFor({ timeout: 180_000 });
  const unavailable = await page.locator('.ic-form > .note').filter({ hasText: /unavailable/i }).allTextContents();
  assert.deepEqual(unavailable, [], 'both ML models ran');
  step(`photo ML ran offline: category "${await page.getByTestId('category-select').inputValue()}"`);
  await close(app);

  assert.deepEqual(offHost, [], 'no request left the machine');
  step('no request to any http(s) host');
  console.log('smoke: PASS');
} finally {
  // WebView2 helper processes can hold the folder briefly; a leftover temp folder must not hide the real result.
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { console.warn(`smoke: could not remove ${dataDir}`); }
}
