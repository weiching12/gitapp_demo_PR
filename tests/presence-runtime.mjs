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
  const send = async (id, time) => {
    const response = await object.fetch(`https://internal/presence?time=${time}`, {
      method: "POST", body: JSON.stringify({ id }), headers: { "Content-Type": "application/json" },
    });
    assert.equal(response.status, 200); return response.json();
  };
  const beforeMidnight = Date.UTC(2026, 9, 22, 15, 50);
  const duplicates = await Promise.all(Array.from({ length: 6 }, () => send(first, beforeMidnight)));
  assert.ok(duplicates.every((value) => value.today === 1));
  assert.equal((await send(second, beforeMidnight)).today, 2);
  assert.equal((await send(first, beforeMidnight + 9 * 60_000)).today, 2);
  const midnight = beforeMidnight + 10 * 60_000;
  const expired = await object.fetch(`https://internal/presence?time=${midnight}`);
  assert.deepEqual(await expired.json(), { today: 0, asOf: "2026-10-23" });
  assert.deepEqual(await send(first, midnight), { today: 1, asOf: "2026-10-23" });
  const forbidden = await mf.dispatchFetch("https://example.test/api/v1/presence", {
    method: "POST", headers: { Origin: "https://other.test" }, body: JSON.stringify({ id: first }),
  });
  assert.equal(forbidden.status, 403);
  console.log("PASS workerd presence: concurrent deduplication, Taipei midnight reset, SQL persistence and origin policy");
} finally { await mf.dispose(); }
