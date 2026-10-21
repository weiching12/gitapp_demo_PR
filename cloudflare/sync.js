import { MANIFEST_KEY, SYNC_KEY } from "./storage/market-keys.js";
import { taipeiDate } from "../shared/market.js";
import { T86Store } from "./t86-store.js";
import { acceptedT86 } from "./t86-sync.js";
import { put } from "./sync/common.js";
import { syncSlot, scheduledDates } from "./sync/plan.js";
import * as acquire from "./sync/acquire.js";
import * as snapshot from "./sync/snapshot.js";
import { publish } from "./sync/publish.js";
import { historyRepository } from "./repositories/history-repository.js";
import { createPushService } from "./composition.js";
export { syncSlot, pendingDates, scheduledDates } from "./sync/plan.js";
export { STAGE_TTL, SHARDS_PER_TICK } from "./sync/common.js";
const phases = { ...acquire, ...snapshot, publish };

export async function syncMarket(env, { now = new Date(), fetcher = fetch, t86Store } = {}) {
  const kv = env.MARKET_DATA, date = taipeiDate(now);
  const slot = syncSlot(now);
  if (!slot) return { date, status: "Skipped", phase: "outside-window" };
  const store = t86Store ?? new T86Store(env.T86_DB);
  let state = await kv.get(SYNC_KEY, "json");
  const manifest = await kv.get(MANIFEST_KEY, "json");
  const originalState = JSON.stringify(state);
  // Recover a publication whose final progress checkpoint was interrupted.
  if (state?.phase === "publish" && manifest?.generation === state.generation) {
    state.phase = "done";
    state.checkedThrough = state.reportDates.at(-1);
    state.cleanupGenerations = [];
    await put(kv, SYNC_KEY, state);
  }
  if (!state || state.date !== date || state.slot !== slot) {
    const checkedThrough = state?.phase === "done" && state.checkedThrough > manifest?.asOf ? state.checkedThrough : manifest?.asOf;
    const reportDates = [...new Set([...scheduledDates(manifest, date, checkedThrough), date])].sort();
    const cleanupGenerations = [...new Set([...(state?.cleanupGenerations ?? []),
      state && state.generation !== manifest?.generation && state.nextShard > 0 ? state.generation : null,
    ].filter(Boolean))];
    state = { date, slot, generation: `${date.replaceAll("-", "")}-${now.getTime()}`,
      phase: "t86", reportDates, nextDate: 0, dayCount: 0, nextShard: 0, failures: 0,
      cleanupGenerations };
  }
  if (state.phase === "done" || state.failures >= 3 || (state.retryAfter && now.getTime() < state.retryAfter)) return state;
  try {
    if (state.phase !== "publish" || now.getTime() >= state.publishAfter) {
      const phase = phases[state.phase];
      if (!phase) throw new Error(`Unknown sync phase: ${state.phase}`);
      await phase({ env, kv, state, manifest, store, now, fetcher, date, slot, history: historyRepository(env),
        notifier: state.phase === "publish" ? createPushService(env) : undefined });
    }
    state.retryAfter = null;
    if (state.t86Status === undefined || acceptedT86(state.t86Status)) state.error = null;
  } catch (error) {
    state.failures++;
    state.retryAfter = now.getTime() + 30 * 60000;
    state.error = error.message;
    console.error(JSON.stringify({ event: "twse-sync-delayed", date, phase: state.phase, failures: state.failures, error: error.message }));
  }
  if (JSON.stringify(state) !== originalState) await put(kv, SYNC_KEY, state);
  return state;
}
