// Compatibility facade for existing sync, API, and seeding consumers.
// New code can import the source adapter, shared rules, or storage format directly.
export { SHARD_COUNT, HISTORY_LIMIT, shardOf } from "../shared/market-codec.js";
export { CATALOG_URL, ETF_CATALOG_URL, fetchJson, reportUrl, normalizeCatalog, normalizeEtfCatalog,
  normalizePrices, normalizeFlows } from "./adapters/twse.js";
export { taipeiDate, validDate, combineCatalogs, marketDay, mergeShard } from "../shared/market.js";
export { MANIFEST_KEY, SYNC_KEY, shardKey, stageKey } from "./storage/market-keys.js";
export { createManifest } from "./snapshots/market-format.js";
