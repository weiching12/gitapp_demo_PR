import { test, expect } from '@playwright/test';

test('public visit registration returns receipts and anonymous statistics access is rejected', async ({ request }) => {
  const id = crypto.randomUUID();
  for (let i = 0; i < 2; i++) {
    const response = await request.post('/api/v1/presence', { data: { id, nationality: '台灣' } });
    expect(response.ok()).toBeTruthy(); expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({ recorded: true });
  }
  for (const path of ['/api/presence', '/api/v1/presence']) expect([401, 503]).toContain((await request.get(path)).status());
});

test('public page hides counts and records visits with stable browser identity', async ({ page }) => {
  const ids = [], reads = [];
  await page.route('**/api/v1/presence', async route => {
    if (route.request().method() === 'POST') ids.push(route.request().postDataJSON().id);
    else reads.push(route.request().method());
    await route.fulfill({ json: { recorded: true } });
  });
  await page.goto('/');
  await expect.poll(() => ids.length).toBe(1);
  await expect(page.locator('#online-count')).toBeHidden();
  await page.getByText('訪客資料說明', { exact: true }).click();
  await page.getByLabel('國籍（選填）').fill('台灣');
  await page.getByRole('button', { name: '送出國籍' }).click();
  await expect(page.locator('#visitor-nationality-form [role="status"]')).toHaveText('國籍已送出');
  await page.reload(); await expect.poll(() => ids.length).toBe(3);
  expect(new Set(ids).size).toBe(1); expect(reads).toHaveLength(0);
});
