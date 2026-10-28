import test from "node:test";
import assert from "node:assert/strict";
import { RequestCache } from "../src/api/request-cache.js";

test("concurrent reads share one validated result while distinct dates stay independent", async () => {
  const cache = new RequestCache();
  let release, calls = 0;
  const waiting = new Promise((resolve) => { release = resolve; });
  const loader = async () => { calls++; await waiting; return { symbol: "2330" }; };
  const first = cache.load("gen:2026-10-16:9:3:3:2330", loader);
  const again = cache.load("gen:2026-10-16:9:3:3:2330", loader);
  assert.equal(first, again);
  assert.equal(await cache.load("gen:2026-10-15:9:3:3:2330", () => "historical"), "historical");
  release();
  const result = await first;
  assert.equal(await again, result);
  assert.equal(await cache.load("gen:2026-10-16:9:3:3:2330", loader), result);
  assert.equal(calls, 1);
});

test("shared failures are not cached and a later request can retry", async () => {
  const cache = new RequestCache();
  let calls = 0;
  const loader = () => { calls++; throw new Error("invalid generation"); };
  const first = cache.load("detail", loader), again = cache.load("detail", loader);
  assert.equal(first, again);
  await Promise.all([assert.rejects(first, /invalid generation/), assert.rejects(again, /invalid generation/)]);
  assert.equal(cache.has("detail"), false);
  assert.equal(await cache.load("detail", () => { calls++; return "valid"; }), "valid");
  assert.equal(calls, 2);
});
