export const SHARD_COUNT = 128;
export const HISTORY_LIMIT = 260;

export function expandStock(metadata, rows) {
  return { ...metadata, history: rows.map((row) => ({
    date: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5],
    institutions: ["外資", "投信", "自營商"].flatMap((name, index) =>
      row[6 + index * 2] === null || row[7 + index * 2] === null ? [] : [{
        name, buy: row[6 + index * 2], sell: row[7 + index * 2],
      }]),
  })) };
}
