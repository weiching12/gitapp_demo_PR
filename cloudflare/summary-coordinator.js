import { routeApi } from "./api/router.js";
import { createApplicationServices } from "./composition.js";

const SUMMARY_ROUTES = ["/api/v1/market/summary", "/api/v1/favorites/summary"];
// Bump when the response shape or derived rules change; old Durable Object entries persist across deploys.
const CACHE_SCHEMA = "entry-score-v1.2-research-v2";
// Durable Object storage values are limited to 2 MB. A market summary can be
// larger, so store serialized responses in small parts.
const CACHE_PART_CHARS = 400_000;

export class MarketSummaryCoordinator {
  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.env = env;
    this.pending = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    if (!SUMMARY_ROUTES.includes(url.pathname) && !url.pathname.startsWith("/api/v1/sectors/"))
      return new Response(null, { status: 404 });

    const services = createApplicationServices(this.env);
    const manifest = await services.market.market();
    const actionRevision = url.pathname === "/api/v1/market/summary" && services.actions
      ? await services.actions.revision() : "not-applicable";
    const key = `view:${CACHE_SCHEMA}:${manifest.generation}:${actionRevision}:${url.pathname}?${url.searchParams.toString()}`;
    const respond = (body) => new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" },
    });
    const cached = await this.readCached(key);
    if (cached) return respond(cached);

    let task = this.pending.get(key);
    if (!task) {
      task = routeApi(new Request(url, { method: "GET" }), this.env, services).then(async (response) => {
        if (!response.ok) return response;
        const body = await response.json();
        if (body.meta?.generation !== manifest.generation)
          return Response.json({ error: { code: "DATA_UNAVAILABLE", message: "Market generation changed during calculation" } }, { status: 503 });
        await this.writeCached(key, body);
        // In-flight work is shared by HEAD and GET. Always retain a GET body;
        // strip it only for the individual HEAD caller below.
        return Response.json(body, { headers: { "Cache-Control": "public, max-age=60" } });
      });
      this.pending.set(key, task);
      task.finally(() => this.pending.delete(key)).catch(() => {});
    }
    const response = await task;
    return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response.clone();
  }

  async readCached(key) {
    const count = await this.storage.get(`${key}:parts`);
    if (!Number.isInteger(count) || count < 1) return null;
    const keys = Array.from({ length: count }, (_, index) => `${key}:part:${index}`);
    const parts = await Promise.all(keys.map((partKey) => this.storage.get(partKey)));
    if (parts.some((part) => typeof part !== "string")) return null;
    return JSON.parse(parts.join(""));
  }

  async writeCached(key, body) {
    const serialized = JSON.stringify(body);
    const parts = [];
    for (let start = 0; start < serialized.length; start += CACHE_PART_CHARS)
      parts.push(serialized.slice(start, start + CACHE_PART_CHARS));
    await Promise.all(parts.map((part, index) => this.storage.put(`${key}:part:${index}`, part)));
    await this.storage.put(`${key}:parts`, parts.length);
  }
}
