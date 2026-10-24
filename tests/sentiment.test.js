import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHistory } from "../shared/indicators.js";
import { calculateMarketSentiment, sentimentBand } from "../shared/sentiment.js";

const dates = Array.from({ length: 85 }, (_, index) =>
  new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
const last = dates.at(-1);
const makeStock = (symbol, { close = (index) => 100 + index, volume = () => 1000,
  net = () => 0, priceBasis = "adjusted" } = {}) => ({
  symbol, name: symbol, sector: "半導體業", market: "上市", assetType: "stock", priceBasis,
  tradingDates: dates,
  history: analyzeHistory(dates.map((date, index) => ({
    date, close: close(index), open: close(index), high: close(index), low: close(index),
    volume: volume(index), institutions: ["外資", "投信", "自營商"].map((name, position) =>
      ({ name, buy: position ? 0 : Math.max(0, net(index)), sell: position ? 0 : Math.max(0, -net(index)) })),
  }))),
});
const today = (stocks, asOf = last) => calculateMarketSentiment(stocks, asOf, 20, dates);

test("breadth gives flat stocks half credit and excludes ETFs and OTC", () => {
  const stocks = Array.from({ length: 10 }, (_, index) =>
    makeStock(String(2000 + index), { close: (day) => 100 + (index < 6 ? day : index < 9 ? -day / 2 : 0) }));
  stocks.push({ ...makeStock("0050", { close: (day) => 100 - day / 2 }), assetType: "etf" });
  stocks.push({ ...makeStock("OTC", { close: (day) => 100 - day / 2 }), market: "上櫃" });
  const result = today(stocks);
  assert.equal(result.components.breadth, 65);
  assert.deepEqual(result.samples.breadth, { valid: 10, expected: 10, ratio: 1 });
});

test("sentiment bands keep stable public thresholds", () => {
  assert.equal(sentimentBand(20).label, "極度恐懼");
  assert.equal(sentimentBand(40).label, "恐懼");
  assert.equal(sentimentBand(59).label, "中性");
  assert.equal(sentimentBand(79).label, "貪婪");
  assert.equal(sentimentBand(80).label, "極度貪婪");
});

test("MA60 position gives above, equal, below 100, 50, 0", () => {
  const up = makeStock("UP"), flat = makeStock("FLAT", { close: () => 100 });
  const down = makeStock("DOWN", { close: (index) => 200 - index });
  assert.equal(today([up, flat, down]).components.trend, 50);
  down.history.splice(-25, 1);
  assert.equal(today([up, flat, down]).samples.trend.valid, 2);
  assert.equal(today([up, flat, down]).components.trend, null);
});

test("20-day momentum uses comparable adjusted prices and complete market sessions", () => {
  const up = makeStock("UP"), flat = makeStock("FLAT", { close: () => 100 });
  const down = makeStock("DOWN", { close: (index) => 200 - index });
  assert.equal(today([up, flat, down]).components.momentum, 50);
  assert.equal(today([{ ...up, priceBasis: "unadjusted" }]).components.momentum, null);
  up.history.splice(-10, 1);
  assert.equal(today([up]).series.at(-1).components.momentum, null);
  const earlier = today([flat], dates.at(-2));
  flat.history.push({ ...flat.history.at(-1), date: "2027-01-01", close: 500 });
  assert.deepEqual(today([flat], dates.at(-2)), earlier);
});

test("verified raw closes restore momentum across events without using future events", () => {
  const stock = makeStock("2330", { priceBasis: "unadjusted" });
  const coveredDates = new Set(dates.slice(-39));
  const actions = { coveredDates, eventsBySymbol: new Map() };
  const score = calculateMarketSentiment([stock], last, 20, dates, actions);
  assert.equal(score.components.momentum, 100);
  assert.equal(score.series[0].components.momentum, 100);
  const missing = { coveredDates: new Set([...coveredDates].filter((date) => date !== dates.at(-5))),
    eventsBySymbol: new Map() };
  assert.equal(calculateMarketSentiment([stock], last, 20, dates, missing).components.momentum, null);
  const eventDate = dates.at(-10), preceding = stock.history.at(-11).close;
  const event = { coveredDates, eventsBySymbol: new Map([["2330", new Map([[eventDate,
    { kind: "息", beforeClose: preceding, reference: preceding - 5 }]])]]) };
  assert.equal(calculateMarketSentiment([stock], last, 20, dates, event).components.momentum, 100);
  event.eventsBySymbol.get("2330").set(eventDate, { kind: "息", beforeClose: preceding + 2,
    reference: preceding - 3 });
  assert.equal(calculateMarketSentiment([stock], last, 20, dates, event).components.momentum, null);
  event.eventsBySymbol.set("2330", new Map([[dates[0], { kind: "息", beforeClose: 100, reference: 95 }]]));
  assert.equal(calculateMarketSentiment([stock], last, 20, dates, event).components.momentum, 100);
  assert.equal(calculateMarketSentiment([stock], dates.at(-2), 20, dates, actions).components.momentum, 100);
});

test("five complete institution sessions use net shares divided by traded shares", () => {
  assert.equal(today([makeStock("BUY", { net: () => 50 })]).components.institutions, 100);
  assert.equal(today([makeStock("ZERO")]).components.institutions, 50);
  assert.equal(today([makeStock("SELL", { net: () => -50 })]).components.institutions, 0);
  const missing = makeStock("MISSING");
  missing.history.at(-3).institutions = [];
  assert.equal(today([missing]).series.at(-1).components.institutions, null);
  assert.equal(today([makeStock("NO-VOLUME", { volume: () => 0 })]).series.at(-1).components.institutions, null);
});

test("volume heat scores direction among RVOL20 >= 1.20 and notes small or empty samples", () => {
  const up = makeStock("UP", { volume: (index) => index === 84 ? 1200 : 1000 });
  const down = makeStock("DOWN", { close: (index) => 200 - index,
    volume: (index) => index === 84 ? 1500 : 1000 });
  const flat = makeStock("FLAT", { close: () => 100,
    volume: (index) => index === 84 ? 1200 : 1000 });
  assert.equal(today([up, down, flat]).components.volume, 50);
  assert.equal(today([up, down, flat]).notes.volume, "樣本偏少");
  assert.equal(today([makeStock("NORMAL")]).components.volume, 50);
  assert.equal(today([makeStock("NORMAL")]).notes.volume, "無明顯放量訊號");
  assert.equal(today([up]).components.volume, 100);
  up.history.at(-20).volume = null;
  assert.equal(today([up]).components.volume, null);
});

test("80% coverage and effective-weight boundaries retain last valid day", () => {
  const stocks = Array.from({ length: 5 }, (_, index) => makeStock(String(index), { priceBasis: "unadjusted" }));
  assert.equal(today(stocks).effectiveWeight, 0.8);
  assert.equal(today(stocks).status, "current");
  const prior = today(stocks, dates.at(-2));
  stocks[0].history.at(-1).institutions = [];
  assert.equal(today(stocks).samples.institutions.ratio, 0.8);
  assert.equal(today(stocks).status, "current");
  stocks[1].history.at(-1).institutions = [];
  const insufficient = today(stocks);
  assert.equal(insufficient.latestSamples.institutions.ratio, 0.6);
  assert.equal(insufficient.latestEffectiveWeight, 0.55);
  assert.equal(insufficient.status, "insufficient");
  assert.equal(insufficient.score, prior.score);
  assert.equal(insufficient.date, dates.at(-2));
  assert.equal(insufficient.series.at(-1).score, null);
  assert.equal(today(stocks, "2026-05-01").status, "insufficient");
  assert.equal(today(stocks, "2026-05-01").series.at(-1).date, last);
  assert.equal(insufficient.version, "tw-market-sentiment-v6");
});

test("last valid score is retained even when older than the visible chart", () => {
  const stock = makeStock("OLD", { priceBasis: "unadjusted" });
  stock.history.slice(-21).forEach((bar) => { bar.institutions = []; });
  const result = today([stock]);
  assert.equal(result.status, "insufficient");
  assert.equal(result.date, dates.at(-22));
  assert.ok(Number.isFinite(result.score));
  assert.ok(result.series.every((point) => point.score === null));
});
