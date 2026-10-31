import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createSocketServer } from 'node:net';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { hashPassword } from '../cloudflare/auth/password.js';

// Isolated, ephemeral D1 and Worker: never contact the developer's 8787 database or production.
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ stdin: { resolveDir: root, contents: `
import worker from './cloudflare/worker.js';
export { OnlinePresence } from './cloudflare/presence.js';
export default worker;
` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
  compatibilityDate: '2026-10-17', host: '127.0.0.1', port: 0, d1Databases: ['T86_DB'],
  durableObjects: { ONLINE_PRESENCE: { className: 'OnlinePresence', useSQLite: true } } }));
let vite, browser;
try {
  const backend = await mf.ready, db = await mf.getD1Database('T86_DB');
  for (const migration of ['0007_auth.sql', '0008_required_password_change.sql']) {
    const source = await readFile(new URL(`../cloudflare/migrations/${migration}`, import.meta.url), 'utf8');
    for (const sql of source.split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
  }
  const username = 'isolated-proxy-admin', initialPassword = 'isolated-proxy-password', newPassword = 'new-isolated-proxy-password';
  await db.prepare(`INSERT INTO app_users(id, username, password_hash, role, created_at, must_change_password)
    VALUES (?, ?, ?, 'admin', ?, 1)`).bind('proxy-admin', username, await hashPassword(initialPassword), Date.now()).run();
  const proxy = Object.fromEntries(['/api/v1/auth', '/api/v1/presence', '/api/presence']
    .map(path => [path, { target: backend.origin }]));
  const reservation = createSocketServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const frontendPort = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  // Load the actual product Vite configuration; only ports and proxy destinations are replaced.
  vite = await createServer({ root, configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    configLoader: 'runner', server: { host: '127.0.0.1', port: frontendPort, strictPort: true, proxy } });
  await vite.listen();
  const frontend = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const post = (path, body, origin = frontend, site = 'same-origin') => fetch(`${frontend}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': site }, body: JSON.stringify(body),
  });
  const credentials = { username, password: initialPassword };
  const valid = await post('/api/v1/auth/login', credentials);
  assert.equal(valid.status, 200, await valid.clone().text());
  assert.equal((await valid.json()).user.mustChangePassword, true);
  assert.ok(valid.headers.get('set-cookie').includes('Secure'));
  for (const [path, body] of [['/api/v1/auth/login', credentials], ['/api/v1/presence', { id: crypto.randomUUID() }], ['/api/presence', { id: crypto.randomUUID() }]]) {
    assert.equal((await post(path, body, 'https://outside.example', 'cross-site')).status, 403);
    // A hostile Origin must stay hostile even when a non-browser client claims same-origin.
    assert.equal((await post(path, body, 'https://outside.example', 'same-origin')).status, 403);
  }
  assert.deepEqual(await (await post('/api/v1/presence', { id: crypto.randomUUID() })).json(), { recorded: true });

  const systemChrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(path => existsSync(path));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || systemChrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${frontend}/login.html`);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(initialPassword);
  await page.locator('#submit').click();
  await page.waitForURL(`${frontend}/change-password.html`);
  await page.locator('#password').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#password').disabled);
  const oldCookie = (await context.cookies()).find(cookie => cookie.name === '__Host-stock_session');
  assert.ok(oldCookie, 'Chrome must accept the real Secure session cookie on loopback HTTP');
  assert.equal(oldCookie.secure, true); assert.equal(oldCookie.httpOnly, true); assert.equal(oldCookie.sameSite, 'Strict');
  const identity = await page.request.get(`${frontend}/api/v1/auth/me`);
  assert.equal((await identity.json()).user.mustChangePassword, true);
  const blocked = await page.request.get(`${frontend}/api/v1/presence`);
  assert.equal(blocked.status(), 403); assert.equal((await blocked.json()).error.code, 'PASSWORD_CHANGE_REQUIRED');
  await page.locator('#password').fill(newPassword);
  await page.locator('#confirm-password').fill(newPassword);
  await page.locator('#submit').click();
  await page.waitForURL(`${frontend}/admin-visitors.html`);
  await page.locator('#report').waitFor({ state: 'visible' });
  const newCookie = (await context.cookies()).find(cookie => cookie.name === '__Host-stock_session');
  assert.ok(newCookie); assert.notEqual(newCookie.value, oldCookie.value);
  const stats = await page.request.get(`${frontend}/api/v1/presence`);
  assert.equal(stats.status(), 200); assert.equal((await stats.json()).today.today, 1);
  const me = await page.request.get(`${frontend}/api/v1/auth/me`);
  assert.equal((await me.json()).user.mustChangePassword, false);
  assert.equal((await post('/api/v1/auth/login', credentials)).status, 401);
  const revoked = await fetch(`${frontend}/api/v1/auth/me`, { headers: { Cookie: `__Host-stock_session=${oldCookie.value}` } });
  assert.deepEqual(await revoked.json(), { user: null });
  console.log('PASS actual Vite proxy + workerd/D1 + Chrome: same-origin login, foreign-origin rejection, Secure cookie, forced password change, session rotation and admin access');
} finally {
  await browser?.close();
  await vite?.close();
  await mf.dispose();
}
