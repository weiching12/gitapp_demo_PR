export class PushRepository {
  constructor(db) { this.db = db; }

  async save(subscription, now) {
    await this.db.prepare(`INSERT INTO push_subscriptions (Endpoint,P256dh,Auth,CreatedAt,UpdatedAt)
      VALUES (?,?,?,?,?) ON CONFLICT(Endpoint) DO UPDATE SET P256dh=excluded.P256dh,Auth=excluded.Auth,UpdatedAt=excluded.UpdatedAt`)
      .bind(subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now, now).run();
  }

  async remove(endpoint) {
    await this.db.prepare("DELETE FROM push_subscriptions WHERE Endpoint=?").bind(endpoint).run();
  }

  async pending(tradeDate, limit = 500) {
    const result = await this.db.prepare(`SELECT Endpoint endpoint,P256dh p256dh,Auth auth
      FROM push_subscriptions WHERE LastTradeDate IS NULL OR LastTradeDate<>? ORDER BY UpdatedAt LIMIT ?`)
      .bind(tradeDate, limit).all();
    return result.results ?? [];
  }

  async mark(endpoint, tradeDate) {
    await this.db.prepare("UPDATE push_subscriptions SET LastTradeDate=? WHERE Endpoint=?")
      .bind(tradeDate, endpoint).run();
  }

  async removeMany(endpoints) {
    if (!endpoints.length) return;
    await this.db.batch(endpoints.map((endpoint) => this.db.prepare("DELETE FROM push_subscriptions WHERE Endpoint=?").bind(endpoint)));
  }
}
