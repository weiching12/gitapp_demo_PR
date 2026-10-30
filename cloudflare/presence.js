import { currentUser } from "./auth/session.js";
import { PresenceRepository } from "./repositories/presence-repository.js";
import { PresenceService, InvalidPresenceIdentifier } from "./services/presence-service.js";
const reply = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

// A single SQLite-backed object deduplicates browsers across Worker regions.
// Store daily browser records and administrator-only visitor metadata.
export class OnlinePresence {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.now = Date.now;
    this.repository = new PresenceRepository(this.sql);
    this.service = new PresenceService(this.repository, { now: () => this.now() });
  }

  async fetch(request) {
    if (!["GET", "POST"].includes(request.method)) return reply({ error: "Method not allowed" }, 405);
    if (new URL(request.url).pathname === "/internal/analytics") {
      const url = new URL(request.url), today = new Date(this.now() + 8 * 3600000).toISOString().slice(0, 10);
      let period = url.searchParams.get("period") || "day";
      const scope = url.searchParams.get("scope") || "range";
      if (!["day", "month"].includes(period) || !["range", "history"].includes(scope)) return reply({ error: "Invalid period" }, 400);
      if (scope === "history") period = "month";
      const end = scope === "history" ? today : url.searchParams.get("end") || today;
      const start = scope === "history" ? (this.repository.firstDay() || today) : url.searchParams.get("start") || new Date(this.now() + 8 * 3600000 - 29 * 86400000).toISOString().slice(0, 10);
      const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
      const offset = Number(url.searchParams.get("offset") || 0);
      if (!validDay(start) || !validDay(end) || start > end || (scope !== "history" && Date.parse(end) - Date.parse(start) > (period === "day" ? 365 : 3650) * 86400000) || !Number.isSafeInteger(offset) || offset < 0)
        return reply({ error: "Invalid date range or offset" }, 400);
      return reply({ ...this.repository.analytics(start, end, 100, offset, period),
        today: this.service.count(), start, end, period, scope, timezone: "Asia/Taipei" });
    }
    let id, nationality = null;
    if (request.method === "POST") {
      if (Number(request.headers.get("Content-Length")) > 512) return reply({ error: "Invalid heartbeat" }, 413);
      // Bound streamed bodies too: Content-Length is optional and untrusted.
      const reader = request.body?.getReader();
      let raw = "", length = 0;
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 512) { await reader.cancel(); return reply({ error: "Invalid heartbeat" }, 413); }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      }
      try { const body = JSON.parse(raw); id = body.id;
        if (body.nationality != null && (typeof body.nationality !== "string" || body.nationality.length > 80)) return reply({ error: "Invalid nationality" }, 400);
        nationality = body.nationality?.trim() || null; } catch { return reply({ error: "Invalid heartbeat" }, 400); }
    }
    try {
      if (request.method === "POST") { this.service.heartbeat(id, { nationality, ip: request.headers.get("CF-Connecting-IP"), country: request.headers.get("CF-IPCountry") }); return reply({ recorded: true }); }
      return reply(this.service.count());
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
  if (request.method === "GET") {
    let user;
    try { user = await currentUser(request, env); }
    catch { return reply({ error: "帳號服務暫時無法使用" }, 503); }
    if (!user) return reply({ error: "請先登入" }, 401);
    if (user.mustChangePassword) return reply({ code: "PASSWORD_CHANGE_REQUIRED", error: "請先更改初始密碼" }, 403);
    if (user.role !== "admin") return reply({ error: "僅管理員可查看造訪紀錄" }, 403);
  }
  if (!env.ONLINE_PRESENCE) return reply({ error: "Daily visitor count unavailable" }, 503);
  try {
    const forwarded = new URL(request.url);
    if (request.method === "GET") forwarded.pathname = "/internal/analytics";
    return await env.ONLINE_PRESENCE.getByName("stock-insight-online").fetch(new Request(forwarded, request));
  }
  catch { return reply({ error: "Daily visitor count unavailable" }, 503); }
}
