import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/t86-db.js";
import { ResearchSnapshotRepository } from "../cloudflare/repositories/research-snapshot-repository.js";

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
