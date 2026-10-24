import { MarketRepository } from "./repositories/market-repository.js";
import { MarketService } from "./services/market-service.js";
import { AnalysisService } from "./services/analysis-service.js";
import { MarketSummaryService } from "./services/market-summary-service.js";
import { HistoryService } from "./services/history-service.js";
import { PushRepository } from "./repositories/push-repository.js";
import { PushService } from "./services/push-service.js";
import { CorporateActionRepository } from "./corporate-actions/repository.js";

// Environment bindings are assembled here, outside application services.
export const createMarketService = (env) => new MarketService(new MarketRepository(env.MARKET_DATA,
  env.MARKET_HISTORY_ENABLED === "1" ? env.T86_DB : null));

export function createApplicationServices(env) {
  const market = createMarketService(env);
  const actions = env.CORPORATE_ACTIONS_ENABLED === "1" ? new CorporateActionRepository(env.T86_DB) : null;
  return { market, actions, analysis: new AnalysisService(market), summary: new MarketSummaryService(market, actions), history: new HistoryService(market),
    push: new PushService(new PushRepository(env.T86_DB), env) };
}

export const createPushService = (env) => new PushService(new PushRepository(env.T86_DB), env);
