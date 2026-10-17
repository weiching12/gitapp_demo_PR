import { STOCK_CATALOG } from "./catalog.js";
import { getInstitutionNet, getInstitutionalNet } from "./indicators.js";

const complete = (bar) => getInstitutionalNet(bar.institutions) !== null;
const validDate = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

function validHistory(history) {
  return Array.isArray(history) && history.length > 0 && history.every((bar, index) =>
    bar && validDate(bar.date) && (index === 0 || history[index - 1].date < bar.date) &&
    [bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0) &&
    bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close) &&
    Number.isSafeInteger(bar.volume) && bar.volume >= 0 && Array.isArray(bar.institutions) &&
    bar.institutions.every((item) => ["外資", "投信", "自營商"].includes(item?.name) &&
      getInstitutionNet(bar.institutions, item.name) !== null));
}

export function combineSnapshots(snapshots) {
  if (snapshots.length !== STOCK_CATALOG.length) throw new Error("Incomplete stock universe");
  const symbols = new Set();
  for (const payload of snapshots) {
    const stock = payload?.stock;
    if (payload?.schemaVersion !== 1 || !STOCK_CATALOG.some((item) => item.symbol === stock?.symbol) ||
        symbols.has(stock.symbol) || !validHistory(stock.history) ||
        !validDate(payload.asOf) ||
        typeof payload.updatedAt !== "string" || !Number.isFinite(Date.parse(payload.updatedAt)))
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
    mode: "finmind", label: "每日收盤資料", asOf,
    updatedAt: new Date(Math.min(...snapshots.map((item) => Date.parse(item.updatedAt)))).toISOString(),
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
