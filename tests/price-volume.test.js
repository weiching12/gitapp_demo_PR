import test from "node:test";
import assert from "node:assert/strict";
import { classifyPriceVolume, getPriceVolumeSignal, getSnapshot } from "../shared/indicators.js";

const dates = Array.from({ length: 23 }, (_, index) =>
  new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
const bars = dates.map((date) => ({ date, close: 100, volume: 1000 }));
const signal = (history, index, change = 1) =>
  getPriceVolumeSignal(history, dates, dates[index], change);
const unknown = { rvol20: null, code: "insufficient", label: "資料不足" };

test("all nine price and volume combinations have reusable codes and concise labels", () => {
  const cases = [
    [2.5, 1.5, "price-up-volume-up", "價漲量增"],
    [2.5, 1, "price-up-volume-flat", "價漲量平"],
    [2.5, 0.65, "price-up-volume-down", "價漲量縮"],
    [-2.1, 2.15, "price-down-volume-up", "價跌量增"],
    [-2.1, 1, "price-down-volume-flat", "價跌量平"],
    [-1.5, 0.6, "price-down-volume-down", "價跌量縮"],
    [0.3, 3.2, "volume-up-price-stagnant", "量增價滯"],
    [0.1, 1, "price-volume-flat", "量價持平"],
    [0, 0.6, "volume-down-range", "量縮盤整"],
  ];
  for (const [change, rvol20, code, label] of cases) {
    assert.deepEqual(classifyPriceVolume(rvol20, change), { code, label });
    const history = bars.map((bar, index) => index === 20 ? { ...bar, volume: rvol20 * 1000 } : bar);
    assert.deepEqual(signal(history, 20, change), { rvol20, code, label });
  }
  assert.equal(classifyPriceVolume(1.5, -0.2).label, "量增價滯");
});

test("RVOL20 0.80 and 1.20 and price change ±0.50% use inclusive boundaries", () => {
  for (const [volume, label] of [[799, "價漲量縮"], [800, "價漲量平"],
    [1199, "價漲量平"], [1200, "價漲量增"]]) {
    const history = bars.map((bar, index) => index === 20 ? { ...bar, volume } : bar);
    assert.equal(signal(history, 20, 2.5).label, label);
    assert.equal(signal(history, 20).rvol20, volume / 1000);
  }
  for (const change of [-0.5, 0, 0.5])
    assert.equal(classifyPriceVolume(2, change).label, "量增價滯");
  assert.equal(classifyPriceVolume(1.2, 0.5001).label, "價漲量增");
  assert.equal(classifyPriceVolume(1.2, -0.5001).label, "價跌量增");
  assert.equal(classifyPriceVolume(0.8, 0.5).label, "量價持平");
  assert.equal(classifyPriceVolume(0.799, -0.5).label, "量縮盤整");
});

test("short history, missing market session, zero average and missing change stay unknown", () => {
  assert.deepEqual(signal(bars, 19), unknown);
  assert.deepEqual(signal(bars.filter((bar) => bar.date !== dates[10]), 20),
    unknown);
  assert.deepEqual(signal(bars.map((bar, index) => index < 20 ? { ...bar, volume: 0 } : bar), 20),
    unknown);
  assert.deepEqual(signal(bars.map((bar, index) => index === 20 ? { ...bar, volume: null } : bar), 20), unknown);
  assert.deepEqual(signal(bars.map((bar, index) => index === 20 ? { ...bar, close: null } : bar), 20), unknown);
  assert.deepEqual(signal(bars, 20, null), unknown);
  assert.deepEqual(classifyPriceVolume(null, 0), { code: "insufficient", label: "資料不足" });
  assert.deepEqual(classifyPriceVolume(-1, 0), { code: "insufficient", label: "資料不足" });
});

test("switching historical date excludes future volume", () => {
  const history = bars.map((bar, index) => ({ ...bar,
    volume: index === 20 ? 500 : index === 21 ? 2000 : index === 22 ? 999999 : 1000 }));
  assert.equal(signal(history, 20).rvol20, 0.5);
  assert.equal(signal(history, 21).rvol20, 2000 / 975);
});

test("switching historical date recalculates price and volume without future bars", () => {
  const history = bars.map((bar, index) => ({ ...bar,
    open: 100, high: 105, low: 95,
    close: index === 20 ? 100.3 : index === 21 ? 102.8 : 100,
    volume: index === 20 ? 3200 : index === 21 ? 650 : index === 22 ? 999999 : 1000,
    institutions: [],
  }));
  const stock = { symbol: "TEST", history, tradingDates: dates };
  const before = getSnapshot(stock, dates[20]);
  const after = getSnapshot(stock, dates[21]);
  assert.equal(before.priceVolume.label, "量增價滯");
  assert.equal(before.priceVolume.rvol20, 3.2);
  assert.equal(after.priceVolume.label, "價漲量縮");
  assert.equal(after.priceVolume.rvol20, 650 / 1110);
  assert.deepEqual(getSnapshot(stock, dates[20]).priceVolume, before.priceVolume);
});
