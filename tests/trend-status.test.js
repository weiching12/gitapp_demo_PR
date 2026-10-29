import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHistory, getTrendStatus } from "../shared/indicators.js";

const dates = Array.from({ length: 64 }, (_, index) =>
  new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
const history = (close) => analyzeHistory(dates.map((date, index) => ({
  date, close: close(index), high: close(index) + 1, low: close(index) - 1, volume: 1000,
})));
const status = (rows, index = 60) => getTrendStatus(rows, dates, dates[index]);

test("complete rising and falling MA20/MA60 classify as bullish and bearish", () => {
  assert.deepEqual(status(history((index) => 100 + index)),
    { code: "bullish", label: "偏多", reason: "月線、季線向上" });
  assert.deepEqual(status(history((index) => 200 - index)),
    { code: "bearish", label: "偏空", reason: "月線、季線向下" });
});

test("conflicting price order, flat averages and mixed slopes remain unclear", () => {
  assert.equal(status(history((index) => index === 60 ? 200 : 200 - index)).code, "unclear");
  assert.equal(status(history(() => 100)).code, "unclear");
  assert.equal(status(history((index) => index < 40 ? 100 + index : 180 - index)).code, "unclear");
});

test("short or missing market-session history cannot be filled with older bars", () => {
  const rows = history((index) => 100 + index);
  assert.equal(status(rows, 59).code, "insufficient");
  assert.equal(status(rows.filter((row) => row.date !== dates[22])).code, "insufficient");
  assert.equal(status(rows.filter((row) => row.date !== dates[60])).code, "insufficient");
});

test("historical selection ignores later closes and recalculates on the selected day", () => {
  const rows = history((index) => index <= 60 ? 100 + index : 20);
  assert.equal(status(rows, 60).code, "bullish");
  assert.notEqual(status(rows, 61).code, "bullish");
});
