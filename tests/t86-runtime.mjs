// Real workerd/D1 integration, isolated from production and persistent local data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import wrangler from "wrangler";
import { T86Store } from "../cloudflare/t86-store.js";
import { syncT86 } from "../cloudflare/t86-sync.js";
const proxy = await wrangler.getPlatformProxy({ persist: false, remoteBindings: false });
try {
  const db = proxy.env.T86_DB, store = new T86Store(db);
  const sql = await readFile(new URL("../cloudflare/migrations/0001_t86.sql", import.meta.url), "utf8");
  await db.batch(wrangler.unstable_splitSqlQuery(sql).map((statement) => db.prepare(statement)));
  const chunksSql = await readFile(new URL("../cloudflare/migrations/0002_t86_raw_chunks.sql", import.meta.url), "utf8");
  await db.batch(wrangler.unstable_splitSqlQuery(chunksSql).map((statement) => db.prepare(statement)));
  const fixture = JSON.parse(await readFile(new URL("./fixtures/twse-20261016.json", import.meta.url), "utf8"));
  const body = { ...fixture.flows, data: Array.from({ length: 1000 }, (_, i) => [String(1000 + i), ...fixture.flows.data[0].slice(1)]) };
  for (const date of ["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]) {
    const rawJson = JSON.stringify({ ...body, date: date.replaceAll("-", "") });
    let run = await syncT86(proxy.env, { tradeDate: date, rawJson, httpStatus: 200, store });
    if (run.Status === "PendingConfirmation") {
      assert.equal(await store.current(date), null);
      await store.statement("INSERT INTO t86_baseline_approvals VALUES(?,?,?,?,?)", run.QueryKey, date,
        run.DataHash, "isolated-runtime-test", new Date().toISOString()).run();
      run = await syncT86(proxy.env, { tradeDate: date, rawJson, httpStatus: 200, store });
    }
    assert.equal(run.Status, "Success", run.ErrorMessage);
  }
  const date = "2026-10-16", rawJson = JSON.stringify({ ...body, date: "20261016" });
  const early = await syncT86(proxy.env, { tradeDate: date, slot: "18:30", rawJson, httpStatus: 200,
    now: new Date("2026-10-16T10:30:00Z"), store });
  assert.equal(early.Status, "Success", early.ErrorMessage);
  const identical = await syncT86(proxy.env, { tradeDate: date, slot: "20:30", rawJson, httpStatus: 200,
    now: new Date("2026-10-16T12:30:00Z"), store });
  assert.equal(identical.Status, "Unchanged", identical.ErrorMessage);
  assert.equal(identical.VersionId, early.VersionId);
  // Abort after records have been upserted: real D1 must roll everything back.
  await db.prepare(`CREATE TRIGGER t86_test_abort BEFORE UPDATE ON t86_heads
    WHEN NEW.TradeDate='2026-10-16' BEGIN SELECT RAISE(ABORT,'injected transaction failure'); END`).run();
  const changed = JSON.stringify({ ...body, date: "20261016", data: body.data.slice(0, 950) });
  const failed = await syncT86(proxy.env, { tradeDate: date, rawJson: changed, httpStatus: 200,
    now: new Date("2026-10-16T13:00:00Z"), store });
  assert.equal(failed.Status, "Failed");
  assert.equal((await store.current(date)).VersionId, early.VersionId);
  assert.equal((await db.prepare("SELECT count(*) n FROM t86_daily WHERE TradeDate=?").bind(date).first()).n, 1000);
  assert.equal((await db.prepare("SELECT count(*) n FROM t86_versions WHERE TradeDate=?").bind(date).first()).n, 1);
  assert.equal((await db.prepare("SELECT count(*) n FROM t86_staging").first()).n, 0);
  assert.equal((await store.statement("SELECT RawJson FROM t86_sync_runs WHERE RunId=?", failed.RunId).first()).RawJson, changed);
  const oversized = "錯誤😀".repeat(200000);
  const large = await syncT86(proxy.env, { tradeDate: date, rawJson: oversized, httpStatus: 500, store });
  assert.equal(large.Status, "Failed");
  assert.equal(await store.raw(await store.statement("SELECT * FROM t86_sync_runs WHERE RunId=?", large.RunId).first()), oversized);
  console.log("D1 runtime PASS: 1,000 securities; exact-hash bootstrap, five-day baseline, Unchanged, transactional rollback, oversized Unicode failure evidence");
} finally { await proxy.dispose(); }
