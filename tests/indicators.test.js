import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeHistory,
  getSnapshot,
  getTechnicalSignal,
  getInstitutionalSummary,
  getDominantInstitution,
  getDirectionalLeader,
  getSectorInstitutionSummary,
  getSectorInstitutionEstimate,
  getStockInstitutionEstimate,
  getInstitutionVolumeRatio,
  getStockInstitutionSeries,
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

test("sector leaders follow aggregate buy or sell direction, independent of page sorting", () => {
  const candidates = [
    { stock: "mild-buyer", value: 12 },
    { stock: "strong-buyer", value: 80 },
    { stock: "mild-seller", value: -7 },
    { stock: "strong-seller", value: -45 },
    { stock: "missing", value: null },
  ];
  assert.deepEqual(getDirectionalLeader(candidates, 20), { stock: "strong-buyer", value: 80 });
  assert.deepEqual(getDirectionalLeader(candidates, -20), { stock: "strong-seller", value: -45 });
  assert.deepEqual(getDirectionalLeader(candidates, 0), { stock: "strong-buyer", value: 80 });
  assert.deepEqual(getDirectionalLeader([{ stock: "missing", value: null }], null), { stock: null, value: null });
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

test("sector partial sums keep one shared cohort, include real zero and count unpriced members", () => {
  const history = Array.from({ length: 20 }, (_, i) => bar(20, `2026-09-${String(i + 1).padStart(2, "0")}`));
  const snapshot = (rows) => getSnapshot({ history: rows, tradingDates: history.map((row) => row.date) }, "2026-09-20");
  const complete = snapshot(history);
  const partialRows = structuredClone(history);
  partialRows.at(-1).institutions.pop();
  const partial = snapshot(partialRows);
  const unpriced = snapshot(history.slice(0, -1));
  const zero = snapshot(history.map((row) => ({ ...row, institutions: row.institutions.map((item) => ({ ...item, buy: 0, sell: 0 })) })));
  const summary = getSectorInstitutionSummary([complete, partial, unpriced, zero], "day");
  assert.deepEqual(summary, { available: 2, expected: 4, total: 2000, 外資: 2000, 投信: 0, 自營商: 0 });
  assert.equal(partial.latest.institutionalNet, null);
  assert.equal(unpriced.latest, null);
});

test("sector windows exclude an entire incomplete stock window without treating missing days as zero", () => {
  const history = Array.from({ length: 20 }, (_, i) => bar(20, `2026-09-${String(i + 1).padStart(2, "0")}`));
  const snapshot = (rows) => getSnapshot({ history: rows, tradingDates: history.map((row) => row.date) }, "2026-09-20");
  const complete = snapshot(history);
  const gapRows = structuredClone(history);
  gapRows[18].institutions = [];
  const gap = snapshot(gapRows);
  assert.equal(getSectorInstitutionSummary([complete, gap], "day").available, 2);
  for (const [window, count] of [["5", 5], ["20", 20]]) {
    const summary = getSectorInstitutionSummary([complete, gap], window);
    assert.equal(summary.available, 1);
    assert.equal(summary.expected, 2);
    assert.equal(summary.total, count * 2000);
    assert.equal(summary.total, summary.外資 + summary.投信 + summary.自營商);
    assert.equal(gap.institutionalSummary.total[`net${window}`], null);
  }
});

test("sectors with no available values remain unknown, while fully observed zero is zero", () => {
  const missing = { latest: null };
  for (const window of ["day", "5", "20"]) {
    assert.deepEqual(getSectorInstitutionSummary([missing], window),
      { available: 0, expected: 1, total: null, 外資: null, 投信: null, 自營商: null });
    assert.equal(getSectorInstitutionSummary([], window).total, null);
  }
  const zero = getSnapshot({ history: [{ ...bar(20), institutions: bar(20).institutions.map((row) => ({ ...row, buy: 0, sell: 0 })) }] }, "2026-10-01");
  assert.equal(getSectorInstitutionSummary([zero], "day").total, 0);
});

test("sector monetary estimates weight each day's shares by that day's price", () => {
  const dates = Array.from({ length: 5 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const nets = [1000, -1000, 0, 2000, -2000];
  const history = dates.map((date, index) => ({ ...bar(20 + index * 10, date), institutions: [
    { name: "外資", buy: Math.max(0, nets[index]), sell: Math.max(0, -nets[index]) },
    { name: "投信", buy: 0, sell: 0 }, { name: "自營商", buy: 0, sell: 0 },
  ] }));
  const stock = getSnapshot({ history, tradingDates: dates }, dates.at(-1));
  assert.equal(stock.institutionalSummary.total.net5, 0);
  assert.deepEqual(getSectorInstitutionEstimate([stock], "5", dates),
    { available: 1, expected: 1, buying: 0, amount: -30000 });
  assert.equal(getSectorInstitutionEstimate([stock], "day", dates).amount, -120000);
});

test("sector monetary estimates exclude incomplete windows and preserve valid zero", () => {
  const dates = Array.from({ length: 5 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const complete = { history: dates.map((date) => bar(20, date)) };
  const missingDay = { history: complete.history.filter((_, index) => index !== 1) };
  const missingInstitution = structuredClone(complete);
  missingInstitution.history[1].institutions.pop();
  const invalidPrice = structuredClone(complete);
  invalidPrice.history[1].close = 0;
  const zero = { history: complete.history.map((row) => ({ ...row,
    institutions: row.institutions.map((item) => ({ ...item, buy: 0, sell: 0 })),
  })) };
  assert.deepEqual(getSectorInstitutionEstimate([complete, missingDay, missingInstitution, invalidPrice, zero], "5", dates),
    { available: 2, expected: 5, buying: 1, amount: 200000 });
  assert.deepEqual(getSectorInstitutionEstimate([missingDay], "5", dates),
    { available: 0, expected: 1, buying: 0, amount: null });
  assert.equal(getSectorInstitutionEstimate([zero], "day", dates).amount, 0);
  assert.equal(getSectorInstitutionEstimate([complete], "20", dates).amount, null);
});

test("a 20-session monetary estimate uses exact market dates within trimmed display history", () => {
  const dates = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
  const stock = getSnapshot({ history: dates.map((date, i) => bar(i + 1, date)), tradingDates: dates }, dates.at(-1));
  stock.history = stock.history.slice(-21);
  assert.equal(getSectorInstitutionEstimate([stock], "20", dates).amount, 820000);
});

test("single-institution monetary values stay available while sector components share a complete-stock cohort", () => {
  const dates = Array.from({ length: 5 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const complete = { history: dates.map((date) => bar(20, date)) };
  const partial = structuredClone(complete);
  partial.history[1].institutions.pop();
  assert.equal(getStockInstitutionEstimate(partial, "外資", "5", dates), 200000);
  assert.equal(getStockInstitutionEstimate(partial, "total", "5", dates), null);
  assert.deepEqual(getSectorInstitutionEstimate([complete, partial], "5", dates, "外資"),
    { available: 1, expected: 2, buying: 1, amount: 200000 });
  assert.equal(getSectorInstitutionEstimate([complete], "5", dates, "missing").amount, null);
});

test("institution volume ratios use shares with a signed numerator and reject missing or zero volume", () => {
  for (const net of [250, -250, 0]) {
    const current = { ...institutionBar([net, 0, 0]), volume: 1000 };
    assert.equal(getInstitutionVolumeRatio(current), net / 10);
    for (const volume of [0, -1000, null, undefined, NaN, Infinity])
      assert.equal(getInstitutionVolumeRatio({ ...current, volume }), null);
    assert.equal(getInstitutionVolumeRatio({ ...current, institutions: current.institutions.slice(0, 2) }), null);
  }
  assert.equal(getInstitutionVolumeRatio(null), null);
});

test("institution daily series retains exact market gaps, zeros and each session's price", () => {
  const dates = ["2026-10-08", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
  const history = dates.map((date, index) => ({ ...institutionBar([index === 3 ? 0 : index % 2 ? -100 : 100, 0, 0], date), close: 10 + index }));
  history[4].institutions.pop();
  const stock = { history: history.filter((_, index) => index !== 2) };
  assert.deepEqual(getStockInstitutionSeries(stock, dates), [
    { date: dates[1], amount: -1100 }, { date: dates[2], amount: null },
    { date: dates[3], amount: 0 }, { date: dates[4], amount: null }, { date: dates[5], amount: -1500 },
  ]);
  assert.deepEqual(getStockInstitutionSeries(stock, dates.slice(0, 2)), [
    { date: dates[0], amount: 1000 }, { date: dates[1], amount: -1100 },
  ]);
  assert.deepEqual(getStockInstitutionSeries(stock, []), []);
  stock.history.at(-1).close = 0;
  assert.equal(getStockInstitutionSeries(stock, dates).at(-1).amount, null);
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
  assert.equal(filterStocks(stocks, { view: "below" }).length, 1);
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
