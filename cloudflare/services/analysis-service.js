import { DEFAULT_SETTINGS, getSnapshot } from "../../shared/indicators.js";
import { DomainError } from "../../shared/domain-error.js";

export const RULES_VERSION = "technical-v1";
export async function stockAnalysis(marketService, symbol, options = {}) {
  const source = await marketService.stock(symbol);
  const asOf = options.asOf || source.asOf;
  if (asOf > source.asOf || !source.stock.tradingDates.includes(asOf))
    throw new DomainError("INVALID_QUERY", "日期必須是已保存的市場交易日");
  const snapshot = getSnapshot(source.stock, asOf, options.settings ?? DEFAULT_SETTINGS);
  return { data: { symbol, latest: snapshot.latest, signal: snapshot.signal,
    institutionalSummary: snapshot.institutionalSummary },
  meta: { asOf, sourceAsOf: source.asOf, rulesVersion: RULES_VERSION,
    priceBasis: "unadjusted", settings: options.settings ?? DEFAULT_SETTINGS } };
}
