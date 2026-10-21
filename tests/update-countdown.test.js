import test from "node:test";
import assert from "node:assert/strict";
import { countdownText, nextMarketUpdate } from "../src/update-countdown.js";

test("next update follows Taipei weekday 18:30 and 20:30 slots", () => {
  assert.equal(nextMarketUpdate(new Date("2026-10-21T09:00:00Z")).label, "18:30");
  assert.equal(nextMarketUpdate(new Date("2026-10-21T11:00:00Z")).label, "20:30");
  assert.equal(countdownText(new Date("2026-10-21T10:29:30Z")), "預計 18:30 更新 · 00:00:30");
});

test("after the evening slot and weekends roll to the next weekday", () => {
  assert.equal(nextMarketUpdate(new Date("2026-10-23T13:00:00Z")).at.toISOString(), "2026-10-26T10:30:00.000Z");
  assert.equal(nextMarketUpdate(new Date("2026-10-24T04:00:00Z")).at.toISOString(), "2026-10-26T10:30:00.000Z");
});
