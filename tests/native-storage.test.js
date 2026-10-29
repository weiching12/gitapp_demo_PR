import test from "node:test";
import assert from "node:assert/strict";
import { createNativeStorage, NATIVE_STORAGE_KEY } from "../src/native/storage.js";

test("native preferences migrate existing WebView data only once and preserve research baselines", async () => {
  let value = null;
  const preferences = { get: async () => ({ value }), set: async (input) => { value = input.value; } };
  const baseline = JSON.stringify({ version: 3, periods: [{ id: "fixed", baseline: { asOf: "2026-10-22", close: 100 } }] });
  const fallback = { getItem: (key) => key === "stock-insight-research-v2" ? baseline : null };
  const storage = await createNativeStorage({ preferences, fallback });
  assert.equal(storage.getItem("stock-insight-research-v2"), baseline);
  const restored = await createNativeStorage({ preferences, fallback: { getItem: () => "stale" } });
  assert.equal(restored.getItem("stock-insight-research-v2"), baseline);
  assert.equal(JSON.parse(value).version, 1);
});

test("serialized native writes retain the newest favorites, settings and last page", async () => {
  let release, value, writes = 0;
  const waiting = new Promise((resolve) => { release = resolve; });
  const storage = await createNativeStorage({ preferences: { get: async () => ({ value: null }),
    set: async (input) => { if (++writes === 1) await waiting; value = input.value; } } });
  storage.setItem("stock-insight-v1", JSON.stringify({ favorites: ["2031"], theme: "light" }));
  storage.setItem("stock-insight-v1", JSON.stringify({ favorites: ["2031", "2330"], theme: "dark" }));
  storage.setItem("stock-insight-current-page", "favorites");
  release(); await storage.flush();
  const values = JSON.parse(value).values;
  assert.equal(values["stock-insight-current-page"], "favorites");
  assert.deepEqual(JSON.parse(values["stock-insight-v1"]).favorites, ["2031", "2330"]);
  assert.equal(writes, 2);
});

test("native storage errors preserve the latest buffer for retry without destroying unreadable originals", async () => {
  let fail = true, writes = 0;
  const errors = [];
  const storage = await createNativeStorage({ preferences: { get: async () => ({ value: null }), set: async ({ key }) => {
    assert.equal(key, NATIVE_STORAGE_KEY); writes++; if (fail) throw new Error("disk full");
  } }, onError: (error) => errors.push(error.message) });
  storage.setItem("stock-insight-v1", "latest");
  await assert.rejects(storage.flush(), /disk full/);
  assert.equal(storage.getItem("stock-insight-v1"), "latest");
  fail = false; await storage.flush(); assert.equal(writes, 2);
  assert.deepEqual(errors, ["disk full"]);
  await assert.rejects(createNativeStorage({ preferences: { get: async () => ({ value: "broken" }),
    set: () => assert.fail("must preserve original") } }));
});
