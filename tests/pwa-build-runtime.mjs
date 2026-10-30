// Build isolated fixtures with the real Vite configuration; never touch project dist or public.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const temporaryParent = await realpath(tmpdir());
const root = await mkdtemp(join(temporaryParent, "stockapps-pwa-build-"));
const publicDir = join(root, "public");
const outDir = join(root, "output");
const configFile = fileURLToPath(new URL("../vite.config.js", import.meta.url));

async function snapshot() {
  await build({ root, publicDir, configFile, configLoader: "runner", logLevel: "silent",
    build: { outDir, emptyOutDir: true } });
  const serviceWorker = await readFile(join(outDir, "sw.js"), "utf8");
  const match = serviceWorker.match(/const SHELL_CACHE = ("[^"]+")/);
  assert.ok(match, "The actual PWA plugin must generate a shell-cache version");
  const assets = (await readdir(join(outDir, "assets"))).filter(name => name.endsWith(".js")).sort();
  assert.ok(assets.length, "The fixture must produce a real JavaScript bundle");
  return { shell: JSON.parse(match[1]), bundles: await Promise.all(assets.map(async name =>
    [name, await readFile(join(outDir, "assets", name), "utf8")])) };
}

try {
  await mkdir(publicDir);
  await writeFile(join(root, "index.html"), '<!doctype html><html><body><main id="app"></main><script type="module" src="/main.js"></script></body></html>');
  await writeFile(join(root, "main.js"), 'document.getElementById("app").textContent = "PWA fingerprint fixture";');
  await writeFile(join(publicDir, "login.css"), "body { color: #14243b; }");
  await writeFile(join(publicDir, "login.js"), 'document.title = "Sign in";');
  await writeFile(join(publicDir, "login.html"), '<!doctype html><html><body><h1>Sign in</h1></body></html>');

  const initial = await snapshot();
  await writeFile(join(publicDir, "login.css"), "body { color: #2563eb; }");
  const cssChanged = await snapshot();
  assert.deepEqual(cssChanged.bundles, initial.bundles, "Public CSS changes must leave emitted JS bundles identical");
  assert.notEqual(cssChanged.shell, initial.shell, "Changing only public CSS must update the Service Worker version");
  assert.equal(await readFile(join(outDir, "login.css"), "utf8"), "body { color: #2563eb; }");

  const unchanged = await snapshot();
  assert.deepEqual(unchanged, cssChanged, "An unchanged rebuild must keep the same JS bundle and cache name");

  await writeFile(join(publicDir, "login.js"), 'document.title = "Updated sign in";');
  const jsChanged = await snapshot();
  assert.deepEqual(jsChanged.bundles, initial.bundles, "Public JS is copied without changing the app bundle");
  assert.notEqual(jsChanged.shell, unchanged.shell, "Changing only public JS must update the Service Worker version");

  await writeFile(join(publicDir, "login.html"), '<!doctype html><html><body><h1>Updated sign in</h1></body></html>');
  const htmlChanged = await snapshot();
  assert.deepEqual(htmlChanged.bundles, initial.bundles, "Public HTML is copied without changing the app bundle");
  assert.notEqual(htmlChanged.shell, jsChanged.shell, "Changing only public HTML must update the Service Worker version");
  console.log("PWA public asset fingerprint runtime passed: CSS, JS, HTML and stable rebuild (5 isolated builds).");
} finally {
  assert.equal(dirname(resolve(root)), temporaryParent, "Only remove this test's direct temporary child directory");
  assert.ok(root.startsWith(join(temporaryParent, "stockapps-pwa-build-")), "Refuse cleanup outside the test fixture");
  await rm(root, { recursive: true, force: true });
}
