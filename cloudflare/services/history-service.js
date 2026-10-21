export class HistoryService {
  constructor(marketService) { this.marketService = marketService; }

  async stock(symbol) {
    const source = await this.marketService.stock(symbol);
    return { data: source.stock.history, meta: { symbol, asOf: source.asOf,
      updatedAt: source.updatedAt, tradingDates: source.stock.tradingDates } };
  }
}
