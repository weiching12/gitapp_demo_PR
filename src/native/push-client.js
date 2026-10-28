import { HttpClient } from "../api/http-client.js";

export class NativePushClient {
  constructor(fetcher = fetch) { this.http = new HttpClient(fetcher); }
  config() { return this.http.json("/api/v1/push/native/config", { cache: "no-store" }); }
  subscribe(input) { return this.http.json("/api/v1/push/native/subscriptions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
  unsubscribe(input) { return this.http.json("/api/v1/push/native/subscriptions", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
}
