import { expect, loadDemo, test } from './fixtures';

// Regression: at narrow widths clicking a library item used to scroll the page and push the plan off-screen.
for (const width of [500, 600, 700, 1400]) {
  test(`app shell never scrolls the document at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await loadDemo(page);
    const before = await page.getByTestId('plan-item').count();
    const row = page.locator('[data-testid=lib-item]').last();
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await expect(page.getByTestId('plan-item')).toHaveCount(before + 1);

    const m = await page.evaluate(() => ({
      scrollY: window.scrollY, scrollH: document.documentElement.scrollHeight, innerH: innerHeight, innerW: innerWidth,
    }));
    expect(m.scrollY).toBe(0);
    expect(m.scrollH).toBeLessThanOrEqual(m.innerH);
    const svg = (await page.getByTestId('plan-svg').boundingBox())!;
    expect(svg.y).toBeGreaterThanOrEqual(0);
    expect(svg.y + svg.height).toBeLessThanOrEqual(m.innerH + 1);
    expect(svg.x + svg.width).toBeLessThanOrEqual(m.innerW + 1);
    expect(svg.height).toBeGreaterThanOrEqual(200);
    // The newly placed (selected) item is drawn inside the visible plan.
    const item = (await page.getByTestId('plan-item').last().boundingBox())!;
    expect(item.y).toBeGreaterThanOrEqual(svg.y - 1);
    expect(item.y + item.height).toBeLessThanOrEqual(svg.y + svg.height + 1);
    if (width === 600) await page.screenshot({ path: 'test-results/narrow-600.png' });
  });
}
