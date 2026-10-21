import test from "node:test";
import assert from "node:assert/strict";
import { SyncMetrics, saveSyncMetrics } from "../cloudflare/sync/metrics.js";

test("KV metrics count actual attempted operations including failures", async () => {
  const meter = new SyncMetrics();
  const kv = meter.wrap({ get: async () => null, put: async () => {}, delete: async () => { throw new Error("failed"); } });
  await kv.get("key"); await kv.put("key", "value"); await assert.rejects(kv.delete("key"));
  assert.deepEqual(meter.counts, { read: 1, write: 1, delete: 1, failed: 1 });
  meter.reset(); assert.equal(meter.counts.write, 0);
});

test("round metrics accumulate, reset for the next round, and skip idle ticks", async () => {
  const map = new Map(); let writes = 0;
  const storage = { get: async (key) => map.get(key), put: async (key, value) => { writes++; map.set(key, value); } };
  const state = { date: "2026-10-21", slot: "18:30", phase: "catalog", failures: 0 };
  await saveSyncMetrics(storage, null, state, { read: 2, write: 1, delete: 0, failed: 0 }, Date.now());
  await saveSyncMetrics(storage, state, { ...state, phase: "shards" }, { read: 1, write: 2, delete: 0, failed: 0 }, Date.now());
  assert.equal(map.get("metrics").kv.write, 3);
  const count = writes;
  await saveSyncMetrics(storage, state, state, { read: 0, write: 0, delete: 0, failed: 0 }, Date.now());
  assert.equal(writes, count);
  await saveSyncMetrics(storage, state, { ...state, slot: "20:30" }, { read: 0, write: 1, delete: 0, failed: 0 }, Date.now());
  assert.equal(map.get("metrics").kv.write, 1);
});
