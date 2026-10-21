import test from "node:test";
import assert from "node:assert/strict";
import * as browser from "../src/indicators.js";
import * as domain from "../shared/indicators.js";
import { stockAnalysis, analysisOptions } from "../cloudflare/services/analysis-service.js";

test("browser compatibility entry exports identical pure rule functions", () => {
  for (const key of Object.keys(browser)) assert.equal(browser[key], domain[key]);
});

test("server analysis matches browser snapshots and never includes future bars", async () => {
  const history = Array.from({ length: 70 }, (_, index) => ({ date: new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10),
    open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 10000,
    institutions: ["外資", "投信", "自營商"].map((name) => ({ name, buy: 500, sell: 100 })) }));
  const stock = { symbol: "2330", history, tradingDates: history.map((row) => row.date) };
  const market = { stock: async () => ({ stock, asOf: history.at(-1).date }) };
  const asOf = history[40].date;
  const options = analysisOptions(new URLSearchParams({ asOf }));
  const result = await stockAnalysis(market, "2330", options);
  const expected = browser.getSnapshot(stock, asOf, options.settings);
  assert.deepEqual(result.data.latest, expected.latest);
  assert.deepEqual(result.data.signal, expected.signal);
  assert.equal(result.data.latest.ma60, null);
  history[69].close = 999999;
  assert.deepEqual(await stockAnalysis(market, "2330", options), result);
  await assert.rejects(stockAnalysis(market, "2330", { ...options, asOf: "2099-01-01" }), /交易日/);
});

test("analysis parameter validation follows frontend bounds", () => {
  for (const query of ["period=0", "period=61", "dSmooth=21", "kSmooth=no", "asOf=2026-02-30"])
    assert.throws(() => analysisOptions(new URLSearchParams(query)));
});
