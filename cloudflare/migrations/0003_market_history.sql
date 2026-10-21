-- Immutable, lossless market generations. Prices retain their original basis.
CREATE TABLE IF NOT EXISTS market_history_shards (
  Generation TEXT NOT NULL,
  ShardIndex INTEGER NOT NULL CHECK(ShardIndex >= 0 AND ShardIndex < 128),
  Payload TEXT NOT NULL CHECK(json_valid(Payload)),
  PRIMARY KEY(Generation, ShardIndex)
);
CREATE TABLE IF NOT EXISTS market_history_manifests (
  Generation TEXT PRIMARY KEY,
  Payload TEXT NOT NULL CHECK(json_valid(Payload)),
  PriceBasis TEXT NOT NULL DEFAULT 'unadjusted' CHECK(PriceBasis='unadjusted'),
  PublishedAt TEXT NOT NULL
);
