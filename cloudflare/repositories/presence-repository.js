// Reuse the existing visitors table; expiry is the next Taipei midnight.
// History retains one row per browser and Taipei calendar day.
export class PresenceRepository {
  constructor(sql) {
    this.sql = sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS visit_history (
      day TEXT NOT NULL, id TEXT NOT NULL, first_seen INTEGER, last_seen INTEGER, nationality TEXT, ip TEXT, country TEXT,
      PRIMARY KEY(day, id))`);
    // Preserve any still-available daily records; original visit times are unknown.
    this.sql.exec(`INSERT OR IGNORE INTO visit_history(day, id)
      SELECT date(expires / 1000, 'unixepoch', '+8 hours', '-1 day'), id FROM visitors`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS visitors_expiry ON visitors(expires)");
  }

  recordVisit({ id, now, expiresAt, nationality = null, ip = null, country = null }) {
    const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
    this.sql.exec(`INSERT INTO visit_history(day, id, first_seen, last_seen, nationality, ip, country) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, id) DO UPDATE SET last_seen=excluded.last_seen, nationality=COALESCE(excluded.nationality, visit_history.nationality), ip=excluded.ip, country=excluded.country`, day, id, now, now, nationality, ip, country);
    this.sql.exec("DELETE FROM visitors WHERE expires <= ?", now);
    this.sql.exec(`INSERT INTO visitors(id, expires) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET expires=excluded.expires WHERE visitors.expires != excluded.expires`, id, expiresAt);
    return this.sql.exec("SELECT count(*) AS count FROM visitors WHERE expires = ?", expiresAt).one().count;
  }

  firstDay() { return this.sql.exec("SELECT min(day) AS day FROM visit_history").one().day; }

  analytics(start, end, limit, offset, period = "day") {
    const daily = period === "day"
      ? [...this.sql.exec(`SELECT day, count(*) AS visitors FROM visit_history
          WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day DESC`, start, end)]
      : [...this.sql.exec(`SELECT substr(day, 1, 7) AS day, count(DISTINCT id) AS visitors
          FROM visit_history WHERE day BETWEEN ? AND ? GROUP BY substr(day, 1, 7) ORDER BY day DESC`, start, end)];
    const unique = this.sql.exec(`SELECT count(DISTINCT id) AS count FROM visit_history
      WHERE day BETWEEN ? AND ?`, start, end).one().count;
    const visitors = [...this.sql.exec(`SELECT day, id, first_seen, last_seen, nationality, ip, country FROM visit_history
      WHERE day BETWEEN ? AND ? ORDER BY day DESC, id LIMIT ? OFFSET ?`, start, end, limit, offset)];
    const total = this.sql.exec(`SELECT count(*) AS count FROM visit_history
      WHERE day BETWEEN ? AND ?`, start, end).one().count;
    return { daily, visitors, total, unique, limit, offset };
  }

  countVisits(expiresAt) {
    return this.sql.exec("SELECT count(*) AS count FROM visitors WHERE expires = ?", expiresAt).one().count;
  }
}
