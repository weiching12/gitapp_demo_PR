import { MarketRepository } from "./repositories/market-repository.js";
import { MarketService } from "./services/market-service.js";
import { AnalysisService } from "./services/analysis-service.js";
import { HistoryService } from "./services/history-service.js";

// Environment bindings are assembled here, outside application services.
export const createMarketService = (env) => new MarketService(new MarketRepository(env.MARKET_DATA));

export function createApplicationServices(env) {
  const market = createMarketService(env);
  return { market, analysis: new AnalysisService(market), history: new HistoryService(market) };
}
