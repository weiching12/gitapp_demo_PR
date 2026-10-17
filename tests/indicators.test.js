import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeHistory,
  getSnapshot,
  filterStocks,
  toCsv,
} from "../src/indicators.js";
import { demoProvider } from "../src/data.js";

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const bar = (close, date = "2026-10-01") => ({
  date,
  open: close,
  high: 100,
  low: 0,
  close,
  volume: 100000,
  institutions: [{ name: "外資", buy: 5000, sell: 3000 }],
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
  assert.equal(stocks.length, 12);
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

test("CSV preserves UTF-8 BOM, quotes commas and newlines, neutralizes formulas", () => {
  const csv = toCsv([
    ["代碼", "名稱"],
    ["0050", '名稱,"測試"\n下一行'],
    ["=SUM(1,2)", -2.5],
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"0050","名稱,""測試""\n下一行"'));
  assert.ok(csv.includes('"\'=SUM(1,2)","-2.5"'));
});
