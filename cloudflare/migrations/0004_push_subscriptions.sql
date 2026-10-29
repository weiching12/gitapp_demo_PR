CREATE TABLE IF NOT EXISTS push_subscriptions (
  Endpoint TEXT PRIMARY KEY,
  P256dh TEXT NOT NULL,
  Auth TEXT NOT NULL,
  CreatedAt TEXT NOT NULL,
  UpdatedAt TEXT NOT NULL,
  LastTradeDate TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_updated ON push_subscriptions(UpdatedAt);
