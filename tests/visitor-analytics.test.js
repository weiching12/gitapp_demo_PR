import { createHash } from 'node:crypto';
import { authDatabase } from './helpers/auth-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { OnlinePresence, presenceResponse } from '../cloudflare/presence.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  const sql = { exec(query, ...values) {
    const statement = db.prepare(query);
    const rows = statement.all(...values);
    return { one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
  } };
  const presence = new OnlinePresence({ storage: { sql } });
  let now = Date.UTC(2026, 9, 22, 15, 50);
  presence.now = () => now;
  const accountDb = authDatabase();
  accountDb.sqlite.prepare('INSERT INTO app_users(id, username, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)').run('admin', 'admin', 'unused', 'admin', Date.now());
  accountDb.sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, ?)').run(createHash('sha256').update('a'.repeat(64)).digest('hex'), 'admin', Date.now() + 3600000);
  const env = { T86_DB: accountDb, ONLINE_PRESENCE: { getByName: () => presence } };
  const request = (path = '', options = {}) => presenceResponse(new Request(`https://stock.test/api/v1/presence${path}`, options), env);
  const get = (query = '') => request(query, { headers: { Cookie: '__Host-stock_session=' + 'a'.repeat(64) } });
  const post = (id, nationality) => request('', { method: 'POST', body: JSON.stringify({ id, nationality }), headers: { 'CF-Connecting-IP': '203.0.113.7', 'CF-IPCountry': 'TW' } });
  return { db, accountDb, env, presence, request, get, post, advance: ms => { now += ms; } };
}
test('anonymous writes disclose no counts; every public GET requires administrator authentication', async () => {
  const f = fixture();
  try {
    const response = await f.post(crypto.randomUUID(), '台灣');
    assert.deepEqual(await response.json(), { recorded: true });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await f.request()).status, 401);
    assert.equal((await f.request('', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    delete f.env.T86_DB;
    assert.equal((await f.get()).status, 503);
  } finally { f.db.close(); f.accountDb.sqlite.close(); }
});
test('history survives midnight and restart, deduplicates browsers, stores submitted name and trusted-edge IP', async () => {
  const f = fixture(), id = crypto.randomUUID();
  try {
    await f.post(id, '台灣'); f.advance(60000); await f.post(id);
    let data = await (await f.get()).json();
    assert.equal(data.today.today, 1); assert.equal(data.total, 1);
    assert.equal(data.visitors[0].nationality, '台灣'); assert.equal(data.visitors[0].ip, '203.0.113.7'); assert.equal(data.visitors[0].country, 'TW');
    assert.ok(data.visitors[0].last_seen > data.visitors[0].first_seen);
    f.advance(10 * 60000); await f.post(id, '台灣');
    await f.post(crypto.randomUUID());
    data = await (await f.get('?start=2026-10-22&end=2026-10-23')).json();
    assert.equal(data.today.today, 2); assert.equal(data.total, 3);
    assert.deepEqual(data.daily, [{ day: '2026-10-23', visitors: 2 }, { day: '2026-10-22', visitors: 1 }]);
    const { PresenceRepository } = await import('../cloudflare/repositories/presence-repository.js');
    const repository = new PresenceRepository(f.presence.sql);
    assert.equal(repository.analytics('2026-10-22', '2026-10-23', 100, 0).total, 3);
    assert.equal((await f.get('?start=2026-02-30')).status, 400);
    assert.equal((await f.get('?offset=-1')).status, 400);
    assert.equal((await f.get('?start=2026-10-24&end=2026-10-23')).status, 400);
    data = await (await f.get('?start=2026-10-22&end=2026-10-23&offset=2')).json();
    assert.equal(data.visitors.length, 1);
    assert.equal((await f.post(id, 'x'.repeat(81))).status, 400);
    assert.equal((await f.request('', { method: 'POST', body: 'x'.repeat(513) })).status, 413);
    assert.equal((await f.request('', { method: 'POST', headers: { Origin: 'https://other.test' } })).status, 403);
  } finally { f.db.close(); f.accountDb.sqlite.close(); }
});

test('trend preserves date order and unknown gaps without inventing historical zeroes', async () => {
  const { trendSeries } = await import('../public/visitor-trend.js');
  assert.deepEqual(trendSeries('2026-10-21', '2026-10-23', [{ day: '2026-10-23', visitors: 3 }, { day: '2026-10-21', visitors: 1 }]), [
    { day: '2026-10-21', value: 1 }, { day: '2026-10-22', value: null }, { day: '2026-10-23', value: 3 },
  ]);
});

test('monthly and whole-history trends count distinct browsers across days and months', async () => {
  const f = fixture(), id = crypto.randomUUID();
  try {
    await f.post(id, '台灣'); f.advance(86400000); await f.post(id, '台灣');
    f.advance(31 * 86400000); await f.post(id);
    let data = await (await f.get('?scope=history')).json();
    assert.equal(data.period, 'month'); assert.equal(data.unique, 1); assert.equal(data.total, 3);
    assert.deepEqual(data.daily, [{ day: '2026-11', visitors: 1 }, { day: '2026-10', visitors: 1 }]);
    const { trendSeries } = await import('../public/visitor-trend.js');
    assert.deepEqual(trendSeries('2026-10-22', '2026-11-23', data.daily, 'month').map(p => p.value), [1, 1]);
    assert.equal((await f.get('?start=2020-01-01&end=2026-10-23')).status, 400);
  } finally { f.db.close(); f.accountDb.sqlite.close(); }
});
