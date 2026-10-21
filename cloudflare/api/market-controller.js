import { stockAnalysis } from "../services/analysis-service.js";
import { analysisOptions, stockCollectionOptions } from "./validators.js";

// Controllers own API representations and HTTP input adaptation.
export async function marketController(route, url, service) {
  switch (route.name) {
    case "market": {
      const body = await service.market();
      return route.versioned ? { ...body,
        chunks: body.chunks.map((_, index) => `/api/v1/market/snapshots/${body.generation}/shards/${index}`) } : body;
    }
    case "snapshot": return service.snapshot(route.params.generation, route.params.index);
    case "stocks": return service.stocks(stockCollectionOptions(url.searchParams));
    case "analysis": return stockAnalysis(service, route.params.symbol, analysisOptions(url.searchParams));
    case "stock": return service.stock(route.params.symbol);
    case "history": {
      const source = await service.stock(route.params.symbol);
      return { data: source.stock.history, meta: { symbol: route.params.symbol, asOf: source.asOf,
        updatedAt: source.updatedAt, tradingDates: source.stock.tradingDates } };
    }
    default: throw new Error("Unregistered market controller");
  }
}
