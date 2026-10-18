import { CATALOG_URL, HISTORY_LIMIT, MANIFEST_KEY, SHARD_COUNT, SYNC_KEY, createManifest, fetchJson,
  marketDay, mergeShard, normalizeCatalog, normalizeFlows, normalizePrices, reportUrl, shardKey, stageKey, taipeiDate } from "./twse.js";

const put = (kv, key, value) => kv.put(key, JSON.stringify(value));

export function pendingDates(after, through, limit = 10) {
  const cursor = new Date(`${after ?? through}T00:00:00Z`), dates = [];
  if (after) cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.toISOString().slice(0, 10) <= through && dates.length < limit) {
    if (![0, 6].includes(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function scheduledDates(manifest, through, checkedThrough) {
  const pending = pendingDates(checkedThrough ?? manifest?.asOf, through);
  // Recheck the last two published sessions once a week for late corrections,
  // instead of re-downloading every stock's two-week history every night.
  const recheck = manifest && new Date(`${through}T00:00:00Z`).getUTCDay() === 5
    ? manifest.dates.filter((date) => date < through).slice(-2) : [];
  return [...new Set([...recheck, ...pending])].sort();
}

/** One phase per minute, one whole-market upstream call at most per invocation.
 * Two small history shards per subsequent invocation keep CPU/memory bounded.
 * The public manifest switches only after all immutable shards have been written.
 */
export async function syncMarket(env, { now = new Date(), fetcher = fetch } = {}) {
  const kv = env.MARKET_DATA, date = taipeiDate(now);
  let state = await kv.get(SYNC_KEY, "json");
  const manifest = await kv.get(MANIFEST_KEY, "json");
  if (manifest?.asOf >= date) return { status: "current", date: manifest.asOf };
  if (!state || state.date !== date) {
    const checkedThrough = state?.phase === "done" && state.checkedThrough > manifest?.asOf ? state.checkedThrough : manifest?.asOf;
    const reportDates = scheduledDates(manifest, date, checkedThrough);
    const cleanupGenerations = [...new Set([...(state?.cleanupGenerations ?? []),
      state && state.generation !== manifest?.generation && state.nextShard > 0 ? state.generation : null,
    ].filter(Boolean))];
    if (state) for (const type of ["catalog", "prices", "days"]) await kv.delete(stageKey(state.generation, type));
    state = { date, generation: `${date.replaceAll("-", "")}-${now.getTime()}`,
      phase: reportDates.length ? "catalog" : "done", reportDates, nextDate: 0, dayCount: 0, nextShard: 0, failures: 0,
      cleanupGenerations };
  }
  if (state.phase === "done" || state.failures >= 3 || (state.retryAfter && now.getTime() < state.retryAfter)) return state;
  try {
    if (state.phase === "catalog") {
      const catalog = normalizeCatalog(await fetchJson(CATALOG_URL, fetcher));
      if (catalog.length < 900 || (manifest && catalog.length < manifest.stocks.length * 0.95))
        throw new Error("Unexpectedly small TWSE catalog; preserve last good market");
      await put(kv, stageKey(state.generation, "catalog"), catalog);
      state.phase = "prices";
    } else if (state.phase === "prices") {
      const reportDate = state.reportDates[state.nextDate];
      const prices = normalizePrices(await fetchJson(reportUrl("prices", reportDate), fetcher), reportDate);
      if (!prices && reportDate === date) throw new Error("No price report yet (holiday or unpublished); retry only after cooldown");
      if (!prices) {
        state.nextDate++;
        if (state.nextDate === state.reportDates.length) {
          state.phase = state.dayCount ? "shards" : "done";
          if (!state.dayCount) state.checkedThrough = reportDate;
        }
      } else {
        if (prices.reportRows < 900) throw new Error("Suspiciously short TWSE price report");
        await put(kv, stageKey(state.generation, "prices"), prices);
        state.phase = "flows";
      }
    } else if (state.phase === "flows") {
      const reportDate = state.reportDates[state.nextDate];
      const flows = normalizeFlows(await fetchJson(reportUrl("flows", reportDate), fetcher), reportDate);
      if (!flows || flows.reportRows < 500) throw new Error("Institution report not ready or too short");
      const [catalog, prices] = await Promise.all([
        kv.get(stageKey(state.generation, "catalog"), "json"), kv.get(stageKey(state.generation, "prices"), "json"),
      ]);
      if (!catalog || !prices) throw new Error("Staged inputs not visible yet");
      const day = marketDay(catalog, prices, flows);
      const days = await kv.get(stageKey(state.generation, "days"), "json") ?? [];
      const merged = new Map(days.map((item) => [item.date, item]));
      merged.set(day.date, day);
      await put(kv, stageKey(state.generation, "days"), [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)));
      state.dayCount = merged.size;
      state.nextDate++;
      state.phase = state.nextDate === state.reportDates.length ? "shards" : "prices";
    } else if (state.phase === "shards") {
      const [catalog, days] = await Promise.all([
        kv.get(stageKey(state.generation, "catalog"), "json"), kv.get(stageKey(state.generation, "days"), "json"),
      ]);
      if (!catalog || !days?.length) throw new Error("Staged market days not visible yet");
      for (let count = 0; count < 2 && state.nextShard < SHARD_COUNT; count++) {
        const index = state.nextShard;
        const previous = manifest ? await kv.get(shardKey(manifest.generation, index), "json") : null;
        if (manifest && !previous) throw new Error("Last good history shard unavailable; do not replace it with one day");
        const chunk = { ...mergeShard(catalog, index, previous, days), generation: state.generation, index };
        await put(kv, shardKey(state.generation, index), chunk);
        // Keep the currently public generation. Retire only the generation before it.
        for (const generation of new Set([manifest?.previousGeneration, ...(state.cleanupGenerations ?? [])].filter(Boolean))) {
          if (generation !== manifest?.generation && generation !== state.generation) {
            const key = shardKey(generation, index);
            // Nonexistent-key deletions also consume the free daily quota.
            if (await kv.get(key) !== null) await kv.delete(key);
          }
        }
        state.nextShard++;
      }
      if (state.nextShard === SHARD_COUNT) {
        state.phase = "publish";
        // KV is eventually consistent. Leave propagation time before switching readers.
        state.publishAfter = now.getTime() + 120000;
      }
    } else if (state.phase === "publish" && now.getTime() >= state.publishAfter) {
      const [catalog, days] = await Promise.all([
        kv.get(stageKey(state.generation, "catalog"), "json"), kv.get(stageKey(state.generation, "days"), "json"),
      ]);
      if (!catalog || !days?.length) throw new Error("Cannot publish missing staged inputs");
      const dates = [...new Set([...(manifest?.dates ?? []), ...days.map((day) => day.date)])].sort().slice(-HISTORY_LIMIT);
      await put(kv, MANIFEST_KEY, createManifest(catalog, dates, state.generation, now.toISOString(), days.at(-1).coverage, manifest?.generation));
      // Staging inputs are no longer used; two generations of history remain.
      for (const type of ["catalog", "prices", "days"]) await kv.delete(stageKey(state.generation, type));
      state.phase = "done";
      state.checkedThrough = state.reportDates.at(-1);
      state.cleanupGenerations = [];
    }
    state.retryAfter = null;
    state.error = null;
  } catch (error) {
    state.failures++;
    state.retryAfter = now.getTime() + 30 * 60000;
    state.error = error.message;
    console.error(JSON.stringify({ event: "twse-sync-delayed", date, phase: state.phase, failures: state.failures, error: error.message }));
  }
  await put(kv, SYNC_KEY, state);
  return state;
}
