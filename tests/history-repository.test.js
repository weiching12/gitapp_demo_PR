import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/t86-db.js";
import { HistoryRepository } from "../cloudflare/repositories/history-repository.js";

test("D1 history requires all shards, preserves exact history and rejects mutations", async () => {
  const db = testDatabase();
  db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0003_market_history.sql", import.meta.url), "utf8"));
  const repository = new HistoryRepository(db);
  const manifest = { generation: "baseline", updatedAt: "2026-10-21T00:00:00Z" };
  try {
    await assert.rejects(repository.commit(manifest), /incomplete/);
    for (let index = 0; index < 128; index++) await repository.saveShard({ generation: "baseline", index,
      stocks: [{ symbol: String(1000 + index), history: [["2026-10-20", 100, 110, 90, 105, 1000, null, null, 0, 0, 0, 0]] }] });
    await repository.commit(manifest); await repository.commit(manifest);
    assert.deepEqual(await repository.manifest("baseline"), manifest);
    const shard = await repository.shard("baseline", 0);
    assert.equal(shard.stocks[0].history[0][6], null);
    await repository.saveShard(shard);
    await assert.rejects(repository.saveShard({ ...shard, stocks: [] }), /conflict/);
    await assert.rejects(repository.commit({ ...manifest, updatedAt: "changed" }), /conflict/);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM market_history_shards").get().n, 128);
  } finally { db.sqlite.close(); }
});
