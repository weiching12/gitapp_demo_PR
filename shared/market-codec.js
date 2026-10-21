export const SHARD_COUNT = 128;
export const HISTORY_LIMIT = 260;
export const validSymbol = (symbol) => typeof symbol === "string" && /^(?:\d{4,6}|\d{5}[A-Z])$/.test(symbol);
export const isEtf = (stock) => stock?.assetType === "etf" || stock?.sector === "ETF";
export function shardOf(symbol) {
  if (!validSymbol(symbol)) throw new Error("Invalid security symbol");
  // Preserve every existing numeric URL; letter-suffixed ETFs use a stable hash.
  if (/^\d+$/.test(symbol)) return Number(symbol) % SHARD_COUNT;
  let hash = 2166136261;
  for (const char of symbol) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash % SHARD_COUNT;
}

export function expandStock(metadata, rows) {
  return { ...metadata, history: rows.map((row) => ({
    date: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5],
    institutions: ["外資", "投信", "自營商"].flatMap((name, index) =>
      row[6 + index * 2] === null || row[7 + index * 2] === null ? [] : [{
        name, buy: row[6 + index * 2], sell: row[7 + index * 2],
      }]),
  })) };
}
