import { shardOf, SHARD_COUNT } from "../../shared/market-codec.js";

export class ResearchSnapshotRepository {
  constructor(db) { this.db = db.withSession ? db.withSession("first-primary") : db; }

  async hasRevision({ asOf, modelVersion, configId, revisionId }) {
    const exists = await this.db.prepare(`SELECT 1 FROM entry_score_snapshot_revisions
      WHERE TradingDate=? AND ModelVersion=? AND ConfigId=? AND RevisionId=?`)
      .bind(asOf, modelVersion, configId, revisionId).first();
    return Boolean(exists);
  }

  async save({ asOf, modelVersion, configId, revisionId, capturedAt, snapshots }) {
    if (await this.hasRevision({ asOf, modelVersion, configId, revisionId })) return false;
    const shards = Array.from({ length: SHARD_COUNT }, () => []);
    for (const snapshot of snapshots) shards[shardOf(snapshot.symbol)].push(snapshot);
    const statements = shards.map((rows, index) => this.db.prepare(`INSERT OR IGNORE INTO entry_score_snapshot_shards
      (TradingDate,ModelVersion,ConfigId,RevisionId,ShardIndex,Payload) VALUES(?,?,?,?,?,?)`)
      .bind(asOf, modelVersion, configId, revisionId, index, JSON.stringify(rows)));
    statements.push(this.db.prepare(`INSERT OR IGNORE INTO entry_score_snapshot_revisions
      (TradingDate,ModelVersion,ConfigId,RevisionId,CapturedAt,StockCount) VALUES(?,?,?,?,?,?)`)
      .bind(asOf, modelVersion, configId, revisionId, capturedAt, snapshots.length));
    await this.db.batch(statements);
    return true;
  }

  async latest(asOf, configId, symbols) {
    return (await this.sessions([asOf], configId, symbols)).get(asOf) ??
      { revision: null, snapshots: new Map() };
  }

  // Read each day's latest published revision once for the entire symbol set.
  // JSON arrays keep the query below D1's bound-parameter limit for 120 dates/50 symbols.
  async sessions(dates, configId, symbols) {
    const sessions = new Map();
    if (!dates.length || !symbols.length) return sessions;
    const wanted = new Set(symbols);
    const indices = [...new Set(symbols.map(shardOf))];
    const rows = await this.db.prepare(`WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY TradingDate ORDER BY CapturedAt DESC,RevisionId DESC) AS Rank
      FROM entry_score_snapshot_revisions WHERE TradingDate IN (SELECT value FROM json_each(?)) AND ConfigId=?
    ) SELECT r.TradingDate,r.ModelVersion,r.RevisionId,r.CapturedAt,r.StockCount,
      CASE WHEN s.Payload IS NULL THEN NULL ELSE (
        SELECT json_group_array(json(value)) FROM json_each(s.Payload)
        WHERE json_extract(value,'$.symbol') IN (SELECT value FROM json_each(?))
      ) END AS Payload
      FROM ranked r CROSS JOIN json_each(?) requested
      LEFT JOIN entry_score_snapshot_shards s ON s.TradingDate=r.TradingDate AND s.ModelVersion=r.ModelVersion
      AND s.ConfigId=r.ConfigId AND s.RevisionId=r.RevisionId AND s.ShardIndex=requested.value
      WHERE r.Rank=1 ORDER BY r.TradingDate DESC`)
      .bind(JSON.stringify(dates), configId, JSON.stringify(symbols), JSON.stringify(indices)).all();
    for (const row of rows.results ?? []) {
      if (row.Payload == null) throw new Error("Published research snapshot shard missing");
      if (!sessions.has(row.TradingDate)) sessions.set(row.TradingDate, {
        revision: { id: row.RevisionId, capturedAt: row.CapturedAt,
          modelVersion: row.ModelVersion, stockCount: row.StockCount }, snapshots: new Map(),
      });
      const { snapshots } = sessions.get(row.TradingDate);
      for (const snapshot of JSON.parse(row.Payload))
        if (wanted.has(snapshot.symbol)) snapshots.set(snapshot.symbol, snapshot);
    }
    return sessions;
  }

  async history(dates, configId, symbols) {
    if (!dates.length || !symbols.length) return new Map();
    const result = new Map(symbols.map((symbol) => [symbol, []]));
    for (const { snapshots } of (await this.sessions(dates, configId, symbols)).values())
      for (const [symbol, snapshot] of snapshots) result.get(symbol).push(snapshot);
    return result;
  }

  async revisions(asOf, configId) {
    const rows = await this.db.prepare(`SELECT ModelVersion,RevisionId,CapturedAt FROM entry_score_snapshot_revisions
      WHERE TradingDate=? AND ConfigId=? ORDER BY CapturedAt DESC,RevisionId DESC LIMIT 10`)
      .bind(asOf, configId).all();
    return rows.results ?? [];
  }
}
