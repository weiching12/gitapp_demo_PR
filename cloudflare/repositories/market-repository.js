import { MANIFEST_KEY, shardKey } from "../storage/market-keys.js";

// Storage details stay here; services may receive another implementation.
export class MarketRepository {
  constructor(kv, db) { this.kv = kv; this.db = db; }
  manifest() { return this.kv.get(MANIFEST_KEY, "json"); }
  shard(generation, index) { return this.kv.get(shardKey(generation, index), "json"); }
  async shards(generation, indices) {
    if (!this.db) return Promise.all(indices.map((index) => this.shard(generation, index)));
    const db = this.db.withSession ? this.db.withSession("first-primary") : this.db;
    // D1 permits at most 100 bound parameters per query, including Generation.
    const shards = [];
    for (let offset = 0; offset < indices.length; offset += 99) {
      const group = indices.slice(offset, offset + 99);
      const placeholders = group.map(() => "?").join(",");
      const rows = await db.prepare(`SELECT ShardIndex, Payload FROM market_history_shards WHERE Generation=? AND ShardIndex IN (${placeholders})`)
        .bind(generation, ...group).all();
      shards.push(...rows.results.map((row) => JSON.parse(row.Payload)));
    }
    return shards;
  }
}
