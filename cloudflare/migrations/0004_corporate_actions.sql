-- Sparse TWSE ex-rights/dividend events. Coverage rows distinguish no event from no data.
CREATE TABLE IF NOT EXISTS corporate_action_events (
  Date TEXT NOT NULL,
  Symbol TEXT NOT NULL,
  Kind TEXT NOT NULL,
  BeforeClose REAL NOT NULL,
  ReferencePrice REAL NOT NULL,
  PRIMARY KEY(Date, Symbol)
);
CREATE TABLE IF NOT EXISTS corporate_action_coverage (
  Date TEXT PRIMARY KEY,
  Status TEXT NOT NULL CHECK(Status IN ('pending', 'complete')),
  Attempts INTEGER NOT NULL DEFAULT 0 CHECK(Attempts BETWEEN 0 AND 2),
  LastAttemptAt TEXT,
  VerifiedAt TEXT,
  Source TEXT NOT NULL DEFAULT 'TWSE-TWT49U+TWTAUU+TWTB8U'
);
CREATE TABLE IF NOT EXISTS corporate_action_meta (
  Key TEXT PRIMARY KEY CHECK(Key='revision'),
  Value TEXT NOT NULL
);
