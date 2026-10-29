import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/t86-db.js";
import { ResearchSnapshotRepository } from "../cloudflare/repositories/research-snapshot-repository.js";
import { MarketSummaryService } from "../cloudflare/services/market-summary-service.js";
import { researchConfigId } from "../shared/research-tracking.js";
import { shardOf } from "../shared/market-codec.js";

test("shared daily research snapshots are idempotent, revisioned and query only requested symbols", async () => {
  const db = testDatabase();
  db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0005_research_snapshots.sql", import.meta.url), "utf8"));
  const repo = new ResearchSnapshotRepository(db);
  const template = { modelVersion: "entry-score-v1.2", configId: "swing-trend:kd-9-3-3", capturedAt: "2026-10-16T10:00:00Z" };
  const first = { ...template, asOf: "2026-10-16", revisionId: "generation-1", snapshots: [
    { id: "a", symbol: "2330", asOf: "2026-10-16", finalScore: 61.234567, valid: true },
    { id: "b", symbol: "2454", asOf: "2026-10-16", finalScore: null, valid: false },
  ] };
  assert.equal(await repo.save(first), true);
  assert.equal(await repo.save(first), false);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM entry_score_snapshot_revisions").get().n, 1);
  assert.equal((await repo.latest("2026-10-16", template.configId, ["2330"])).snapshots.get("2330").finalScore, 61.234567);
  assert.deepEqual((await repo.history(["2026-10-15", "2026-10-16"], template.configId, ["2454"])).get("2454").map((x) => x.asOf), ["2026-10-16"]);
  await repo.save({ ...first, revisionId: "generation-2", capturedAt: "2026-10-16T11:00:00Z",
    snapshots: [{ ...first.snapshots[0], id: "c", finalScore: 63.5 }] });
  const latest = await repo.latest("2026-10-16", template.configId, ["2330"]);
  assert.equal(latest.revision.id, "generation-2");
  assert.equal(latest.snapshots.get("2330").finalScore, 63.5);
  assert.equal((await repo.revisions("2026-10-16", template.configId)).length, 2);
  db.sqlite.close();
});

test("50-symbol research reads latest and previous history in two queries without old revision payloads", async () => {
  const db = testDatabase();
  try {
    db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0005_research_snapshots.sql", import.meta.url), "utf8"));
    const repo = new ResearchSnapshotRepository(db);
    const settings = { period: 9, kSmooth: 3, dSmooth: 3 }, configId = researchConfigId(settings);
    const dates = Array.from({ length: 30 }, (_, index) =>
      new Date(Date.UTC(2026, 8, index + 1)).toISOString().slice(0, 10));
    const symbols = Array.from({ length: 50 }, (_, index) => String(2300 + index));
    assert.ok(new Set(symbols.map(shardOf)).size > 20);
    for (const asOf of dates) {
      const template = { asOf, modelVersion: "entry-score-v1.2", configId,
        snapshots: symbols.map((symbol) => ({ symbol, asOf, valid: false })) };
      await repo.save({ ...template, revisionId: "old", capturedAt: `${asOf}T10:00:00Z` });
      await repo.save({ ...template, revisionId: "new", capturedAt: `${asOf}T11:00:00Z`,
        snapshots: template.snapshots.map((row) => ({ ...row, id: `${row.symbol}:${asOf}:new` })) });
    }
    // An obsolete payload with an incompatible shape must never be decoded.
    db.sqlite.exec("UPDATE entry_score_snapshot_shards SET Payload='{}' WHERE RevisionId='old'");
    let queries = 0;
    db.beforeStatement = () => { queries++; };
    const summary = new MarketSummaryService({ market: async () => ({ asOf: dates.at(-1), dates,
      stocks: symbols.map((symbol) => ({ symbol })) }) }, null, repo);
    const response = await summary.research(symbols, dates.at(-1), settings);
    assert.equal(queries, 2);
    assert.equal(response.data.length, 50);
    assert.equal(response.meta.latestRevision.id, "new");
    assert.equal(response.meta.previousRevision.id, "new");
    for (const row of response.data) {
      assert.equal(row.latest.id, `${row.symbol}:${dates.at(-1)}:new`);
      assert.equal(row.previous.id, `${row.symbol}:${dates.at(-2)}:new`);
      assert.deepEqual(row.history.map((snapshot) => snapshot.asOf), dates);
    }
    db.beforeStatement = null;
    db.sqlite.prepare("DELETE FROM entry_score_snapshot_shards WHERE TradingDate=? AND RevisionId='new' AND ShardIndex=?")
      .run(dates.at(-1), shardOf(symbols[0]));
    await assert.rejects(repo.sessions(dates, configId, symbols), /Published research snapshot shard missing/);
  } finally { db.sqlite.close(); }
});
