import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { expect, test } from './fixtures';

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
let server: ChildProcess | undefined;

test.describe('offline (production build + service worker)', () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    execSync('npm run build', { stdio: 'pipe' });
    server = spawn(`npx vite preview --port ${PORT} --strictPort`, { shell: true, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      if (await fetch(URL).then((r) => r.ok, () => false)) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('vite preview did not start');
  });
  test.afterAll(() => {
    if (!server?.pid) return;
    // shell: true → kill the whole process tree (vite runs under npx under a shell).
    if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
    else server.kill('SIGTERM');
  });

  test('precache stays well under 40 MB', () => {
    const sw = readFileSync('dist/sw.js', 'utf8');
    const urls = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
    expect(urls.some((u) => u.endsWith('ort-wasm-simd-threaded.asyncify.wasm'))).toBe(true);
    expect(urls.filter((u) => u.endsWith('.wasm'))).toHaveLength(1); // one runtime binary, shipped once
    const bytes = urls.reduce((s, u) => s + statSync(`dist/${u}`).size, 0);
    test.info().annotations.push({ type: 'precache', description: `${(bytes / 2 ** 20).toFixed(1)} MiB in ${urls.length} files` });
    expect(bytes).toBeLessThan(40 * 2 ** 20);
  });

  test('app loads and the demo works offline after the first visit', async ({ page, context }) => {
    await page.goto(URL);
    await expect(page.getByTestId('home')).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 60_000 }).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('home-empty')).toBeVisible();
    await page.getByTestId('home-demo').click();
    await expect(page.getByTestId('plan-item')).toHaveCount(6);
    await page.getByTestId('view-3d').click(); // lazy three.js chunk comes from the precache too
    await expect(page.locator('[data-testid=view3d] canvas')).toBeVisible();
    await context.setOffline(false);
  });
});
