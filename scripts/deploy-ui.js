import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { build } from "vite";

// Explicitly reuse the Git revision corresponding to the live backend. This
// publishes UI work without enabling an unfinished database migration.
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
const backendRef = args["backend-ref"];
if (!/^[a-f0-9]{7,40}$/.test(backendRef ?? ""))
  throw new Error("Use --backend-ref=<deployed Git SHA>, after checking wrangler deployments list");
const root = process.cwd();
function git(...args) {
  const result = spawnSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Git read failed");
  return result.stdout;
}
const config = JSON.parse(git("show", `${backendRef}:wrangler.jsonc`));
if (config.name !== "stock-insight-tw" || config.main !== "cloudflare/worker.js" || config.d1_databases?.length)
  throw new Error("This UI-only release path requires the existing pre-D1 stock-insight-tw backend");
const note = git("show", `${backendRef}:src/main.js`).match(/<dt>更新方式<\/dt><dd>([^<]+)<\/dd>/)?.[1];
if (!note) throw new Error("Cannot determine the deployed backend's update description");
const head = git("rev-parse", "--short", "HEAD").trim();
const stage = resolve(".wrangler", `ui-release-${head}-${Date.now()}`);
const files = git("ls-tree", "-r", "--name-only", backendRef, "cloudflare", "src/market-codec.js").trim().split("\n");
for (const file of files) {
  const target = resolve(stage, file);
  if (!target.startsWith(`${stage}${sep}`)) throw new Error("Invalid release staging path");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, git("show", `${backendRef}:${file}`));
}
config.main = resolve(stage, config.main);
config.assets.directory = resolve(stage, "dist");
const configPath = resolve(stage, "wrangler.json");
await writeFile(configPath, JSON.stringify(config, null, 2));
await build({ configLoader: "runner", mode: "cloudflare",
  define: { "import.meta.env.VITE_SYNC_NOTE": JSON.stringify(note) },
  build: { outDir: config.assets.directory, emptyOutDir: true } });
await writeFile(resolve(stage, "release.json"), JSON.stringify({ uiCommit: git("rev-parse", "HEAD").trim(),
  backendCommit: git("rev-parse", backendRef).trim(), configPath, syncNote: note, createdAt: new Date().toISOString() }, null, 2));
console.log(`UI release staged at ${stage}; backend ${backendRef}, schedule ${config.triggers.crons.join(", ")}`);
if (!Object.hasOwn(args, "build-only")) {
  const result = spawnSync(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), "deploy", "--config", configPath,
    "--keep-vars", "--message", `UI ${head}; existing backend ${backendRef}`, ...(Object.hasOwn(args, "dry-run") ? ["--dry-run"] : [])],
  { stdio: "inherit", env: { ...process.env, WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? resolve(".wrangler/logs") } });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
