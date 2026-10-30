import { test, expect } from '@playwright/test';

const user = { id: 'temporary-admin', username: 'temporary-admin', role: 'admin', mustChangePassword: true };
const nextPassword = 'replacement-test-password-2026';

async function session(page, currentUser = user) {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: currentUser } }));
}

async function completeLogin(page) {
  await page.goto('/login.html');
  await page.getByLabel('帳號', { exact: true }).fill('temporary-admin');
  await page.getByLabel('密碼', { exact: true }).fill('temporary-test-password');
  await page.locator('#submit').click();
}

async function completePassword(page) {
  await page.goto('/change-password.html');
  await expect(page.locator('#password')).toBeEnabled();
  await page.locator('#password').fill(nextPassword);
  await page.locator('#confirm-password').fill(nextPassword);
  await page.locator('#submit').click();
}

async function friendlyFailure(page) {
  const status = page.locator('#status');
  await expect(status).toContainText(/[\u4e00-\u9fff]/);
  await expect(status).not.toContainText(/Unexpected|JSON|SyntaxError|Failed to fetch|NetworkError|<html|<h1/i);
  await expect(page.locator('#submit')).toBeEnabled();
}

test('temporary account login requires a password change before its destination', async ({ page }) => {
  await session(page, null);
  await page.route('**/api/v1/auth/login', route => route.fulfill({ json: { user } }));
  await page.route('http://127.0.0.1:5173/change-password.html', route => route.fulfill({ contentType: 'text/html', body: '<main>Change password first</main>' }));
  await completeLogin(page);
  await expect(page).toHaveURL(/\/change-password\.html$/);
  await expect(page.getByRole('main')).toHaveText('Change password first');
});

test('an existing temporary session also redirects from login to password change', async ({ page }) => {
  await session(page);
  await page.route('http://127.0.0.1:5173/change-password.html', route => route.fulfill({ contentType: 'text/html', body: '<main>Change password first</main>' }));
  await page.goto('/login.html');
  await expect(page).toHaveURL(/\/change-password\.html$/);
});

test('password change requires an authenticated session', async ({ page }) => {
  await session(page, null);
  await page.goto('/change-password.html');
  await expect(page).toHaveURL(/\/login\.html$/);
  await expect(page.getByLabel('帳號', { exact: true })).toBeVisible();
});

test('password confirmation mismatch is explained without submitting credentials', async ({ page }) => {
  await session(page);
  let requests = 0;
  await page.route('**/api/v1/auth/change-password', route => { requests++; return route.fulfill({ json: { user: { ...user, mustChangePassword: false } } }); });
  await page.goto('/change-password.html');
  await expect(page.locator('#password')).toBeEnabled();
  await page.locator('#password').fill(nextPassword);
  await page.locator('#confirm-password').fill('different-test-password-2026');
  await page.locator('#submit').click();
  await friendlyFailure(page);
  await expect(page.locator('#status')).toContainText(/一致|相同/);
  expect(requests).toBe(0);
});

test('successful password change sends confirmation and returns to administrator statistics', async ({ page }) => {
  await session(page);
  let payload;
  await page.route('**/api/v1/auth/change-password', route => {
    expect(route.request().method()).toBe('POST');
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { user: { ...user, mustChangePassword: false } } });
  });
  await page.route('http://127.0.0.1:5173/admin-visitors.html', route => route.fulfill({ contentType: 'text/html', body: '<main>Password updated</main>' }));
  await completePassword(page);
  await expect(page).toHaveURL(/\/admin-visitors\.html$/);
  expect(payload).toEqual({ password: nextPassword, confirmPassword: nextPassword });
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('replacement-test-password')))).toBe(false);
});

for (const screen of ['login', 'change-password']) {
  for (const failure of ['empty-server-error', 'html-server-error', 'network-error']) {
    test(`${screen} explains ${failure} without exposing parser or network exceptions`, async ({ page }) => {
      await session(page, screen === 'login' ? null : user);
      const path = screen === 'login' ? 'login' : 'change-password';
      await page.route(`**/api/v1/auth/${path}`, route => failure === 'network-error' ? route.abort('failed') : route.fulfill({
        status: 500,
        contentType: failure === 'html-server-error' ? 'text/html' : 'application/json',
        body: failure === 'html-server-error' ? '<html><h1>Internal Server Error</h1></html>' : '',
      }));
      if (screen === 'login') await completeLogin(page);
      else await completePassword(page);
      await friendlyFailure(page);
      await expect(page).toHaveURL(new RegExp(`/${screen}\\.html$`));
    });
  }

  for (const width of [320, 390, 550, 1440]) {
    test(`${screen} remains within ${width}px width and scrollable on short screens`, async ({ page }) => {
      await session(page, screen === 'login' ? null : user);
      await page.setViewportSize({ width, height: 956 });
      await page.goto(`/${screen}.html`);
      await expect(page.locator('#submit')).toBeEnabled();
      for (const height of [956, 340]) {
        await page.setViewportSize({ width, height });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        for (const field of await page.locator('input, #submit').all()) {
          const bounds = await field.boundingBox();
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
          await field.scrollIntoViewIfNeeded();
          await expect(field).toBeInViewport();
        }
      }
    });
  }

  test(`${screen} supports visible keyboard focus on its form controls`, async ({ page }) => {
    await session(page, screen === 'login' ? null : user);
    await page.goto(`/${screen}.html`);
    await expect(page.locator('#submit')).toBeEnabled();
    const visited = new Set();
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const active = document.activeElement, style = getComputedStyle(active);
        return { id: active.id, outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0, shadow: style.boxShadow !== 'none' };
      });
      if (['username', 'password', 'confirm-password', 'submit'].includes(focused.id)) {
        visited.add(focused.id);
        expect(focused.outline || focused.shadow).toBe(true);
      }
    }
    const expected = screen === 'login' ? ['username', 'password', 'submit'] : ['password', 'confirm-password', 'submit'];
    for (const id of expected) expect(visited.has(id)).toBe(true);
  });
}
