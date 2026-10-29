import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/t86-db.js";
import { captureLatestResearch } from "../cloudflare/research-capture.js";
import { MarketSyncCoordinator, coordinateResearchCapture } from "../cloudflare/sync/coordinator.js";
import { runScheduled } from "../cloudflare/worker.js";
import { ResearchSnapshotRepository } from "../cloudflare/repositories/research-snapshot-repository.js";
import { MarketSummaryService } from "../cloudflare/services/market-summary-service.js";
import { ENTRY_MODEL_VERSION } from "../shared/entry-score.js";
import { DEFAULT_SETTINGS } from "../shared/indicators.js";
import { researchConfigId } from "../shared/research-tracking.js";
import { MANIFEST_KEY, shardKey } from "../cloudflare/storage/market-keys.js";
import { SHARD_COUNT, shardOf } from "../shared/market-codec.js";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const captureRequest = () => new Request("https://internal/capture-research", { method: "POST" });
function coordinatorFixture(env = {}) {
  const data = new Map(), remote = new Map();
  const storage = { get: async key => structuredClone(data.get(key)),
    put: async (key, value) => data.set(key, structuredClone(value)), delete: async key => data.delete(key) };
  const kv = { get: async (key, type) => type === "json" ? structuredClone(remote.get(key) ?? null)
    : remote.has(key) ? JSON.stringify(remote.get(key)) : null,
  put: async (key, value) => remote.set(key, JSON.parse(value)), delete: async key => remote.delete(key) };
  env.MARKET_DATA = kv;
  const coordinator = new MarketSyncCoordinator({ storage }, env);
  env.MARKET_SYNC = { getByName: () => coordinator };
  return { data, remote, env, coordinator };
}

