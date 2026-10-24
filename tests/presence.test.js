import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { OnlinePresence, presenceResponse } from "../cloudflare/presence.js";
import { PresenceService, InvalidPresenceIdentifier, taipeiVisitDay } from "../cloudflare/services/presence-service.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  const ctx = { storage: { sql: { exec(query, ...values) {
    const statement = db.prepare(query);
    if (/^SELECT/i.test(query)) return { one: () => statement.get(...values) };
    return statement.run(...values);
  } } } };
  const presence = new OnlinePresence(ctx);
  let now = Date.UTC(2026, 9, 22, 15, 50);
  presence.now = () => now;
  const send = (id) => presence.fetch(new Request("https://stock.test/api/presence", {
    method: "POST", body: JSON.stringify({ id }),
  })).then((r) => r.json());
  return { db, ctx, presence, send, advance: (ms) => { now += ms; } };
}

test("daily count deduplicates browser tabs and resets at Taipei midnight", async () => {
  const f = fixture(), first = crypto.randomUUID(), second = crypto.randomUUID();
  try {
    assert.deepEqual(await f.send(first), { today: 1, asOf: "2026-10-22" });
    assert.equal((await f.send(first)).today, 1);
    assert.equal((await f.send(second)).today, 2);
    f.advance(9 * 60_000);
    assert.equal((await f.send(first)).today, 2);
    f.advance(60_000);
    const response = await f.presence.fetch(new Request("https://stock.test/api/presence"));
    assert.deepEqual(await response.json(), { today: 0, asOf: "2026-10-23" });
    assert.deepEqual(await f.send(first), { today: 1, asOf: "2026-10-23" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(f.db.prepare("SELECT count(*) n FROM visitors").get().n, 1);
  } finally { f.db.close(); }
});

test("a new Durable Object instance retains today's visitors and rejects malformed payloads", async () => {
  const f = fixture();
  try {
    await f.send(crypto.randomUUID());
    const restarted = new OnlinePresence(f.ctx);
    restarted.now = f.presence.now;
    assert.equal((await (await restarted.fetch(new Request("https://stock.test/api/presence"))).json()).today, 1);
    for (const body of ["{", JSON.stringify({ id: "not-a-uuid" }), "x".repeat(129)]) {
      const response = await restarted.fetch(new Request("https://stock.test/api/presence", { method: "POST", body }));
      assert.ok([400, 413].includes(response.status));
    }
    assert.equal(f.db.prepare("SELECT count(*) n FROM visitors").get().n, 1);
  } finally { f.db.close(); }
});

test("presence endpoint rejects cross-site writes and fails independently of stock data", async () => {
  const request = (headers = {}, method = "POST") => new Request("https://stock.test/api/presence", { method, headers });
  let calls = 0;
  const env = { ONLINE_PRESENCE: { getByName(name) {
    assert.equal(name, "stock-insight-online");
    return { fetch: async () => { calls++; return Response.json({ today: 1, asOf: "2026-10-22" }); } };
  } } };
  assert.equal((await presenceResponse(request({ Origin: "https://other.test" }), env)).status, 403);
  assert.equal((await presenceResponse(request({}, "DELETE"), env)).status, 405);
  assert.equal(calls, 0);
  assert.equal((await presenceResponse(request({ Origin: "https://stock.test" }), env)).status, 200);
  assert.equal(calls, 1);
  assert.equal((await presenceResponse(request(), {})).status, 503);
});

test("daily visitor policy validates identifiers and uses Taipei midnight", () => {
  const calls = [];
  const now = Date.UTC(2026, 9, 22, 15, 50);
  const service = new PresenceService({ recordVisit(input) { calls.push(input); return 7; },
    countVisits(expiresAt) { calls.push(expiresAt); return 7; } }, { now: () => now });
  for (const id of [undefined, null, 123, "", "6ba7b810-9dad-11d1-80b4-00c04fd430c8", "00000000-0000-4000-7000-000000000000"]) {
    assert.throws(() => service.heartbeat(id), InvalidPresenceIdentifier);
  }
  assert.equal(calls.length, 0);
  const id = "00000000-0000-4000-8000-000000000000";
  assert.deepEqual(service.heartbeat(id), { today: 7, asOf: "2026-10-22" });
  assert.deepEqual(calls[0], { id, now, expiresAt: Date.UTC(2026, 9, 22, 16) });
  assert.deepEqual(service.count(), { today: 7, asOf: "2026-10-22" });
  assert.equal(calls[1], Date.UTC(2026, 9, 22, 16));
  assert.deepEqual(taipeiVisitDay(Date.UTC(2026, 9, 22, 16)),
    { asOf: "2026-10-23", expiresAt: Date.UTC(2026, 9, 23, 16) });
});

test("repeated visits on the same day do not update the browser row", async () => {
  const f = fixture(), id = crypto.randomUUID();
  const expires = () => f.db.prepare("SELECT expires FROM visitors WHERE id = ?").get(id).expires;
  const writes = () => f.db.prepare("SELECT total_changes() AS count").get().count;
  try {
    await f.send(id);
    assert.equal(expires(), Date.UTC(2026, 9, 22, 16));
    const initialWrites = writes();
    f.advance(9 * 60_000);
    await f.send(id);
    assert.equal(expires(), Date.UTC(2026, 9, 22, 16));
    assert.equal(writes(), initialWrites);
    f.advance(60_000);
    await f.send(id);
    assert.equal(expires(), Date.UTC(2026, 9, 23, 16));
    assert.equal(writes(), initialWrites + 2);
  } finally { f.db.close(); }
});

test("streamed visit records enforce a byte limit without relying on Content-Length", async () => {
  const f = fixture(), id = crypto.randomUUID();
  const payload = JSON.stringify({ id });
  const streamed = (chunks) => new Request("https://stock.test/api/presence", {
    method: "POST", duplex: "half",
    body: new ReadableStream({ start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    } }),
  });
  try {
    const allowed = await f.presence.fetch(streamed([payload, " ".repeat(128 - payload.length)]));
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { today: 1, asOf: "2026-10-22" });
    const excess = await f.presence.fetch(streamed([payload, " ".repeat(129 - payload.length)]));
    assert.equal(excess.status, 413);
    assert.deepEqual(await excess.json(), { error: "Invalid heartbeat" });
    // Multi-byte characters count as bytes, even when Content-Length is absent.
    const unicode = await f.presence.fetch(streamed(["界".repeat(43)]));
    assert.equal(unicode.status, 413);
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM visitors").get().count, 1);
  } finally { f.db.close(); }
});

test("presence HTTP responses preserve validation, origin and storage failure behavior", async () => {
  const f = fixture();
  try {
    const cases = [
      ["{", 400, "Invalid heartbeat"],
      ["null", 400, "Invalid heartbeat"],
      ["{}", 400, "Invalid browser identifier"],
      [JSON.stringify({ id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" }), 400, "Invalid browser identifier"],
    ];
    for (const [body, status, error] of cases) {
      const response = await f.presence.fetch(new Request("https://stock.test/api/presence", { method: "POST", body }));
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error });
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const tooLarge = await f.presence.fetch(new Request("https://stock.test/api/presence", {
      method: "POST", body: "{}", headers: { "Content-Length": "129" },
    }));
    assert.equal(tooLarge.status, 413);
    const crossSite = await presenceResponse(new Request("https://stock.test/api/presence", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    }), {});
    assert.equal(crossSite.status, 403);
    const unavailable = await presenceResponse(new Request("https://stock.test/api/presence"), {
      ONLINE_PRESENCE: { getByName() { return { fetch() { throw new Error("storage offline"); } }; } },
    });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { error: "Daily visitor count unavailable" });
  } finally { f.db.close(); }
});
