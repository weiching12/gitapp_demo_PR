CREATE TABLE t86_sync_runs (
  RunId TEXT PRIMARY KEY, TradeDate TEXT NOT NULL, SyncTime TEXT NOT NULL,
  Source TEXT NOT NULL, QueryKey TEXT NOT NULL, Slot TEXT NOT NULL,
  RecordCount INTEGER NOT NULL DEFAULT 0, DataHash TEXT, Status TEXT NOT NULL,
  ValidationResult TEXT NOT NULL, ErrorMessage TEXT, RawJson TEXT, HttpStatus INTEGER,
  VersionId TEXT
);
CREATE INDEX t86_run_lookup ON t86_sync_runs(QueryKey, TradeDate, Slot, Status, SyncTime);
CREATE UNIQUE INDEX t86_daily_round ON t86_sync_runs(QueryKey, TradeDate, Slot) WHERE Slot IN ('18:30','20:30');
CREATE TABLE t86_versions (
  VersionId TEXT PRIMARY KEY, QueryKey TEXT NOT NULL, TradeDate TEXT NOT NULL,
  SyncTime TEXT NOT NULL, DataHash TEXT NOT NULL, RecordCount INTEGER NOT NULL,
  RowsJson TEXT NOT NULL, RunId TEXT NOT NULL REFERENCES t86_sync_runs(RunId)
);
CREATE TABLE t86_heads (
  QueryKey TEXT NOT NULL, TradeDate TEXT NOT NULL, VersionId TEXT NOT NULL REFERENCES t86_versions(VersionId),
  SyncTime TEXT NOT NULL, PRIMARY KEY(QueryKey, TradeDate)
);
CREATE TABLE t86_staging (
  RunId TEXT NOT NULL, Symbol TEXT NOT NULL, Name TEXT NOT NULL,
  ValuesJson TEXT NOT NULL, OfficialTotal INTEGER NOT NULL,
  PRIMARY KEY(RunId, Symbol)
);
CREATE TABLE t86_daily (
  QueryKey TEXT NOT NULL, TradeDate TEXT NOT NULL, Symbol TEXT NOT NULL, Name TEXT NOT NULL,
  ValuesJson TEXT NOT NULL, OfficialTotal INTEGER NOT NULL, VersionId TEXT NOT NULL REFERENCES t86_versions(VersionId),
  PRIMARY KEY(QueryKey, TradeDate, Symbol)
);
-- Only an operator may confirm an exact structurally validated bootstrap report.
CREATE TABLE t86_baseline_approvals (
  QueryKey TEXT NOT NULL, TradeDate TEXT NOT NULL, DataHash TEXT NOT NULL,
  ConfirmedBy TEXT NOT NULL, ConfirmedAt TEXT NOT NULL,
  PRIMARY KEY(QueryKey, TradeDate, DataHash)
);
-- A failing CHECK aborts the entire D1 batch, including staging and Upsert.
CREATE TABLE t86_commit_guard (RunId TEXT PRIMARY KEY, Ok INTEGER NOT NULL CHECK (Ok = 1));
