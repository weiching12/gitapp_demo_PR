import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CATALOG_URL, MANIFEST_KEY, SHARD_COUNT, createManifest, fetchJson, marketDay,
  mergeShard, normalizeCatalog, normalizeFlows, normalizePrices, reportUrl, shardKey, taipeiDate, validDate } from "../cloudflare/twse.js";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const readJson = async (path) => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
async function saveJson(path, value) {
  await writeFile(`${path}.tmp`, JSON.stringify(value));
  await rename(`${path}.tmp`, path);
}

/** Sequential, resumable bulk download. Cache only successful JSON replies. */
export async function seedMarket({ end = taipeiDate(), sessions = 90, interval = 10000,
  directory = ".wrangler/twse-cache", output = ".wrangler/market-seed.json", offline = false,
  fetcher = fetch, wait = sleep, now = () => Date.now(), log = console.log } = {}) {
  if (!validDate(end) || end > taipeiDate() || !Number.isInteger(sessions) || sessions < 1 || sessions > 260 || interval < 10000)
    throw new Error("Use a valid --end date, 1–260 --sessions, and --interval >= 10000 ms");
  await mkdir(directory, { recursive: true });
  let lastRequest = 0;
  async function request(url) {
    if (offline) throw new Error(`Offline cache missing: ${url}`);
    const delay = Math.max(0, lastRequest + interval - now());
    if (delay) await wait(delay);
    lastRequest = now();
    // Fail fast on 403/429/network errors. No parallelism or automatic retry loop.
    return fetchJson(url, fetcher);
  }
  const catalogPath = `${directory}/companies.json`;
  let cachedCatalog = await readJson(catalogPath);
  if (!cachedCatalog || (!offline && cachedCatalog.checkedOn !== taipeiDate())) {
    const rows = await request(CATALOG_URL);
    const stocks = normalizeCatalog(rows);
    if (stocks.length < 900) throw new Error("Unexpectedly small listed-company catalog");
    cachedCatalog = { checkedOn: taipeiDate(), rows };
    await saveJson(catalogPath, cachedCatalog);
  }
  const catalog = normalizeCatalog(cachedCatalog.rows);
  const days = [];
  const cursor = new Date(`${end}T00:00:00Z`);
  for (let scanned = 0; days.length < sessions && scanned < 600; scanned++, cursor.setUTCDate(cursor.getUTCDate() - 1)) {
    if ([0, 6].includes(cursor.getUTCDay())) continue;
    const date = cursor.toISOString().slice(0, 10);
    const pricePath = `${directory}/prices-${date}.json`;
    let rawPrices = await readJson(pricePath);
    if (!rawPrices) {
      rawPrices = await request(reportUrl("prices", date));
      normalizePrices(rawPrices, date);
      // Today's no-data reply might simply precede publication; don't pin it.
      if (date < taipeiDate() || rawPrices.stat === "OK") await saveJson(pricePath, rawPrices);
    }
    const prices = normalizePrices(rawPrices, date);
    if (!prices) { log(`${date}: no exchange report`); continue; }
    const flowPath = `${directory}/flows-${date}.json`;
    let rawFlows = await readJson(flowPath);
    if (!rawFlows) {
      rawFlows = await request(reportUrl("flows", date));
      if (!normalizeFlows(rawFlows, date)) throw new Error(`Institution report not published: ${date}`);
      await saveJson(flowPath, rawFlows);
    }
    const day = marketDay(catalog, prices, normalizeFlows(rawFlows, date));
    if (prices.reportRows < 900 || rawFlows.data.length < 500) throw new Error(`Suspiciously short market report: ${date}`);
    days.push(day);
    if (!offline) await saveJson(`${directory}/progress.json`, { companies: catalog.length, requestedSessions: sessions,
      completedSessions: days.length, newest: days[0].date, oldest: date, checkedAt: new Date(now()).toISOString() });
    log(`${date}: ${days.length}/${sessions} sessions; ${day.coverage.traded} traded, ${day.coverage.missingInstitutions.length} institution rows absent`);
  }
  if (days.length !== sessions) throw new Error("Could not collect requested history; cached progress retained");
  days.reverse();
  // A republished seed must get a new immutable URL, even for the same end date.
  const generation = `seed-${days.at(-1).date.replaceAll("-", "")}-${sessions}-${now()}`;
  const manifest = createManifest(catalog, days.map((day) => day.date), generation,
    new Date(now()).toISOString(), days.at(-1).coverage);
  const entries = Array.from({ length: SHARD_COUNT }, (_, index) => ({
    key: shardKey(generation, index), value: JSON.stringify({ ...mergeShard(catalog, index, null, days), generation, index }),
  }));
  entries.push({ key: MANIFEST_KEY, value: JSON.stringify(manifest) });
  await mkdir(resolve(output, ".."), { recursive: true });
  await saveJson(output, entries);
  log(`Saved ${catalog.length} companies / ${sessions} market sessions / ${entries.length} KV keys to ${output}. No cloud resources changed.`);
  return { manifest, entries };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
  seedMarket({ ...(args.end && { end: args.end }), ...(args.sessions && { sessions: Number(args.sessions) }),
    ...(args.interval && { interval: Number(args.interval) }), ...(args.directory && { directory: args.directory }),
    ...(args.output && { output: args.output }), offline: Object.hasOwn(args, "offline") })
    .catch((error) => { console.error(`TWSE ingestion stopped: ${error.message}. Re-run to resume cached downloads.`); process.exitCode = 1; });
}
