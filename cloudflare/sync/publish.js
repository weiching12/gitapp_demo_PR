import { HISTORY_LIMIT } from "../../shared/market-codec.js";
import { MANIFEST_KEY, stageKey } from "../storage/market-keys.js";
import { createManifest } from "../snapshots/market-format.js";
import { put } from "./common.js";

export async function publish({ kv, state, manifest, store, now, date, slot, history }) {
  const [catalog, days] = await Promise.all([
    kv.get(stageKey(state.generation, "catalog"), "json"), kv.get(stageKey(state.generation, "days"), "json"),
  ]);
  if (!catalog || !days?.length) throw new Error("Cannot publish missing staged inputs");
  const version = await store.current(date);
  if (version?.VersionId !== state.t86VersionId) throw new Error("T86 changed during staging; refuse stale publication");
  const dates = [...new Set([...(manifest?.dates ?? []), ...days.map((day) => day.date)])].sort().slice(-HISTORY_LIMIT);
  state.publishedAt ??= now.toISOString();
  const next = { ...createManifest(catalog, dates, state.generation, state.publishedAt, days.at(-1).coverage, manifest?.generation),
    t86Hash: state.t86Hash, t86VersionId: state.t86VersionId, syncSlot: slot,
    catalogHash: state.catalogHash,
    dayHashes: Object.fromEntries(Object.entries({ ...manifest?.dayHashes, ...state.dayHashes }).filter(([day]) => dates.includes(day))) };
  // Use one stable publication timestamp across retries and both storage systems.
  if (history) await history.commit(next);
  await put(kv, MANIFEST_KEY, next);
  if (history) await history.retainPublished(next.generation, next.previousGeneration);
  // Temporary inputs expire; public history never receives a TTL.
  state.phase = "done";
  state.checkedThrough = state.reportDates.at(-1);
  state.cleanupGenerations = [];
}
