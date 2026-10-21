import { MANIFEST_KEY, shardKey } from "../twse.js";

// Storage details stay here; services may receive another implementation.
export class MarketRepository {
  constructor(kv) { this.kv = kv; }
  manifest() { return this.kv.get(MANIFEST_KEY, "json"); }
  shard(generation, index) { return this.kv.get(shardKey(generation, index), "json"); }
}
