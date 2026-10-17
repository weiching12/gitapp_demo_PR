import test from "node:test";
import assert from "node:assert/strict";
import worker, { refreshStock } from "../cloudflare/worker.js";
import { fetchStock, normalizeHistory, stockKey, taipeiDate } from "../cloudflare/finmind.js";
import { STOCK_CATALOG } from "../src/catalog.js";
import { combineSnapshots, loadApiDataset } from "../src/provider.js";
import { analyzeHistory } from "../src/indicators.js";

const symbol = "0050";
const price = (date = "2026-10-16") => ({ stock_id: symbol, date, open: 100, max: 110, min: 90, close: 105, Trading_Volume: 1234567 });
const flows = (date = "2026-10-16") => [
  ["Foreign_Investor", 1000, 300], ["Foreign_Dealer_Self", 999999, 0],
  ["Investment_Trust", 200, 50], ["Dealer_self", 100, 20], ["Dealer_Hedging", 60, 10],
].map(([name, buy, sell]) => ({ stock_id: symbol, date, name, buy, sell }));
const history = () => Array.from({ length: 80 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 6, i + 1)).toISOString().slice(0, 10);
  return normalizeHistory(symbol, [price(date)], flows(date))[0];
});
const snapshot = (stock = STOCK_CATALOG.find((item) => item.symbol === symbol)) => ({
  schemaVersion: 1, asOf: "2026-09-18", updatedAt: "2026-10-17T10:00:00Z",
  stock: { ...stock, history: history() },
});

test("FinMind normalization preserves share units and ETF zeros, excludes foreign dealer double count", () => {
  const [bar] = normalizeHistory(symbol, [price()], flows());
  assert.equal(bar.volume, 1234567);
  assert.deepEqual(bar.institutions, [
    { name: "外資", buy: 1000, sell: 300 }, { name: "投信", buy: 200, sell: 50 },
    { name: "自營商", buy: 160, sell: 30 },
  ]);
  assert.equal(analyzeHistory([bar])[0].institutionalNet, 980);
});

test("Missing dealer component is missing, and daily total cannot become zero", () => {
  const [bar] = normalizeHistory(symbol, [price()], flows().filter((row) => row.name !== "Dealer_Hedging"));
  assert.equal(bar.institutions.length, 2);
  assert.equal(analyzeHistory([bar])[0].institutionalNet, null);
  assert.equal(analyzeHistory([{ ...bar, institutions: [] }])[0].institutionalNet, null);
});

test("Reject malformed prices, wrong symbols and duplicate institution rows", () => {
  assert.throws(() => normalizeHistory(symbol, [{ ...price(), close: null }], flows()));
  assert.throws(() => normalizeHistory(symbol, [{ ...price(), stock_id: "2330" }], flows()));
  assert.throws(() => normalizeHistory(symbol, [price()], [...flows(), flows()[0]]));
  assert.throws(() => normalizeHistory(symbol, [price(), price()], flows()));
});

test("Dates follow Taiwan time across the UTC day boundary", () => {
  assert.equal(taipeiDate(new Date("2026-10-16T17:00:00Z")), "2026-10-17");
});

test("An upstream error never writes over last good cloud data", async () => {
  const writes = [];
  const env = { MARKET_DATA: { get: async () => snapshot(), put: async (...args) => writes.push(args) } };
  await assert.rejects(refreshStock(env, STOCK_CATALOG[0], { fetcher: async () => new Response(null, { status: 402 }) }));
  assert.equal(writes.length, 0);
});

test("Temporarily incomplete institutional history cannot erase previously complete data", async () => {
  const previous = snapshot();
  const date = previous.stock.history.at(-1).date;
  const fetcher = async (url) => Response.json({ status: 200, data:
    url.searchParams.get("dataset") === "TaiwanStockPrice" ? [price(date)] : [] });
  await assert.rejects(fetchStock(previous.stock, previous, { fetcher }), /incomplete/);
});

test("All stocks share a complete selected day while earlier missing sessions remain in history", () => {
  const snapshots = STOCK_CATALOG.map(snapshot);
  const newest = snapshots[0].stock.history.at(-1).date;
  snapshots[0].stock.history.at(-1).institutions = [];
  const dataset = combineSnapshots(snapshots);
  assert.equal(dataset.info.mode, "finmind");
  assert.ok(dataset.info.asOf < newest);
  assert.ok(dataset.dates.every((date) => date <= dataset.info.asOf));
  assert.equal(dataset.stocks.length, 14);
});

test("API loads fail explicitly without demo fallback", async () => {
  await assert.rejects(loadApiDataset(async () => new Response(null, { status: 503 })), /雲端/);
});

test("Public API only reads cached keys; never invokes upstream updates", async () => {
  const keys = [];
  const env = { MARKET_DATA: { get: async (key) => { keys.push(key); return JSON.stringify(snapshot()); } } };
  const response = await worker.fetch(new Request("https://example.test/api/stocks/0050"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(keys, [stockKey(symbol)]);
  assert.equal((await worker.fetch(new Request("https://example.test/api/stocks/9999"), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://example.test/api/market", { method: "POST" }), env)).status, 405);
});

test("An empty KV returns an explicit 503 instead of fake market data", async () => {
  const env = { MARKET_DATA: { get: async () => null } };
  assert.equal((await worker.fetch(new Request("https://example.test/api/market"), env)).status, 503);
});
