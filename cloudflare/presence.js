export const PRESENCE_TTL_MS = 90_000;
const reply = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

// A single SQLite-backed object serializes heartbeats from every Worker region.
// Only a random browser identifier and its expiry are stored, never IP addresses.
export class OnlinePresence {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.now = Date.now;
    this.sql.exec("CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS visitors_expiry ON visitors(expires)");
  }

  async fetch(request) {
    if (!["GET", "POST"].includes(request.method)) return reply({ error: "Method not allowed" }, 405);
    let id;
    if (request.method === "POST") {
      if (Number(request.headers.get("Content-Length")) > 128) return reply({ error: "Invalid heartbeat" }, 413);
      // Bound streamed bodies too: Content-Length is optional and untrusted.
      const reader = request.body?.getReader();
      let raw = "", length = 0;
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 128) { await reader.cancel(); return reply({ error: "Invalid heartbeat" }, 413); }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      }
      try { id = JSON.parse(raw).id; } catch { return reply({ error: "Invalid heartbeat" }, 400); }
      if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
        return reply({ error: "Invalid browser identifier" }, 400);
    }
    const now = this.now();
    this.sql.exec("DELETE FROM visitors WHERE expires <= ?", now);
    if (id) this.sql.exec(`INSERT INTO visitors VALUES (?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires
      WHERE visitors.expires <= ?`, id, now + PRESENCE_TTL_MS, now + PRESENCE_TTL_MS - 10_000);
    return reply({ online: this.sql.exec("SELECT count(*) AS count FROM visitors").one().count,
      windowSeconds: PRESENCE_TTL_MS / 1000 });
  }
}

export async function presenceResponse(request, env) {
  const url = new URL(request.url);
  if (!["GET", "POST"].includes(request.method)) return reply({ error: "Method not allowed" }, 405);
  const origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site")
    return reply({ error: "Same-origin requests required" }, 403);
  if (!env.ONLINE_PRESENCE) return reply({ error: "Online count unavailable" }, 503);
  try { return await env.ONLINE_PRESENCE.getByName("stock-insight-online").fetch(request); }
  catch { return reply({ error: "Online count unavailable" }, 503); }
}
