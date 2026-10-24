import { T86DataValidator, T86_QUERY, normalizeT86Date, t86DataHash } from "./t86-validator.js";
import { T86Store } from "./t86-store.js";

export const acceptedT86 = (status) => status === "Success" || status === "Unchanged";
// Fetches time out after 30 seconds; leave ample time for validation and D1.
// An interrupted invocation must not leave its daily unique slot locked forever.
export const T86_RUNNING_TIMEOUT_MS = 5 * 60 * 1000;
export const isoTradeDate = (date) => {
  const compact = normalizeT86Date(date);
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`;
};
const auditRun = (run) => ({ ...run, ValidationResult: typeof run.ValidationResult === "string"
  ? JSON.parse(run.ValidationResult) : run.ValidationResult });

async function existingDailyRun(store, date, slot, now) {
  const previous = await store.scheduledRun(date, slot);
  if (!previous) return null;
  const run = auditRun(previous);
  if (run.Status !== "Running") return run;
  const started = Date.parse(run.SyncTime);
  if (Number.isFinite(started) && now.getTime() - started < T86_RUNNING_TIMEOUT_MS) return run;
  run.Status = "Failed";
  run.VersionId = null;
  run.ErrorMessage = "T86 invocation interrupted or exceeded the running timeout; preserve the last verified version";
  run.ValidationResult = [...(run.ValidationResult ?? []), { rule: "interruptedRun", passed: false,
    timeoutMs: T86_RUNNING_TIMEOUT_MS, checkedAt: now.toISOString(), error: run.ErrorMessage }];
  // Update the original RunId, retaining its response/chunks and start time.
  // Do not insert another record into the same uniquely constrained daily slot.
  return auditRun(await store.expireRun(run));
}

/** Daily rounds and backfills enter here; raw responses and failed attempts are
 * audit data only. No staging/business table is touched until validation passes.
 */
export async function syncT86(env, { tradeDate, slot = "backfill", now = new Date(), fetcher = fetch,
  rawJson, httpStatus, store = new T86Store(env.T86_DB), skipWeekend = true } = {}) {
  const date = isoTradeDate(tradeDate);
  if (!["18:30", "20:30", "backfill"].includes(slot)) throw new Error("Invalid T86 sync slot");
  if (slot !== "backfill") {
    const existing = await existingDailyRun(store, date, slot, now);
    if (existing) return existing;
  }
  const run = { RunId: crypto.randomUUID(), TradeDate: date, SyncTime: now.toISOString(),
    Source: "TWSE T86", QueryKey: T86_QUERY, Slot: slot, RecordCount: 0, DataHash: null,
    Status: "Running", ValidationResult: [], ErrorMessage: null, RawJson: null, HttpStatus: null, VersionId: null };
  try { await store.log(run); }
  catch (error) {
    // Another Cron may have claimed the slot after our initial read. Reuse that
    // attempt without issuing another upstream request or claiming success.
    const existing = slot !== "backfill" && await existingDailyRun(store, date, slot, now);
    if (existing) return existing;
    throw error;
  }
  try {
    if (skipWeekend && [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
      run.Status = "Skipped";
      run.ValidationResult = [{ rule: "calendar", passed: false, reason: "Weekend" }];
    } else {
      if (rawJson === undefined) {
        const url = new URL("https://www.twse.com.tw/rwd/zh/fund/T86");
        url.search = new URLSearchParams({ response: "json", date: normalizeT86Date(date), selectType: "ALLBUT0999" }).toString();
        const response = await fetcher(url, { signal: AbortSignal.timeout(30000), headers: { Accept: "application/json" } });
        httpStatus = response.status;
        rawJson = await response.text();
      }
      run.RawJson = rawJson;
      run.HttpStatus = httpStatus;
      // Persist raw evidence before later database/validation errors can occur.
      await store.log(run);
      const persisted = await store.getRun(run.RunId);
      if (persisted.Status !== "Running") return auditRun(persisted);
      const context = await store.context(date);
      const validator = new T86DataValidator({
        historyRatio: Number(env.T86_HISTORY_RATIO ?? 0.90), eveningRatio: Number(env.T86_EVENING_RATIO ?? 0.95),
      });
      const input = { httpStatus, rawJson, tradeDate: date, slot, ...context };
      let result = validator.validate(input);
      if (result.rows.length) {
        run.DataHash = await t86DataHash(result.rows, date);
        if (result.status === "PendingConfirmation" && await store.approved(date, run.DataHash))
          result = validator.validate({ ...input, baselineConfirmed: true });
      }
      run.RecordCount = result.recordCount;
      run.ValidationResult = result.checks;
      run.ErrorMessage = result.error;
      run.Status = result.status;
      if (result.valid) {
        run.Status = context.current?.DataHash === run.DataHash ? "Unchanged" : "Success";
        run.VersionId = run.Status === "Unchanged" ? context.current.VersionId : run.RunId;
        await store.commit(run, result.rows, context.current);
        return run;
      }
    }
  } catch (error) {
    run.Status = "Failed";
    run.VersionId = null;
    run.ErrorMessage = error.message;
    run.ValidationResult.push({ rule: "syncOrTransaction", passed: false, error: error.message });
  }
  await store.log(run);
  // A commit may have succeeded before its response was lost, or a different
  // invocation may have expired this run. Return the persisted terminal result;
  // a late catch must neither overwrite nor misreport that result.
  return auditRun(await store.getRun(run.RunId));
}
