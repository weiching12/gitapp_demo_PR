-- An oversized error response must not prevent its audit record being saved.
CREATE TABLE t86_raw_chunks (
  RunId TEXT NOT NULL REFERENCES t86_sync_runs(RunId), Part INTEGER NOT NULL,
  Body TEXT NOT NULL, PRIMARY KEY(RunId, Part)
);
