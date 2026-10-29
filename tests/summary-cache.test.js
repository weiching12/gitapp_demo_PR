import test from "node:test";
import assert from "node:assert/strict";
import { SummaryCache } from "../cloudflare/summary-cache.js";
import { durableStorage } from "./helpers/durable-storage.js";

test("cache migration clears derived legacy responses, then preserves the versioned cache on restart", async () => {
  const data = new Map([["view:old:parts", 1], ["view:old:part:0", "stale"]]);
  const storage = durableStorage(data), cache = new SummaryCache(storage);
  assert.equal(await cache.read("old"), null);
  assert(!data.has("view:old:parts"));
  await cache.write("new", { value: 2 });
  assert.deepEqual(await new SummaryCache(storage).read("new"), { value: 2 });
});

test("LRU entry and UTF-8 byte limits evict all parts of the least recently read response", async () => {
  const data = new Map(), cache = new SummaryCache(durableStorage(data), { maxEntries: 2, maxBytes: 100 });
  await cache.write("a", { value: "台灣" });
  await cache.write("b", { value: 2 });
  await cache.read("a");
  await cache.write("c", { value: 3 });
  assert.equal(await cache.read("b"), null);
  assert(![...data.keys()].some(key => key.startsWith("b:")));
  assert.deepEqual(await cache.read("a"), { value: "台灣" });
  assert.equal(await cache.write("huge", { value: "台".repeat(40) }), false);
  assert(![...data.keys()].some(key => key.startsWith("huge:")));
  const bounded = new SummaryCache(durableStorage(), { maxBytes: 40 });
  await bounded.write("first", { value: "台灣台灣" });
  await bounded.write("second", { value: "台灣台灣" });
  assert.equal(await bounded.read("first"), null);
});

test("alarms expire idle cache entries without waiting for a browser request", async () => {
  let now = 1000;
  const data = new Map(), storage = durableStorage(data), cache = new SummaryCache(storage, { now: () => now, ttlMs: 100 });
  await cache.write("current-generation", { value: 1 });
  assert.equal(await storage.getAlarm(), 1100);
  now = 1050;
  await cache.write("next-generation", { value: 2 });
  now = 1100;
  await cache.prune();
  assert.equal(await cache.read("current-generation"), null);
  assert.equal(await storage.getAlarm(), 1150);
  now = 1150;
  await cache.prune();
  assert.equal(await storage.getAlarm(), null);
  assert.equal(data.size, 1);
});

test("concurrent writes remain bounded and shrinking replacements remove surplus parts", async () => {
  const data = new Map(), storage = durableStorage(data), cache = new SummaryCache(storage, { maxEntries: 3 });
  await Promise.all(Array.from({ length: 12 }, (_, index) => cache.write(`key-${index}`, { index })));
  assert.equal([...data.keys()].filter(key => key.endsWith(":parts")).length, 3);
  await cache.write("large", { text: "台".repeat(500_000) });
  assert(data.has("large:part:1"));
  await cache.write("large", { text: "small" });
  assert(!data.has("large:part:1"));
  assert.deepEqual(await cache.read("large"), { text: "small" });
});

test("a failed cache write rolls back its parts and does not block subsequent requests", async () => {
  const data = new Map(), storage = durableStorage(data), cache = new SummaryCache(storage);
  await cache.write("good", { value: 1 });
  const put = storage.put;
  storage.put = async (key, value) => { if (key === "bad:parts") throw Error("write failed"); return put(key, value); };
  await assert.rejects(cache.write("bad", { text: "台".repeat(500_000) }), /write failed/);
  assert(![...data.keys()].some(key => key.startsWith("bad:")));
  assert.deepEqual(await cache.read("good"), { value: 1 });
});

test("alarm failures roll back payload and index in the same transaction", async () => {
  const data = new Map(), storage = durableStorage(data), cache = new SummaryCache(storage);
  await cache.prune();
  const setAlarm = storage.setAlarm;
  storage.setAlarm = async () => { throw Error("alarm failed"); };
  await assert.rejects(cache.write("unarmed", { value: 1 }), /alarm failed/);
  assert.equal(await storage.getAlarm(), null);
  assert.equal([...data.keys()].some(key => key.startsWith("unarmed:")), false);
  storage.setAlarm = setAlarm;
  assert.equal(await cache.read("unarmed"), null);
  await cache.write("armed", { value: 2 });
  assert.notEqual(await storage.getAlarm(), null);
});
