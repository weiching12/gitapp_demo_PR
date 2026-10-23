import test from "node:test";
import assert from "node:assert/strict";
import { calculateMarketSentiment, sentimentBand } from "../shared/sentiment.js";

const stock = (symbol, positive = true, missingInstitutions = false) => ({
  symbol, name: symbol, sector: "半導體業", assetType: "stock",
  history: Array.from({ length: 41 }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    close: 100 + (positive ? index : -index / 2), volume: 1000 + index * 10,
    changePercent: positive ? 1 : -1, deviation: positive ? 2 : -2,
    institutions: missingInstitutions ? [] : ["外資", "投信", "自營商"].map((name) => ({ name, buy: positive ? 20 : 10, sell: positive ? 10 : 20 })),
  })),
});

test("market sentiment excludes ETFs and missing institution values without filling zero", () => {
  const positive = stock("2330"), negative = stock("2317", false), missing = stock("2603", true, true);
  const etf = { ...stock("0050", false), sector: "ETF", assetType: "etf" };
  const result = calculateMarketSentiment([positive, negative, missing, etf], "2026-09-41");
  assert.equal(result.components.coverage, 3);
  assert.equal(Math.round(result.components.institutions), 50);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.series.length, 20);
});

test("sentiment bands keep stable public thresholds", () => {
  assert.equal(sentimentBand(20).label, "極度恐懼");
  assert.equal(sentimentBand(40).label, "恐懼");
  assert.equal(sentimentBand(59).label, "中性");
  assert.equal(sentimentBand(79).label, "貪婪");
  assert.equal(sentimentBand(80).label, "極度貪婪");
});

test("market sentiment averages the latest five trading days rather than using only the current day", () => {
  const mixed = stock("2330");
  mixed.history = mixed.history.slice(-6);
  mixed.history[0].changePercent = -1;
  mixed.history[5].changePercent = -1;
  const result = calculateMarketSentiment([mixed], "2026-09-41", 6);
  assert.equal(result.components.breadth, 80);
  assert.equal(result.series[3].score, null);
  assert.equal(result.series[4].components.breadth, 80);
  assert.equal(result.version, "tw-market-sentiment-v2");
});
