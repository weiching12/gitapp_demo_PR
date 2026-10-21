import { DEFAULT_SETTINGS, getSnapshot } from "../../shared/indicators.js";
import { MarketError } from "./market-service.js";

export const RULES_VERSION = "technical-v1";
export function analysisOptions(params) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const name of Object.keys(settings)) {
    const raw = params.get(name);
    if (raw === null) continue;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > (name === "period" ? 60 : 20))
      throw new MarketError("INVALID_QUERY", "指標參數超出允許範圍", 400);
    settings[name] = Number(raw);
  }
  const asOf = params.get("asOf");
  if (asOf && (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) ||
      new Date(asOf).toISOString().slice(0, 10) !== asOf)) throw new MarketError("INVALID_QUERY", "日期格式不正確", 400);
  return { settings, asOf };
}

export async function stockAnalysis(marketService, symbol, options) {
  const source = await marketService.stock(symbol);
  const asOf = options.asOf || source.asOf;
  if (asOf > source.asOf || !source.stock.tradingDates.includes(asOf))
    throw new MarketError("INVALID_QUERY", "日期必須是已保存的市場交易日", 400);
  const snapshot = getSnapshot(source.stock, asOf, options.settings);
  return { data: { symbol, latest: snapshot.latest, signal: snapshot.signal,
    institutionalSummary: snapshot.institutionalSummary },
  meta: { asOf, sourceAsOf: source.asOf, rulesVersion: RULES_VERSION,
    priceBasis: "unadjusted", settings: options.settings } };
}
