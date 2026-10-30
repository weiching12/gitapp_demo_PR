import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { hashPassword } from '../cloudflare/auth/password.js';
const result = await build({ stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)), contents: `
import { authController } from './cloudflare/auth/controller.js';
import { presenceResponse } from './cloudflare/presence.js';
export { OnlinePresence } from './cloudflare/presence.js';
export default { fetch(request, env) {
  const action = new URL(request.url).pathname.match(/^\\/api\\/v1\\/auth\\/(login|logout|me|change-password)$/)?.[1];
  return action ? authController(request, env, action) : presenceResponse(request, env);
} };
` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: result.outputFiles[0].text,
  compatibilityDate: '2026-10-17', d1Databases: ['T86_DB'],
  durableObjects: { ONLINE_PRESENCE: { className: 'OnlinePresence', useSQLite: true } } }));
try {
  const db = await mf.getD1Database('T86_DB');
  const migration = await readFile(new URL('../cloudflare/migrations/0007_auth.sql', import.meta.url), 'utf8');
  for (const sql of migration.split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
  const requiredChange = await readFile(new URL('../cloudflare/migrations/0008_required_password_change.sql', import.meta.url), 'utf8');
  for (const sql of requiredChange.split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
  const hash = await hashPassword('runtime-test-password');
  for (const role of ['admin', 'user']) await db.prepare('INSERT INTO app_users(id, username, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)').bind(role, role, hash, role, Date.now()).run();
  const request = (path, options = {}) => mf.dispatchFetch(`https://stock.test${path}`, options);
  const login = async username => {
    const response = await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username, password: 'runtime-test-password' }), headers: { Origin: 'https://stock.test' } });
    assert.equal(response.status, 200, await response.clone().text()); return response.headers.get('set-cookie').split(';')[0];
  };
  const admin = await login('admin'), user = await login('user');
  await db.prepare("UPDATE app_users SET must_change_password = 1 WHERE id = 'admin'").run();
  const pending = await request('/api/v1/presence', { headers: { Cookie: admin } });
  assert.equal(pending.status, 403); assert.equal((await pending.json()).code, 'PASSWORD_CHANGE_REQUIRED');
  const changed = await request('/api/v1/auth/change-password', { method: 'POST', headers: { Cookie: admin, Origin: 'https://stock.test' },
    body: JSON.stringify({ password: 'new-runtime-password', confirmPassword: 'new-runtime-password' }) });
  assert.equal(changed.status, 200, await changed.clone().text());
  assert.equal((await changed.json()).user.mustChangePassword, false);
  const changedAdmin = changed.headers.get('set-cookie').split(';')[0];
  assert.notEqual(changedAdmin, admin);
  assert.equal((await request('/api/v1/presence', { headers: { Cookie: admin } })).status, 401);
  assert.equal((await request('/api/v1/presence', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID() }) })).status, 200);
  for (const path of ['/api/presence', '/api/v1/presence']) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { headers: { Cookie: user } })).status, 403);
    const response = await request(path, { headers: { Cookie: changedAdmin } });
    assert.equal(response.status, 200); assert.equal((await response.json()).today.today, 1);
  }
  const logout = await request('/api/v1/auth/logout', { method: 'POST', headers: { Cookie: changedAdmin, Origin: 'https://stock.test' } });
  assert.equal(logout.status, 200); assert.equal((await request('/api/presence', { headers: { Cookie: changedAdmin } })).status, 401);
  await db.prepare("UPDATE app_users SET disabled = 1 WHERE id = 'user'").run();
  assert.equal((await request('/api/v1/auth/me', { headers: { Cookie: user } })).status, 200);
  assert.deepEqual(await (await request('/api/v1/auth/me', { headers: { Cookie: user } })).json(), { user: null });
  console.log('PASS workerd/D1 authentication: password login, persistent sessions, role enforcement, revocation and private visitor statistics');
} finally { await mf.dispose(); }
