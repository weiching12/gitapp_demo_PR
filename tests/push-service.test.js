import test from "node:test";
import assert from "node:assert/strict";
import { PushService } from "../cloudflare/services/push-service.js";
import { pushController } from "../cloudflare/api/push-controller.js";

const valid = { endpoint: "https://push.example/subscription", expirationTime: null,
  keys: { p256dh: "abcdefgh", auth: "ijklmnop" } };

test("push subscriptions validate and persist without storing browser identity", async () => {
  const saved = [], removed = [];
  const repository = { save: async (...args) => saved.push(args), remove: async (endpoint) => removed.push(endpoint) };
  const service = new PushService(repository, {});
  assert.deepEqual(await service.subscribe(valid, new Date("2026-10-21T10:00:00Z")), { subscribed: true });
  assert.equal(saved[0][0].endpoint, valid.endpoint);
  await service.unsubscribe({ endpoint: valid.endpoint });
  assert.deepEqual(removed, [valid.endpoint]);
  await assert.rejects(service.subscribe({ endpoint: "http://unsafe.test", keys: valid.keys }), /Invalid push subscription/);
});

test("push config is public while subscription writes require same origin", async () => {
  const service = { config: () => ({ enabled: true, publicKey: "public" }), subscribe: async () => ({ subscribed: true }) };
  const config = await pushController(new Request("https://app.test/api/v1/push/config"), { name: "pushConfig" }, service);
  assert.deepEqual(await config.json(), { enabled: true, publicKey: "public" });
  const rejected = await pushController(new Request("https://app.test/api/v1/push/subscriptions", {
    method: "POST", headers: { Origin: "https://evil.test", "Content-Type": "application/json" }, body: JSON.stringify(valid),
  }), { name: "pushSubscriptions" }, service);
  assert.equal(rejected.status, 403);
});

test("notification dispatch skips cleanly until VAPID secrets are configured", async () => {
  const service = new PushService({ pending() { throw new Error("must not read subscriptions"); } }, { VAPID_PUBLIC_KEY: "public" });
  assert.deepEqual(await service.notifyPublished({ generation: "g", asOf: "2026-10-21" }), { sent: 0, skipped: true });
});

test("notification dispatch encrypts one payload and marks the trade date", async () => {
  const encode = (value) => Buffer.from(value).toString("base64url");
  const server = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPrivate = await crypto.subtle.exportKey("jwk", server.privateKey);
  const serverPublic = await crypto.subtle.exportKey("raw", server.publicKey);
  const clientPublic = await crypto.subtle.exportKey("raw", client.publicKey);
  const marks = [], requests = [];
  const repository = {
    pending: async () => [{ endpoint: "https://push.example/subscription", p256dh: encode(clientPublic), auth: encode(crypto.getRandomValues(new Uint8Array(16))) }],
    mark: async (...args) => marks.push(args), removeMany: async () => {},
  };
  const service = new PushService(repository, { VAPID_SUBJECT: "https://app.test", VAPID_PUBLIC_KEY: encode(serverPublic), VAPID_PRIVATE_KEY: serverPrivate.d },
    async (endpoint, payload) => { requests.push([endpoint, payload]); return new Response(null, { status: 201 }); });
  assert.deepEqual(await service.notifyPublished({ generation: "g1", asOf: "2026-10-21" }), { sent: 1, removed: 0 });
  assert.deepEqual(marks, [["https://push.example/subscription", "2026-10-21"]]);
  assert.equal(new Headers(requests[0][1].headers).get("Content-Encoding"), "aes128gcm");
});
