import { PresenceRepository } from "./repositories/presence-repository.js";
import { PresenceService, InvalidPresenceIdentifier } from "./services/presence-service.js";
const reply = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

// A single SQLite-backed object deduplicates browsers across Worker regions.
// Only a random browser identifier and its Taipei-day expiry are stored.
export class OnlinePresence {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.now = Date.now;
    this.service = new PresenceService(new PresenceRepository(this.sql), { now: () => this.now() });
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
    }
    try {
      return reply(request.method === "POST" ? this.service.heartbeat(id) : this.service.count());
    } catch (error) {
      if (error instanceof InvalidPresenceIdentifier) return reply({ error: error.message }, 400);
      throw error;
    }
  }
}

export async function presenceResponse(request, env) {
  const url = new URL(request.url);
  if (!["GET", "POST"].includes(request.method)) return reply({ error: "Method not allowed" }, 405);
  const origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site")
    return reply({ error: "Same-origin requests required" }, 403);
  if (!env.ONLINE_PRESENCE) return reply({ error: "Daily visitor count unavailable" }, 503);
  try { return await env.ONLINE_PRESENCE.getByName("stock-insight-online").fetch(request); }
  catch { return reply({ error: "Daily visitor count unavailable" }, 503); }
}
