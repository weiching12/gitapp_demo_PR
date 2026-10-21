import { MarketRepository } from "./repositories/market-repository.js";
import { MarketService } from "./services/market-service.js";

// Environment bindings are assembled here, outside application services.
export const createMarketService = (env) => new MarketService(new MarketRepository(env.MARKET_DATA));
