import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { resolveApiRoute } from "../cloudflare/api/routes.js";
import { HttpClient, ApiError } from "../src/api/http-client.js";
import { MarketApiClient, MARKET_API_PATH } from "../src/api/market-client.js";
import { PresenceApiClient } from "../src/api/presence-client.js";
import { PushApiClient } from "../src/api/push-client.js";

const root = new URL("..", import.meta.url);
const files = (directory) => readdirSync(new URL(directory, root), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && extname(entry.name) === ".js")
  .map((entry) => join(entry.parentPath, entry.name));

test("domain, service, repository and UI dependency directions stay one-way", () => {
  for (const path of files("shared/")) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:src|cloudflare)\//, relative(root.pathname, path));
  }
  for (const path of files("cloudflare/services/"))
    assert.doesNotMatch(readFileSync(path, "utf8"), /from\s+["'][^"']*\/api\//, relative(root.pathname, path));
  for (const path of files("cloudflare/repositories/"))
    assert.doesNotMatch(readFileSync(path, "utf8"), /from\s+["'][^"']*\/(?:api|services)\//, relative(root.pathname, path));
  for (const path of files("src/ui/")) assert.doesNotMatch(readFileSync(path, "utf8"), /\bfetch\s*\(/, relative(root.pathname, path));
});

test("OpenAPI v1 operations are routable with the documented methods", () => {
  const spec = JSON.parse(readFileSync(new URL("../public/openapi.json", import.meta.url), "utf8"));
  const sample = (path) => path.replace("{generation}", "generation").replace("{index}", "0")
    .replace("{symbol}", "2330").replace("{name}", encodeURIComponent("半導體業"));
  for (const [path, operations] of Object.entries(spec.paths)) {
    if (!path.startsWith("/api/v1")) continue;
    const route = resolveApiRoute(sample(path));
    assert.ok(route.name, `OpenAPI path is not routable: ${path}`);
    for (const method of Object.keys(operations).filter((name) => ["get", "post", "delete", "head"].includes(name)))
      assert.ok(route.methods.includes(method.toUpperCase()), `${method.toUpperCase()} ${path}`);
  }
});

test("frontend API clients use v1 resources and preserve structured failures", async () => {
  const calls = [];
  const fetcher = async (path, options) => {
    calls.push([path, options]);
    return Response.json(path === MARKET_API_PATH ? { generation: "g" } : { online: 3 });
  };
  assert.equal((await new MarketApiClient(fetcher).market()).data.generation, "g");
  assert.equal((await new PresenceApiClient(fetcher).heartbeat("00000000-0000-4000-8000-000000000000")).online, 3);
  assert.deepEqual(calls.map(([path]) => path), ["/api/v1/market", "/api/v1/presence"]);

  await assert.rejects(new HttpClient(async () => Response.json({ error: { code: "NO_DATA", message: "missing" } },
    { status: 503 })).json("/api/v1/market"), (error) =>
    error instanceof ApiError && error.status === 503 && error.code === "NO_DATA" && error.message === "missing");
});

test("push client uses versioned config and subscription resources", async () => {
  const calls = [];
  const client = new PushApiClient(async (path, options = {}) => {
    calls.push([path, options.method ?? "GET"]);
    return Response.json(path.endsWith("config") ? { enabled: true, publicKey: "key" } : { subscribed: options.method === "POST" });
  });
  await client.config();
  await client.subscribe({ endpoint: "https://push.example/sub", keys: { p256dh: "abcdefgh", auth: "abcdefgh" } });
  await client.unsubscribe("https://push.example/sub");
  assert.deepEqual(calls, [["/api/v1/push/config", "GET"], ["/api/v1/push/subscriptions", "POST"], ["/api/v1/push/subscriptions", "DELETE"]]);
});
