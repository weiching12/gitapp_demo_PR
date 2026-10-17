import { STOCK_CATALOG } from "./catalog.js";

const complete = (bar) => ["外資", "投信", "自營商"].every((name) =>
  bar.institutions.some((item) => item.name === name));

export function combineSnapshots(snapshots) {
  if (snapshots.length !== STOCK_CATALOG.length) throw new Error("Incomplete stock universe");
  const symbols = new Set();
  for (const payload of snapshots) {
    const stock = payload?.stock;
    if (payload?.schemaVersion !== 1 || !STOCK_CATALOG.some((item) => item.symbol === stock?.symbol) ||
        symbols.has(stock.symbol) || !Array.isArray(stock.history) || !stock.history.length)
      throw new Error("Invalid stock snapshot");
    symbols.add(stock.symbol);
  }
  const stocks = snapshots.map((item) => item.stock);
  const sharedDates = stocks.slice(1).map((stock) => new Set(stock.history.map((bar) => bar.date)));
  const dates = stocks[0].history.map((bar) => bar.date)
    .filter((date) => sharedDates.every((set) => set.has(date)));
  const completeDates = stocks.map((stock) => new Set(stock.history.filter(complete).map((bar) => bar.date)));
  const asOf = dates.findLast((date) => completeDates.every((set) => set.has(date)));
  if (!asOf) throw new Error("No common complete trading date");
  return { stocks, dates: dates.filter((date) => date <= asOf), info: {
    mode: "finmind", label: "FinMind 日資料", asOf,
    updatedAt: snapshots.map((item) => item.updatedAt).sort()[0],
    note: "資料來源：FinMind。股價為未還原日資料，非即時報價；外資不含外資自營商，自營商合計自行買賣與避險。所有標的共用最近一個價量與法人均完整的交易日。",
  } };
}

export async function loadApiDataset(fetcher = fetch) {
  const snapshots = await Promise.all(STOCK_CATALOG.map(async ({ symbol }) => {
    const response = await fetcher(`/api/stocks/${symbol}`);
    if (!response.ok) throw new Error("目前無法載入雲端股票資料，請稍後重試。");
    const data = await response.json();
    if (data.stock?.symbol !== symbol) throw new Error("Stock identity mismatch");
    return data;
  }));
  return combineSnapshots(snapshots);
}

export async function loadDataset() {
  if (import.meta.env.VITE_DATA_MODE === "api") return loadApiDataset();
  const { demoProvider } = await import("./data.js");
  return demoProvider.load();
}
