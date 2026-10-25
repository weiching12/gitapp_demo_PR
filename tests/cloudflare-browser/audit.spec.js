import { test, expect } from "@playwright/test";
import { demoProvider } from "../../src/data.js";
import { MarketSummaryService } from "../../cloudflare/services/market-summary-service.js";
import { AnalysisService } from "../../cloudflare/services/analysis-service.js";
import { SHARD_COUNT, shardOf } from "../../shared/market-codec.js";

const demo = await demoProvider.load();
const stocks = demo.stocks.slice(0, 2).map((stock) => ({ ...stock, tradingDates: demo.dates }));
const manifest = { schemaVersion: 2, source: "twse", generation: "audit-fixture", dates: demo.dates,
  asOf: demo.info.asOf, updatedAt: `${demo.info.asOf}T12:00:00Z`,
  stocks: stocks.map(({ history, tradingDates, ...stock }) => ({ ...stock,
    assetType: "stock", currency: "TWD", listedOn: demo.dates[0] })),
  chunks: Array.from({ length: SHARD_COUNT }, (_, index) => `/api/v1/market/snapshots/audit-fixture/shards/${index}`) };
const chunks = Array.from({ length: SHARD_COUNT }, (_, index) => ({ generation: manifest.generation, index,
  stocks: stocks.filter((stock) => shardOf(stock.symbol) === index).map((stock) => ({ symbol: stock.symbol,
    history: stock.history.map((bar) => [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume,
      ...bar.institutions.flatMap((item) => [item.buy, item.sell])]) })) }));
const market = { market: async () => manifest,
  shards: async (_generation, indices) => indices.map((index) => chunks[index]),
  stock: async (symbol) => ({ asOf: manifest.asOf, stock: stocks.find((stock) => stock.symbol === symbol) }) };
const summary = new MarketSummaryService(market), analysis = new AnalysisService(market);
const defer = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function setup(page, intercept = async () => false) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (await intercept(route, url)) return;
    const path = url.pathname, date = url.searchParams.get("asOf") || manifest.asOf;
    const settings = Object.fromEntries(["period", "kSmooth", "dSmooth"].map((key) =>
      [key, Number(url.searchParams.get(key) || (key === "period" ? 9 : 3))]));
    const symbol = path.match(/^\/api\/v1\/stocks\/([^/]+)\/analysis$/)?.[1];
    const sector = path.match(/^\/api\/v1\/sectors\/([^/]+)$/)?.[1];
    const body = path === "/api/v1/market" ? manifest
      : path === "/api/v1/market/summary" ? await summary.summary(date, settings)
        : path === "/api/v1/favorites/summary" ? await summary.favorites(url.searchParams.get("symbols").split(","), date, settings)
          : symbol ? await analysis.stock(symbol, { asOf: date, settings })
            : sector ? await summary.sector(decodeURIComponent(sector), date, settings)
              : path === "/api/v1/presence" ? { today: 1 }
                : path === "/api/v1/push/config" ? { enabled: false } : null;
    await route.fulfill(body ? { json: body } : { status: 404 });
  });
  await page.goto("/");
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
}

test("cached date selection clears loading and ignores a late failure", async ({ page }) => {
  const waiting = defer(), entered = defer(), oldDate = demo.dates.at(-2);
  await setup(page, async (route, url) => {
    if (url.pathname !== "/api/v1/market/summary" || url.searchParams.get("asOf") !== oldDate) return false;
    entered.resolve(); await waiting.promise;
    await route.fulfill({ status: 503, json: { error: { message: "obsolete request failed" } } });
    return true;
  });
  try {
    await page.locator("#trade-date").selectOption(oldDate);
    await entered.promise;
    await page.locator("#trade-date").selectOption(manifest.asOf);
    await expect(page.locator("#date-loading")).toBeHidden();
    await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
    waiting.resolve();
    await expect(page.locator("#trade-date")).toHaveValue(manifest.asOf);
    await expect(page.locator("#table-summary")).toContainText(manifest.asOf);
    await expect(page.locator("#toast")).not.toContainText("obsolete request failed");
  } finally { waiting.resolve(); }
});

test("late entry detail cannot replace a subsequently opened settings dialog", async ({ page }) => {
  const waiting = defer(), entered = defer();
  await setup(page, async (route, url) => {
    const symbol = url.pathname.match(/\/stocks\/([^/]+)\/analysis$/)?.[1];
    if (!symbol) return false;
    entered.resolve(); await waiting.promise;
    await route.fulfill({ json: await analysis.stock(symbol, { asOf: manifest.asOf }) });
    return true;
  });
  try {
    await page.locator(".entry-score-button").first().click();
    await entered.promise;
    await page.locator("#close-dialog").click();
    await page.getByRole("button", { name: "設定", exact: true }).click();
    waiting.resolve();
    await expect(page.locator("#settings-form")).toBeVisible();
    await expect(page.locator("#dialog-heading")).toHaveText("設定");
  } finally { waiting.resolve(); }
});

test("industry page and detail retain the latest session after historical market browsing", async ({ page }) => {
  const requested = [];
  await setup(page, async (_route, url) => {
    if (url.pathname.startsWith("/api/v1/sectors/")) requested.push(url.searchParams.get("asOf"));
    return false;
  });
  await page.locator("#trade-date").selectOption(demo.dates.at(-2));
  await expect(page.locator("#table-summary")).toContainText(demo.dates.at(-2));
  await page.locator('.sidebar [data-page="sectors"]').click();
  await page.locator(".sector-card").first().click();
  await expect(page.locator("#sector-dialog-meta")).toContainText(manifest.asOf);
  expect(requested).toEqual([manifest.asOf]);
});
