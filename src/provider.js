import { expandStock, SHARD_COUNT, HISTORY_LIMIT } from "./market-codec.js";

const validDate = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const orderedDates = (dates) => Array.isArray(dates) && dates.length > 0 &&
  dates.every((date, index) => validDate(date) && (index === 0 || dates[index - 1] < date));

function validRows(rows, asOf) {
  return Array.isArray(rows) && rows.length <= HISTORY_LIMIT && rows.every((row, index) =>
    Array.isArray(row) && row.length === 12 && validDate(row[0]) && row[0] <= asOf &&
    (index === 0 || rows[index - 1][0] < row[0]) &&
    row.slice(1, 5).every((value) => Number.isFinite(value) && value > 0) &&
    row[2] >= Math.max(row[1], row[4]) && row[3] <= Math.min(row[1], row[4]) &&
    Number.isSafeInteger(row[5]) && row[5] >= 0 &&
    row.slice(6).every((value) => value === null || (Number.isSafeInteger(value) && value >= 0)));
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 2 || manifest.source !== "twse" ||
    !/^[a-z0-9-]{1,64}$/.test(manifest.generation) || !orderedDates(manifest.dates) ||
    manifest.asOf !== manifest.dates.at(-1) || !Number.isFinite(Date.parse(manifest.updatedAt)) ||
    !Array.isArray(manifest.stocks) || !manifest.stocks.length || !Array.isArray(manifest.chunks) ||
    manifest.chunks.length !== SHARD_COUNT || manifest.chunks.some((url, i) => url !== `/api/market/${manifest.generation}/${i}`))
    throw new Error("Invalid TWSE market manifest");
  const seen = new Set();
  for (const stock of manifest.stocks) {
    if (!/^\d{4,6}$/.test(stock?.symbol) || !stock.name || !stock.sector || stock.market !== "上市" ||
      !validDate(stock.listedOn) || seen.has(stock.symbol)) throw new Error("Invalid listed-company identity");
    seen.add(stock.symbol);
  }
  return manifest;
}

export function combineChunks(manifest, chunks) {
  validateManifest(manifest);
  if (chunks.length !== manifest.chunks.length) throw new Error("Incomplete market chunks");
  const compact = new Map();
  for (const [index, chunk] of chunks.entries()) {
    if (chunk?.schemaVersion !== 2 || chunk.generation !== manifest.generation || chunk.index !== index || !Array.isArray(chunk.stocks))
      throw new Error("Mixed or invalid market generation");
    for (const stock of chunk.stocks) {
      if (Number(stock.symbol) % SHARD_COUNT !== index || compact.has(stock.symbol) || !validRows(stock.history, manifest.asOf))
        throw new Error("Invalid stock history chunk");
      compact.set(stock.symbol, stock.history);
    }
  }
  if (compact.size !== manifest.stocks.length || manifest.stocks.some((stock) => !compact.has(stock.symbol)))
    throw new Error("Incomplete listed-company coverage");
  const stocks = manifest.stocks.map((stock) => ({ ...expandStock(stock, compact.get(stock.symbol)), tradingDates: manifest.dates }));
  return { stocks, dates: manifest.dates, info: {
    mode: "twse", label: "每日收盤資料", asOf: manifest.asOf, updatedAt: manifest.updatedAt,
    coverage: manifest.coverage,
    note: "資料來源：臺灣證券交易所。上市公司名錄、每日收盤行情與三大法人買賣超日報；價格未還原、非即時報價。外資不含外資自營商，自營商合計自行買賣與避險。未提供行情或法人明細時保留缺漏，不補零。",
  } };
}

export async function loadApiDataset(fetcher = fetch) {
  const get = async (url) => {
    const response = await fetcher(url);
    if (!response.ok) throw new Error("目前無法載入雲端股票資料，請稍後重試。");
    return response.json();
  };
  const manifest = validateManifest(await get("/api/market"));
  const chunks = new Array(manifest.chunks.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < chunks.length) {
      const index = cursor++;
      chunks[index] = await get(manifest.chunks[index]);
    }
  }));
  return combineChunks(manifest, chunks);
}

export async function loadDataset() {
  if (import.meta.env.VITE_DATA_MODE === "api") return loadApiDataset();
  const { demoProvider } = await import("./data.js");
  return demoProvider.load();
}
