import { DEFAULT_SETTINGS, getSnapshot, getStockInstitutionEstimate } from "../../shared/indicators.js";
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
    const dates = source.stock.tradingDates.filter((date) => date <= asOf);
    const money = Object.fromEntries(["day", "5", "20"].map((window) => [window,
      Object.fromEntries(["total", "外資", "投信", "自營商"].map((name) => [name,
        getStockInstitutionEstimate(snapshot, name, window, dates)]))]));
    return { data: { symbol, latest: snapshot.latest, signal: snapshot.signal,
      institutionalSummary: snapshot.institutionalSummary, money },
    meta: { asOf, sourceAsOf: source.asOf, rulesVersion: RULES_VERSION,
      priceBasis: "unadjusted", settings } };
  }
}

// Compatibility entry point for existing internal consumers.
export const stockAnalysis = (marketService, symbol, options) =>
  new AnalysisService(marketService).stock(symbol, options);
