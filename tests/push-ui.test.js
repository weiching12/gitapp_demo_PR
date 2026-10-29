import test from "node:test";
import assert from "node:assert/strict";
import { startPushNotifications } from "../src/push.js";
import { PushApiClient } from "../src/api/push-client.js";

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
    addEventListener(name, handler) { if (name === "click") this.click = handler; },
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
    Notification: { permission: "granted", requestPermission: async () => "granted" },
  };

  startPushNotifications(button, { runtime, onStatus: (status) => statuses.push(status) });
  await flushPromises();

  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: true, permission: "granted" });
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
    Notification: { permission: "granted", requestPermission: async () => "granted" },
  };

  startPushNotifications(button, { runtime, onStatus: (status) => statuses.push(status) });
  await flushPromises();
  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: false, permission: "granted" });

  subscription = { endpoint: "https://push.example/sub" };
  visibilityHandler();
  await flushPromises();
  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: true, permission: "granted" });
});

test("an older subscription check cannot restore the bell after enabling notifications", async () => {
  const button = fakeButton();
  let finishInitialCheck;
  let subscription = null;
  let checks = 0;
  const pushManager = {
    getSubscription: () => ++checks === 1
      ? new Promise((resolve) => { finishInitialCheck = resolve; }) : Promise.resolve(subscription),
    subscribe: async () => { subscription = {
      endpoint: "https://push.example/sub", toJSON: () => ({ endpoint: "https://push.example/sub" }),
    }; return subscription; },
  };
  const statuses = [];
  const requests = [];
  startPushNotifications(button, {
    runtime: {
      navigator: { serviceWorker: { ready: Promise.resolve({ pushManager }) } },
      window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
      document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
      Notification: { permission: "granted", requestPermission: async () => "granted" },
    },
    client: new PushApiClient(async (path, options = {}) => {
      requests.push([path, options.method ?? "GET"]);
      return Response.json(path.endsWith("/config") ? { enabled: true, publicKey: "AQ" } : { subscribed: true });
    }),
    onStatus: (status) => statuses.push(status),
  });
  await flushPromises();
  await button.click();
  finishInitialCheck(null);
  await flushPromises();
  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: true, permission: "granted" });
  assert.equal(button.classList.contains("push-enabled"), true);
  assert.deepEqual(requests, [["/api/v1/push/config", "GET"], ["/api/v1/push/subscriptions", "POST"]]);
});

test("a rejected browser subscription remains visibly incomplete", async () => {
  const button = fakeButton();
  const statuses = [];
  const runtime = {
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: {
      getSubscription: async () => null,
      subscribe: async () => { throw new DOMException("Registration failed - permission denied", "AbortError"); },
    } }) } },
    window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    Notification: { permission: "granted", requestPermission: async () => "granted" },
  };
  startPushNotifications(button, { runtime,
    client: new PushApiClient(async () => Response.json({ enabled: true, publicKey: "AQ" })),
    onStatus: (status) => statuses.push(status),
  });
  await button.click();
  await flushPromises();
  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: false, permission: "granted",
    error: "瀏覽器無法建立推播訂閱；請使用一般瀏覽視窗或已安裝的 App 重試" });
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("the newest subscription check wins when checks finish out of order", async () => {
  const button = fakeButton();
  let finishFirstCheck;
  let checks = 0;
  const statuses = [];
  const runtime = {
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: {
      getSubscription: () => ++checks === 1
        ? new Promise((resolve) => { finishFirstCheck = resolve; })
        : Promise.resolve({ endpoint: "https://push.example/sub" }),
    } }) } },
    window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    Notification: { permission: "granted" },
  };
  const controller = startPushNotifications(button, { runtime, onStatus: (status) => statuses.push(status) });
  await flushPromises();
  await controller.refresh();
  finishFirstCheck(null);
  await flushPromises();
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].subscribed, true);
});

test("a failed browser unsubscribe keeps the server subscription and enabled state", async () => {
  const button = fakeButton();
  const requests = [];
  const statuses = [];
  const runtime = {
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: {
      getSubscription: async () => ({ endpoint: "https://push.example/sub", unsubscribe: async () => false }),
    } }) } },
    window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    Notification: { permission: "granted" },
  };
  startPushNotifications(button, { runtime,
    client: { unsubscribe: async (endpoint) => requests.push(endpoint) },
    onStatus: (status) => statuses.push(status),
  });
  await button.click();
  await flushPromises();
  assert.deepEqual(requests, []);
  assert.equal(statuses.at(-1).subscribed, true);
  assert.equal(button.getAttribute("aria-pressed"), "true");
});
