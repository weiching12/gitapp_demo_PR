CREATE TABLE IF NOT EXISTS native_push_subscriptions (
  DeviceToken TEXT NOT NULL,
  Environment TEXT NOT NULL CHECK(Environment IN ('sandbox','production')),
  SecretHash TEXT NOT NULL,
  CreatedAt TEXT NOT NULL,
  UpdatedAt TEXT NOT NULL,
  LastTradeDate TEXT,
  PRIMARY KEY(DeviceToken,Environment)
);
CREATE INDEX IF NOT EXISTS idx_native_push_pending ON native_push_subscriptions(UpdatedAt);
