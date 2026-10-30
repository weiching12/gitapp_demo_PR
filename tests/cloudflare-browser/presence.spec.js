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

test('public page counts each reload with a new entry key and nationality edits update the same event', async ({ page }) => {
  const entries = [], reads = [];
  await page.route('**/api/v1/presence', async route => {
    if (route.request().method() === 'POST') entries.push(route.request().postDataJSON());
    else reads.push(route.request().method());
    await route.fulfill({ json: { recorded: true } });
  });
  await page.goto('/');
  await expect.poll(() => entries.length).toBe(1);
  expect(entries[0].visitId).toMatch(/^[a-f0-9-]{36}$/i);
  expect(entries[0].metadataOnly).not.toBe(true);
  await expect(page.locator('#online-count')).toBeHidden();
  await page.getByText('訪客資料說明', { exact: true }).click();
  await page.getByLabel('國籍（選填）').fill('台灣');
  await page.getByRole('button', { name: '送出國籍' }).click();
  await expect(page.locator('#visitor-nationality-form [role="status"]')).toHaveText('國籍已送出');
  await expect.poll(() => entries.length).toBe(2);
  expect(entries[1]).toMatchObject({ id: entries[0].id, visitId: entries[0].visitId, metadataOnly: true, nationality: '台灣' });
  await page.reload(); await expect.poll(() => entries.length).toBe(3);
  expect(entries[2].id).toBe(entries[0].id);
  expect(entries[2].visitId).not.toBe(entries[0].visitId);
  expect(entries[2].metadataOnly).not.toBe(true);
  expect(new Set(entries.filter(entry => !entry.metadataOnly).map(entry => entry.visitId)).size).toBe(2);
  expect(reads).toHaveLength(0);
});
