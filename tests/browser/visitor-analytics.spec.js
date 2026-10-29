import { test, expect } from '@playwright/test';

test('administrator views daily, monthly and full history trends with private details and can log out', async ({ page }) => {
  const queries = [];
  await page.route('**/api/v1/presence?**', route => {
    expect(route.request().headers().authorization).toBe('Bearer admin-test-secret');
    const url = new URL(route.request().url()); queries.push(url.searchParams);
    const monthly = url.searchParams.get('period') === 'month';
    return route.fulfill({ json: {
      today: { today: 2, asOf: '2026-10-29' }, start: '2026-10-01', end: '2026-10-29',
      period: monthly ? 'month' : 'day', unique: 2, total: 3, limit: 100, offset: 0,
      daily: monthly ? [{ day: '2026-10', visitors: 2 }] : [{ day: '2026-10-28', visitors: 1 }, { day: '2026-10-29', visitors: 2 }],
      visitors: [{ day: '2026-10-29', id: 'anonymous-browser', nationality: '台灣', ip: '203.0.113.7', country: 'TW', first_seen: 1793203200000, last_seen: 1793203200000 }],
    } });
  });
  await page.goto('/admin-visitors.html');
  await expect(page.locator('#report')).toBeHidden();
  await page.locator('#token').fill('admin-test-secret'); await page.locator('#login button').click();
  await expect(page.locator('#today')).toHaveText('今日 2026-10-29：2 位瀏覽者');
  await expect(page.locator('#visitors')).toContainText('台灣'); await expect(page.locator('#visitors')).toContainText('203.0.113.7');
  await expect(page.locator('#trend svg circle')).toHaveCount(2);
  await page.locator('#view').selectOption('month');
  await expect(page.locator('#trend-title')).toHaveText('每月瀏覽者趨勢');
  await expect(page.locator('#trend svg circle')).toHaveCount(1);
  await page.locator('#view').selectOption('history');
  await expect(page.locator('#trend-title')).toContainText('全部歷史'); await expect(page.locator('#start')).toBeDisabled();
  expect(queries.at(-1).get('scope')).toBe('history');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#logout').click();
  await expect(page.locator('#report')).toBeHidden(); await expect(page.locator('#visitors')).toBeEmpty();
  await expect(page.locator('#trend')).toBeEmpty();
});

test('rejected credentials never reveal analytics or visitor details', async ({ page }) => {
  await page.route('**/api/v1/presence?**', route => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await page.goto('/admin-visitors.html');
  await page.locator('#token').fill('wrong'); await page.locator('#login button').click();
  await expect(page.locator('#status')).toHaveText('管理員密鑰錯誤');
  await expect(page.locator('#report')).toBeHidden(); await expect(page.locator('#visitors')).toBeEmpty();
});
