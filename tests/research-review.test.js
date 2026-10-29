import test from "node:test";
import assert from "node:assert/strict";
import { priceBaseline, reviewEventTimeline, reviewInitialScore, reviewMilestones, reviewPriceStatus } from "../shared/research-review.js";
import { addResearchPeriod, loadResearchStore, removeResearchPeriod, recordFirstValidPriceBaseline } from "../src/ui/research-store.js";
import { HistoryService } from "../cloudflare/services/history-service.js";

const dates = ["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09",
  "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19",
  "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27",
  "2026-10-28", "2026-10-29", "2026-10-30"];
const review = (overrides = {}) => ({ dates, bars: dates.map((date, index) => ({ date, close: 100 + index })),
  priceBasis: "unadjusted", corporateActions: { coveredDates: dates.slice(1), events: [] }, ...overrides });
const baseline = priceBaseline({ close: 100 }, { asOf: dates[0], capturedAt: "2026-10-03T00:00:00Z",
  source: "verified-summary", revisionId: "gen-a" });

test("joining before and after close or on a weekend uses only the latest validated data already available", () => {
  for (const joinedAt of ["2026-10-02T04:00:00Z", "2026-10-02T08:00:00Z", "2026-10-04T08:00:00Z"]) {
    const known = joinedAt < "2026-10-02T08:00:00Z" ? "2026-10-01" : "2026-10-02";
    const price = priceBaseline({ close: 100 }, { asOf: known, capturedAt: joinedAt, source: "verified-summary" });
    assert.equal(price.asOf, known);
  }
  assert.equal(priceBaseline({ close: null }, { asOf: dates[0] }), null);
  assert.equal(priceBaseline({ close: 0 }, { asOf: dates[0] }), null);
});

test("5, 10 and 20 count market sessions; weekends and holidays do not shift observation dates", () => {
  const period = { baseline };
  const result = reviewMilestones(period, review());
  assert.equal(result.milestones[5].date, "2026-10-09");
  assert.equal(result.milestones[10].date, "2026-10-16");
  assert.equal(result.milestones[20].date, "2026-10-30");
  assert.ok(Math.abs(result.milestones[5].change - .05) < 1e-12);
  assert.equal(result.milestones[5].index, 105);
  assert.ok(Math.abs(result.latest.change - .2) < 1e-12);
});

test("pending, suspended, missing and outside coverage are distinct; no later row fills an absent day", () => {
  const short = review({ dates: dates.slice(0, 6), bars: review().bars.slice(0, 6) });
  assert.equal(reviewMilestones({ baseline }, short).milestones[10].status, "pending");
  const missing = review({ bars: review().bars.filter((bar) => bar.date !== dates[5]) });
  assert.equal(reviewMilestones({ baseline }, missing).milestones[5].status, "missing-price");
  assert.equal(reviewMilestones({ baseline }, review({ dates: dates.slice(2), bars: review().bars.slice(2) })).milestones[5].status, "outside-coverage");
});

test("corporate actions, incomplete verification and incompatible price bases suppress comparable changes", () => {
  assert.equal(reviewPriceStatus(baseline, dates[5], review({ corporateActions: { coveredDates: dates.slice(1, 5), events: [] } })).status, "action-unverified");
  assert.equal(reviewPriceStatus(baseline, dates[5], review({ corporateActions: { coveredDates: dates.slice(1), events: [{ date: dates[4], kind: "息" }] } })).status, "action-affected");
  assert.equal(reviewPriceStatus(baseline, dates[5], review({ priceBasis: "adjusted" })).status, "incompatible");
  assert.equal(reviewPriceStatus(baseline, dates[5], review({ bars: review().bars.map((bar) => ({ ...bar, close: bar.date === dates[5] ? 0 : bar.close })) })).status, "missing-price");
});

test("legacy and rejoined periods never backfill an original join price", () => {
  const store = loadResearchStore(null, ["2330"], "2026-10-25T00:00:00Z");
  const legacy = store.periods[0];
  assert.equal(legacy.baseline, null);
  recordFirstValidPriceBaseline(store, "2330", baseline);
  assert.equal(legacy.firstValidPriceBaseline.asOf, baseline.asOf);
  assert.equal(legacy.baseline, null);
  removeResearchPeriod(store, "2330", "2026-10-25T01:00:00Z");
  const newer = addResearchPeriod(store, { symbol: "2330", baseline: priceBaseline({ close: 120 }, { asOf: dates.at(-1) }) }, "2026-10-25T02:00:00Z");
  assert.equal(newer.baseline.close, 120);
  assert.equal(newer.firstValidPriceBaseline, null);
  assert.equal(store.periods.length, 2);
});

test("initial score requires identical model, weights and price basis; historical recalculation never replaces original", () => {
  const initial = { id: "saved", asOf: dates[0], valid: true, modelVersion: "v1", strategy: "swing",
    configId: "a", priceBasis: "unadjusted", baseScore: 50, finalScore: 40,
    categories: {}, conditions: {}, passedCount: 0, totalConditions: 5, cap: {} };
  const current = { ...initial, id: "recalc", asOf: dates[1], finalScore: 60, configId: "b" };
  const period = { addedSnapshot: initial };
  assert.equal(reviewInitialScore(period, current).status, "incompatible");
  assert.equal(period.addedSnapshot.id, "saved");
});

test("a missing session yields an observed-after-gap event instead of an exact transition day", () => {
  const base = { id: "a", asOf: dates[0], symbol: "2330", valid: true, modelVersion: "v1", strategy: "swing",
    configId: "a", priceBasis: "unadjusted", baseScore: 60, finalScore: 60,
    categories: Object.fromEntries(["trend", "momentum", "priceVolume", "institutional", "entryRisk"].map((key) => [key, { score: 60 }])),
    conditions: Object.fromEntries(["trend", "momentum", "priceVolume", "institutional", "entryRisk"].map((key) => [key, { status: "PASS" }])),
    passedCount: 4, totalConditions: 5, cap: {} };
  const history = [base, { asOf: dates[1], valid: false }, { ...base, id: "c", asOf: dates[2], passedCount: 5 }];
  const timeline = reviewEventTimeline(history, dates);
  assert.equal(timeline[0].type, "observed-after-gap");
  assert.match(timeline[0].reason, /前期資料不足/);
});

test("review API is read-only, one symbol, and bounded to 120 actual market dates", async () => {
  const allDates = Array.from({ length: 130 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
  const service = new HistoryService({ stock: async () => ({ source: "twse", asOf: allDates.at(-1), updatedAt: "t",
    stock: { tradingDates: allDates, history: allDates.map((date) => ({ date, close: 100 })) } }) },
  { window: async (sessions) => ({ coveredDates: new Set(sessions), eventsBySymbol: new Map() }), revision: async () => "r1" });
  const response = await service.review("2330");
  assert.equal(response.data.dates.length, 120);
  assert.equal(response.data.bars.length, 120);
  assert.equal(response.data.corporateActions.coveredDates.length, 119);
});
