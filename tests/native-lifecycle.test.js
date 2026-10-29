import test from "node:test";
import assert from "node:assert/strict";
import { startAppLifecycle } from "../src/native/lifecycle.js";
import { createNativeRuntime } from "../src/native/runtime.js";
import { apiRequestUrl } from "../src/api/url.js";

function plugin() {
  const listeners = new Map(), removed = [];
  return { listeners, removed, minimized: 0,
    async addListener(name, callback) { listeners.set(name, callback); return { remove: async () => { removed.push(name); listeners.delete(name); } }; },
    getState: async () => ({ isActive: true }),
    async minimizeApp() { this.minimized++; },
    emit(name, data) { return listeners.get(name)?.(data); } };
}

test("iPhone lifecycle saves on background, refreshes only on transitions and removes owned listeners", async () => {
  const app = plugin(); let saved = 0, resumed = 0;
  const lifecycle = await startAppLifecycle({ app, platform: "ios", onPause: () => saved++, onResume: () => resumed++ });
  assert.deepEqual([...app.listeners.keys()], ["appStateChange"]);
  await app.emit("appStateChange", { isActive: true });
  assert.equal(resumed, 0);
  await app.emit("appStateChange", { isActive: false });
  await app.emit("appStateChange", { isActive: false });
  await app.emit("appStateChange", { isActive: true });
  await app.emit("appStateChange", { isActive: true });
  assert.equal(saved, 1); assert.equal(resumed, 1);
  await lifecycle.stop(); assert.equal(lifecycle.isActive(), false);
  assert.deepEqual(app.removed, ["appStateChange"]);
});

test("native refresh coalesces calls, ignores background results and retries on return", async () => {
  const app = plugin(); let reads = 0, updates = 0, release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const runtime = await createNativeRuntime({ app, platform: "ios", getDataVersion: () => "g1",
    onDataUpdate: () => updates++, client: { market: async () => { reads++; await waiting; return { data: { generation: "g2" } }; } } });
  const first = runtime.checkForUpdates(true), second = runtime.checkForUpdates(true);
  assert.equal(first, second);
  await app.emit("appStateChange", { isActive: false });
  release(); assert.equal(await first, false); assert.equal(updates, 0);
  await app.emit("appStateChange", { isActive: true });
  assert.equal(reads, 2); assert.equal(updates, 1);
  await runtime.stop();
});

test("native update failures stay retryable and identical versions do not reload", async () => {
  const app = plugin(); let reads = 0;
  const runtime = await createNativeRuntime({ app, platform: "ios", getDataVersion: () => "g1",
    onDataUpdate: () => assert.fail("same generation"), client: { market: async () => {
      if (++reads === 1) throw new Error("offline"); return { data: { generation: "g1" } };
    } } });
  await assert.rejects(runtime.checkForUpdates(), /offline/);
  assert.equal(await runtime.checkForUpdates(), false);
  assert.equal(await runtime.checkForUpdates(), false); assert.equal(reads, 2);
  await runtime.stop();
});

test("partial lifecycle setup cleans up and browser URLs retain their existing contract", async () => {
  const app = plugin(); app.getState = async () => { throw new Error("bridge failed"); };
  await assert.rejects(startAppLifecycle({ app, platform: "ios", onResume: () => {} }), /bridge failed/);
  assert.deepEqual(app.removed, ["appStateChange"]);
  assert.equal(apiRequestUrl("/api/v1/market"), "/api/v1/market");
  assert.equal(apiRequestUrl("/api/v1/market", "https://app.test"), "https://app.test/api/v1/market");
  assert.equal(apiRequestUrl("/icons/a.png", "https://app.test"), "/icons/a.png");
});
