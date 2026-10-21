// All statements run synchronously in one Durable Object request. Do not insert
// an async boundary between expiry cleanup, heartbeat upsert and count. Keeping
// the statements synchronous prevents another request from interleaving them.
export class PresenceRepository {
  constructor(sql) {
    this.sql = sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS visitors_expiry ON visitors(expires)");
  }

  refreshAndCount({ id, now, expiresAt, refreshBefore }) {
    this.sql.exec("DELETE FROM visitors WHERE expires <= ?", now);
    if (id) this.sql.exec(`INSERT INTO visitors VALUES (?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires
      WHERE visitors.expires <= ?`, id, expiresAt, refreshBefore);
    return this.sql.exec("SELECT count(*) AS count FROM visitors").one().count;
  }
}
