import test from 'node:test';
import assert from 'node:assert/strict';
import { startPresence } from '../src/presence.js';
import { PresenceApiClient } from '../src/api/presence-client.js';

const dayStart = Date.UTC(2026, 9, 29, 15, 59, 50);
const node = () => ({ textContent: '', dataset: {} });
const documentWith = () => ({ getElementById() { throw Error('Visit reporting must not query visitor forms'); } });

async function browserWorld(run, { blockedStorage = false } = {}) {
  const keys = ['document', 'localStorage', 'window'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const values = new Map(), reads = [], writes = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { reads.push(key); if (blockedStorage) throw Error('Storage disabled'); return values.get(key) ?? null; },
    setItem(key, value) { writes.push(key); if (blockedStorage) throw Error('Storage disabled'); values.set(key, value); },
    removeItem(key) { writes.push(key); if (blockedStorage) throw Error('Storage disabled'); values.delete(key); },
  } });
  const newDocument = () => Object.defineProperty(globalThis, 'document', { configurable: true, value: documentWith() });
  newDocument();
  try { await run({ newDocument, values, reads, writes }); }
  finally { for (const key of keys) {
    if (previous.get(key)) Object.defineProperty(globalThis, key, previous.get(key));
    else delete globalThis[key];
  } }
}

function clientRecorder(implementation = async () => ({ recorded: true })) {
  const calls = [];
  return { calls, client: { async recordVisit(id, options) {
    calls.push({ id, ...options });
    return implementation(calls.length);
  }, count() { throw Error('Public UI must not read administrator analytics'); } } };
}

test('shell rebuilds share one document visit, including an in-flight request', async () => {
  await browserWorld(async () => {
    let finish;
    const { calls, client } = clientRecorder(() => new Promise(resolve => { finish = resolve; }));
    const first = startPresence(node(), { client, now: () => dayStart });
    const firstPending = first.refresh();
    first.stop();
    const second = startPresence(node(), { client, now: () => dayStart });
    const secondPending = second.refresh();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    finish({ recorded: true });
    await Promise.all([firstPending, secondPending]);
    await second.refresh(true);
    second.stop();
    const third = startPresence(node(), { client, now: () => dayStart });
    await third.refresh();
    assert.equal(calls.length, 1);
    third.stop();
  });
});

test('a reload starts a new visit while preserving the browser identifier', async () => {
  await browserWorld(async ({ newDocument, values }) => {
    const { calls, client } = clientRecorder();
    const first = startPresence(node(), { client, now: () => dayStart });
    await first.refresh(); first.stop();
    newDocument();
    const reloaded = startPresence(node(), { client, now: () => dayStart });
    await reloaded.refresh(); reloaded.stop();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].id, calls[1].id);
    assert.notEqual(calls[0].visitId, calls[1].visitId);
    assert.match(calls[0].visitId, /^[a-f0-9-]{36}$/i);
    assert.deepEqual([...values.keys()], ['stock-insight-browser-id']);
  });
});

test('BFCache return records another visit, while initial pageshow and foregrounding do not', async () => {
  await browserWorld(async () => {
    const { calls, client } = clientRecorder();
    const show = persisted => {
      const event = new Event('pageshow'); Object.defineProperty(event, 'persisted', { value: persisted });
      window.dispatchEvent(event);
    };
    const first = startPresence(node(), { client, now: () => dayStart });
    await first.refresh(); first.stop();
    const rebuilt = startPresence(node(), { client, now: () => dayStart });
    await rebuilt.refresh();
    show(false); window.dispatchEvent(new Event('visibilitychange'));
    await rebuilt.refresh(true);
    assert.equal(calls.length, 1);
    show(true); await rebuilt.refresh();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].id, calls[1].id);
    assert.notEqual(calls[0].visitId, calls[1].visitId);
    await rebuilt.refresh(); assert.equal(calls.length, 2);
    rebuilt.stop(); show(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2);
  });
});

