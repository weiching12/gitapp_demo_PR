import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/t86-db.js";
import { NativePushService } from "../cloudflare/services/native-push-service.js";
import { NativePushRepository } from "../cloudflare/repositories/native-push-repository.js";
import { ApnsClient } from "../cloudflare/services/apns-client.js";
import worker from "../cloudflare/worker.js";

const token = "ab".repeat(32), secret = "cd".repeat(32);
const configured = { NATIVE_PUSH_ENABLED: "1", APNS_KEY_ID: "ABCDEFGHIJ", APNS_TEAM_ID: "1234567890",
  APNS_BUNDLE_ID: "dev.workers.stockinsighttw.app", APNS_PRIVATE_KEY: "test-only" };

test("native push is disabled without Apple configuration and never queries an unavailable table", async () => {
  const response = await worker.fetch(new Request("https://app.test/api/v1/push/native/config"), {});
  assert.deepEqual(await response.json(), { enabled: false, provider: "apns", environment: "sandbox" });
  const service = new NativePushService({ pending: () => assert.fail("must not query") }, {});
  assert.deepEqual(await service.notifyPublished({ asOf: "2026-10-27" }), { sent: 0, removed: 0, failed: 0, hasMore: false });
});

test("iOS token ownership, retry and invalid-token cleanup use separate native storage", async () => {
  const db = testDatabase();
  try {
    db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0006_native_push.sql", import.meta.url), "utf8"));
    const repo = new NativePushRepository(db), env = { ...configured, T86_DB: db };
    let attempt = 0;
    const service = new NativePushService(repo, env, { send: async () => ({ ok: ++attempt > 1, status: attempt === 1 ? 503 : 200 }) });
    const input = { token, environment: "sandbox", secret };
    await service.subscribe(input);
    await service.unsubscribe({ ...input, secret: "ef".repeat(32) });
    assert.equal((await repo.pending("2026-10-27", "sandbox")).length, 1);
    assert.equal((await service.notifyPublished({ asOf: "2026-10-27" })).failed, 1);
    assert.equal((await service.notifyPublished({ asOf: "2026-10-27" })).sent, 1);
    assert.equal((await service.notifyPublished({ asOf: "2026-10-27" })).sent, 0);
    const invalid = new NativePushService(repo, env, { send: async () => ({ ok: false, status: 410, invalidToken: true }) });
    assert.equal((await invalid.notifyPublished({ asOf: "2026-10-28" })).removed, 1);
    assert.equal((await repo.pending("2026-10-28", "sandbox")).length, 0);
    await assert.rejects(service.subscribe({ ...input, environment: "production" }), /Invalid native push/);
    const request = (origin) => new Request("https://app.test/api/v1/push/native/subscriptions", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(input) });
    assert.equal((await worker.fetch(request("https://evil.test"), env)).status, 403);
    assert.equal((await worker.fetch(request("capacitor://localhost"), env)).status, 200);
    const hash = db.sqlite.prepare("SELECT SecretHash FROM native_push_subscriptions").get().SecretHash;
    assert.notEqual(hash, secret); assert.match(hash, /^[a-f0-9]{64}$/);
  } finally { db.sqlite.close(); }
});

test("APNs requests sign ES256 tokens, reuse authorization and distinguish permanent from retryable failures", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64")}\n-----END PRIVATE KEY-----`;
  const calls = [], now = () => Date.parse("2026-10-28T00:00:00Z");
  const env = { ...configured, APNS_PRIVATE_KEY: pem };
  const fetcher = async (url, options) => { calls.push([url, options]); return calls.length === 1
    ? new Response(null, { status: 200 }) : Response.json({ reason: "BadDeviceToken" }, { status: 400 }); };
  const first = new ApnsClient(env, fetcher, now), second = new ApnsClient(env, fetcher, now);
  assert.equal((await first.send({ token, environment: "sandbox" }, { asOf: "2026-10-27", generation: "g1" })).ok, true);
  assert.equal((await second.send({ token, environment: "production" }, { asOf: "2026-10-27", generation: "g1" })).invalidToken, true);
  assert.match(calls[0][0], /^https:\/\/api\.sandbox\.push\.apple\.com\//);
  assert.match(calls[1][0], /^https:\/\/api\.push\.apple\.com\//);
  assert.equal(calls[0][1].headers.authorization, calls[1][1].headers.authorization);
  const jwt = calls[0][1].headers.authorization.slice(7), [header, payload, signature] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "ES256");
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey,
    Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${payload}`)), true);
  assert.equal(JSON.parse(calls[0][1].body).aps.alert.title, "株研資料已更新");
  assert.equal(calls[0][1].headers["apns-topic"], configured.APNS_BUNDLE_ID);
});
