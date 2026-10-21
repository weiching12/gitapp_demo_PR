import test from "node:test";
import assert from "node:assert/strict";
import { startPushNotifications } from "../src/push.js";

const fakeButton = () => {
  const classes = new Set();
  const attributes = new Map();
  return {
    hidden: false,
    disabled: false,
    classList: {
      toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
    querySelector: () => ({ textContent: "" }),
    addEventListener() {},
  };
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an existing push subscription reports the enabled state", async () => {
  const button = fakeButton();
  const statuses = [];
  const runtime = {
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => ({ endpoint: "https://push.example/sub" }) } }) } },
    window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    Notification: { requestPermission: async () => "granted" },
  };

  startPushNotifications(button, { runtime, onStatus: (status) => statuses.push(status) });
  await flushPromises();

  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: true });
  assert.equal(button.classList.contains("push-enabled"), true);
  assert.equal(button.getAttribute("aria-pressed"), "true");
});

test("the subscription state is checked again when the app returns to the foreground", async () => {
  const button = fakeButton();
  let subscription = null;
  let visibilityHandler;
  const statuses = [];
  const runtime = {
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }) } },
    window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
    document: {
      visibilityState: "visible",
      addEventListener: (name, handler) => { if (name === "visibilitychange") visibilityHandler = handler; },
      removeEventListener() {},
    },
    Notification: { requestPermission: async () => "granted" },
  };

  startPushNotifications(button, { runtime, onStatus: (status) => statuses.push(status) });
  await flushPromises();
  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: false });

  subscription = { endpoint: "https://push.example/sub" };
  visibilityHandler();
  await flushPromises();
  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: true });
});
