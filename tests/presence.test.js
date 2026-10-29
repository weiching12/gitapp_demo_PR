import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { OnlinePresence } from '../cloudflare/presence.js';
import { PresenceService, InvalidPresenceIdentifier, taipeiVisitDay } from '../cloudflare/services/presence-service.js';
const sqlFor = db => ({ exec(query, ...values) {
  const statement = db.prepare(query);
  const rows = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
  return { one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
} });
test('invalid browser identifiers and malformed or oversized stream bodies are rejected', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const presence = new OnlinePresence({ storage: { sql: sqlFor(db) } });
    for (const body of ['{', 'null', '{}', JSON.stringify({ id: 'bad' }), JSON.stringify({ id: crypto.randomUUID(), nationality: 123 })]) {
      assert.equal((await presence.fetch(new Request('https://stock.test/api/presence', { method: 'POST', body }))).status, 400);
    }
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('界'.repeat(171))); controller.close(); } });
    assert.equal((await presence.fetch(new Request('https://stock.test/api/presence', { method: 'POST', duplex: 'half', body: stream }))).status, 413);
    assert.equal(db.prepare('SELECT count(*) n FROM visit_history').get().n, 0);
  } finally { db.close(); }
});
test('legacy daily records are imported once with unknown timestamps', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE visitors (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
    db.prepare('INSERT INTO visitors VALUES (?, ?)').run(crypto.randomUUID(), Date.UTC(2026, 9, 22, 16));
    const ctx = { storage: { sql: sqlFor(db) } };
    new OnlinePresence(ctx); new OnlinePresence(ctx);
    const rows = db.prepare('SELECT * FROM visit_history').all();
    assert.equal(rows.length, 1); assert.equal(rows[0].day, '2026-10-22'); assert.equal(rows[0].first_seen, null);
  } finally { db.close(); }
});
test('daily visitor policy validates identifiers and uses Taipei midnight', () => {
  const calls = [], now = Date.UTC(2026, 9, 22, 15, 50);
  const service = new PresenceService({ recordVisit(input) { calls.push(input); return 7; }, countVisits() { return 7; } }, { now: () => now });
  for (const id of [undefined, null, 123, '', '6ba7b810-9dad-11d1-80b4-00c04fd430c8']) assert.throws(() => service.heartbeat(id), InvalidPresenceIdentifier);
  assert.equal(calls.length, 0);
  assert.deepEqual(service.heartbeat(crypto.randomUUID()), { today: 7, asOf: '2026-10-22' });
  assert.deepEqual(taipeiVisitDay(Date.UTC(2026, 9, 22, 16)), { asOf: '2026-10-23', expiresAt: Date.UTC(2026, 9, 23, 16) });
});
test('public UI only writes visits, including after midnight, and never requests protected counts', async () => {
  const { startPresence } = await import('../src/presence.js');
  let now = Date.UTC(2026, 9, 22, 15, 59, 50);
  const calls = [], node = { textContent: '', dataset: {} };
  const client = { recordVisit: async () => { calls.push('POST'); return { recorded: true }; }, count: () => { throw Error('public count request'); } };
  const presence = startPresence(node, { client, now: () => now });
  await new Promise(resolve => setImmediate(resolve));
  await presence.refresh(true); await presence.refresh(true);
  assert.deepEqual(calls, ['POST']); assert.equal(node.hidden, true);
  now += 20000; await presence.refresh();
  assert.deepEqual(calls, ['POST', 'POST']); presence.stop();
});
