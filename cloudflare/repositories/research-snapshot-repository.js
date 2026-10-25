import { shardOf, SHARD_COUNT } from "../../shared/market-codec.js";

export class ResearchSnapshotRepository {
  constructor(db) { this.db = db.withSession ? db.withSession("first-primary") : db; }

  async save({ asOf, modelVersion, configId, revisionId, capturedAt, snapshots }) {
    const exists = await this.db.prepare(`SELECT 1 FROM entry_score_snapshot_revisions
      WHERE TradingDate=? AND ModelVersion=? AND ConfigId=? AND RevisionId=?`)
      .bind(asOf, modelVersion, configId, revisionId).first();
    if (exists) return false;
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
    const revision = await this.db.prepare(`SELECT ModelVersion,RevisionId,CapturedAt,StockCount
      FROM entry_score_snapshot_revisions WHERE TradingDate=? AND ConfigId=?
      ORDER BY CapturedAt DESC, RevisionId DESC LIMIT 1`).bind(asOf, configId).first();
    if (!revision) return { revision: null, snapshots: new Map() };
    const indices = [...new Set(symbols.map(shardOf))];
    const snapshots = new Map();
    for (const index of indices) {
      const row = await this.db.prepare(`SELECT Payload FROM entry_score_snapshot_shards
        WHERE TradingDate=? AND ModelVersion=? AND ConfigId=? AND RevisionId=? AND ShardIndex=?`)
        .bind(asOf, revision.ModelVersion, configId, revision.RevisionId, index).first();
      if (!row) throw new Error("Published research snapshot shard missing");
      for (const snapshot of JSON.parse(row.Payload))
        if (symbols.includes(snapshot.symbol)) snapshots.set(snapshot.symbol, snapshot);
    }
    return { revision: { id: revision.RevisionId, capturedAt: revision.CapturedAt,
      modelVersion: revision.ModelVersion, stockCount: revision.StockCount }, snapshots };
  }

  async history(dates, configId, symbols) {
    if (!dates.length || !symbols.length) return new Map();
    const indices = [...new Set(symbols.map(shardOf))];
    const placeholders = dates.map(() => "?").join(",");
    const result = new Map(symbols.map((symbol) => [symbol, []]));
    for (const index of indices) {
      const rows = await this.db.prepare(`SELECT s.TradingDate,s.Payload,r.CapturedAt,r.RevisionId
        FROM entry_score_snapshot_shards s JOIN entry_score_snapshot_revisions r
        ON r.TradingDate=s.TradingDate AND r.ModelVersion=s.ModelVersion
        AND r.ConfigId=s.ConfigId AND r.RevisionId=s.RevisionId
        WHERE s.TradingDate IN (${placeholders}) AND s.ConfigId=? AND s.ShardIndex=?
        ORDER BY s.TradingDate DESC,r.CapturedAt DESC,r.RevisionId DESC`)
        .bind(...dates, configId, index).all();
      const selectedDates = new Set();
      for (const row of rows.results ?? []) {
        if (selectedDates.has(row.TradingDate)) continue;
        selectedDates.add(row.TradingDate);
        for (const snapshot of JSON.parse(row.Payload))
          if (result.has(snapshot.symbol)) result.get(snapshot.symbol).push(snapshot);
      }
    }
    return result;
  }

  async revisions(asOf, configId) {
    const rows = await this.db.prepare(`SELECT ModelVersion,RevisionId,CapturedAt FROM entry_score_snapshot_revisions
      WHERE TradingDate=? AND ConfigId=? ORDER BY CapturedAt DESC,RevisionId DESC LIMIT 10`)
      .bind(asOf, configId).all();
    return rows.results ?? [];
  }
}
