import { SHARD_COUNT, mergeShard, shardKey, stageKey } from "../twse.js";
import { put, SHARDS_PER_TICK } from "./common.js";
import { retireShard } from "./cleanup.js";

export async function shards({ kv, state, manifest, now }) {
  const [catalog, days] = await Promise.all([
    kv.get(stageKey(state.generation, "catalog"), "json"), kv.get(stageKey(state.generation, "days"), "json"),
  ]);
  if (!catalog || !days?.length) throw new Error("Staged market days not visible yet");
  // Missing fingerprints deliberately force one full baseline publication.
  if (state.nextShard === 0 && typeof state.catalogHash === "string" && manifest?.catalogHash === state.catalogHash &&
      days.every((day) => manifest.dayHashes?.[day.date] === state.dayHashes?.[day.date])) {
    state.phase = "done";
    state.result = "Unchanged";
    state.checkedThrough = state.reportDates.at(-1);
    return;
  }
  for (let count = 0; count < SHARDS_PER_TICK && state.nextShard < SHARD_COUNT; count++) {
    const index = state.nextShard;
    const previous = manifest ? await kv.get(shardKey(manifest.generation, index), "json") : null;
    if (manifest && !previous) throw new Error("Last good history shard unavailable; do not replace it with one day");
    const chunk = { ...mergeShard(catalog, index, previous, days), generation: state.generation, index };
    await put(kv, shardKey(state.generation, index), chunk);
    await retireShard(kv, manifest, state, index);
    state.nextShard++;
  }
  if (state.nextShard === SHARD_COUNT) {
    state.phase = "publish";
    // KV is eventually consistent. Leave propagation time before switching readers.
    state.publishAfter = now.getTime() + 120000;
  }
}

