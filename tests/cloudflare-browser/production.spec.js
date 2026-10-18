import { test, expect } from "@playwright/test";
import { getSnapshot } from "../../src/indicators.js";

test("TWSE full listed-company API renders current-day prices with no per-stock browser requests", async ({ page, request }) => {
  const manifest = await (await request.get("/api/market")).json();
  expect(manifest.source).toBe("twse");
  expect(manifest.stocks.length).toBeGreaterThanOrEqual(1000);
  const urls = [], errors = [];
  page.on("request", (request) => urls.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#stock-rows tr")).toHaveCount(manifest.coverage.traded, { timeout: 30000 });
  await expect(page.locator(".demo-badge")).toHaveText("每日收盤資料");
  await expect(page.locator(".watch-card")).toHaveCount(3);
  expect(urls.filter((url) => /\/api\/stocks\//.test(url))).toEqual([]);
  expect(urls.filter((url) => /\/api\/market\//.test(url))).toHaveLength(128);
  expect(urls.some((url) => /finmind|twse\.com\.tw/i.test(new URL(url).hostname))).toBe(false);
  await page.locator('[data-page="favorites"]').click();
  for (const symbol of ["2330", "2317", "3026"]) {
    const payload = await (await request.get(`/api/stocks/${symbol}`)).json();
    const snapshot = getSnapshot({ ...payload.stock, tradingDates: manifest.dates }, manifest.asOf);
    const card = page.locator(`[data-watch-symbol="${symbol}"]`);
    await expect(card.locator(".metric-number").nth(0)).toHaveText(snapshot.latest.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  await page.getByRole("button", { name: "資料說明", exact: true }).click();
  const dialog = page.locator("#info-dialog");
  await expect(dialog).toContainText("臺灣證券交易所");
  await expect(dialog).toContainText(`${manifest.stocks.length} 家上市公司`);
  await expect(dialog).not.toContainText("FinMind");
  await expect(dialog).toContainText("21:00");
  expect(errors).toEqual([]);
});

test("real TWSE institutional day/5/20 sums agree with cached histories at current and historical dates", async ({ page, request }) => {
  const manifest = await (await request.get("/api/market")).json();
  const stocks = await Promise.all(["2330", "2317", "3026"].map(async (symbol) =>
    (await (await request.get(`/api/stocks/${symbol}`)).json()).stock));
  await page.goto("/");
  await expect(page.locator(".watch-card")).toHaveCount(3, { timeout: 30000 });
  await page.locator('[data-page="favorites"]').click();
  await page.getByRole("tab", { name: "法人總覽", exact: true }).click();
  for (const dateIndex of [0, 5]) {
    await page.locator("#trade-date").selectOption({ index: dateIndex });
    const date = await page.locator("#trade-date").inputValue();
    for (const [key, count] of [["day", 1], ["5", 5], ["20", 20]]) {
      await page.locator(`[data-institution-window="${key}"]`).click();
      for (const stock of stocks) {
        const byDate = new Map(stock.history.map((bar) => [bar.date, bar]));
        const dates = manifest.dates.filter((d) => d <= date).slice(-count);
        const values = dates.map((d) => {
          const bar = byDate.get(d);
          return bar?.institutions.length === 3 ? bar.institutions.reduce((n, row) => n + row.buy - row.sell, 0) : null;
        });
        const cell = page.locator(`[data-overview-symbol="${stock.symbol}"] [data-overview-net="total"]`);
        if (dates.length !== count || values.includes(null)) await expect(cell).toHaveText("資料不足");
        else expect(Math.abs(Number((await cell.innerText()).replaceAll(",", "").replace("張", "").trim()) - values.reduce((a, b) => a + b, 0) / 1000)).toBeLessThanOrEqual(0.005001);
      }
    }
  }
});

test("full-market phone controls, filters, sector and institution details retain their layouts", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".watch-card")).toHaveCount(3, { timeout: 30000 });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[data-page="market"]').click();
    await page.locator('[data-view="oversold"]').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.locator('[data-view="all"]').click();
    await page.locator('[data-page="favorites"]').click();
    await page.getByRole("tab", { name: "法人總覽", exact: true }).click();
    await page.locator('[data-institution-details="2330"]').click();
    await expect(page.locator("#institution-dialog")).toBeVisible();
    expect(await page.locator("#institution-dialog").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.locator("#close-institution-dialog").click();
    await page.locator('[data-page="sectors"]').click();
    await page.locator('[data-sector-window="20"]').click();
    await page.locator(".sector-card").first().click();
    await expect(page.locator("#sector-dialog")).toBeVisible();
    expect(await page.locator("#sector-dialog").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`twse-full-market-${width}.png`) });
    await page.keyboard.press("Escape");
  }
});
