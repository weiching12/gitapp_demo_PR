import { routeApi } from "./api/router.js";
import { coordinateMarketSync } from "./sync/coordinator.js";
export { MarketSyncCoordinator } from "./sync/coordinator.js";
export { MarketSummaryCoordinator } from "./summary-coordinator.js";
export { OnlinePresence } from "./presence.js";

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    return path === "/api" || path.startsWith("/api/")
      ? routeApi(request, env) : env.ASSETS.fetch(request);
  },
  async scheduled(controller, env) {
    const state = await coordinateMarketSync(env, controller.scheduledTime);
    console.log(JSON.stringify({ event: "twse-sync", date: state.date, slot: state.slot, phase: state.phase,
      t86Status: state.t86Status, nextShard: state.nextShard, failures: state.failures, error: state.error }));
  },
};
