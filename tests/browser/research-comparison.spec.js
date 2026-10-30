import { test, expect } from '@playwright/test';

test('chart selection compares that session to joining and keeps the selected day across range changes', async ({ page }) => {
  await page.setViewportSize({ width: 516, height: 956 });
  await page.addInitScript(() => {
    const keys = ['trend', 'momentum', 'priceVolume', 'institutional', 'entryRisk'];
    const initial = { id: 'saved-join', symbol: '3026', asOf: '2026-10-14', valid: true,
      modelVersion: 'entry-score-v1.2', strategy: 'swing-trend',
      configId: 'swing-trend:kd-9-3-3:weights-25-15-15-20-25', priceBasis: 'unadjusted',
      finalScore: 89.25, baseScore: 89.25, passedCount: 5, totalConditions: 5,
      categories: Object.fromEntries(keys.map(key => [key, { score: 90 }])),
      conditions: Object.fromEntries(keys.map(key => [key, { status: 'PASS' }])), cap: { enabled: false } };
    localStorage.setItem('stock-insight-v1', JSON.stringify({ favorites: ['3026'], theme: 'light', catalogVersion: 2 }));
    localStorage.setItem('stock-insight-research-v2', JSON.stringify({ version: 3, periods: [{
      id: 'join-fixture', symbol: '3026', removedAt: null, startedAt: '2026-10-14T08:00:00Z',
      addedSnapshot: initial, firstValidSnapshot: initial,
      baseline: { asOf: '2026-10-14', close: 100, priceBasis: 'unadjusted' },
    }] }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: '株研追蹤', exact: true }).first().click();
  await page.locator('.research-card-main').first().click();
  const plot = page.locator('.research-chart-plot');
  const comparison = page.locator('.research-initial-comparison');
  await expect(plot).toBeVisible();
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-16');
  const points = await plot.evaluate(n => JSON.parse(n.dataset.points));
  const joinedIndex = points.findIndex(point => point.date === '2026-10-14');
  await plot.scrollIntoViewIfNeeded();
  const svg = await plot.locator('svg').boundingBox();
  await page.mouse.click(svg.x + (12 + joinedIndex * 296 / (points.length - 1)) / 320 * svg.width, svg.y + svg.height / 2);
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-14');
  await plot.focus(); await plot.press('Home');
  await expect(comparison.locator('.research-comparison-notice')).toContainText('早於評分基準日');
  await expect(page.locator('.research-chart-readout')).toContainText('加入前');
  await plot.press('End'); await plot.press('ArrowLeft'); await plot.press('ArrowLeft');
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-14');
  await expect(page.locator('.research-chart-readout strong').last()).toHaveText('89.25 分');
  await expect(comparison.locator('.research-comparison-summary')).toContainText('89.25 → 89.25 · 變化 0.00');
  await plot.press('ArrowRight');
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-15');
  await expect(comparison.locator('.research-comparison-dates')).toHaveText('加入時 2026-10-14 → 所選日 2026-10-15');
  const readout = await page.locator('.research-chart-readout strong').last().textContent();
  await expect(comparison.locator('.research-comparison-summary')).toContainText(readout.replace(' 分', ''));
  await page.locator('[data-review-range="20"]').click();
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-15');
  await expect(plot.locator('.research-selected-date text')).toHaveText('10/15');
  const rect = await plot.boundingBox();
  await page.mouse.click(rect.x + rect.width - 4, rect.y + rect.height / 2);
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-16');
  await expect(comparison.locator('.research-comparison-category')).toHaveCount(5);
  await expect(comparison.locator('.research-comparison-bar')).toHaveCount(10);
  await expect(comparison.locator('.research-comparison-summary')).toContainText('89.25 → 64.25 · 變化 -25.00');
  for (const width of [320, 516]) {
    await page.setViewportSize({ width, height: 956 });
    expect(await comparison.evaluate(n => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(1);
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const charts = page.locator('.research-chart, .research-price-chart');
    for (const chart of await charts.all()) {
      await expect(chart).toHaveCSS('background-color', theme === 'dark' ? 'rgba(0, 0, 0, 0)' : 'rgb(255, 255, 255)');
      await expect(chart).toHaveCSS('color', theme === 'dark' ? 'rgb(229, 237, 248)' : 'rgb(30, 41, 59)');
    }
    await charts.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.wrangler/research-trend-${theme}.png` });
    await comparison.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.wrangler/research-comparison-${theme}.png` });
  }
});
