// Reuse the existing visitors table; expiry is the next Taipei midnight.
// A repeated visit from the same browser has no write until the next day.
export class PresenceRepository {
  constructor(sql) {
    this.sql = sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS visitors_expiry ON visitors(expires)");
  }

  recordVisit({ id, now, expiresAt }) {
    this.sql.exec("DELETE FROM visitors WHERE expires <= ?", now);
    this.sql.exec(`INSERT INTO visitors(id, expires) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET expires=excluded.expires WHERE visitors.expires != excluded.expires`, id, expiresAt);
    return this.sql.exec("SELECT count(*) AS count FROM visitors WHERE expires = ?", expiresAt).one().count;
  }

  countVisits(expiresAt) {
    return this.sql.exec("SELECT count(*) AS count FROM visitors WHERE expires = ?", expiresAt).one().count;
  }
}
