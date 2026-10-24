import { HISTORY_LIMIT, shardOf, isEtf } from "./market-codec.js";

// Pure market rules: no upstream transport, storage, or public API paths.
export const taipeiDate = (now = new Date()) => new Date(now.getTime() + 28800000).toISOString().slice(0, 10);
export const validDate = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

export function combineCatalogs(companies, etfs) {
  const stocks = [...companies, ...etfs];
  if (new Set(stocks.map((stock) => stock.symbol)).size !== stocks.length) throw new Error("Duplicate combined security identity");
  return stocks.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function marketDay(catalog, prices, flows) {
  if (!prices || !flows || prices.date !== flows.date) throw new Error("Price and institution dates must both be available");
  const records = {}, missingPrices = [], inactive = [], missingInstitutions = [];
  for (const stock of catalog) {
    if (stock.listedOn > prices.date) continue;
    const values = prices.records[stock.symbol];
    if (!values) {
      (prices.inactive.includes(stock.symbol) ? inactive : missingPrices).push(stock.symbol);
      continue;
    }
    const institutions = flows.records[stock.symbol];
    if (!institutions) missingInstitutions.push(stock.symbol);
    records[stock.symbol] = [prices.date, ...values, ...(institutions ?? Array(6).fill(null))];
  }
  // A new ETF feed cannot mask missing stock data (or vice versa).
  for (const etf of [false, true]) {
    const eligible = catalog.filter((stock) => isEtf(stock) === etf && stock.listedOn <= prices.date);
    const traded = eligible.filter((stock) => records[stock.symbol]);
    const missing = traded.filter((stock) => missingInstitutions.includes(stock.symbol));
    if (eligible.length > 100 && (traded.length < eligible.length * 0.9 || missing.length > traded.length * 0.2))
      throw new Error("Unexpectedly low whole-market coverage; preserve last good data");
  }
  return { date: prices.date, records, coverage: { companies: catalog.length, traded: Object.keys(records).length,
    missingPrices, inactive, missingInstitutions } };
}

/** Compact rows: date, O,H,L,C,volume, foreign buy/sell, trust buy/sell, dealer buy/sell. */
export function mergeShard(catalog, index, previous, days) {
  const old = new Map((previous?.stocks ?? []).map((stock) => [stock.symbol, stock.history]));
  return { schemaVersion: 2, stocks: catalog.filter((stock) => shardOf(stock.symbol) === index).map(({ symbol }) => {
    const history = new Map((old.get(symbol) ?? []).map((row) => [row[0], row]));
    for (const day of days) {
      const row = day.records[symbol];
      if (!row) continue;
      const prior = history.get(day.date);
      if (prior?.slice(6).every(Number.isSafeInteger) && !row.slice(6).every(Number.isSafeInteger))
        throw new Error(`Refusing to erase complete institution data: ${symbol} ${day.date}`);
      history.set(day.date, row);
    }
    return { symbol, history: [...history.values()].sort((a, b) => a[0].localeCompare(b[0])).slice(-HISTORY_LIMIT) };
  }) };
}
