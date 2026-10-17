import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeHistory,
  getSnapshot,
  getTechnicalSignal,
  getInstitutionalSummary,
  getDominantInstitution,
  filterStocks,
} from "../src/indicators.js";
import { demoProvider } from "../src/data.js";

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("dominant institution follows the total net direction and handles ties", () => {
  const entries = (foreign, trust, dealer) => [
    ["外資", foreign], ["投信", trust], ["自營商", dealer],
  ].map(([name, net]) => ({ name, buy: Math.max(0, net), sell: Math.max(0, -net) }));
  assert.deepEqual(getDominantInstitution(entries(-1200, -300, 500)),
    { names: ["外資"], direction: "sell" });
  assert.deepEqual(getDominantInstitution(entries(800, 200, -100)),
    { names: ["外資"], direction: "buy" });
  assert.deepEqual(getDominantInstitution(entries(-300, -300, 100)),
    { names: ["外資", "投信"], direction: "sell" });
  assert.equal(getDominantInstitution(entries(100, -100, 0)), null);
  assert.equal(getDominantInstitution(entries(100, -100, 0).slice(0, 2)), null);
});
const bar = (close, date = "2026-10-01") => ({
  date,
  open: close,
  high: 100,
  low: 0,
  close,
  volume: 100000,
  institutions: [
    { name: "外資", buy: 5000, sell: 3000 },
    { name: "投信", buy: 0, sell: 0 },
    { name: "自營商", buy: 0, sell: 0 },
  ],
});

test("KD starts at 50 after a complete RSV window, then follows the recursive formula", () => {
  const rows = Array.from({ length: 8 }, () => bar(50));
  rows.push(bar(100), bar(0));
  const result = analyzeHistory(rows);
  assert.equal(result[7].k, null);
  assert.equal(result[7].rsv, null);
  near(result[8].rsv, 100);
  near(result[8].k, 200 / 3);
  near(result[8].d, 500 / 9);
  near(result[9].k, 400 / 9);
  near(result[9].d, 1400 / 27);
});

test("flat windows stay neutral, configurable smoothing and incomplete MA windows work", () => {
  const flat = Array.from({ length: 60 }, () => ({
    ...bar(8),
    open: 8,
    high: 8,
    low: 8,
  }));
  const results = analyzeHistory(flat);
  assert.equal(results[58].ma60, null);
  assert.equal(results[59].ma60, 8);
  assert.equal(results[59].k, 50);
  assert.equal(results[59].d, 50);
  assert.equal(results[59].deviation, 0);
  const custom = analyzeHistory([bar(50), bar(100)], {
    period: 2,
    kSmooth: 1,
    dSmooth: 1,
  });
  assert.equal(custom[1].k, 100);
  assert.equal(custom[1].d, 100);
  assert.throws(
    () => analyzeHistory([], { period: 0, kSmooth: 3, dSmooth: 3 }),
    RangeError,
  );
});

test("60-session average, price change and net institutional volume use exact inputs", () => {
  const results = analyzeHistory(
    Array.from({ length: 60 }, (_, i) => bar(i + 1)),
  );
  assert.equal(results[59].ma60, 30.5);
  assert.equal(results[59].change, 1);
  near(results[59].changePercent, (60 / 59 - 1) * 100);
  near(results[59].deviation, (60 / 30.5 - 1) * 100);
  assert.equal(results[59].institutionalNet, 2000);
  assert.equal(results[0].change, null);
});

test("historical snapshots never include data after the selected date", () => {
  const stock = {
    symbol: "0050",
    name: "台灣50",
    sector: "ETF",
    history: [
      bar(20, "2026-10-01"),
      bar(40, "2026-10-02"),
      bar(90, "2026-10-05"),
    ],
  };
  const snapshot = getSnapshot(stock, "2026-10-02");
  assert.equal(snapshot.history.length, 2);
  assert.equal(snapshot.latest.close, 40);
  assert.equal(snapshot.latest.date, "2026-10-02");
  assert.equal(getSnapshot(stock, "2020-01-01").latest, null);
});

test("search, sector, favorites and indicator filters combine correctly", () => {
  const stocks = [
    {
      symbol: "2330",
      name: "台積電",
      sector: "半導體",
      latest: { deviation: 2, k: 10 },
    },
    {
      symbol: "0050",
      name: "元大台灣50",
      sector: "ETF",
      latest: { deviation: -2, k: 40 },
    },
    {
      symbol: "2303",
      name: "聯電",
      sector: "半導體",
      latest: { deviation: 0, k: null },
    },
  ];
  assert.equal(filterStocks(stocks, { query: " 台積 " }).length, 1);
  assert.equal(filterStocks(stocks, { query: "0050" })[0].symbol, "0050");
  assert.equal(
    filterStocks(stocks, {
      view: "favorites",
      favorites: ["0050"],
      sector: "半導體",
    }).length,
    0,
  );
  assert.equal(filterStocks(stocks, { view: "above" }).length, 1);
  assert.equal(filterStocks(stocks, { view: "oversold" }).length, 1);
});

