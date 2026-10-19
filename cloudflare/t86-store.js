import { T86_QUERY } from "./t86-validator.js";
const chunked = (raw) => typeof raw === "string" && raw.length > 262144;

export class T86Store {
  constructor(db) {
    if (!db) throw new Error("T86_DB binding is required; refusing unprotected ingestion");
    // Read the primary, including when D1 read replication is enabled.
    this.db = db.withSession ? db.withSession("first-primary") : db;
  }
  statement(sql, ...values) { return this.db.prepare(sql).bind(...values); }
  async context(date, queryKey = T86_QUERY) {
    const history = await this.statement(`SELECT v.RecordCount FROM t86_heads h JOIN t86_versions v USING(VersionId)
      WHERE h.QueryKey = ? AND h.TradeDate < ? ORDER BY h.TradeDate DESC LIMIT 5`, queryKey, date).all();
    const early = await this.statement(`SELECT RecordCount FROM t86_sync_runs
      WHERE QueryKey = ? AND TradeDate = ? AND Slot = '18:30' AND Status IN ('Success','Unchanged')
      ORDER BY SyncTime DESC LIMIT 1`, queryKey, date).first();
    const current = await this.current(date, queryKey);
    return { recentCounts: history.results.map((r) => r.RecordCount), earlyCount: early?.RecordCount ?? null, current };
  }
  async current(date, queryKey = T86_QUERY) {
    return this.statement(`SELECT v.*, h.SyncTime AS HeadSyncTime FROM t86_heads h
      JOIN t86_versions v USING(VersionId) WHERE h.QueryKey = ? AND h.TradeDate = ?`, queryKey, date).first();
  }
  async approved(date, hash, queryKey = T86_QUERY) {
    return !!await this.statement(`SELECT 1 FROM t86_baseline_approvals WHERE QueryKey = ? AND TradeDate = ? AND DataHash = ?`,
      queryKey, date, hash).first();
  }
  async getRun(id) {
    return this.statement("SELECT * FROM t86_sync_runs WHERE RunId=?", id).first();
  }
  async expireRun(run) {
    // Race the original transaction atomically. If it already completed, its
    // terminal result and raw evidence remain unchanged.
    await this.statement(`UPDATE t86_sync_runs SET Status='Failed',VersionId=NULL,
      ValidationResult=?,ErrorMessage=? WHERE RunId=? AND Status='Running'`,
    JSON.stringify(run.ValidationResult), run.ErrorMessage, run.RunId).run();
    return this.getRun(run.RunId);
  }
  logStatement(run) {
    const names = ["RunId", "TradeDate", "SyncTime", "Source", "QueryKey", "Slot", "RecordCount", "DataHash", "Status",
      "ValidationResult", "ErrorMessage", "RawJson", "HttpStatus", "VersionId"];
    return this.statement(`INSERT INTO t86_sync_runs (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})
      ON CONFLICT(RunId) DO UPDATE SET ${names.slice(1).map((n) => `${n}=excluded.${n}`).join(",")}
      WHERE t86_sync_runs.Status='Running'`,
    ...names.map((n) => n === "ValidationResult" ? JSON.stringify(run[n]) : n === "RawJson" && chunked(run[n]) ? null : run[n] ?? null));
  }
  async log(run) {
    if (!chunked(run.RawJson)) return this.logStatement(run).run();
    // Keep the header Running until all chunks are saved. This also allows a
    // final Failed log to retain raw evidence when an earlier raw-log batch
    // failed. Existing terminal runs remain protected by every statement.
    const statements = [this.logStatement({ ...run, Status: "Running" }), this.statement(`DELETE FROM t86_raw_chunks WHERE RunId=?
      AND EXISTS(SELECT 1 FROM t86_sync_runs WHERE RunId=? AND Status='Running')`, run.RunId, run.RunId)];
    let start = 0, part = 0;
    while (start < run.RawJson.length) {
      let end = Math.min(start + 65536, run.RawJson.length);
      // Do not split a Unicode surrogate pair between database strings.
      if (end < run.RawJson.length && /[\uD800-\uDBFF]/.test(run.RawJson[end - 1])) end--;
      statements.push(this.statement(`INSERT INTO t86_raw_chunks SELECT ?,?,? WHERE EXISTS
        (SELECT 1 FROM t86_sync_runs WHERE RunId=? AND Status='Running')`,
      run.RunId, part++, run.RawJson.slice(start, end), run.RunId));
      start = end;
    }
    if (run.Status !== "Running") statements.push(this.logStatement(run));
    await this.db.batch(statements);
  }
  async raw(run) {
    if (run.RawJson !== null) return run.RawJson;
    const chunks = await this.statement("SELECT Body FROM t86_raw_chunks WHERE RunId=? ORDER BY Part", run.RunId).all();
    return chunks.results.length ? chunks.results.map((r) => r.Body).join("") : null;
  }
  async scheduledRun(date, slot, queryKey = T86_QUERY) {
    return this.statement(`SELECT * FROM t86_sync_runs WHERE QueryKey = ? AND TradeDate = ? AND Slot = ?
      ORDER BY SyncTime DESC LIMIT 1`, queryKey, date, slot).first();
  }
  async commit(run, rows, previous) {
    const { RunId: id, QueryKey: key, TradeDate: date, SyncTime: time } = run;
    // Optimistic concurrency: a stale invocation cannot overwrite a newer round.
    // This guard is checked inside the same transaction as the data writes.
    const guard = this.statement(`INSERT INTO t86_commit_guard VALUES (?, CASE WHEN
      EXISTS(SELECT 1 FROM t86_sync_runs WHERE RunId=? AND Status='Running') AND
      COALESCE((SELECT VersionId FROM t86_heads WHERE QueryKey=? AND TradeDate=?),'') = ? AND
      COALESCE((SELECT SyncTime FROM t86_heads WHERE QueryKey=? AND TradeDate=?),'') <= ? THEN 1 ELSE 0 END)`,
    id, id, key, date, previous?.VersionId ?? "", key, date, time);
    const head = this.statement(`INSERT INTO t86_heads VALUES(?,?,?,?)
      ON CONFLICT(QueryKey,TradeDate) DO UPDATE SET VersionId=excluded.VersionId,SyncTime=excluded.SyncTime`,
    key, date, run.VersionId, time);
    const statements = [guard];
    if (run.Status === "Success") {
      const json = JSON.stringify(rows);
      statements.push(
        this.statement(`INSERT INTO t86_staging SELECT ?, json_extract(value,'$[0]'), json_extract(value,'$[1]'),
          value, json_extract(value,'$[18]') FROM json_each(?)`, id, json),
        this.statement(`INSERT INTO t86_versions VALUES(?,?,?,?,?,?,?,?)`, run.VersionId, key, date, time,
          run.DataHash, rows.length, json, id),
        this.statement(`INSERT INTO t86_daily SELECT ?,?,Symbol,Name,ValuesJson,OfficialTotal,? FROM t86_staging WHERE RunId=?
          ON CONFLICT(QueryKey,TradeDate,Symbol) DO UPDATE SET Name=excluded.Name,ValuesJson=excluded.ValuesJson,
          OfficialTotal=excluded.OfficialTotal,VersionId=excluded.VersionId`, key, date, run.VersionId, id),
        this.statement(`DELETE FROM t86_daily WHERE QueryKey=? AND TradeDate=? AND Symbol NOT IN
          (SELECT Symbol FROM t86_staging WHERE RunId=?)`, key, date, id),
        this.statement("DELETE FROM t86_staging WHERE RunId=?", id),
      );
    }
    statements.push(head, this.logStatement(run), this.statement("DELETE FROM t86_commit_guard WHERE RunId=?", id));
    // D1 batch is a transaction: any statement failure rolls every statement back.
    await this.db.batch(statements);
  }
}
