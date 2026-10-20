import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createManifest, marketDay, mergeShard, normalizeCatalog, normalizeFlows, normalizePrices, SHARD_COUNT, shardOf } from "../../cloudflare/twse.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/twse-20261016.json", import.meta.url)));
const catalog = normalizeCatalog(fixture.companies);
const date = "2026-10-16";
const day = marketDay(catalog, normalizePrices(fixture.prices, date), normalizeFlows(fixture.flows, date));
const generation = "progressive-test";
const manifest = createManifest(catalog, [date], generation, "2026-10-18T08:00:00Z", day.coverage);
const chunks = Array.from({ length: SHARD_COUNT }, (_, index) => ({ ...mergeShard(catalog, index, null, [day]), generation, index }));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const preferences = async (page) => page.addInitScript(() => {
  if (!localStorage.getItem("stock-insight-v1")) localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites: ["2330", "3026"], catalogVersion: 2 }));
});

test("shell and usable rows appear before completion without losing filters, favorites or existing row nodes", async ({ page }, testInfo) => {
  const metadata = deferred(), rest = deferred();
  await preferences(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/presence") return route.fulfill({ json: { online: 2 } });
    if (path === "/api/market") {
      await metadata.promise;
      return route.fulfill({ json: manifest });
    }
    const index = Number(path.split("/").at(-1));
    if (index !== shardOf("2330")) await rest.promise;
    await route.fulfill({ json: chunks[index] });
  });
  try {
    await page.goto("/");
    await expect(page.locator("#page-title")).toContainText("市場觀察清單");
    await expect(page.locator("#load-status")).toBeHidden();
    await expect(page.locator("#trade-date")).toBeDisabled();
    metadata.resolve();
    const row = page.locator('#stock-rows [data-symbol="2330"]');
    await expect(row).toBeVisible();
    await expect(page.locator('#stock-rows [data-symbol="3026"]')).toHaveAttribute("aria-busy", "true");
    await expect(page.locator('#stock-rows [data-symbol="3026"] .loading-spinner')).toHaveCount(7);
    await page.screenshot({ path: testInfo.outputPath("field-icons-390.png") });
    await expect(page.locator("#load-status")).toBeHidden();
    await expect(page.locator("#table-empty")).toBeHidden();
    await expect(page.locator("#favorite-count")).toHaveText("2");
    await page.locator('[data-page="favorites"]').click();
    await expect(page.locator('[data-watch-symbol="3026"] .loading-spinner')).toHaveCount(4);
    await page.locator("#watchlist-institutions-tab").click();
    await expect(page.locator('[data-overview-symbol="3026"] .loading-spinner')).toHaveCount(4);
    await page.locator('[data-page="sectors"]').click();
    await expect(page.locator("#sector-grid .sector-card")).toHaveCount(0);
    await expect(page.locator("#sector-grid .loading-spinner")).toHaveCount(3);
    await expect(page.locator("#load-status")).toBeHidden();
    await page.locator('[data-page="market"]').click();
    await page.locator("#stock-search").fill("2330");
    await row.locator("[data-favorite]").click();
    await expect(row.locator("[data-favorite]")).toHaveAttribute("aria-pressed", "false");
    await page.evaluate(() => { window.progressiveRow = document.querySelector('#stock-rows [data-symbol="2330"]'); });
    await page.screenshot({ path: testInfo.outputPath("progressive-loading-390.png") });
    rest.resolve();
    await expect(page.locator("#load-status")).toBeHidden();
    await expect(page.locator("#stock-rows .loading-spinner")).toHaveCount(0);
    await expect(page.locator("#stock-search")).toHaveValue("2330");
    await expect(page.locator("#stock-rows tr")).toHaveCount(1);
    expect(await page.evaluate(() => window.progressiveRow === document.querySelector('#stock-rows [data-symbol="2330"]'))).toBe(true);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("stock-insight-v1")).favorites)).toEqual(["3026"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.locator('[data-page="sectors"]').click();
    await expect(page.locator("#sector-grid .sector-card").first()).toBeVisible();
  } finally { metadata.resolve(); rest.resolve(); }
});

test("a failed shard keeps validated rows marked incomplete and retry reloads without losing favorites", async ({ page }) => {
  const failed = deferred();
  let rejectShard = true;
  await preferences(page);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/market") return route.fulfill({ json: manifest });
    const index = Number(path.split("/").at(-1));
    if (index === shardOf("3026") && rejectShard) {
      await failed.promise;
      return route.fulfill({ status: 503, body: "unavailable" });
    }
    await route.fulfill({ json: chunks[index] });
  });
  try {
    await page.goto("/");
    await expect(page.locator('#stock-rows [data-symbol="2330"]')).toBeVisible();
    failed.resolve();
    await expect(page.locator("#load-status")).toContainText("資料尚未完整載入");
    await expect(page.locator("#stock-rows .loading-spinner")).toHaveCount(0);
    await expect(page.locator('#stock-rows [data-symbol="3026"]')).toContainText("載入失敗");
    await expect(page.locator('#stock-rows [data-symbol="2330"]')).toBeVisible();
    await page.locator('[data-page="sectors"]').click();
    await expect(page.locator("#sector-grid .sector-card")).toHaveCount(0);
    rejectShard = false;
    await page.locator("#reload-data").click();
    await expect(page.locator("#load-status")).toBeHidden();
    await expect(page.locator("#stock-rows tr")).toHaveCount(manifest.coverage.traded);
    await expect(page.locator("#favorite-count")).toHaveText("2");
  } finally { failed.resolve(); }
});

test("metadata failure preserves the usable shell and saved favorites", async ({ page }) => {
  await preferences(page);
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/");
  await expect(page.locator("#page-title")).toContainText("市場觀察清單");
  await expect(page.locator("#load-status")).toContainText("無法取得股票資料");
  await expect(page.locator("#reload-data")).toBeVisible();
  await expect(page.locator("#table-empty")).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("stock-insight-v1")).favorites)).toEqual(["2330", "3026"]);
  await page.getByRole("button", { name: "資料說明", exact: true }).click();
  await expect(page.locator("#info-dialog")).toContainText("正在取得資料來源與市場範圍");
  await expect(page.locator("#info-dialog")).not.toContainText("Invalid Date");
});
