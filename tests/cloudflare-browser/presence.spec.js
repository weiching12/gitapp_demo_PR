import { test, expect } from '@playwright/test';

test('public visit registration returns receipts and anonymous statistics access is rejected', async ({ request }) => {
  const id = crypto.randomUUID(), visitId = crypto.randomUUID();
  for (let i = 0; i < 2; i++) {
    const response = await request.post('/api/v1/presence', { data: { id, visitId } });
    expect(response.ok()).toBeTruthy(); expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({ recorded: true });
  }
  for (const path of ['/api/presence', '/api/v1/presence']) expect([401, 503]).toContain((await request.get(path)).status());
});

test('public page counts each reload without asking for or sending stored nationality', async ({ page }) => {
  const entries = [], reads = [];
  await page.route('**/api/v1/presence', async route => {
    if (route.request().method() === 'POST') entries.push(route.request().postDataJSON());
    else reads.push(route.request().method());
    await route.fulfill({ json: { recorded: true } });
  });
  await page.addInitScript(() => localStorage.setItem('stock-insight-nationality', '台灣'));
  await page.goto('/');
  await expect.poll(() => entries.length).toBe(1);
  expect(entries[0].visitId).toMatch(/^[a-f0-9-]{36}$/i);
  expect(entries[0].metadataOnly).not.toBe(true);
  expect(entries[0]).not.toHaveProperty('nationality');
  await expect(page.locator('#online-count')).toBeHidden();
  await expect(page.locator('#visitor-nationality-form, .visitor-info')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '送出國籍' })).toHaveCount(0);
  await page.reload(); await expect.poll(() => entries.length).toBe(2);
  expect(entries[1].id).toBe(entries[0].id);
  expect(entries[1].visitId).not.toBe(entries[0].visitId);
  expect(entries[1].metadataOnly).not.toBe(true);
  expect(entries[1]).not.toHaveProperty('nationality');
  expect(new Set(entries.filter(entry => !entry.metadataOnly).map(entry => entry.visitId)).size).toBe(2);
  expect(reads).toHaveLength(0);
});
