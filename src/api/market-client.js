import { HttpClient } from "./http-client.js";

export const MARKET_API_PATH = "/api/v1/market";

export class MarketApiClient {
  constructor(fetcher = fetch) { this.http = new HttpClient(fetcher); }

  market(options) { return this.http.json(MARKET_API_PATH, options); }
  snapshot(path, options) { return this.http.json(path, options); }
}