test("scheduled capture saves the current authoritative generation without any browser request and skips saved revisions", async () => {
  const db = testDatabase();
  try {
    db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0005_research_snapshots.sql", import.meta.url), "utf8"));
    const f = coordinatorFixture({ T86_DB: db });
    const dates = Array.from({ length: 75 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
    const symbol = "2330", generation = "current";
    const manifest = { generation, asOf: dates.at(-1), dates,
      stocks: [{ symbol, name: "台積電", sector: "半導體", market: "上市", currency: "TWD", listedOn: dates[0] }] };
    f.data.set("manifest", manifest);
    // Public KV may still expose an obsolete head whose shards were reclaimed.
    f.remote.set(MANIFEST_KEY, { ...manifest, generation: "retired" });
    const rows = dates.map((date, i) => {
      const close = 80 + i * .25;
      return [date, close - .4, close + 1, close - 1, close, 100000, 10000, 9000, 10000, 9000, 10000, 9000];
    });
    for (let index = 0; index < SHARD_COUNT; index++)
      f.remote.set(shardKey(generation, index), { generation, index,
        stocks: index === shardOf(symbol) ? [{ symbol, history: rows }] : [] });
    const phase = { phase: "done", generation, date: manifest.asOf, failures: 0 };
    await runScheduled({ scheduledTime: Date.parse("2026-10-21T12:30:00Z") }, f.env, {
      sync: async () => phase, syncActions: async () => ({ status: "complete" }),
    });
    const repo = new ResearchSnapshotRepository(db);
    const key = { asOf: manifest.asOf, modelVersion: ENTRY_MODEL_VERSION,
      configId: researchConfigId(DEFAULT_SETTINGS), revisionId: `${generation}:no-actions` };
    assert.equal(await repo.hasRevision(key), true);
    const saved = (await repo.latest(manifest.asOf, key.configId, [symbol])).snapshots.get(symbol);
    assert.equal(saved.valid, true);
    // No shard reads or score recalculation are needed for the same revision.
    f.remote.clear();
    assert.equal((await coordinateResearchCapture(f.env)).status, "already-saved");
    assert.deepEqual(phase, { phase: "done", generation, date: manifest.asOf, failures: 0 });
    assert.equal(await repo.hasRevision({ ...key, revisionId: "other" }), false);
  } finally { db.sqlite.close(); }
});

test("a failed capture is retried by a later scheduled run without changing publication progress", async () => {
  const f = coordinatorFixture({ T86_DB: {} });
  let attempts = 0, saved = false;
  const services = { market: { market: async () => ({ generation: "current", asOf: "2026-10-21" }) },
    actions: null, research: { hasRevision: async () => saved },
    summary: { summary: async (date, settings, options) => {
      assert.equal(date, undefined); assert.deepEqual(settings, DEFAULT_SETTINGS);
      assert.deepEqual(options, { persistResearch: true });
      attempts++;
      if (attempts === 1) return { meta: { generation: "current", researchCapture: "failed" } };
      saved = true;
      return { meta: { generation: "current", researchCapture: "saved" } };
    } } };
  f.coordinator.capture = env => captureLatestResearch(env, () => services);
  const state = { phase: "done", generation: "current", failures: 0 };
  const options = { sync: async () => state, syncActions: async () => { throw new Error("temporary action failure"); } };
  await runScheduled({ scheduledTime: 0 }, f.env, options);
  assert.equal(saved, false);
  await runScheduled({ scheduledTime: 60000 }, f.env, options);
  assert.equal(saved, true); assert.equal(attempts, 2);
  assert.deepEqual(state, { phase: "done", generation: "current", failures: 0 });
});

test("a delayed public summary cannot publish an old revision after the queued current capture", async () => {
  const db = testDatabase(), entered = deferred(), release = deferred();
  try {
    db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0005_research_snapshots.sql", import.meta.url), "utf8"));
    const dates = Array.from({ length: 75 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
    const symbol = "2330", repo = new ResearchSnapshotRepository(db);
    const rows = dates.map((date, i) => {
      const close = 80 + i * .25;
      return [date, close - .4, close + 1, close - 1, close, 100000, 10000, 9000, 10000, 9000, 10000, 9000];
    });
    const market = generation => ({
      market: async () => ({ generation, asOf: dates.at(-1), dates,
        stocks: [{ symbol, name: "台積電", sector: "半導體", market: "上市", currency: "TWD", listedOn: dates[0] }] }),
      shards: async (_generation, indices) => {
        if (generation === "z-old") { entered.resolve(); await release.promise; }
        return indices.map(index => ({ generation, index,
          stocks: index === shardOf(symbol) ? [{ symbol, history: rows }] : [] }));
      },
    });
    const old = new MarketSummaryService(market("z-old"), null, repo);
    const pendingPublic = old.summary(undefined, DEFAULT_SETTINGS);
    await entered.promise;
    const currentMarket = market("a-new");
    const current = new MarketSummaryService(currentMarket, null, repo);
    const captured = await captureLatestResearch({ T86_DB: db }, () => ({
      market: currentMarket, actions: null, research: repo, summary: current,
    }));
    assert.equal(captured.status, "saved");
    const configId = researchConfigId(DEFAULT_SETTINGS);
    assert.equal((await repo.latest(dates.at(-1), configId, [symbol])).revision.id, "a-new:no-actions");
    // The old request finishes after the newer capture, when its CapturedAt
    // would otherwise sort ahead of the current publication.
    release.resolve();
    const publicResult = await pendingPublic;
    assert.equal(publicResult.meta.generation, "z-old");
    assert.equal(publicResult.meta.researchCapture, "failed");
    const latest = await repo.latest(dates.at(-1), configId, [symbol]);
    assert.equal(latest.revision.id, "a-new:no-actions");
    assert.equal(latest.snapshots.get(symbol).revisionId, "a-new:no-actions");
    assert.deepEqual((await repo.revisions(dates.at(-1), configId)).map(row => row.RevisionId), ["a-new:no-actions"]);
  } finally { release.resolve(); db.sqlite.close(); }
});

test("capture holds the sync queue so publication cannot retire its generation during shard reads", async () => {
  const f = coordinatorFixture(), entered = deferred(), release = deferred();
  f.data.set("manifest", { generation: "current" });
  let nextTickEntered = false;
  f.coordinator.capture = async env => {
    assert.equal((await env.MARKET_DATA.get(MANIFEST_KEY, "json")).generation, "current");
    entered.resolve(); await release.promise;
    assert.equal(nextTickEntered, false);
    return { status: "saved" };
  };
  f.coordinator.run = async () => { nextTickEntered = true; return { phase: "done" }; };
  const capture = f.coordinator.fetch(captureRequest()); await entered.promise;
  const tick = f.coordinator.fetch(new Request("https://internal/tick?time=1792582200000", { method: "POST" }));
  await Promise.resolve(); assert.equal(nextTickEntered, false);
  release.resolve();
  assert.equal((await (await capture).json()).status, "saved");
  await tick; assert.equal(nextTickEntered, true);
});

test("capture exceptions or incomplete summary results remain retryable and unconfigured jobs do not compute", async () => {
  assert.equal((await captureLatestResearch({}, () => { throw new Error("should not run"); })).status, "not-required");
  const create = summary => () => ({ market: { market: async () => ({ generation: "new", asOf: "2026-10-21" }) },
    actions: null, research: { hasRevision: async () => false }, summary });
  for (const summary of [
    { summary: async () => { throw new Error("D1 unavailable"); } },
    { summary: async () => ({ meta: { generation: "new", researchCapture: "not-required" } }) },
    { summary: async () => ({ meta: { generation: "retired", researchCapture: "saved" } }) },
  ]) assert.equal((await captureLatestResearch({ T86_DB: {} }, create(summary))).status, "failed");
  let captured = false;
  await runScheduled({ scheduledTime: 0 }, {}, { sync: async () => ({ phase: "shards" }),
    syncActions: async () => ({ status: "skipped" }), capture: async () => { captured = true; } });
  assert.equal(captured, false);
});
