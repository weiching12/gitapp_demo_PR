// Actual workerd + SQLite Durable Object storage, without production bindings.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { fileURLToPath } from "node:url";

const source = `
import { SummaryCache } from "./cloudflare/summary-cache.js";
import worker from "./cloudflare/worker.js";
export { MarketSummaryCoordinator } from "./cloudflare/summary-coordinator.js";
export class TestSummaryCache {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.time = Date.now() + 86_400_000;
    this.options = { now: () => this.time, ttlMs: 60_000, maxEntries: 3, maxBytes: 1_200_000 };
    this.cache = new SummaryCache(this.storage, this.options);
  }
  async alarm() { await this.cache.prune(); }
  async fetch(request) {
    const { op, key, body, options, advance = 0 } = await request.json();
    if (op === "seed") {
      await this.storage.put("view:old:parts", 1);
      await this.storage.put("view:old:part:0", JSON.stringify({ legacy: true }));
      return Response.json(true);
    }
    if (op === "reopen") {
      this.options = { ...this.options, ...options };
      this.cache = new SummaryCache(this.storage, this.options);
      return Response.json(true);
    }
    if (op === "inspect") return Response.json({ keys: [...(await this.storage.list()).keys()],
      entries: [...(await this.storage.list({ prefix: "summary-cache:index:" })).values()].flat(),
      alarm: await this.storage.getAlarm(), now: this.time });
    if (op === "write-with-failed-alarm") {
      this.time += advance;
      const faultingStorage = new Proxy(this.storage, { get(target, property) {
        if (property === "setAlarm") return async (time) => {
          await target.setAlarm(time);
          throw new Error("synthetic alarm failure after update");
        };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const cache = new SummaryCache(faultingStorage, this.options);
      try { await cache.write(key, body); return Response.json({ rejected: false }); }
      catch (error) { return Response.json({ rejected: true, message: error.message }); }
    }
    if (op === "read") return Response.json(await this.cache.read(key));
    if (op === "write") return Response.json(await this.cache.write(key, body));
    if (op === "prune") {
      this.time += advance;
      await this.cache.prune();
      return Response.json(true);
    }
    return new Response(null, { status: 404 });
  }
}
export default worker;
`;
const bundle = await build({ stdin: { contents: source, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
  compatibilityDate: "2026-10-17", kvNamespaces: ["MARKET_DATA"],
  durableObjects: { SUMMARY_CACHE: { className: "TestSummaryCache", useSQLite: true },
    MARKET_SUMMARY: { className: "MarketSummaryCoordinator", useSQLite: true } } }));
