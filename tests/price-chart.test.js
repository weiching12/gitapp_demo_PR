import test from "node:test";
import assert from "node:assert/strict";
import { priceTrend } from "../src/ui/entry-score.js";

test("thirty-day line tone follows first and last valid close", () => {
  assert.equal(priceTrend([{ close: 10 }, { close: null }, { close: 11 }]), "up");
  assert.equal(priceTrend([{ close: 11 }, { close: 10 }]), "down");
  assert.equal(priceTrend([{ close: 10 }, { close: 10 }]), "flat");
  assert.equal(priceTrend([{ close: null }, { close: 10 }]), "flat");
});
