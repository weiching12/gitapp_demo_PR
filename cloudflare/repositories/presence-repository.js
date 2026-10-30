// Count page entries as events. Legacy browser/day rows remain intact and are imported once.
export class PresenceRepository {
  constructor(sql) {
    this.sql = sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS visit_history (
      day TEXT NOT NULL, id TEXT NOT NULL, first_seen INTEGER, last_seen INTEGER, nationality TEXT, ip TEXT, country TEXT,
      PRIMARY KEY(day, id))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS visit_events (
      event_id TEXT PRIMARY KEY, day TEXT NOT NULL, id TEXT NOT NULL,
      first_seen INTEGER, last_seen INTEGER, nationality TEXT, ip TEXT, country TEXT, legacy_key TEXT UNIQUE)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS visit_events_day_time ON visit_events(day, first_seen, event_id)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS presence_migrations (name TEXT PRIMARY KEY)");
    if (![...this.sql.exec("SELECT name FROM presence_migrations WHERE name = 'visit-events-v1'")].length) {
      // A permanent key makes crash retries idempotent; mark completion only after both imports.
      // Retained daily records represent at least one visit, not an invented exact page-view count.
      this.sql.exec(`INSERT OR IGNORE INTO visit_history(day, id)
        SELECT date(expires / 1000, 'unixepoch', '+8 hours', '-1 day'), id FROM visitors`);
      this.sql.exec(`INSERT OR IGNORE INTO visit_events(event_id, day, id, first_seen, last_seen, nationality, ip, country, legacy_key)
        SELECT 'legacy:' || day || ':' || id, day, id, first_seen, last_seen, nationality, ip, country, day || ':' || id FROM visit_history`);
      this.sql.exec("INSERT OR IGNORE INTO presence_migrations(name) VALUES ('visit-events-v1')");
    }
  }

  recordVisit({ id, visitId, metadataOnly = false, now, nationality = null, ip = null, country = null }) {
    const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
    if (metadataOnly) {
      this.sql.exec(`UPDATE visit_events SET last_seen = ?, nationality = COALESCE(?, nationality),
        ip = COALESCE(?, ip), country = COALESCE(?, country) WHERE event_id = ? AND id = ?`, now, nationality, ip, country, visitId, id);
    } else {
      this.sql.exec(`INSERT INTO visit_events(event_id, day, id, first_seen, last_seen, nationality, ip, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET last_seen=excluded.last_seen,
        nationality=COALESCE(excluded.nationality, visit_events.nationality), ip=COALESCE(excluded.ip, visit_events.ip), country=COALESCE(excluded.country, visit_events.country)
        WHERE visit_events.id = excluded.id`, visitId, day, id, now, now, nationality, ip, country);
    }
    return this.countVisits(day);
  }

  firstDay() { return this.sql.exec("SELECT min(day) AS day FROM visit_events").one().day; }
  overall() { return this.sql.exec("SELECT count(*) AS total, min(day) AS firstDay, max(day) AS lastDay FROM visit_events").one(); }
  months(today) {
    return [...new Set([today.slice(0, 7), ...[...this.sql.exec("SELECT DISTINCT substr(day, 1, 7) AS month FROM visit_events")].map(row => row.month)])].sort().reverse();
  }

  analytics(start, end, limit, offset, period = "day", selectedDay = null) {
    const daily = period === "day"
      ? [...this.sql.exec(`SELECT day, count(*) AS visitors, count(*) AS visits FROM visit_events
          WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day DESC`, start, end)]
      : [...this.sql.exec(`SELECT substr(day, 1, 7) AS day, count(*) AS visitors, count(*) AS visits
          FROM visit_events WHERE day BETWEEN ? AND ? GROUP BY substr(day, 1, 7) ORDER BY day DESC`, start, end)];
    const unique = this.sql.exec(`SELECT count(DISTINCT id) AS count FROM visit_events
      WHERE day BETWEEN ? AND ?`, start, end).one().count;
    const detailStart = selectedDay || start, detailEnd = selectedDay || end;
    const visitors = [...this.sql.exec(`SELECT event_id, day, id, first_seen, last_seen, nationality, ip, country FROM visit_events
      WHERE day BETWEEN ? AND ? ORDER BY day DESC, first_seen DESC, event_id LIMIT ? OFFSET ?`, detailStart, detailEnd, limit, offset)];
    const total = this.sql.exec(`SELECT count(*) AS count FROM visit_events
      WHERE day BETWEEN ? AND ?`, start, end).one().count;
    const detailTotal = this.sql.exec("SELECT count(*) AS count FROM visit_events WHERE day BETWEEN ? AND ?", detailStart, detailEnd).one().count;
    return { daily, visitors, total, detailTotal, selectedDay, unique, limit, offset };
  }

  countVisits(day) {
    return this.sql.exec("SELECT count(*) AS count FROM visit_events WHERE day = ?", day).one().count;
  }
}
