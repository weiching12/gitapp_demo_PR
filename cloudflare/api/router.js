import { SHARD_COUNT, validSymbol } from "../../src/market-codec.js";
import { MarketRepository } from "../repositories/market-repository.js";
import { MarketError, MarketService } from "../services/market-service.js";
import { presenceResponse } from "../presence.js";
import { json, error } from "./http.js";
import { analysisOptions, stockAnalysis } from "../services/analysis-service.js";

const integer = (value, fallback, max) => {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max)
    throw new MarketError("INVALID_QUERY", "分頁參數格式或範圍不正確", 400);
  return Number(value);
};

export async function routeApi(request, env, service = new MarketService(new MarketRepository(env.MARKET_DATA))) {
  const url = new URL(request.url), path = url.pathname;
  const versioned = path === "/api/v1" || path.startsWith("/api/v1/");
  const fail = (code, message, status, headers) => error(request, versioned, code, message, status, headers);
  if (path === "/api/presence" || path === "/api/v1/presence") {
    if (!["GET", "POST"].includes(request.method)) return fail("METHOD_NOT_ALLOWED", "Method not allowed", 405, { Allow: "GET, POST" });
    const response = await presenceResponse(request, env);
    if (versioned && !response.ok) {
      const body = await response.json();
      return fail("PRESENCE_ERROR", body.error, response.status);
    }
    return response;
  }
  const resource = versioned ? path.slice(7) : path.slice(4);
  const chunk = resource.match(versioned
    ? /^\/market\/snapshots\/([a-z0-9-]{1,64})\/shards\/(\d{1,3})$/
    : /^\/market\/([a-z0-9-]{1,64})\/(\d{1,3})$/);
  const stock = resource.match(/^\/stocks\/([^/]+)(\/(?:history|analysis))?$/);
  const known = resource === "/market" || (versioned && resource === "/stocks") ||
    (chunk && Number(chunk[2]) < SHARD_COUNT) || (stock && (!stock[2] || versioned) && validSymbol(stock[1]));
  if (!known) return fail("NOT_FOUND", "找不到這個資料端點", 404);
  if (!["GET", "HEAD"].includes(request.method)) return fail("METHOD_NOT_ALLOWED", "Method not allowed", 405, { Allow: "GET, HEAD" });
  try {
    let body;
    if (resource === "/market") {
      body = await service.market();
      if (versioned) body = { ...body, chunks: body.chunks.map((_, index) => `/api/v1/market/snapshots/${body.generation}/shards/${index}`) };
    } else if (chunk) body = await service.snapshot(chunk[1], Number(chunk[2]));
    else if (resource === "/stocks") {
      const type = url.searchParams.get("type");
      if (type && !["stock", "etf"].includes(type)) throw new MarketError("INVALID_QUERY", "type 必須是 stock 或 etf", 400);
      const limit = integer(url.searchParams.get("limit"), 100, 200);
      if (!limit) throw new MarketError("INVALID_QUERY", "limit 必須大於 0", 400);
      body = await service.stocks({ offset: integer(url.searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER),
        limit, type, sector: url.searchParams.get("sector"), query: url.searchParams.get("q") });
    } else {
      if (stock[2] === "/analysis") {
        body = await stockAnalysis(service, stock[1], analysisOptions(url.searchParams));
        return json(request, body, 200, "public, max-age=60");
      }
      body = await service.stock(stock[1]);
      if (stock[2]) body = { data: body.stock.history, meta: { symbol: stock[1], asOf: body.asOf,
        updatedAt: body.updatedAt, tradingDates: body.stock.tradingDates } };
    }
    return json(request, body, 200, chunk ? "public, max-age=86400, immutable" : "public, max-age=60");
  } catch (err) {
    if (err instanceof MarketError) return fail(err.code, err.message, err.status);
    console.error(JSON.stringify({ event: "api-read-failed", path, message: err.message }));
    return fail("DATA_UNAVAILABLE", "目前無法讀取股票資料，請稍後重試。", 503);
  }
}
