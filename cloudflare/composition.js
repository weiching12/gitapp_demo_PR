import { MarketRepository } from "./repositories/market-repository.js";
import { MarketService } from "./services/market-service.js";
import { AnalysisService } from "./services/analysis-service.js";
import { HistoryService } from "./services/history-service.js";
import { PushRepository } from "./repositories/push-repository.js";
import { PushService } from "./services/push-service.js";

// Environment bindings are assembled here, outside application services.
export const createMarketService = (env) => new MarketService(new MarketRepository(env.MARKET_DATA));

export function createApplicationServices(env) {
  const market = createMarketService(env);
  return { market, analysis: new AnalysisService(market), history: new HistoryService(market),
    push: new PushService(new PushRepository(env.T86_DB), env) };
}

export const createPushService = (env) => new PushService(new PushRepository(env.T86_DB), env);
