import test from "node:test";
import assert from "node:assert/strict";
import { createUpdateFlow } from "../src/update-flow.js";

function setup(saved) {
  const values = new Map(saved ? [["stock-insight-update-progress", JSON.stringify({ showProgress: true, startedAt: 100 })]] : []);
  const calls = [], states = [];
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const flow = createUpdateFlow({ storage, now: () => 200, beforeReload: async () => calls.push("save-page"),
    reload: () => calls.push("reload"), onState: (state) => states.push(state) });
  return { flow, values, calls, states };
}

test("startup updates save the page and activate before reloading without a confirmation", async () => {
  const { flow, calls, states, values } = setup();
  await flow.offer({ kind: "app", activate: async () => calls.push("activate") });
  assert.deepEqual(calls, ["save-page", "activate", "reload"]);
  assert.deepEqual(states, []);
  assert.equal(JSON.parse(values.get("stock-insight-update-progress")).showProgress, false);
});

test("a running page waits for explicit confirmation and coalesces repeated apply taps", async () => {
  const { flow, calls, states } = setup();
  flow.finishStartup();
  await flow.offer({ kind: "app", activate: async () => calls.push("activate") });
  await flow.offer({ kind: "data" });
  assert.deepEqual(calls, []);
  assert.equal(flow.isBlocking(), true);
  await Promise.all([flow.apply(), flow.apply()]);
  assert.deepEqual(calls, ["save-page", "activate", "reload"]);
  assert.equal(states.at(-1).phase, "updating");
});

test("failed activation keeps the prompt blocked and can retry without a forced reload", async () => {
  const { flow, calls, states } = setup();
  flow.finishStartup(); let attempt = 0;
  await flow.offer({ kind: "app", activate: async () => { if (++attempt === 1) throw new Error("offline"); } });
  await assert.rejects(flow.apply(), /offline/);
  assert.equal(states.at(-1).phase, "error");
  assert.equal(flow.isBlocking(), true);
  assert.equal(calls.includes("reload"), false);
  await flow.apply();
  assert.equal(calls.at(-1), "reload");
});

test("the progress dialog closes only after a fresh page successfully initializes", async () => {
  const { flow, states, values } = setup(true);
  assert.equal(states.at(-1).phase, "updating");
  flow.finishStartup({ fresh: false });
  assert.equal(states.at(-1).phase, "error");
  assert.equal(flow.isBlocking(), true);
  flow.finishStartup();
  assert.equal(states.at(-1).phase, "idle");
  assert.equal(flow.isBlocking(), false);
  assert.equal(values.has("stock-insight-update-progress"), false);
});

test("page initialization failure leaves the progress prompt available for retry", () => {
  const { flow, states } = setup(true);
  flow.failStartup();
  assert.equal(states.at(-1).phase, "error");
  assert.equal(flow.isBlocking(), true);
});
