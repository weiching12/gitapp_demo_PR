import { routeApi } from "./api/router.js";
import { syncMarket } from "./sync.js";
export { OnlinePresence } from "./presence.js";

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    return path === "/api" || path.startsWith("/api/")
      ? routeApi(request, env) : env.ASSETS.fetch(request);
  },
  async scheduled(controller, env) {
    const state = await syncMarket(env, { now: new Date(controller.scheduledTime) });
    console.log(JSON.stringify({ event: "twse-sync", date: state.date, slot: state.slot, phase: state.phase,
      t86Status: state.t86Status, nextShard: state.nextShard, failures: state.failures, error: state.error }));
  },
};
