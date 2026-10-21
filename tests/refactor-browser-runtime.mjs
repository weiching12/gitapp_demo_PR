// Build first. Serve local assets and a fixed API fixture; no production requests.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { normalizeCatalog, normalizePrices, normalizeFlows, marketDay, createManifest, mergeShard } from "../cloudflare/twse.js";
import { combineChunks } from "../src/provider.js";
import { getSnapshot } from "../shared/indicators.js";
import { getSectorOverview, getSectorDetail } from "../shared/sectors.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/twse-20261016.json", import.meta.url), "utf8"));
const date = "2026-10-16", catalog = normalizeCatalog(fixture.companies);
const day = marketDay(catalog, normalizePrices(fixture.prices, date), normalizeFlows(fixture.flows, date));
const manifest = createManifest(catalog, [date], "ui-boundaries", "2026-10-16T12:00:00Z", day.coverage);
const chunks = Array.from({ length: 128 }, (_, index) => ({ ...mergeShard(catalog, index, null, [day]), generation: manifest.generation, index }));
const dataset = combineChunks(manifest, chunks), snapshots = dataset.stocks.map((stock) => getSnapshot(stock, date));
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const server = createServer(async (request, response) => {
  request.resume();
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    const chunk = path.match(/^\/api\/market\/ui-boundaries\/(\d+)$/);
    if (path === "/api/market" || path === "/api/presence" || chunk) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(path === "/api/market" ? manifest : path === "/api/presence"
        ? { online: 1, windowSeconds: 90 } : chunks[Number(chunk[1])]));
      return;
    }
    const target = resolve(dist, `.${path === "/" ? "/index.html" : path}`);
    if (!target.startsWith(resolve(dist) + sep)) throw new Error("Invalid asset path");
    const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
    const contents = await readFile(target);
    response.writeHead(200, { "Content-Type": types[extname(target)] ?? "application/octet-stream" });
    response.end(contents);
  } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
    await page.locator('.sidebar [data-page="sectors"]').click();
    for (const window of ["day", "5", "20"]) {
      await page.locator(`[data-sector-window="${window}"]`).click();
      const expected = getSectorOverview(snapshots, { window, sort: "name-asc", tradingDates: dataset.dates, asOf: date });
      assert.deepEqual(await page.locator(".sector-card").evaluateAll((cards) => cards.map((card) => card.dataset.sectorName)), expected.map((sector) => sector.name));
      const amounts = await page.locator(".sector-card [data-sector-amount]").allTextContents();
      assert.deepEqual(amounts, expected.map(({ estimate: { amount } }) => amount === null ? ""
        : `${amount > 0 ? "+" : ""}${(amount / 1e8).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 億`));
    }
    const card = page.locator(".sector-card").first(), name = await card.getAttribute("data-sector-name");
    await card.click();
    await expect(page.locator("#sector-dialog")).toBeVisible();
    assert.equal(await page.locator(".sector-stock-table tbody tr").count(), getSectorDetail(snapshots, name, { tradingDates: dataset.dates, asOf: date }).members.length);
    await page.locator(width <= 520 ? "#sector-dialog .sector-dialog-handle" : "#close-sector-dialog").click();
    await expect(page.locator("#sector-dialog")).toBeHidden();
    await page.locator('.sidebar [data-page="market"]').click();
    const star = page.locator('#stock-rows [data-favorite="2330"]');
    const selected = await star.getAttribute("aria-pressed");
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", selected === "true" ? "false" : "true");
    await page.locator(".brand-intro button").click();
    await expect(page.locator(".about-goal")).toHaveCount(5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS browser ${width}px: all sector windows match shared model, detail, favorite, navigation and layout`);
    await context.close();
  }
} finally {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await browser?.close();
}
