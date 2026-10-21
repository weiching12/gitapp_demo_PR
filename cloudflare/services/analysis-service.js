import { DEFAULT_SETTINGS, getSnapshot } from "../../shared/indicators.js";
import { DomainError } from "../../shared/domain-error.js";

export const RULES_VERSION = "technical-v1";

export class AnalysisService {
  constructor(marketService) { this.marketService = marketService; }

  async stock(symbol, options = {}) {
    const source = await this.marketService.stock(symbol);
    const asOf = options.asOf || source.asOf;
    if (asOf > source.asOf || !source.stock.tradingDates.includes(asOf))
      throw new DomainError("INVALID_QUERY", "指定日期不是現有市場資料中的交易日");
    const settings = options.settings ?? DEFAULT_SETTINGS;
    const snapshot = getSnapshot(source.stock, asOf, settings);
    return { data: { symbol, latest: snapshot.latest, signal: snapshot.signal,
      institutionalSummary: snapshot.institutionalSummary },
    meta: { asOf, sourceAsOf: source.asOf, rulesVersion: RULES_VERSION,
      priceBasis: "unadjusted", settings } };
  }
}

// Compatibility entry point for existing internal consumers.
export const stockAnalysis = (marketService, symbol, options) =>
  new AnalysisService(marketService).stock(symbol, options);