test('failed requests retry the same idempotency key without recording successful refreshes twice', async () => {
  await browserWorld(async () => {
    const { calls, client } = clientRecorder(attempt => {
      if (attempt === 1) throw Error('Network interrupted');
      return { recorded: true };
    });
    const display = node();
    const presence = startPresence(display, { client, now: () => dayStart });
    await presence.refresh();
    assert.equal(display.dataset.state, 'error');
    await presence.refresh(true);
    await presence.refresh(true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].visitId, calls[1].visitId);
    assert.equal(calls[0].id, calls[1].id);
    assert.equal(display.dataset.state, undefined);
    presence.stop();
  });
});

test('Taipei midnight starts a fresh document visit and later refreshes reuse it', async () => {
  await browserWorld(async () => {
    let now = dayStart;
    const { calls, client } = clientRecorder();
    const presence = startPresence(node(), { client, now: () => now });
    await presence.refresh();
    now += 20_000;
    await presence.refresh(); await presence.refresh(true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].id, calls[1].id);
    assert.notEqual(calls[0].visitId, calls[1].visitId);
    presence.stop();
  });
});

test('a pre-midnight in-flight completion cannot mark the new day as already recorded', async () => {
  await browserWorld(async () => {
    let now = dayStart, finish;
    const { calls, client } = clientRecorder(attempt => attempt === 1
      ? new Promise(resolve => { finish = resolve; }) : { recorded: true });
    const presence = startPresence(node(), { client, now: () => now });
    const oldDay = presence.refresh();
    await new Promise(resolve => setImmediate(resolve));
    now += 20_000;
    await presence.refresh();
    finish({ recorded: true }); await oldDay;
    await presence.refresh();
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].visitId, calls[1].visitId);
    presence.stop();
  });
});

test('legacy nationality storage is neither read nor sent, and visits need no visitor form', async () => {
  await browserWorld(async ({ values, reads, writes }) => {
    values.set('stock-insight-nationality', '台灣');
    const { calls, client } = clientRecorder();
    const presence = startPresence(node(), { client, now: () => dayStart });
    await presence.refresh();
    assert.equal(calls.length, 1);
    assert.equal(Object.hasOwn(calls[0], 'nationality'), false);
    assert.equal(Object.hasOwn(calls[0], 'metadataOnly'), false);
    assert.deepEqual(reads, ['stock-insight-browser-id']);
    assert.deepEqual(writes, ['stock-insight-browser-id']);
    assert.equal(values.get('stock-insight-nationality'), '台灣');
    presence.stop();
  });
});

test('disabled browser storage still preserves the visit across shell rebuilds', async () => {
  await browserWorld(async () => {
    const { calls, client } = clientRecorder();
    const first = startPresence(node(), { client, now: () => dayStart });
    await first.refresh(); first.stop();
    const second = startPresence(node(), { client, now: () => dayStart });
    await second.refresh(); second.stop();
    assert.equal(calls.length, 1);
  }, { blockedStorage: true });
});

test('demo pages never send page visits or metadata', async () => {
  await browserWorld(async ({ values }) => {
    const { calls, client } = clientRecorder();
    assert.equal(startPresence(node(), { client, demo: true }), undefined);
    assert.equal(calls.length, 0); assert.equal(values.size, 0);
  });
});

test('presence API posts page keys without forwarding retired nationality options', async () => {
  const calls = [], signal = new AbortController().signal;
  const api = new PresenceApiClient(async (url, options) => {
    calls.push({ url, ...options });
    return Response.json({ recorded: true });
  });
  const id = crypto.randomUUID(), visitId = crypto.randomUUID();
  await api.recordVisit(id, { visitId, signal });
  await api.recordVisit(id, { visitId, nationality: '台灣', metadataOnly: true, signal });
  assert.deepEqual(JSON.parse(calls[0].body), { id, visitId });
  assert.deepEqual(JSON.parse(calls[1].body), { id, visitId, metadataOnly: true });
  for (const call of calls) {
    assert.equal(call.url, '/api/v1/presence'); assert.equal(call.method, 'POST');
    assert.equal(call.cache, 'no-store'); assert.equal(call.signal, signal);
  }
});
