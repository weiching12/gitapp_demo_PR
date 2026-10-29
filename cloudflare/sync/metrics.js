export class SyncMetrics {
  constructor() { this.reset(); }
  reset() { this.counts = { read: 0, write: 0, delete: 0, failed: 0 }; }
  wrap(kv) {
    const invoke = async (operation, method, args) => {
      this.counts[operation]++;
      try { return await kv[method](...args); }
      catch (error) { this.counts.failed++; throw error; }
    };
    return { get: (...args) => invoke("read", "get", args),
      put: (...args) => invoke("write", "put", args),
      delete: (...args) => invoke("delete", "delete", args) };
  }
}

export async function saveSyncMetrics(storage, prior, state, counts, startedAt) {
  if (JSON.stringify(prior) === JSON.stringify(state) && !Object.values(counts).some(Boolean)) return;
  const previous = await storage.get("metrics");
  const sameRound = Boolean(previous) && previous.date === state.date && previous.slot === state.slot;
  const kv = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value + (sameRound ? previous.kv[key] : 0)]));
  const record = { date: state.date, slot: state.slot, phase: state.phase, kv,
    lastTickKv: { ...counts }, durationMs: Date.now() - startedAt, failures: state.failures,
    error: state.error ?? null, result: state.error ? "Failed" : state.result ?? (state.phase === "done" ? "Completed" : "Running") };
  await storage.put("metrics", record);
  console.log(JSON.stringify({ event: "market-sync-metrics", ...record }));
}
