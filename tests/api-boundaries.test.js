import test from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../shared/domain-error.js";
import { MarketService } from "../cloudflare/services/market-service.js";
import { routeApi } from "../cloudflare/api/router.js";
import { resolveApiRoute } from "../cloudflare/api/routes.js";
import { stockCollectionOptions } from "../cloudflare/api/validators.js";
import worker from "../cloudflare/worker.js";

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

test("worker converts synchronous and asynchronous summary DO failures into private API errors", async (t) => {
  t.mock.method(console, "error", () => {});
  const paths = ["/api/v1/market/summary", "/api/v1/favorites/summary?symbols=2330", "/api/v1/sectors/ETF"];
  for (const path of paths) {
    for (const failure of ["throw", "reject"]) {
      for (const method of ["GET", "HEAD"]) {
        await t.test(`${method} ${path} ${failure}`, async () => {
          const request = new Request(`https://example.test${path}`, { method });
          const env = { MARKET_SUMMARY: { getByName(name) {
            assert.equal(name, "stock-insight-market-summary");
            return { fetch(forwarded) {
              assert.equal(forwarded, request);
              const cause = new Error("private summary storage credentials");
              if (failure === "throw") throw cause;
              return Promise.reject(cause);
            } };
          } } };
          const response = await worker.fetch(request, env);
          assert.equal(response.status, 503);
          assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
          assert.equal(response.headers.get("cache-control"), "no-store");
          assert.equal(response.headers.get("x-content-type-options"), "nosniff");
          const raw = await response.text();
          assert.doesNotMatch(raw, /private|credentials/);
          if (method === "HEAD") assert.equal(raw, "");
          else assert.deepEqual(JSON.parse(raw), { error: {
            code: "DATA_UNAVAILABLE", message: "目前無法讀取股票資料，請稍後重試。",
          } });
        });
      }
    }
  }
});

test("worker preserves summary DO response status, headers and HEAD representation", async () => {
  for (const method of ["GET", "HEAD"]) {
    const body = { error: { code: "DATA_UNAVAILABLE", message: "Summary is being prepared" } };
    const expected = new Response(method === "HEAD" ? null : JSON.stringify(body), {
      status: 503, headers: { "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store", "Retry-After": "60", "X-Content-Type-Options": "nosniff" },
    });
    const env = { MARKET_SUMMARY: { getByName: () => ({ fetch: async () => expected }) } };
    const response = await worker.fetch(new Request("https://example.test/api/v1/market/summary", { method }), env);
    assert.equal(response, expected);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await response.text(), method === "HEAD" ? "" : JSON.stringify(body));
  }
});

test("direct summary responses stay successful but bypass HTTP caches after research capture failure", async () => {
  for (const researchCapture of ["failed", "saved", "not-requested"]) {
    for (const method of ["GET", "HEAD"]) {
      const body = { data: { stocks: [] }, meta: { generation: "test", researchCapture } };
      const services = { market: {}, summary: { summary: async () => body } };
      const response = await routeApi(new Request("https://example.test/api/v1/market/summary", { method }), {}, services);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), researchCapture === "failed" ? "no-store" : "public, max-age=60");
      assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(await response.text(), method === "HEAD" ? "" : JSON.stringify(body));
    }
  }
});
