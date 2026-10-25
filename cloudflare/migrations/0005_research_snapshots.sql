-- Shared score results. Personal watchlist reasons remain on the device.
-- A revision is published only after every shard has been written.
CREATE TABLE IF NOT EXISTS entry_score_snapshot_shards (
  TradingDate TEXT NOT NULL,
  ModelVersion TEXT NOT NULL,
  ConfigId TEXT NOT NULL,
  RevisionId TEXT NOT NULL,
  ShardIndex INTEGER NOT NULL CHECK(ShardIndex >= 0 AND ShardIndex < 128),
  Payload TEXT NOT NULL CHECK(json_valid(Payload)),
  PRIMARY KEY(TradingDate, ModelVersion, ConfigId, RevisionId, ShardIndex)
);
CREATE TABLE IF NOT EXISTS entry_score_snapshot_revisions (
  TradingDate TEXT NOT NULL,
  ModelVersion TEXT NOT NULL,
  ConfigId TEXT NOT NULL,
  RevisionId TEXT NOT NULL,
  CapturedAt TEXT NOT NULL,
  StockCount INTEGER NOT NULL,
  PRIMARY KEY(TradingDate, ModelVersion, ConfigId, RevisionId)
);
CREATE INDEX IF NOT EXISTS idx_entry_score_revisions_latest
  ON entry_score_snapshot_revisions(TradingDate, ConfigId, CapturedAt DESC);
