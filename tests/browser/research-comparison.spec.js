import { test, expect } from '@playwright/test';

test('chart selection compares that session to joining and keeps the selected day across range changes', async ({ page }) => {
  await page.setViewportSize({ width: 516, height: 956 });
  await page.addInitScript(() => {
    const keys = ['trend', 'momentum', 'priceVolume', 'institutional', 'entryRisk'];
    const initial = { id: 'saved-join', symbol: '3026', asOf: '2026-10-14', valid: true,
      modelVersion: 'entry-score-v1.2', strategy: 'swing-trend',
      configId: 'swing-trend:kd-9-3-3:weights-25-15-15-20-25', priceBasis: 'unadjusted',
      finalScore: 89.25, baseScore: 89.25, passedCount: 5, totalConditions: 5,
      categories: Object.fromEntries(keys.map((key, index) => [key, { score: [100, 85, 100, 95, 70][index] }])),
      conditions: Object.fromEntries(keys.map(key => [key, { status: 'PASS' }])), cap: { enabled: false } };
    localStorage.setItem('stock-insight-v1', JSON.stringify({ favorites: ['3026'], theme: 'light', catalogVersion: 2 }));
    localStorage.setItem('stock-insight-research-v2', JSON.stringify({ version: 3, periods: [{
      id: 'join-fixture', symbol: '3026', removedAt: null, addedAt: '2026-10-14T08:00:00Z', startedAt: '2026-10-14T08:00:00Z',
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
  await expect(page.locator('.research-price-chart .research-chart-readout')).toHaveCount(0);
  await expect(comparison.locator('[data-metric="price"]')).toBeVisible();
  await expect(comparison.locator('[data-metric="score"]')).toBeVisible();
  await expect(page.locator('.research-price-chart > .research-muted')).toHaveCSS('text-align', 'right');
  await expect(plot).toHaveCSS('user-select', 'none');
  await expect(plot).toHaveCSS('touch-action', 'pan-y');
  await expect(page.locator('.research-review-detail > .research-initial-comparison')).toBeVisible();
  await expect(comparison.locator('summary')).toHaveCount(0);
  await expect(comparison).not.toHaveJSProperty('tagName', 'DETAILS');
  const gap = await comparison.evaluate(n => n.getBoundingClientRect().top - n.previousElementSibling.getBoundingClientRect().bottom);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(10);
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-16');
  const points = await plot.evaluate(n => JSON.parse(n.dataset.points));
  expect(points[0].date).toBe('2026-10-14');
  const joinedIndex = points.findIndex(point => point.date === '2026-10-14');
  await plot.scrollIntoViewIfNeeded();
  const svg = await plot.locator('svg').boundingBox();
  await page.mouse.click(svg.x + (12 + joinedIndex * 296 / (points.length - 1)) / 320 * svg.width, svg.y + svg.height / 2);
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-14');
  await plot.focus(); await plot.press('Home');
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-14');
  await expect(page.locator('.research-price-chart > .research-muted')).toHaveText('以加入收藏日期為起始');
  await expect(comparison.locator('[data-metric="score"] strong')).toHaveText('89.25');
  await expect(comparison.locator('[data-metric="score"] .research-metric-baseline')).toHaveText('加入時 89.25');
  await expect(comparison.locator('[data-metric="score"] .research-metric-change')).toHaveText('變化 0.00 分');
  await plot.press('ArrowRight');
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-15');
  await expect(comparison.locator('.research-comparison-dates, .research-comparison-notice')).toHaveCount(0);
  await expect(comparison.locator('.research-comparison-summary')).toHaveAttribute('aria-label', '加入時 2026-10-14 → 所選日 2026-10-15');
  const readout = await comparison.locator('[data-metric="score"] strong').textContent();
  await expect(comparison.locator('.research-comparison-summary')).toContainText(readout.replace(' 分', ''));
  await page.locator('[data-review-range="20"]').click();
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-15');
  await expect(plot.locator('.research-selected-date text')).toHaveText('10/15');
  const rect = await plot.boundingBox();
  await page.mouse.click(rect.x + rect.width - 4, rect.y + rect.height / 2);
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-16');
  await expect(comparison.locator('.research-comparison-category')).toHaveCount(5);
  await expect(comparison.locator('.research-comparison-bar')).toHaveCount(10);
  await expect(comparison.locator('[data-metric="score"] strong')).toHaveText('64.25');
  await expect(comparison.locator('[data-metric="score"] .research-metric-baseline')).toHaveText('加入時 89.25');
  await expect(comparison.locator('[data-metric="score"] .research-metric-change')).toHaveText('變化 -25.00 分');
  const trend = comparison.locator('[data-category="trend"]');
  await expect(comparison.locator('[data-metric="score"] dt')).toHaveText('加權總分');
  await expect(comparison.locator('.research-contribution-heading')).toContainText('各條件加權貢獻');
  await expect(trend.locator('.research-comparison-category-heading')).toContainText('權重 25%');
  await expect(trend.locator('.research-comparison-category-heading')).toContainText('-25.00 分');
  await expect(trend.locator('.research-comparison-bar').last().locator('strong')).toHaveText('0.00');
  await expect(trend.locator('.research-comparison-bar').last().locator('.research-comparison-status')).toHaveText('未通過');
  await expect(trend.locator('.research-comparison-bar').last().locator('.selected')).toHaveCSS('width', '0px');
  await expect(comparison.locator('.research-comparison-state')).toHaveCount(0);
  const totals = await comparison.locator('.research-comparison-bar').evaluateAll(bars => bars.reduce((sums, bar, index) => {
    sums[index % 2] += Number(bar.dataset.contribution); return sums;
  }, [0, 0]));
  expect(totals.map(value => value.toFixed(2))).toEqual(['89.25', '64.25']);
  await plot.scrollIntoViewIfNeeded();
  const marker = await plot.locator('.research-selected-date text').boundingBox();
  const plotBounds = await plot.boundingBox();
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await page.mouse.down();
  await page.mouse.move(plotBounds.x + 18, marker.y + marker.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection().toString())).toBe('');
  await expect(comparison).toHaveAttribute('data-selected-date', '2026-10-14');
  await plot.focus(); await plot.press('End');
  for (const width of [320, 375, 400, 516]) {
    await page.setViewportSize({ width, height: 956 });
    expect(await comparison.evaluate(n => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(1);
    const priceMetric = await comparison.locator('[data-metric="price"]').boundingBox();
    const scoreMetric = await comparison.locator('[data-metric="score"]').boundingBox();
    expect(Math.abs(priceMetric.y - scoreMetric.y)).toBeLessThanOrEqual(1);
    expect(scoreMetric.x).toBeGreaterThanOrEqual(priceMetric.x + priceMetric.width);
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
