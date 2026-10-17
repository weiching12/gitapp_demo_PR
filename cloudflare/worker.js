import { STOCK_CATALOG } from "../src/catalog.js";
import { fetchStock, MANIFEST_KEY, stockKey, stockMetadata } from "./finmind.js";

const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

export async function refreshStock(env, stock, options) {
  const previous = await env.MARKET_DATA.get(stockKey(stock.symbol), "json");
  const snapshot = await fetchStock(stock, previous, { token: env.FINMIND_TOKEN, ...options });
  // Write the snapshot first. A failed update leaves the last good version.
  await env.MARKET_DATA.put(stockKey(stock.symbol), JSON.stringify(snapshot));
  const manifest = await env.MARKET_DATA.get(MANIFEST_KEY, "json") ?? { schemaVersion: 1, stocks: {} };
  manifest.stocks[stock.symbol] = stockMetadata(snapshot);
  await env.MARKET_DATA.put(MANIFEST_KEY, JSON.stringify(manifest));
  return stockMetadata(snapshot);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    const symbol = path.match(/^\/api\/stocks\/(\d{4,6})$/)?.[1];
    const key = path === "/api/market" ? MANIFEST_KEY
      : STOCK_CATALOG.some((stock) => stock.symbol === symbol) ? stockKey(symbol) : null;
    if (!key) return json({ error: "找不到這個資料端點" }, 404);
    try {
      const value = await env.MARKET_DATA.get(key);
      if (!value) return json({ error: "股票資料尚未準備完成，請稍後再試。" }, 503);
      return new Response(request.method === "HEAD" ? null : value, {
        headers: { "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" },
      });
    } catch {
      return json({ error: "目前無法讀取股票資料，請稍後重試。" }, 503);
    }
  },
  async scheduled(controller, env) {
    // UTC 13:00–13:52 = Taipei 21:00–21:52. One stock every four minutes
    // keeps individual invocations small enough for the Workers Free CPU limit.
    const slot = Math.floor(new Date(controller.scheduledTime).getUTCMinutes() / 4);
    const stock = STOCK_CATALOG[slot];
    if (!stock) return;
    const metadata = await refreshStock(env, stock);
    console.log(JSON.stringify({ event: "stock-updated", ...metadata }));
  },
};
