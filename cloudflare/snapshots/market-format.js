import { SHARD_COUNT, HISTORY_LIMIT } from "../../shared/market-codec.js";
import { validDate } from "../../shared/market.js";

// Published snapshot format owns the compatibility URLs consumed by readers.
export function createManifest(catalog, dates, generation, updatedAt, coverage, previousGeneration = null) {
  const ordered = [...new Set(dates)].sort().slice(-HISTORY_LIMIT);
  if (!catalog.length || !ordered.length || !ordered.every(validDate)) throw new Error("Cannot publish empty market");
  return { schemaVersion: 2, source: "twse", generation, previousGeneration, updatedAt,
    asOf: ordered.at(-1), dates: ordered, stocks: catalog, coverage,
    chunks: Array.from({ length: SHARD_COUNT }, (_, index) => `/api/market/${generation}/${index}`) };
}
