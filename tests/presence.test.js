import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { OnlinePresence, presenceResponse, PRESENCE_TTL_MS } from "../cloudflare/presence.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  const ctx = { storage: { sql: { exec(query, ...values) {
    const statement = db.prepare(query);
    if (/^SELECT/i.test(query)) return { one: () => statement.get(...values) };
    return statement.run(...values);
  } } } };
  const presence = new OnlinePresence(ctx);
  let now = 1_000_000;
  presence.now = () => now;
  const send = (id) => presence.fetch(new Request("https://stock.test/api/presence", {
    method: "POST", body: JSON.stringify({ id }),
  })).then((r) => r.json());
  return { db, ctx, presence, send, advance: (ms) => { now += ms; } };
}

test("online count deduplicates browser tabs and expires visitors after 90 seconds", async () => {
  const f = fixture(), first = crypto.randomUUID(), second = crypto.randomUUID();
  try {
    assert.equal((await f.send(first)).online, 1);
    assert.equal((await f.send(first)).online, 1);
    assert.equal((await f.send(second)).online, 2);
    f.advance(30_000);
    assert.equal((await f.send(first)).online, 2);
    f.advance(PRESENCE_TTL_MS - 30_000);
    assert.equal((await f.send(first)).online, 1);
    f.advance(PRESENCE_TTL_MS);
    const response = await f.presence.fetch(new Request("https://stock.test/api/presence"));
    assert.equal((await response.json()).online, 0);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(f.db.prepare("SELECT count(*) n FROM visitors").get().n, 0);
  } finally { f.db.close(); }
});

test("a new Durable Object instance retains active visitors and rejects malformed payloads", async () => {
  const f = fixture();
  try {
    await f.send(crypto.randomUUID());
    const restarted = new OnlinePresence(f.ctx);
    restarted.now = f.presence.now;
    assert.equal((await (await restarted.fetch(new Request("https://stock.test/api/presence"))).json()).online, 1);
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
    return { fetch: async () => { calls++; return Response.json({ online: 1 }); } };
  } } };
  assert.equal((await presenceResponse(request({ Origin: "https://other.test" }), env)).status, 403);
  assert.equal((await presenceResponse(request({}, "DELETE"), env)).status, 405);
  assert.equal(calls, 0);
  assert.equal((await presenceResponse(request({ Origin: "https://stock.test" }), env)).status, 200);
  assert.equal(calls, 1);
  assert.equal((await presenceResponse(request(), {})).status, 503);
});
