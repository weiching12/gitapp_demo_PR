import { CATALOG_URL, ETF_CATALOG_URL, fetchJson, normalizeCatalog, normalizeEtfCatalog, normalizePrices, reportUrl } from "../adapters/twse.js";
import { marketDay, combineCatalogs } from "../../shared/market.js";
import { stageKey } from "../storage/market-keys.js";
import { isEtf } from "../../shared/market-codec.js";
import { acceptedT86, syncT86 } from "../t86-sync.js";
import { t86FlowReport } from "../t86-validator.js";
import { put, fingerprint } from "./common.js";

export async function t86({ env, state, store, now, fetcher, date, slot }) {
  // One acquisition per daily round. Minute ticks only advance the validated
  // generation; they never poll today's T86 again.
  const run = await syncT86(env, { tradeDate: date, slot, now, fetcher, store });
  state.t86Status = run.Status;
  state.t86VersionId = run.VersionId;
  state.t86Hash = run.DataHash;
  if (run.Status === "Running") {
    // A concurrent invocation owns this round. Keep waiting; syncT86 will
    // explicitly fail an expired attempt instead of repeating acquisition.
    state.phase = "t86";
  } else if (!acceptedT86(run.Status)) {
    state.phase = "done";
    state.error = run.ErrorMessage;
  } else {
    // T86 only fingerprints institution data. Even an unchanged report must
    // continue through catalog/prices and scheduled historical rechecks:
    // price/volume corrections and older T86 revisions have separate lives.
    // syncT86 still avoids rewriting unchanged institution rows in D1.
    state.phase = "catalog";
  }
}

export async function catalog({ kv, state, manifest, fetcher }) {
  const catalog = normalizeCatalog(await fetchJson(CATALOG_URL, fetcher));
  if (catalog.length < 900 || (manifest && catalog.length < manifest.stocks.filter((stock) => !isEtf(stock)).length * 0.95))
    throw new Error("Unexpectedly small TWSE catalog; preserve last good market");
  await put(kv, stageKey(state.generation, "companies"), catalog);
  state.phase = "etfs";
}

export async function etfs({ kv, state, manifest, fetcher }) {
  const etfs = normalizeEtfCatalog(await fetchJson(ETF_CATALOG_URL, fetcher));
  const priorEtfs = manifest?.stocks.filter(isEtf).length ?? 0;
  if (etfs.length < priorEtfs * 0.95) throw new Error("Unexpectedly small ETF catalog; preserve last good market");
  const companies = await kv.get(stageKey(state.generation, "companies"), "json");
  if (!companies) throw new Error("Staged company catalog not visible yet");
  const catalog = combineCatalogs(companies, etfs);
  state.catalogHash = await fingerprint(catalog);
  await put(kv, stageKey(state.generation, "catalog"), catalog);
  state.phase = "prices";
}

export async function prices({ kv, state, fetcher, date }) {
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
}

export async function flows({ env, kv, state, store, now, fetcher, date }) {
  const reportDate = state.reportDates[state.nextDate];
  if (reportDate !== date) {
    const run = await syncT86(env, { tradeDate: reportDate, slot: "backfill", now, fetcher, store });
    if (!acceptedT86(run.Status)) throw new Error(`Historical T86 ${run.Status}: ${run.ErrorMessage ?? reportDate}`);
  }
  const version = await store.current(reportDate);
  if (!version || (reportDate === date && version.VersionId !== state.t86VersionId))
    throw new Error("Validated T86 version unavailable or superseded; preserve public snapshot");
  const flows = t86FlowReport(JSON.parse(version.RowsJson), reportDate);
  const [catalog, prices] = await Promise.all([
    kv.get(stageKey(state.generation, "catalog"), "json"), kv.get(stageKey(state.generation, "prices"), "json"),
  ]);
  if (!catalog || !prices) throw new Error("Staged inputs not visible yet");
  const day = marketDay(catalog, prices, flows);
  state.dayHashes = { ...state.dayHashes, [day.date]: await fingerprint(day) };
  const days = await kv.get(stageKey(state.generation, "days"), "json") ?? [];
  const merged = new Map(days.map((item) => [item.date, item]));
  merged.set(day.date, day);
  await put(kv, stageKey(state.generation, "days"), [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)));
  state.dayCount = merged.size;
  state.nextDate++;
  state.phase = state.nextDate === state.reportDates.length ? "shards" : "prices";
}
