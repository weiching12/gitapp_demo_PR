import { HttpClient } from "./http-client.js";

export class PresenceApiClient {
  constructor(fetcher = fetch) { this.http = new HttpClient(fetcher); }

  async recordVisit(id, { signal, nationality, visitId, metadataOnly } = {}) {
    const { data } = await this.http.json("/api/v1/presence", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, visitId, nationality, metadataOnly }), cache: "no-store", signal,
    });
    return data;
  }

  async count({ signal } = {}) {
    const { data } = await this.http.json("/api/v1/presence", { cache: "no-store", signal });
    return data;
  }
}
