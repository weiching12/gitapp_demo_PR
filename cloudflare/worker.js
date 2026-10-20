import { MANIFEST_KEY, SHARD_COUNT, shardKey, shardOf } from "./twse.js";
import { syncMarket } from "./sync.js";
import { expandStock } from "../src/market-codec.js";
import { presenceResponse } from "./presence.js";
export { OnlinePresence } from "./presence.js";

const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (path === "/api/presence") return presenceResponse(request, env);
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    try {
      let value, immutable = false;
      if (path === "/api/market") {
        value = await env.MARKET_DATA.get(MANIFEST_KEY);
      } else {
        const chunk = path.match(/^\/api\/market\/([a-z0-9-]{1,64})\/(\d{1,3})$/);
        const symbol = path.match(/^\/api\/stocks\/(\d{4,6})$/)?.[1];
        if (chunk && Number(chunk[2]) < SHARD_COUNT) {
          value = await env.MARKET_DATA.get(shardKey(chunk[1], Number(chunk[2])));
          immutable = true;
        } else if (symbol) {
          const manifest = await env.MARKET_DATA.get(MANIFEST_KEY, "json");
          if (!manifest) return json({ error: "上市公司資料尚未準備完成" }, 503);
          const metadata = manifest.stocks.find((stock) => stock.symbol === symbol);
          if (!metadata) return json({ error: "找不到這家上市公司" }, 404);
          const shard = await env.MARKET_DATA.get(shardKey(manifest.generation, shardOf(symbol)), "json");
          const compact = shard?.stocks.find((stock) => stock.symbol === symbol);
          if (compact) value = JSON.stringify({ schemaVersion: 2, source: "twse", asOf: manifest.asOf,
            updatedAt: manifest.updatedAt, stock: { ...expandStock(metadata, compact.history), tradingDates: manifest.dates } });
        } else return json({ error: "找不到這個資料端點" }, 404);
      }
      if (!value) return json({ error: "股票資料尚未準備完成，請稍後再試。" }, 503);
      return new Response(request.method === "HEAD" ? null : value, {
        headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff",
          "Cache-Control": immutable ? "public, max-age=86400, immutable" : "public, max-age=60" },
      });
    } catch {
      return json({ error: "目前無法讀取股票資料，請稍後重試。" }, 503);
    }
  },
  async scheduled(controller, env) {
    const state = await syncMarket(env, { now: new Date(controller.scheduledTime) });
    console.log(JSON.stringify({ event: "twse-sync", date: state.date, slot: state.slot, phase: state.phase,
      t86Status: state.t86Status, nextShard: state.nextShard, failures: state.failures, error: state.error }));
  },
};
