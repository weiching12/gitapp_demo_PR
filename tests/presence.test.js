import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { OnlinePresence } from '../cloudflare/presence.js';
import { PresenceService, InvalidPresenceIdentifier, taipeiVisitDay, normalizeCountry } from '../cloudflare/services/presence-service.js';
const sqlFor = db => ({ exec(query, ...values) {
  const statement = db.prepare(query);
  const rows = statement.all(...values);
  return { one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
} });
test('invalid browser identifiers and malformed or oversized stream bodies are rejected', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const presence = new OnlinePresence({ storage: { sql: sqlFor(db) } });
    for (const body of ['{', 'null', '{}', JSON.stringify({ id: 'bad' }),
      JSON.stringify({ id: crypto.randomUUID(), visitId: 'bad' }), JSON.stringify({ id: crypto.randomUUID(), metadataOnly: true }),
      JSON.stringify({ id: crypto.randomUUID(), metadataOnly: 'true' })]) {
      assert.equal((await presence.fetch(new Request('https://stock.test/api/presence', { method: 'POST', body }))).status, 400);
    }
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('界'.repeat(171))); controller.close(); } });
    assert.equal((await presence.fetch(new Request('https://stock.test/api/presence', { method: 'POST', duplex: 'half', body: stream }))).status, 413);
    assert.equal(db.prepare('SELECT count(*) n FROM visit_events').get().n, 0);
  } finally { db.close(); }
});

test('edge country codes normalize to supported ISO alpha-2 values, excluding unknown and special values', () => {
  for (const [value, expected] of [['tw', 'TW'], [' US ', 'US'], ['gb', 'GB'], ['JP', 'JP'], ['AX', 'AX'],
    ['T1', null], ['XX', null], ['ZZ', null], ['unknown', null], ['EU', null], ['USA', null], ['', null], [null, null], [123, null]])
    assert.equal(normalizeCountry(value), expected);
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
    const events = db.prepare('SELECT * FROM visit_events').all();
    assert.equal(events.length, 1); assert.equal(events[0].legacy_key, `2026-10-22:${rows[0].id}`);
    assert.equal(events[0].first_seen, null);
    assert.equal(db.prepare('SELECT count(*) n FROM presence_migrations').get().n, 1);
  } finally { db.close(); }
});
test('page visit policy validates identifiers and uses Taipei dates', () => {
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
