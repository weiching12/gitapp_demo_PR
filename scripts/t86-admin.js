import { readFile, writeFile, mkdir, unlink, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import wrangler from "wrangler";
import { T86Store } from "../cloudflare/t86-store.js";
import { syncT86 } from "../cloudflare/t86-sync.js";
const { getPlatformProxy, unstable_splitSqlQuery: splitSqlQuery } = wrangler;

// No public ingestion endpoint. This operator command uses Wrangler credentials
// for --remote; local is the default. Cached raw reports need no TWSE requests.
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split(/=(.*)/s).slice(0, 2)));
const remote = Object.hasOwn(args, "remote");
const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
if (remote && !config.d1_databases[0].database_id) throw new Error("Set the created D1 database_id in wrangler.jsonc before remote operations");
await mkdir(".wrangler", { recursive: true });
const path = resolve(`.wrangler/t86-admin-${process.pid}.json`);
const binding = { ...config.d1_databases[0], remote };
await writeFile(path, JSON.stringify({ name: "t86-admin", compatibility_date: config.compatibility_date,
  vars: config.vars, d1_databases: [binding] }));
let proxy;
try {
  proxy = await getPlatformProxy({ configPath: path, persist: { path: ".wrangler/state/v3" }, remoteBindings: remote });
  const env = proxy.env, store = new T86Store(env.T86_DB);
  if (Object.hasOwn(args, "migrate")) {
    const db = env.T86_DB;
    await db.prepare(`CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`).run();
    const names = (await readdir("cloudflare/migrations")).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
    for (const name of names) {
      const applied = await db.prepare("SELECT 1 FROM d1_migrations WHERE name=?").bind(name).first();
      if (!applied) await db.batch([
        ...splitSqlQuery(await readFile(`cloudflare/migrations/${name}`, "utf8")).map((sql) => db.prepare(sql)),
        db.prepare("INSERT INTO d1_migrations(name) VALUES(?)").bind(name),
      ]);
      console.log(`${name}: ${applied ? "already applied" : "applied atomically"}`);
    }
  } else if (args.approve) {
    if (!args["confirmed-by"]?.trim()) throw new Error("--confirmed-by is required for a reviewed bootstrap report");
    const run = await store.statement("SELECT * FROM t86_sync_runs WHERE RunId=?", args.approve).first();
    if (!run || run.Status !== "PendingConfirmation" || !run.DataHash) throw new Error("Only an exact PendingConfirmation report can be approved");
    await store.statement(`INSERT INTO t86_baseline_approvals VALUES(?,?,?,?,?)
      ON CONFLICT(QueryKey,TradeDate,DataHash) DO NOTHING`, run.QueryKey, run.TradeDate, run.DataHash,
    args["confirmed-by"], new Date().toISOString()).run();
    // Revalidate all rules and current count context; approval never skips them.
    const replay = await syncT86(env, { tradeDate: run.TradeDate, slot: "backfill", rawJson: await store.raw(run),
      httpStatus: run.HttpStatus, store });
    console.log(JSON.stringify(replay, (key, value) => key === "RawJson" ? undefined : value, 2));
    if (!["Success", "Unchanged"].includes(replay.Status)) process.exitCode = 1;
  } else if (args.file && args.date) {
    const run = await syncT86(env, { tradeDate: args.date, rawJson: await readFile(args.file, "utf8"), httpStatus: 200, store });
    console.log(JSON.stringify(run, (key, value) => key === "RawJson" ? undefined : value, 2));
    if (!["Success", "Unchanged"].includes(run.Status)) process.exitCode = 1;
  } else if (Object.hasOwn(args, "status")) {
    console.log(JSON.stringify((await store.statement(`SELECT RunId,TradeDate,SyncTime,Slot,Status,RecordCount,DataHash,
      ValidationResult,ErrorMessage FROM t86_sync_runs ORDER BY SyncTime DESC LIMIT 30`).all()).results, null, 2));
  } else throw new Error("Use --migrate, --status, --date=YYYY-MM-DD --file=raw.json, or --approve=RunId --confirmed-by=operator; optional --remote");
} finally {
  if (proxy) await proxy.dispose();
  await unlink(path);
}