test("demo provider data is consistent across all OHLC and volume records", async () => {
  const { stocks, dates, info } = await demoProvider.load();
  assert.equal(stocks.length, 14);
  assert.equal(dates.at(-1), info.asOf);
  for (const stock of stocks) {
    assert.equal(stock.history.length, 180);
    for (const row of stock.history) {
      assert.ok(row.high >= Math.max(row.open, row.close));
      assert.ok(row.low <= Math.min(row.open, row.close));
      assert.ok(row.volume > 0);
      assert.ok(
        row.institutions.every((item) => item.buy >= 0 && item.sell >= 0),
      );
      assert.ok(
        row.institutions.reduce((sum, item) => sum + item.buy, 0) <= row.volume,
      );
      assert.ok(
        row.institutions.reduce((sum, item) => sum + item.sell, 0) <=
          row.volume,
      );
    }
    const latest = getSnapshot(stock, info.asOf).latest;
    assert.ok(latest.k >= 0 && latest.k <= 100);
    assert.ok(latest.d >= 0 && latest.d <= 100);
  }
});

const kdBar = (k, d, extra = {}) => ({ k, d, close: 105, ma20: 100, ...extra });

const institutionBar = (nets, date = "2026-10-01") => ({
  ...bar(50, date),
  institutions: ["外資", "投信", "自營商"].map((name, index) => ({
    name,
    buy: 10000 + Math.max(nets[index], 0),
    sell: 10000 + Math.max(-nets[index], 0),
  })),
});

test("institutional rolling sums include exactly the latest 5 and 20 sessions in shares", () => {
  const history = Array.from({ length: 21 }, (_, i) =>
    institutionBar([(i + 1) * 1000, -(i + 1) * 2000, 500]),
  );
  const result = getInstitutionalSummary(history);
  assert.equal(result.institutions.外資.net5, 95000);
  assert.equal(result.institutions.外資.net20, 230000);
  assert.equal(result.institutions.投信.net5, -190000);
  assert.equal(result.institutions.自營商.net20, 10000);
  assert.deepEqual(result.total, { net5: -92500, net20: -220000 });
  assert.equal(getInstitutionalSummary(history.slice(0, 19)).total.net20, null);
  assert.equal(getInstitutionalSummary(history.slice(0, 4)).institutions.外資.net5, null);
  assert.equal(getInstitutionalSummary(history.slice(0, 20)).institutions.外資.net20, 210000);
});

test("institutional streaks stop at direction changes or zero net sessions", () => {
  const history = [[100, 0, 0], [-100, 100, 0], [0, -100, 0], [200, -200, 0], [300, -300, 0]]
    .map((nets) => institutionBar(nets));
  const result = getInstitutionalSummary(history);
  assert.deepEqual(result.institutions.外資.streak, { direction: "buy", days: 2, atLeast: false });
  assert.deepEqual(result.institutions.投信.streak, { direction: "sell", days: 3, atLeast: false });
  assert.deepEqual(result.institutions.自營商.streak, { direction: "neutral", days: 0, atLeast: false });
  assert.equal(result.institutions.外資.net5, 500);
});

test("short or missing institution histories are not silently counted as zero", () => {
  const history = Array.from({ length: 5 }, () => institutionBar([100, -200, 300]));
  history[2].institutions = history[2].institutions.filter((item) => item.name !== "投信");
  const result = getInstitutionalSummary(history);
  assert.equal(result.institutions.外資.net5, 500);
  assert.equal(result.institutions.投信.net5, null);
  assert.equal(result.total.net5, null);
  assert.deepEqual(result.institutions.投信.streak, { direction: "sell", days: 2, atLeast: true });
  assert.deepEqual(result.institutions.外資.streak, { direction: "buy", days: 5, atLeast: true });
  history[4].institutions = [];
  assert.deepEqual(getInstitutionalSummary(history).institutions.外資.streak,
    { direction: "unknown", days: null, atLeast: false });
  assert.deepEqual(getInstitutionalSummary([]).total, { net5: null, net20: null });
  for (const invalid of [NaN, Infinity, -1, null]) {
    const rows = Array.from({ length: 5 }, () => institutionBar([100, 200, 300]));
    rows[0].institutions[0].buy = invalid;
    assert.equal(getInstitutionalSummary(rows).institutions.外資.net5, null);
  }
  const duplicate = Array.from({ length: 5 }, () => institutionBar([100, 200, 300]));
  duplicate[0].institutions.push({ ...duplicate[0].institutions[0] });
  assert.equal(getInstitutionalSummary(duplicate).total.net5, null);
});

