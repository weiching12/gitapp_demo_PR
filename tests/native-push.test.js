import test from "node:test";
import assert from "node:assert/strict";
import { startNativePush } from "../src/native/push.js";
import { NATIVE_PUSH_KEY } from "../src/native/storage.js";

function fixture(configured = true) {
  const values = new Map(), callbacks = new Map(), subscribed = [], removed = [], states = [];
  let prompts = 0, registered = 0, unregistered = 0, opened = 0;
  const token = "ab".repeat(32);
  const push = { addListener: async (name, callback) => { callbacks.set(name, callback); return { remove: async () => callbacks.delete(name) }; },
    checkPermissions: async () => ({ receive: "prompt" }), requestPermissions: async () => { prompts++; return { receive: "granted" }; },
    register: async () => { registered++; await callbacks.get("registration")({ value: token }); },
    unregister: async () => { unregistered++; } };
  const options = { push, storage: { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), flush: async () => {} },
  client: { config: async () => ({ data: { enabled: configured, environment: "sandbox" } }),
    subscribe: async (input) => subscribed.push(input), unsubscribe: async (input) => removed.push(input) },
  onStatus: (state) => states.push(state), onOpen: () => opened++, registrationTimeout: 100 };
  return { options, callbacks, subscribed, removed, states,
    counts: () => ({ prompts, registered, unregistered, opened }) };
}

test("unconfigured native push does not request permission or register a device", async () => {
  const f = fixture(false), controller = await startNativePush(f.options);
  await controller.toggle();
  assert.deepEqual(f.counts(), { prompts: 0, registered: 0, unregistered: 0, opened: 0 });
  assert.equal(f.states.at(-1).enabled, false);
  await controller.stop(); assert.equal(f.callbacks.size, 0);
});

test("iPhone notification opt-in registers once, persists ownership and handles taps without external navigation", async () => {
  const f = fixture(), controller = await startNativePush(f.options);
  assert.equal(f.counts().prompts, 0);
  const first = controller.toggle(), again = controller.toggle();
  assert.equal(first, again); await first;
  assert.equal(f.subscribed.length, 1);
  assert.match(f.subscribed[0].secret, /^[a-f0-9]{64}$/);
  assert.equal(f.states.at(-1).subscribed, true);
  await f.callbacks.get("pushNotificationActionPerformed")({ notification: { data: { url: "https://evil.test" } } });
  assert.equal(f.counts().opened, 1);
  await controller.toggle();
  assert.equal(f.counts().unregistered, 1); assert.equal(f.removed.length, 1);
  assert.equal(f.states.at(-1).subscribed, false); await controller.stop();
});

test("denied permission and APNs registration failure never claim a successful subscription", async () => {
  const f = fixture(); f.options.push.requestPermissions = async () => ({ receive: "denied" });
  const controller = await startNativePush(f.options);
  await assert.rejects(controller.toggle(), /允許通知/);
  assert.equal(f.subscribed.length, 0);
  f.options.push.requestPermissions = async () => ({ receive: "granted" });
  f.options.push.register = async () => f.callbacks.get("registrationError")({ error: "native failure" });
  await assert.rejects(controller.toggle(), /無法註冊/);
  assert.equal(f.states.at(-1).subscribed, false); await controller.stop();
});

test("token rotations serialize and disable cleanup failures retry without re-enabling notifications", async () => {
  const f = fixture(), controller = await startNativePush(f.options);
  await controller.toggle();
  const first = f.callbacks.get("registration")({ value: "cd".repeat(32) });
  const second = f.callbacks.get("registration")({ value: "ef".repeat(32) });
  await Promise.all([first, second]);
  const saved = () => JSON.parse(f.options.storage.getItem(NATIVE_PUSH_KEY));
  assert.equal(saved().token, "ef".repeat(32));
  assert.deepEqual(f.removed.map((input) => input.token), ["ab".repeat(32), "cd".repeat(32)]);
  let fails = true;
  f.options.client.unsubscribe = async (input) => { if (fails) throw new Error("offline"); f.removed.push(input); };
  await controller.toggle();
  assert.equal(saved().enabled, false);
  assert.equal(saved().cleanup.token, "ef".repeat(32));
  fails = false;
  await controller.refresh();
  assert.equal(saved().cleanup, null);
  assert.equal(saved().enabled, false);
  await controller.stop();
});

test("an interrupted prior opt-in retries registration instead of treating the next tap as unsubscribe", async () => {
  const f = fixture(), register = f.options.push.register;
  f.options.storage.setItem(NATIVE_PUSH_KEY, JSON.stringify({ enabled: true, token: null, secret: "ab".repeat(32) }));
  f.options.push.checkPermissions = async () => ({ receive: "granted" });
  f.options.push.register = async () => f.callbacks.get("registrationError")({});
  const controller = await startNativePush(f.options);
  await controller.refresh();
  assert.equal(f.states.at(-1).subscribed, false);
  f.options.push.register = register;
  await controller.toggle();
  assert.equal(f.subscribed.length, 1);
  assert.equal(f.counts().unregistered, 0);
  assert.equal(f.states.at(-1).subscribed, true);
  await controller.stop();
});
