import { getInstitutionalNet } from "../src/indicators.js";

export const FINMIND_URL = "https://api.finmindtrade.com/api/v4/data";
export const MANIFEST_KEY = "market:v1";
export const stockKey = (symbol) => `stock:v1:${symbol}`;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export const hasInstitutions = (bar) => getInstitutionalNet(bar.institutions) !== null;

export function taipeiDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

function subtractDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

async function query(dataset, symbol, start, end, token, fetcher) {
  const url = new URL(FINMIND_URL);
  url.search = new URLSearchParams({ dataset, data_id: symbol, start_date: start, end_date: end });
  const response = await fetcher(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`FinMind HTTP ${response.status}`);
  const body = await response.json();
  if (body.status !== 200 || !Array.isArray(body.data))
    throw new Error(`FinMind dataset unavailable: ${dataset}`);
  return body.data;
}

/** Missing institution rows stay missing; they must never become zero trades. */
export function normalizeHistory(symbol, prices, flows) {
  const byDate = new Map();
  for (const row of flows) {
    if (row.stock_id !== symbol || !datePattern.test(row.date)) throw new Error("Invalid institution identity");
    if (![row.buy, row.sell].every((n) => Number.isSafeInteger(n) && n >= 0))
      throw new Error("Invalid institutional share count");
    if (!byDate.has(row.date)) byDate.set(row.date, new Map());
    const day = byDate.get(row.date);
    if (day.has(row.name)) throw new Error("Duplicate institution row");
    day.set(row.name, row);
  }
  const seen = new Set();
  return prices.map((row) => {
    if (row.stock_id !== symbol || !datePattern.test(row.date) || seen.has(row.date))
      throw new Error("Invalid or duplicate price identity");
    seen.add(row.date);
    // Suspended or otherwise inactive sessions may be returned as an all-zero
    // OHLC row. They contain no tradable price and should not block the full
    // universe refresh; malformed partial rows still fail validation below.
    if (row.Trading_Volume === 0 && [row.open, row.max, row.min, row.close].every((n) => n === 0))
      return null;
    if (![row.open, row.max, row.min, row.close].every((n) => Number.isFinite(n) && n > 0) ||
        row.max < Math.max(row.open, row.close) || row.min > Math.min(row.open, row.close) ||
        !Number.isSafeInteger(row.Trading_Volume) || row.Trading_Volume < 0)
      throw new Error("Invalid listed-stock OHLC or volume");
    const day = byDate.get(row.date) ?? new Map();
    const institutions = [];
    for (const [name, source] of [["外資", "Foreign_Investor"], ["投信", "Investment_Trust"]]) {
      const item = day.get(source);
      if (item) institutions.push({ name, buy: item.buy, sell: item.sell });
    }
    // Current listed-stock data has two dealer components. Foreign_Dealer_Self
    // is a separate statistic and is deliberately excluded from this total.
    const self = day.get("Dealer_self"), hedge = day.get("Dealer_Hedging");
    if (self && hedge) {
      const buy = self.buy + hedge.buy, sell = self.sell + hedge.sell;
      if (![buy, sell].every(Number.isSafeInteger)) throw new Error("Invalid dealer share total");
      institutions.push({ name: "自營商", buy, sell });
    }
    return { date: row.date, open: row.open, high: row.max, low: row.min,
      close: row.close, volume: row.Trading_Volume, institutions };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchStock(stock, previous = null, { token, now = new Date(), fetcher = fetch } = {}) {
  const end = taipeiDate(now);
  const lastDate = previous?.stock.history.at(-1)?.date;
  // Re-fetch the last two weeks to pick up late institutional corrections.
  const start = subtractDays(lastDate ?? end, lastDate ? 14 : 400);
  const prices = await query("TaiwanStockPrice", stock.symbol, start, end, token, fetcher);
  const flows = await query("TaiwanStockInstitutionalInvestorsBuySell", stock.symbol, start, end, token, fetcher);
  if (!prices.length) throw new Error("No price history returned");
  const incoming = normalizeHistory(stock.symbol, prices, flows);
  const merged = new Map((previous?.stock.history ?? []).map((bar) => [bar.date, bar]));
  for (const bar of incoming) {
    const older = merged.get(bar.date);
    // A temporarily incomplete upstream reply must not erase complete data.
    if (older && hasInstitutions(older) && !hasInstitutions(bar)) {
      throw new Error("Upstream institutional history became incomplete");
    }
    merged.set(bar.date, bar);
  }
  const history = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-260);
  const asOf = history.findLast(hasInstitutions)?.date;
  if (!asOf || history.filter((bar) => bar.date <= asOf).length < 60)
    throw new Error("Insufficient complete price and institution history");
  if (previous?.asOf && asOf < previous.asOf) throw new Error("Refusing a backwards data date");
  return { schemaVersion: 1, asOf, updatedAt: now.toISOString(), stock: { ...stock, history } };
}

export function stockMetadata(snapshot) {
  return { symbol: snapshot.stock.symbol, asOf: snapshot.asOf, updatedAt: snapshot.updatedAt };
}
