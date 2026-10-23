import test from "node:test";
import assert from "node:assert/strict";
import { getPriceVolumeSignal } from "../shared/indicators.js";

const dates = Array.from({ length: 23 }, (_, index) =>
  new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
const bars = dates.map((date) => ({ date, close: 100, volume: 1000 }));
const signal = (history, index, change = 1) =>
  getPriceVolumeSignal(history, dates, dates[index], change);

test("RVOL20 volume classes include the 0.80 and 1.20 boundaries", () => {
  for (const [volume, label] of [[799, "交易變少"], [800, "交易差不多"],
    [1199, "交易差不多"], [1200, "交易變多"]]) {
    const history = bars.map((bar, index) => index === 20 ? { ...bar, volume } : bar);
    assert.equal(signal(history, 20).label, `漲了，${label}`);
    assert.equal(signal(history, 20).rvol20, volume / 1000);
  }
});

test("all nine price and volume combinations use plain language", () => {
  for (const [change, price] of [[1, "漲了"], [-1, "跌了"], [0, "價格沒變"]])
    for (const [volume, amount] of [[1200, "交易變多"], [1000, "交易差不多"], [500, "交易變少"]]) {
      const history = bars.map((bar, index) => index === 20 ? { ...bar, volume } : bar);
      assert.equal(signal(history, 20, change).label, `${price}，${amount}`);
    }
});

test("short history, missing market session, zero average and missing change stay unknown", () => {
  assert.deepEqual(signal(bars, 19), { rvol20: null, label: "資料不足" });
  assert.deepEqual(signal(bars.filter((bar) => bar.date !== dates[10]), 20),
    { rvol20: null, label: "資料不足" });
  assert.deepEqual(signal(bars.map((bar, index) => index < 20 ? { ...bar, volume: 0 } : bar), 20),
    { rvol20: null, label: "資料不足" });
  assert.deepEqual(signal(bars, 20, null), { rvol20: null, label: "資料不足" });
});

test("switching historical date excludes future volume", () => {
  const history = bars.map((bar, index) => ({ ...bar,
    volume: index === 20 ? 500 : index === 21 ? 2000 : index === 22 ? 999999 : 1000 }));
  assert.equal(signal(history, 20).rvol20, 0.5);
  assert.equal(signal(history, 21).rvol20, 2000 / 975);
});
