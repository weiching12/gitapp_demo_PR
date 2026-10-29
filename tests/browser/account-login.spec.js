import { test, expect } from '@playwright/test';

for (const width of [320, 390, 700]) {
  test(`mobile settings provides a login entry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 956 });
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: null } }));
    await page.goto('/');
    await page.getByRole('button', { name: '設定', exact: true }).click();
    const login = page.getByRole('dialog').getByRole('link', { name: '登入', exact: true });
    await expect(login).toBeVisible();
    await expect(login).toHaveAttribute('href', '/login.html');
    const bounds = await login.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await login.click();
    await expect(page).toHaveURL(/\/login\.html$/);
    await expect(page.getByLabel('帳號', { exact: true })).toBeVisible();
    await expect(page.getByLabel('密碼', { exact: true })).toBeVisible();
  });
}

test('desktop keeps its existing account entry in the top bar', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.goto('/');
  await expect(page.locator('#account-menu').getByRole('link', { name: '登入', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.locator('.settings-account')).toBeHidden();
});

for (const role of ['user', 'admin']) {
  test(`${role} uses the shared login form and reaches the correct destination`, async ({ page }) => {
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: null } }));
    let payload;
    await page.route('**/api/v1/auth/login', route => {
      expect(route.request().method()).toBe('POST');
      payload = route.request().postDataJSON();
      return route.fulfill({ json: { user: { id: 'account-test', username: 'account-test', role } } });
    });
    const destination = role === 'admin' ? '/admin-visitors.html' : '/';
    await page.route(`http://127.0.0.1:5173${destination}`, route => route.fulfill({ contentType: 'text/html', body: `<main>Signed in as ${role}</main>` }));
    await page.goto('/login.html');
    await page.getByLabel('帳號', { exact: true }).fill('account-test');
    await page.getByLabel('密碼', { exact: true }).fill('correct-test-password');
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await expect(page).toHaveURL(`http://127.0.0.1:5173${destination}`);
    expect(payload).toEqual({ username: 'account-test', password: 'correct-test-password' });
    expect(payload).not.toHaveProperty('role');
    await expect(page.getByRole('main')).toHaveText(`Signed in as ${role}`);
  });
}

test('invalid credentials leave the form available and clear the password', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.route('**/api/v1/auth/login', route => route.fulfill({ status: 401, json: { error: '帳號或密碼錯誤' } }));
  await page.goto('/login.html');
  await page.locator('#username').fill('account-test');
  await page.locator('#password').fill('wrong-test-password');
  await page.locator('#submit').click();
  await expect(page.locator('#status')).toHaveText('帳號或密碼錯誤');
  await expect(page).toHaveURL(/\/login(?:\.html)?$/);
  await expect(page.locator('#password')).toHaveValue('');
  await expect(page.locator('#submit')).toBeEnabled();
  await expect(page.locator('#visitors')).toHaveCount(0);
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('wrong-test-password')))).toBe(false);
});
