import { REVIEW_HISTORY_LIMIT } from "../../shared/research-review.js";

export class HistoryService {
  constructor(marketService, actions = null) { this.marketService = marketService; this.actions = actions; }

  async stock(symbol) {
    const source = await this.marketService.stock(symbol);
    return { data: source.stock.history, meta: { symbol, asOf: source.asOf,
      updatedAt: source.updatedAt, tradingDates: source.stock.tradingDates } };
  }


  async review(symbol) {
    const source = await this.marketService.stock(symbol);
    const dates = source.stock.tradingDates.slice(-REVIEW_HISTORY_LIMIT);
    const byDate = new Map(source.stock.history.map((bar) => [bar.date, bar]));
    const actions = this.actions ? await this.actions.window(dates.slice(1)) : null;
    const events = [...(actions?.eventsBySymbol.get(symbol) ?? new Map())]
      .map(([date, event]) => ({ date, kind: event.kind }));
    return { data: { symbol, dates, bars: dates.map((date) => ({ date,
      close: byDate.get(date)?.close ?? null })), priceBasis: "unadjusted",
      corporateActions: { coveredDates: [...(actions?.coveredDates ?? [])], events,
        revisionId: this.actions ? await this.actions.revision() : null } },
    meta: { asOf: source.asOf, source: source.source, updatedAt: source.updatedAt,
      retrievedAt: new Date().toISOString(), limit: REVIEW_HISTORY_LIMIT } };
  }
}
