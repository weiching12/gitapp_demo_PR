import test from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../shared/domain-error.js";
import { MarketService } from "../cloudflare/services/market-service.js";
import { routeApi } from "../cloudflare/api/router.js";
import { resolveApiRoute } from "../cloudflare/api/routes.js";
import { stockCollectionOptions } from "../cloudflare/api/validators.js";

test("application errors carry domain codes and acquire HTTP status only at the API boundary", async () => {
  const market = new MarketService({ manifest: async () => null });
  let cause;
  try { await market.market(); } catch (error) { cause = error; }
  assert.ok(cause instanceof DomainError);
  assert.equal(cause.code, "DATA_UNAVAILABLE");
  assert.equal("status" in cause, false);
  const response = await routeApi(new Request("https://example.test/api/v1/market"), {}, market);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: cause.code, message: cause.message } });
  const legacy = await routeApi(new Request("https://example.test/api/market"), {}, market);
  assert.deepEqual(await legacy.json(), { error: cause.message });
});

test("collection controller passes typed options without leaking HTTP request objects to the service", async () => {
  const expected = { offset: 10, limit: 20, type: "etf", sector: "ETF", query: "0050" };
  let calls = 0;
  const service = { stocks: async (options) => {
    calls++; assert.deepEqual(options, expected); assert.equal(options instanceof URLSearchParams, false);
    return { data: [], meta: { total: 0, offset: 10, limit: 20 } };
  } };
  const response = await routeApi(new Request("https://example.test/api/v1/stocks?offset=10&limit=20&type=etf&sector=ETF&q=0050"), {}, service);
  assert.equal(response.status, 200); assert.equal(calls, 1);
  const invalid = await routeApi(new Request("https://example.test/api/v1/stocks?limit=-1"), {}, service);
  assert.equal(invalid.status, 400); assert.equal(calls, 1);
  assert.throws(() => stockCollectionOptions(new URLSearchParams("offset=9007199254740992")), DomainError);
});

test("route matching preserves v1 and legacy boundaries, ETF codes, limits and method policy", () => {
  const cases = [
    ["/api/market", "market", false], ["/api/v1/market", "market", true],
    ["/api/stocks/00632R", "stock", false], ["/api/v1/stocks/00981A/history", "history", true],
    ["/api/v1/stocks/2330/analysis", "analysis", true], ["/api/stocks/2330/analysis", null, false],
    ["/api/v1/market/snapshots/generation/shards/127", "snapshot", true],
    ["/api/v1/market/snapshots/generation/shards/128", null, true],
    ["/api/v2/stocks", null, false], ["/api/v1/stocks/BAD", null, true],
  ];
  for (const [path, name, versioned] of cases) {
    const route = resolveApiRoute(path); assert.equal(route.name, name, path); assert.equal(route.versioned, versioned, path);
  }
  assert.deepEqual(resolveApiRoute("/api/v1/presence").methods, ["GET", "POST"]);
});

test("unsupported methods and unknown paths do not access repositories; storage details stay private", async () => {
  let calls = 0;
  const service = { market: async () => { calls++; throw new Error("private database credentials"); } };
  const method = await routeApi(new Request("https://example.test/api/v1/market", { method: "DELETE" }), {}, service);
  assert.equal(method.status, 405); assert.equal(method.headers.get("allow"), "GET, HEAD");
  const missing = await routeApi(new Request("https://example.test/api/v1/invalid"), {}, service);
  assert.equal(missing.status, 404); assert.equal(calls, 0);
  const failed = await routeApi(new Request("https://example.test/api/v1/market"), {}, service);
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /credentials/);
  const head = await routeApi(new Request("https://example.test/api/v1/market", { method: "HEAD" }), {}, service);
  assert.equal(head.status, 503); assert.equal(await head.text(), "");
});
