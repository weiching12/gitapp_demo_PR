import test from "node:test";
import assert from "node:assert/strict";
import { resolveApiRoute } from "../cloudflare/api/routes.js";
import { marketController } from "../cloudflare/api/market-controller.js";
import { MarketSummaryService } from "../cloudflare/services/market-summary-service.js";
import { researchConfigId } from "../shared/research-tracking.js";

const settings = { period: 9, kSmooth: 3, dSmooth: 3 };
const asOf = "2026-10-16", previousDate = "2026-10-15";
const dates = Array.from({ length: 31 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`)
  .slice(0, 29).concat(previousDate, asOf);
const snapshot = (date, score) => ({ id: `${date}:2330`, symbol: "2330", asOf: date,
  modelVersion: "entry-score-v1.2", strategy: "swing-trend", configId: researchConfigId(settings),
  priceBasis: "unadjusted", valid: true, baseScore: score, finalScore: score,
  passedCount: 5, totalConditions: 5, cap: { enabled: false },
  categories: Object.fromEntries(["trend", "momentum", "priceVolume", "institutional", "entryRisk"].map((key) => [key, { score: 80 }])),
  conditions: Object.fromEntries(["trend", "momentum", "priceVolume", "institutional", "entryRisk"].map((key) => [key, { status: "PASS" }])) });

test("versioned research route is read-only and preserves the old favorites summary route", () => {
  assert.equal(resolveApiRoute("/api/v1/favorites/research").name, "favoriteResearch");
  assert.deepEqual(resolveApiRoute("/api/v1/favorites/research").methods, ["GET", "HEAD"]);
  assert.equal(resolveApiRoute("/api/v1/favorites/summary").name, "favoriteSummary");
});

test("research response compares only exact previous session and has no private notes", async () => {
  const calls = [];
  const market = { market: async () => ({ asOf, dates, stocks: [{ symbol: "2330" }] }) };
  const research = { latest: async (date, config, symbols) => {
    calls.push([date, config, symbols]);
    return { revision: { id: date }, snapshots: new Map([["2330", snapshot(date, date === asOf ? 72 : 60)]]) };
  }, history: async () => new Map([["2330", [snapshot(previousDate, 60), snapshot(asOf, 72)]]]),
  revisions: async () => [{ RevisionId: "r1" }] };
  const summary = new MarketSummaryService(market, null, research);
  const url = new URL(`https://example.test/api/v1/favorites/research?symbols=2330&asOf=${asOf}`);
  const response = await marketController(resolveApiRoute(url.pathname), url, { summary });
  assert.equal(response.data[0].comparison.finalDelta, 12);
  assert.equal(response.data[0].comparison.events.some((event) => event.type === "final-score-change"), true);
  assert.equal(response.data[0].history.length, 30);
  assert.equal(response.data[0].history[0].valid, false);
  assert.equal(JSON.stringify(response).includes("privateNote"), false);
  assert.deepEqual(calls.map((item) => item[0]), [asOf, previousDate]);
  await assert.rejects(summary.research(Array.from({ length: 51 }, (_, index) => String(index).padStart(4, "0")), asOf, settings),
    /自選股票代號無效/);
});
