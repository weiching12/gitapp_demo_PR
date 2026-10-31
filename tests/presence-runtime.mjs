// Real workerd/SQLite adapter verification, without production bindings.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { fileURLToPath } from "node:url";

const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
import { OnlinePresence, presenceResponse } from "./cloudflare/presence.js";
export class TestPresence extends OnlinePresence {
  async fetch(request) {
    const time = Number(new URL(request.url).searchParams.get("time"));
    this.now = () => time;
    return super.fetch(request);
  }
}
export default { fetch: (request, env) => presenceResponse(request, env) };
` }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
  compatibilityDate: "2026-10-17", durableObjects: { ONLINE_PRESENCE: { className: "TestPresence", useSQLite: true } } }));
try {
  const namespace = await mf.getDurableObjectNamespace("ONLINE_PRESENCE");
  const object = namespace.get(namespace.idFromName("stock-insight-online"));
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const send = async (id, time, visitId = crypto.randomUUID(), metadataOnly = false) => {
    const response = await object.fetch(`https://internal/presence?time=${time}`, {
      method: "POST", body: JSON.stringify({ id, visitId, metadataOnly }), headers: { "Content-Type": "application/json" },
    });
    assert.equal(response.status, 200); return response.json();
  };
  const beforeMidnight = Date.UTC(2026, 9, 22, 15, 50);
  const firstVisit = crypto.randomUUID();
  const duplicates = await Promise.all(Array.from({ length: 6 }, () => send(first, beforeMidnight, firstVisit)));
  assert.ok(duplicates.every((value) => value.recorded === true));
  assert.deepEqual(await send(second, beforeMidnight), { recorded: true });
  await send(first, beforeMidnight + 9 * 60_000, firstVisit, true);
  // Reloading in the same browser creates a new page-entry key and counts again.
  await send(first, beforeMidnight + 9 * 60_000);
  const midnight = beforeMidnight + 10 * 60_000;
  const expired = await object.fetch(`https://internal/presence?time=${midnight}`);
  assert.deepEqual(await expired.json(), { today: 0, asOf: "2026-10-23" });
  assert.deepEqual(await send(first, midnight), { recorded: true });
  const history = await object.fetch(`https://internal/internal/analytics?time=${midnight}&scope=history`);
  const stats = await history.json();
  assert.equal(stats.unique, 2); assert.equal(stats.total, 4); assert.equal(stats.overall.total, 4);
  assert.deepEqual(stats.daily, [{ day: "2026-10", visitors: 4, visits: 4 }]);
  const selected = await object.fetch(`https://internal/internal/analytics?time=${midnight}&month=2026-10&selectedDay=2026-10-22`);
  const details = await selected.json();
  assert.equal(details.total, 4); assert.equal(details.detailTotal, 3); assert.equal(details.overall.total, 4);
  assert.equal(details.visitors.every(event => event.day === "2026-10-22"), true);
  assert.deepEqual(details.daily, [{ day: "2026-10-23", visitors: 1, visits: 1 }, { day: "2026-10-22", visitors: 3, visits: 3 }]);
  assert.deepEqual(details.months, ["2026-10"]);
  const future = await object.fetch(`https://internal/internal/analytics?time=${midnight}&month=2026-11`);
  assert.equal(future.status, 400);
  const unauthorized = await mf.dispatchFetch("https://example.test/api/v1/presence");
  assert.equal(unauthorized.status, 401);
  const forbidden = await mf.dispatchFetch("https://example.test/api/v1/presence", {
    method: "POST", headers: { Origin: "https://other.test" }, body: JSON.stringify({ id: first }),
  });
  assert.equal(forbidden.status, 403);
  console.log("PASS workerd presence: retry idempotency, repeat page entries, metadata-only edits, Taipei midnight reset, SQL persistence and origin policy");
} finally { await mf.dispose(); }
