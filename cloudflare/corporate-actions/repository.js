export class CorporateActionRepository {
  constructor(db) { this.db = db; }

  async revision() {
    if (!this.db) return "unavailable";
    const row = await this.db.prepare("SELECT Value FROM corporate_action_meta WHERE Key='revision'").first();
    return row?.Value ?? "unavailable";
  }

  async window(dates) {
    if (!this.db || !dates.length) return { coveredDates: new Set(), eventsBySymbol: new Map() };
    const start = dates[0], end = dates.at(-1);
    const [coverage, events] = await Promise.all([
      this.db.prepare("SELECT Date FROM corporate_action_coverage WHERE Date BETWEEN ? AND ? AND Status='complete'")
        .bind(start, end).all(),
      this.db.prepare("SELECT Date, Symbol, Kind, BeforeClose, ReferencePrice FROM corporate_action_events WHERE Date BETWEEN ? AND ?")
        .bind(start, end).all(),
    ]);
    const eventsBySymbol = new Map();
    for (const row of events.results) {
      if (!eventsBySymbol.has(row.Symbol)) eventsBySymbol.set(row.Symbol, new Map());
      eventsBySymbol.get(row.Symbol).set(row.Date, {
        kind: row.Kind, beforeClose: row.BeforeClose, reference: row.ReferencePrice,
      });
    }
    return { coveredDates: new Set(coverage.results.map((row) => row.Date)), eventsBySymbol };
  }

  async claim(date, now) {
    await this.db.prepare("INSERT OR IGNORE INTO corporate_action_coverage(Date,Status,Attempts) VALUES(?,'pending',0)")
      .bind(date).run();
    const retryBefore = new Date(now.getTime() - 30 * 60_000).toISOString();
    const result = await this.db.prepare(`UPDATE corporate_action_coverage
      SET Attempts=Attempts+1,LastAttemptAt=?
      WHERE Date=? AND Status='pending' AND Attempts<2 AND
      (Attempts=0 OR LastAttemptAt<=?)`).bind(now.toISOString(), date, retryBefore).run();
    if ((result.meta?.changes ?? result.changes) !== 1) return 0;
    const row = await this.db.prepare("SELECT Attempts FROM corporate_action_coverage WHERE Date=?").bind(date).first();
    return row.Attempts;
  }

  async save(dates, events, verifiedAt) {
    if (!dates.length || events.some((event) => !dates.includes(event.date)))
      throw new Error("Corporate-action events must belong to the verified dates");
    // A verified report replaces those dates, including events removed by a
    // source correction. Other dates remain untouched.
    const clearEvents = this.db.prepare("DELETE FROM corporate_action_events WHERE Date IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(dates));
    const insertEvents = this.db.prepare(`INSERT INTO corporate_action_events
      (Date,Symbol,Kind,BeforeClose,ReferencePrice)
      SELECT json_extract(value,'$.date'),json_extract(value,'$.symbol'),
      json_extract(value,'$.kind'),json_extract(value,'$.beforeClose'),json_extract(value,'$.reference')
      FROM json_each(?) WHERE true
      ON CONFLICT(Date,Symbol) DO UPDATE SET Kind=excluded.Kind,
      BeforeClose=excluded.BeforeClose,ReferencePrice=excluded.ReferencePrice`)
      .bind(JSON.stringify(events));
    const markCoverage = this.db.prepare(`INSERT INTO corporate_action_coverage
      (Date,Status,Attempts,VerifiedAt)
      SELECT value,'complete',0,? FROM json_each(?) WHERE true
      ON CONFLICT(Date) DO UPDATE SET Status='complete',VerifiedAt=excluded.VerifiedAt`)
      .bind(verifiedAt, JSON.stringify(dates));
    const revision = this.db.prepare(`INSERT INTO corporate_action_meta(Key,Value)
      VALUES('revision',?) ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value`).bind(verifiedAt);
    // Replacement and coverage are atomic; the cache revision advances last.
    await this.db.batch([clearEvents, insertEvents, markCoverage, revision]);
  }
}
