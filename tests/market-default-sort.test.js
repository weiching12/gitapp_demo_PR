import assert from "node:assert/strict";
import test from "node:test";
import { compareDefaultMarketStocks } from "../src/ui/market.js";

const stock = (symbol, net, signal = "neutral", trend = "unclear") => ({
  symbol,
  latest: net === undefined ? null : { institutionalNet: net },
  signal: signal === null ? null : { code: signal },
  trend: trend === null ? null : { code: trend },
});

test("default market order puts complete rows first by signed institutional shares", () => {
  const stocks = [
    stock("SELL", -3000), stock("BUY", 5000), stock("FLAT", 0),
    stock("SMALL", 100), stock("TIE-B", 100), stock("TIE-A", 100),
  ];
  assert.deepEqual(stocks.sort(compareDefaultMarketStocks).map(({ symbol }) => symbol),
    ["BUY", "SMALL", "TIE-A", "TIE-B", "FLAT", "SELL"]);
});

test("missing KD or trend data follows complete rows even with more institutional shares", () => {
  const stocks = [
    stock("NO-KD", 9000, "insufficient"), stock("NO-TREND", 8000, "neutral", "insufficient"),
    stock("BOTH-MISSING", 7000, "insufficient", "insufficient"), stock("NO-SIGNAL", 6000, null),
    stock("NO-TREND-OBJECT", 5000, "neutral", null), stock("COMPLETE", -100),
  ];
  assert.deepEqual(stocks.sort(compareDefaultMarketStocks).map(({ symbol }) => symbol),
    ["COMPLETE", "NO-KD", "NO-TREND", "BOTH-MISSING", "NO-SIGNAL", "NO-TREND-OBJECT"]);
});

test("missing institutional data is last, including a traded stock like 5906", () => {
  const stocks = [stock("5906", null, "bearish-watch", "insufficient"), stock("NO-QUOTE", undefined),
    stock("HAS-NET-AND-ANALYSIS", -5000), stock("HAS-NET-NO-TREND", -10000, "neutral", "insufficient")];
  assert.deepEqual(stocks.sort(compareDefaultMarketStocks).map(({ symbol }) => symbol),
    ["HAS-NET-AND-ANALYSIS", "HAS-NET-NO-TREND", "5906", "NO-QUOTE"]);
});

test("an ETF with missing KD and trend follows every technically complete stock", () => {
  const stocks = [stock("00701", 120908, "insufficient", "insufficient"),
    stock("COMPLETE-NO-NET", null), stock("COMPLETE-WITH-NET", -1000),
    stock("5906", null, "bearish-watch", "insufficient")];
  assert.deepEqual(stocks.sort(compareDefaultMarketStocks).map(({ symbol }) => symbol),
    ["COMPLETE-WITH-NET", "COMPLETE-NO-NET", "00701", "5906"]);
});