test("historical institutional windows and streaks count trading sessions without future data", () => {
  const dates = ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19"];
  const nets = [-1000, 500, 500, -900, 1000, 1000, 1000];
  const stock = { history: dates.map((date, i) => institutionBar([nets[i], 0, 0], date)) };
  const before = getSnapshot(stock, "2026-10-16").institutionalSummary.institutions.外資;
  assert.equal(before.net5, 2100);
  assert.deepEqual(before.streak, { direction: "buy", days: 2, atLeast: false });
  const after = getSnapshot(stock, "2026-10-19").institutionalSummary.institutions.外資;
  assert.equal(after.net5, 2600);
  assert.equal(after.streak.days, 3);
  assert.deepEqual(before, getSnapshot({ history: stock.history.slice(0, -1) }, "2026-10-16")
    .institutionalSummary.institutions.外資);
});

test("low and high K readings alone never become buy or sell suggestions", () => {
  assert.equal(getTechnicalSignal([kdBar(12, 18), kdBar(10, 16)]).code, "oversold-watch");
  assert.equal(getTechnicalSignal([kdBar(91, 85), kdBar(94, 88)]).code, "overbought-watch");
  for (const boundary of [20, 80])
    assert.equal(getTechnicalSignal([kdBar(boundary, boundary), kdBar(boundary, boundary)]).code, "neutral");
});

test("a low-zone golden cross requires MA20 confirmation for a buy watch", () => {
  const previous = kdBar(10, 15);
  const current = kdBar(18, 16, { ma20: 101 });
  assert.equal(getTechnicalSignal([previous, current]).code, "buy-watch");
  assert.equal(getTechnicalSignal([previous, { ...current, close: 99 }]).code, "rebound-watch");
  assert.equal(getTechnicalSignal([previous, { ...current, ma20: 99 }]).code, "rebound-watch");
  assert.equal(getTechnicalSignal([previous, { ...current, ma20: null }]).code, "rebound-watch");
  assert.equal(getTechnicalSignal([previous, kdBar(18, 16, { close: 100 })]).code, "buy-watch");
  // An exit from the low zone still qualifies when both lines were low yesterday.
  assert.equal(getTechnicalSignal([previous, kdBar(23, 18)]).code, "buy-watch");
});

test("high-zone death crosses flag selling, while mid-range crosses flag momentum", () => {
  assert.equal(getTechnicalSignal([kdBar(90, 85), kdBar(82, 84)]).code, "sell-watch");
  assert.equal(getTechnicalSignal([kdBar(90, 85), kdBar(78, 83)]).code, "sell-watch");
  assert.equal(getTechnicalSignal([kdBar(55, 50), kdBar(45, 48)]).code, "weakening");
  assert.equal(getTechnicalSignal([kdBar(40, 45), kdBar(52, 47)]).code, "strengthening");
  // A single low line is not a cross in the low zone.
  assert.equal(getTechnicalSignal([kdBar(19, 30), kdBar(35, 31)]).code, "strengthening");
});

test("crosses are fresh events and require K to move in the crossing direction", () => {
  assert.equal(getTechnicalSignal([kdBar(10, 15), kdBar(18, 18)]).code, "oversold-watch");
  assert.equal(getTechnicalSignal([kdBar(15, 15), kdBar(18, 16)]).code, "buy-watch");
  assert.equal(getTechnicalSignal([kdBar(18, 16), kdBar(19, 17)]).code, "oversold-watch");
  assert.notEqual(getTechnicalSignal([kdBar(18, 19), kdBar(17, 16)]).code, "buy-watch");
  assert.notEqual(getTechnicalSignal([kdBar(85, 84), kdBar(86, 87)]).code, "sell-watch");
  assert.equal(getTechnicalSignal([kdBar(55, 50), kdBar(57, 52)]).code, "bullish-watch");
  assert.equal(getTechnicalSignal([kdBar(45, 50), kdBar(42, 48)]).code, "bearish-watch");
});

test("missing or nonfinite KD data cannot generate technical trade suggestions", () => {
  for (const history of [[], [kdBar(10, 15)], [kdBar(null, 15), kdBar(18, 16)]])
    assert.equal(getTechnicalSignal(history).code, "insufficient");
  for (const invalid of [null, undefined, NaN, Infinity, -1, 101])
    assert.equal(getTechnicalSignal([kdBar(10, 15), kdBar(invalid, 16)]).code, "insufficient");
});

test("technical suggestions use the selected date and custom KD parameters only", () => {
  const stock = {
    history: Array.from({ length: 22 }, (_, i) =>
      bar(i === 21 ? 100 : 10, `2026-10-${String(i + 1).padStart(2, "0")}`),
    ),
  };
  const settings = { period: 1, kSmooth: 1, dSmooth: 3 };
  const before = getSnapshot(stock, "2026-10-21", settings);
  const after = getSnapshot(stock, "2026-10-22", settings);
  assert.equal(before.signal.code, "oversold-watch");
  assert.equal(after.signal.code, "buy-watch");
  const shortened = getSnapshot({ history: stock.history.slice(0, -1) }, "2026-10-21", settings);
  assert.deepEqual(before.signal, shortened.signal);
  assert.equal(getSnapshot(stock, "2026-10-22", { ...settings, dSmooth: 1 }).signal.code, "overbought-watch");
});
