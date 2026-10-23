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
import { MarketSummaryService } from "../cloudflare/services/market-summary-service.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/twse-20261016.json", import.meta.url), "utf8"));
const date = "2026-10-16", catalog = normalizeCatalog(fixture.companies);
const day = marketDay(catalog, normalizePrices(fixture.prices, date), normalizeFlows(fixture.flows, date));
const manifest = createManifest(catalog, [date], "ui-boundaries", "2026-10-16T12:00:00Z", day.coverage);
const versionedManifest = { ...manifest, chunks: manifest.chunks.map((_, index) =>
  `/api/v1/market/snapshots/${manifest.generation}/shards/${index}`) };
const chunks = Array.from({ length: 128 }, (_, index) => ({ ...mergeShard(catalog, index, null, [day]), generation: manifest.generation, index }));
const dataset = combineChunks(manifest, chunks), snapshots = dataset.stocks.map((stock) => getSnapshot(stock, date));
const summaryService = new MarketSummaryService({ market: async () => manifest,
  shards: async (_generation, indices) => indices.map((index) => chunks[index]) });
const summary = await summaryService.summary(date, { period: 9, kSmooth: 3, dSmooth: 3 });
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const serverErrors = [];
const apiRequests = [];
const server = createServer(async (request, response) => {
  request.resume();
  try {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;
    if (path.startsWith("/api/")) apiRequests.push(path);
    const sector = path.match(/^\/api\/v1\/sectors\/(.+)$/);
    if (path === "/api/v1/market" || path === "/api/v1/market/summary" ||
        path === "/api/v1/favorites/summary" || path === "/api/v1/presence" || sector) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(path === "/api/v1/market" ? versionedManifest : path === "/api/v1/presence"
        ? { online: 1, windowSeconds: 90 } : path === "/api/v1/market/summary" ? summary
          : path === "/api/v1/favorites/summary"
            ? await summaryService.favorites(new URL(request.url, "http://localhost").searchParams.get("symbols").split(","),
              date, { period: 9, kSmooth: 3, dSmooth: 3 })
            : await summaryService.sector(decodeURIComponent(sector[1]), url.searchParams.get("asOf"), { period: 9, kSmooth: 3, dSmooth: 3 })));
      return;
    }
    const target = resolve(dist, `.${path === "/" ? "/index.html" : path}`);
    if (!target.startsWith(resolve(dist) + sep)) throw new Error("Invalid asset path");
    const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
    const contents = await readFile(target);
    response.writeHead(200, { "Content-Type": types[extname(target)] ?? "application/octet-stream" });
    response.end(contents);
  } catch (error) { serverErrors.push({ url: request.url, message: error.message }); if (!response.headersSent) response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
  for (const width of [1440, 390]) {
    const previousFavoriteRequests = apiRequests.filter((path) => path === "/api/v1/favorites/summary").length;
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("requestfailed", (request) => errors.push(`${request.url()} ${request.failure()?.errorText}`));
    await page.route(/https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
    assert.equal(apiRequests.filter((path) => path.includes("/shards/")).length, 0);
    assert.equal(apiRequests.filter((path) => path === "/api/v1/market/summary").length, width === 1440 ? 1 : 2);
    assert.equal(apiRequests.filter((path) => path === "/api/v1/favorites/summary").length, previousFavoriteRequests);
    await page.locator('.sidebar [data-page="sectors"]').click();
    for (const window of ["day", "5", "20"]) {
      await page.locator(`[data-sector-window="${window}"]`).click();
      const expected = getSectorOverview(snapshots, { window, sort: "name-asc", tradingDates: dataset.dates, asOf: date });
      const actual = await page.locator(".sector-card").evaluateAll((cards) => cards.map((card) => card.dataset.sectorName));
      const loadStatus = await page.locator("#load-status").textContent();
      assert.deepEqual(actual, expected.map((sector) => sector.name), JSON.stringify({ errors, loadStatus, serverErrors }));
      const amounts = await page.locator(".sector-card [data-sector-amount]").allTextContents();
      assert.deepEqual(amounts, expected.map(({ estimate: { amount } }) => amount === null ? ""
        : `${amount > 0 ? "+" : ""}${(amount / 1e8).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 億`));
    }
    const card = page.locator(".sector-card").first(), name = await card.getAttribute("data-sector-name");
    await card.click();
    await expect(page.locator("#sector-dialog")).toBeVisible();
    await expect(page.locator(".sector-stock-table tbody tr")).toHaveCount(
      getSectorDetail(snapshots, name, { tradingDates: dataset.dates, asOf: date }).members.length);
    await page.locator(width <= 520 ? "#sector-dialog .sector-dialog-handle" : "#close-sector-dialog").click();
    await expect(page.locator("#sector-dialog")).toBeHidden();
    await page.locator('.sidebar [data-page="market"]').click();
    const star = page.locator('#stock-rows [data-favorite="2330"]');
    const selected = await star.getAttribute("aria-pressed");
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", selected === "true" ? "false" : "true");
    await page.locator('.sidebar [data-page="favorites"]').click();
    await expect(page.locator("#watchlist-grid .watch-card").first()).toBeVisible();
    assert.equal(apiRequests.filter((path) => path === "/api/v1/favorites/summary").length, previousFavoriteRequests + 1);
    await page.locator('.sidebar [data-dialog="source"]').click();
    await expect(page.locator(".source-about")).toContainText("從數據到洞察");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS browser ${width}px: all sector windows match shared model, detail, favorite, navigation and layout`);
    await context.close();
  }
  const offlineContext = await browser.newContext({ viewport: { width: 390, height: 900 } });
  try {
    const offlinePage = await offlineContext.newPage();
    await offlinePage.goto(`http://127.0.0.1:${server.address().port}/`);
    await expect(offlinePage.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
    await offlinePage.locator('.sidebar [data-page="favorites"]').click();
    await expect(offlinePage.locator("#watchlist-grid .watch-card:not(.pending-card)").first()).toBeVisible();
    await offlinePage.evaluate(() => navigator.serviceWorker.ready);
    await offlinePage.reload();
    await expect.poll(() => offlinePage.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await offlineContext.setOffline(true);
    await offlinePage.reload();
    await expect(offlinePage.locator('#stock-rows [data-symbol="2330"]')).toBeVisible();
    await offlinePage.locator('.sidebar [data-page="favorites"]').click();
    await expect(offlinePage.locator("#watchlist-grid .watch-card:not(.pending-card)").first()).toBeVisible();
    console.log("PASS browser 390px: fetched market and favorite summaries remain available offline");
  } finally { await offlineContext.close(); }
} finally {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await browser?.close();
}
