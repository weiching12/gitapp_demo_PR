import test from 'node:test';
import assert from 'node:assert/strict';
import { authDatabase } from './helpers/auth-db.js';
import { authController } from '../cloudflare/auth/controller.js';
import { currentUser } from '../cloudflare/auth/session.js';
import { hashPassword, verifyPassword, sha256 } from '../cloudflare/auth/password.js';
import { presenceResponse } from '../cloudflare/presence.js';

async function fixture() {
  const db = authDatabase();
  const hash = await hashPassword('correct-test-password');
  for (const role of ['admin', 'user']) db.sqlite.prepare('INSERT INTO app_users VALUES (?, ?, ?, ?, 0, ?)').run(role, role, hash, role, Date.now());
  let time = Date.now(), calls = 0;
  const env = { T86_DB: db, ONLINE_PRESENCE: { getByName: () => ({ fetch: () => { calls++; return Response.json({ private: true }); } }) } };
  const send = (action, body, cookie, headers = {}) => authController(new Request(`https://stock.test/api/v1/auth/${action}`, {
    method: action === 'me' ? 'GET' : 'POST', headers: { Origin: 'https://stock.test', 'CF-Connecting-IP': '203.0.113.1', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, action, { now: () => time });
  const login = async username => {
    const response = await send('login', { username, password: 'correct-test-password', role: 'admin' });
    assert.equal(response.status, 200); return response.headers.get('set-cookie');
  };
  const stats = (cookie, path = '/api/v1/presence') => presenceResponse(new Request(`https://stock.test${path}`, { headers: cookie ? { Cookie: cookie } : {} }), env);
  return { db, env, send, login, stats, calls: () => calls, advance: ms => { time += ms; } };
}
test('salted password hashes verify without retaining plaintext', async () => {
  const first = await hashPassword('correct-test-password'), second = await hashPassword('correct-test-password');
  assert.notEqual(first, second); assert.ok(!first.includes('correct-test-password'));
  assert.equal(await verifyPassword('correct-test-password', first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
  await assert.rejects(hashPassword('short'));
});
test('shared login sets secure sessions; only the server-stored admin role can access both analytics paths', async () => {
  const f = await fixture();
  try {
    const admin = await f.login('ADMIN'), user = await f.login('user');
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) assert.ok(admin.includes(flag));
    const identity = await (await f.send('me', null, user)).json();
    assert.deepEqual(identity.user, { id: 'user', username: 'user', role: 'user' });
    assert.equal(JSON.stringify(identity).includes('password'), false);
    for (const path of ['/api/presence', '/api/v1/presence']) {
      assert.equal((await f.stats(null, path)).status, 401);
      assert.equal((await f.stats(user, path)).status, 403);
      assert.equal((await f.stats(admin, path)).status, 200);
    }
    assert.equal(f.calls(), 2);
    const token = admin.split(';')[0].split('=')[1];
    assert.equal(f.db.sqlite.prepare('SELECT token_hash FROM auth_sessions WHERE user_id = ?').get('admin').token_hash, await sha256(token));
    f.env.ADMIN_ANALYTICS_TOKEN = 'old-shared-key';
    assert.equal((await presenceResponse(new Request('https://stock.test/api/presence', { headers: { Authorization: 'Bearer old-shared-key' } }), f.env)).status, 401);
    f.db.sqlite.prepare("UPDATE app_users SET role='user' WHERE id='admin'").run();
    assert.equal((await f.stats(admin)).status, 403);
    f.db.sqlite.prepare("UPDATE app_users SET disabled=1 WHERE id='user'").run();
    assert.equal((await f.stats(user)).status, 401);
  } finally { f.db.sqlite.close(); }
});
test('logout revokes the server session and expired or invented cookies never authenticate', async () => {
  const f = await fixture();
  try {
    const cookie = await f.login('admin');
    const expiredRequest = new Request('https://stock.test', { headers: { Cookie: cookie } });
    assert.equal(await currentUser(expiredRequest, f.env, Date.now() + 13 * 3600000), null);
    const response = await f.send('logout', null, cookie);
    assert.equal(response.status, 200); assert.ok(response.headers.get('set-cookie').includes('Max-Age=0'));
    assert.equal((await f.stats(cookie)).status, 401);
    assert.equal((await f.stats('__Host-stock_session=' + 'a'.repeat(64))).status, 401);
    assert.deepEqual(await (await f.send('me')).json(), { user: null });
  } finally { f.db.sqlite.close(); }
});
test('wrong and nonexistent accounts fail identically; durable throttling expires; cross-site changes are blocked', async () => {
  const f = await fixture();
  try {
    for (const username of ['admin', 'nonexistent']) {
      const response = await f.send('login', { username, password: 'wrong-password' });
      assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: '帳號或密碼錯誤' });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    for (let i = 0; i < 4; i++) await f.send('login', { username: 'admin', password: 'wrong-password' });
    assert.equal((await f.send('login', { username: 'admin', password: 'correct-test-password' })).status, 429);
    f.advance(15 * 60000 + 1); assert.equal((await f.send('login', { username: 'admin', password: 'correct-test-password' })).status, 200);
    for (const action of ['login', 'logout']) assert.equal((await f.send(action, null, null, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await f.send('login', { username: 'admin', password: 'x'.repeat(3000) })).status, 400);
  } finally { f.db.sqlite.close(); }
});


test('a password reset during password verification cannot create a session with the old password', async () => {
  const f = await fixture();
  try {
    const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = sql => {
      const statement = prepare(sql);
      if (sql === 'SELECT * FROM app_users WHERE username = ?') {
        const first = statement.first.bind(statement);
        statement.first = async () => {
          const user = await first();
          f.db.sqlite.prepare('UPDATE app_users SET password_hash = ? WHERE id = ?').run(await hashPassword('new-valid-password'), user.id);
          f.db.sqlite.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user.id);
          return user;
        };
      }
      return statement;
    };
    const response = await f.send('login', { username: 'admin', password: 'correct-test-password' });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM auth_sessions').get().n, 0);
  } finally { f.db.sqlite.close(); }
});
