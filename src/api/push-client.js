import { HttpClient } from "./http-client.js";

export class PushApiClient {
  constructor(fetcher) { this.http = new HttpClient(fetcher); }
  config() { return this.http.json("/api/v1/push/config", { cache: "no-store" }); }
  subscribe(subscription) { return this.http.json("/api/v1/push/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription) }); }
  unsubscribe(endpoint) { return this.http.json("/api/v1/push/subscriptions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint }) }); }
}
