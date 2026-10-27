import test from "node:test";
import assert from "node:assert/strict";
import { researchCardTrend } from "../src/ui/research.js";

const keys = ["trend", "momentum", "priceVolume", "institutional", "entryRisk"];
function snapshot(asOf, finalScore, options = {}) {
  const conditions = Object.fromEntries(keys.map((key) => [key, { status: options.failed === key ? "FAIL" : "PASS" }]));
  return {
    id: `${asOf}-${finalScore}`, asOf, valid: true, symbol: "2330", modelVersion: "entry-score-v1.2",
    strategy: "swing-trend", configId: options.configId ?? "default", priceBasis: "unadjusted",
    source: "daily", baseScore: finalScore, finalScore, conditions,
    categories: Object.fromEntries(keys.map((key) => [key, { score: finalScore, creditedContribution: finalScore / 5 }])),
    passedCount: options.failed ? 4 : 5, totalConditions: 5,
    cap: { enabled: false, value: null, reason: null }, ...options,
  };
}

test("card trend compares to the saved join score and summarizes the changed condition", () => {
  const initial = snapshot("2026-10-15", 70, { failed: "momentum" });
  const latest = snapshot("2026-10-16", 75);
  const trend = researchCardTrend({ addedSnapshot: initial }, { latest, history: [initial, latest] });
  assert.equal(trend.status, "comparable");
  assert.equal(trend.delta, 5);
  assert.equal(trend.reason, "KD條件改善");
  assert.equal(trend.label, "自收藏後");
});

test("an older join baseline remains the comparison date when intermediate history is missing", () => {
  const initial = snapshot("2026-09-01", 60);
  const latest = snapshot("2026-10-16", 80);
  const trend = researchCardTrend({ addedSnapshot: initial }, { latest, history: [snapshot("2026-10-15", 78), latest] });
  assert.equal(trend.delta, 20);
  assert.equal(trend.initial.asOf, "2026-09-01");
  assert.equal(trend.latest.asOf, "2026-10-16");
});

test("legacy favorites do not fabricate a since-join change", () => {
  const latest = snapshot("2026-10-16", 80);
  const trend = researchCardTrend({ addedSnapshot: null, firstValidSnapshot: null },
    { latest, history: [snapshot("2026-10-15", 78), latest] });
  assert.equal(trend.status, "missing-initial");
  assert.equal(trend.delta, undefined);
  assert.match(trend.reason, /收藏基準未知/);
});

test("different score settings and same-day join do not claim a score change", () => {
  const initial = snapshot("2026-10-15", 70);
  const changedSettings = snapshot("2026-10-16", 80, { configId: "new-settings" });
  assert.equal(researchCardTrend({ addedSnapshot: initial }, { latest: changedSettings }).status, "incompatible");
  assert.equal(researchCardTrend({ addedSnapshot: initial }, { latest: initial }).status, "same-snapshot");
});