try {
  // Error subclasses do not preserve their prototype across a real DO boundary.
  // Validation must form the API response inside the DO, before stub transport.
  for (const method of ["GET", "HEAD"]) {
    const response = await mf.dispatchFetch("https://internal/api/v1/market/summary?period=0", { method });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    if (method === "HEAD") assert.equal(await response.text(), "");
    else assert.equal((await response.json()).error.code, "INVALID_QUERY");
  }
  const namespace = await mf.getDurableObjectNamespace("SUMMARY_CACHE");
  const client = (name) => {
    const object = namespace.get(namespace.idFromName(name));
    return async (op, args = {}) => {
      const response = await object.fetch("https://internal/cache", { method: "POST", body: JSON.stringify({ op, ...args }) });
      assert.equal(response.status, 200, `${name} ${op}: ${await response.clone().text()}`);
      return response.json();
    };
  };

  const cache = client("legacy-and-lru");
  await cache("seed");
  assert.equal((await cache("inspect")).keys.length, 2);
  assert.equal(await cache("read", { key: "missing" }), null);
  assert.ok((await cache("inspect")).keys.every(key => !key.startsWith("view:old:")), "first use removes legacy cache parts");

  // Exceed a single cache part and exercise real SQLite-backed transactions.
  const large = { text: "台".repeat(400_010), meta: { generation: "one" } };
  await cache("reopen", { options: { maxBytes: 2_000_000 } });
  assert.equal(await cache("write", { key: "large", body: large }), true);
  assert.deepEqual(await cache("read", { key: "large" }), large);
  assert.ok((await cache("inspect")).keys.includes("large:part:1"));
  await cache("reopen");
  assert.deepEqual(await cache("read", { key: "large" }), large, "new cache instance retains indexed entries");

  for (const key of ["a", "b", "c"]) await cache("write", { key, body: { key } });
  assert.equal(await cache("read", { key: "large" }), null);
  assert.deepEqual(await cache("read", { key: "a" }), { key: "a" });
  await cache("write", { key: "d", body: { key: "d" } });
  assert.equal(await cache("read", { key: "b" }), null, "read refreshes LRU order before the next eviction");
  assert.deepEqual(await cache("read", { key: "a" }), { key: "a" });
  const beforeExpiry = await cache("inspect");
  assert.equal(beforeExpiry.alarm, beforeExpiry.now + 60_000, "TTL schedules a Durable Object alarm");
  await cache("prune", { advance: 60_001 });
  assert.equal(await cache("read", { key: "a" }), null);
  const expired = await cache("inspect");
  assert.equal(expired.alarm, null);
  assert.ok(expired.keys.every(key => !key.endsWith(":parts") && !key.includes(":part:")), "pruning removes expired payload parts");

  const concurrent = client("concurrent-writes");
  const writes = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    concurrent("write", { key: `parallel-${index}`, body: { index, payload: "data".repeat(100) } })));
  assert.ok(writes.every(result => result === true));
  const surviving = await Promise.all(Array.from({ length: 8 }, (_, index) => concurrent("read", { key: `parallel-${index}` })));
  assert.equal(surviving.filter(Boolean).length, 3, "concurrent writes preserve the configured entry bound");
  for (const body of surviving.filter(Boolean)) assert.equal(body.payload, "data".repeat(100));
  assert.equal((await concurrent("inspect")).keys.filter(key => key.endsWith(":parts")).length, 3);

  const byteLimited = client("byte-limit");
  await byteLimited("reopen", { options: { maxEntries: 10, maxBytes: 100 } });
  await byteLimited("write", { key: "first", body: { value: "x".repeat(50) } });
  await byteLimited("write", { key: "second", body: { value: "y".repeat(50) } });
  assert.equal(await byteLimited("read", { key: "first" }), null);
  assert.deepEqual(await byteLimited("read", { key: "second" }), { value: "y".repeat(50) });
  assert.equal(await byteLimited("write", { key: "oversized", body: { value: "z".repeat(100) } }), false);
  assert.equal(await byteLimited("read", { key: "oversized" }), null);

  const rollback = client("alarm-rollback");
  await rollback("reopen", { options: { maxEntries: 1 } });
  await rollback("write", { key: "retained", body: { value: "original" } });
  const beforeFailure = await rollback("inspect");
  const failure = await rollback("write-with-failed-alarm", { key: "must-rollback", body: { value: "uncommitted" }, advance: 1000 });
  assert.deepEqual(failure, { rejected: true, message: "synthetic alarm failure after update" });
  const afterFailure = await rollback("inspect");
  assert.deepEqual(afterFailure.keys, beforeFailure.keys, "alarm failure rolls back payload parts");
  assert.deepEqual(afterFailure.entries, beforeFailure.entries, "alarm failure rolls back the cache index");
  assert.equal(afterFailure.alarm, beforeFailure.alarm, "alarm update rolls back with index and payloads");
  assert.deepEqual(await rollback("read", { key: "retained" }), { value: "original" });
  assert.equal(await rollback("read", { key: "must-rollback" }), null);
  console.log("PASS workerd summary cache: legacy cleanup, multipart persistence, LRU, TTL/alarm, concurrent writes, byte bounds and alarm transaction rollback");
} finally { await mf.dispose(); }
