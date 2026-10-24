import { performance } from "node:perf_hooks";
import { MarketSummaryService } from "../cloudflare/services/market-summary-service.js";
import { SHARD_COUNT, shardOf } from "../shared/market-codec.js";

const count = Number(process.argv[2] || 1336), sessions = Number(process.argv[3] || 94);
const dates = Array.from({ length: sessions }, (_, index) =>
  new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10));
const stocks = Array.from({ length: count }, (_, index) => ({ symbol: String(1000 + index),
  name: `Stock ${index}`, sector: `Sector ${index % 32}`, market: "上市", listedOn: "2020-01-01" }));
const shards = Array.from({ length: SHARD_COUNT }, (_, index) => ({ generation: "benchmark", index, stocks: [] }));
for (const stock of stocks) shards[shardOf(stock.symbol)].stocks.push({ symbol: stock.symbol,
  history: dates.map((date, index) => [date, 100, 110, 90, 100 + index % 10, 100000,
    1000, 900, 1000, 900, 1000, 900]) });
const manifest = { generation: "benchmark", asOf: dates.at(-1), dates, stocks };
const service = new MarketSummaryService({ market: async () => manifest,
  shards: async (_generation, indices) => indices.map((index) => shards[index]) });
const start = performance.now();
const result = await service.summary(manifest.asOf, { period: 9, kSmooth: 3, dSmooth: 3 });
const elapsed = performance.now() - start;
console.log(JSON.stringify({ stocks: result.data.stocks.length, sessions, elapsedMs: Math.round(elapsed),
  payloadBytes: Buffer.byteLength(JSON.stringify(result)), heapMb: Math.round(process.memoryUsage().heapUsed / 1048576) }));
