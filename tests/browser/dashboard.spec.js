import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { demoProvider } from "../../src/data.js";
import { getSnapshot } from "../../src/indicators.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("dashboard renders computed values and updates stock, date and chart range without errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("heading", { name: "台股研究室." }),
  ).toBeVisible();
  await expect(page.locator("#stock-rows tr")).toHaveCount(12);
  await expect(page.locator("#metrics")).toContainText("1,085.00");
  await page.locator('[data-select="2454"]').click();
  await expect(page.locator("#selected-title")).toContainText("聯發科");
  await expect(page.locator("#metrics")).toContainText("1,360.00");
  await page.locator("#trade-date").selectOption({ index: 8 });
  const date = await page.locator("#trade-date").inputValue();
  const { stocks } = await demoProvider.load();
  const expected = getSnapshot(
    stocks.find((stock) => stock.symbol === "2454"),
    date,
  ).latest;
  await expect(page.locator("#metrics")).toContainText(
    expected.close.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  );
  await expect(page.locator("#flow-date")).toContainText(
    date.replaceAll("-", "."),
  );
  await page.getByRole("button", { name: "6 個月" }).click();
  await expect(page.locator('[data-range="132"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors).toEqual([]);
});

test("combined filters, empty state and numeric sorting work", async ({
  page,
}) => {
  await page.getByRole("searchbox").fill("0050");
  await expect(page.locator("#stock-rows tr")).toHaveCount(1);
  await page.locator("#sector-filter").selectOption("半導體");
  await expect(page.locator("#table-empty")).toBeVisible();
  await expect(page.locator("#export-csv")).toBeDisabled();
  await page.getByRole("button", { name: "清除篩選" }).click();
  await expect(page.locator("#stock-rows tr")).toHaveCount(12);
  await page.locator('[data-sort="close"]').click();
  await expect(page.locator("#stock-rows tr").first()).toHaveAttribute(
    "data-symbol",
    "2454",
  );
  await page.locator('[data-sort="close"]').click();
  await expect(page.locator("#stock-rows tr").first()).toHaveAttribute(
    "data-symbol",
    "00878",
  );
  await page.getByRole("button", { name: "K 值低於 20", exact: true }).click();
  const rows = page.locator("#stock-rows tr");
  for (const row of await rows.all())
    expect(Number(await row.locator(".k-cell").innerText())).toBeLessThan(20);
});

test("favorites persist after reload and do not change the selected stock", async ({
  page,
}) => {
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await expect(page.locator("#selected-title")).toContainText("台積電");
  await page.reload();
  await page.locator('[data-view="favorites"]').click();
  await expect(page.locator("#stock-rows tr")).toHaveCount(4);
  await expect(
    page.locator('#stock-rows [data-favorite="2454"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await expect(page.locator("#stock-rows tr")).toHaveCount(3);
});

test("settings recompute indicators, persist, and dialogs support Escape", async ({
  page,
}) => {
  await page.getByRole("button", { name: "指標設定", exact: true }).click();
  await page.getByLabel("RSV 回溯週期").fill("14");
  await page.getByRole("button", { name: "儲存並重新計算" }).click();
  await expect(page.locator("#metrics")).toContainText("KD (14, 3, 3)");
  const { stocks, info } = await demoProvider.load();
  const expected = getSnapshot(stocks[0], info.asOf, {
    period: 14,
    kSmooth: 3,
    dSmooth: 3,
  });
  await expect(page.locator("#metrics")).toContainText(
    expected.latest.k.toFixed(2),
  );
  await page.reload();
  await expect(page.locator("#metrics")).toContainText("KD (14, 3, 3)");
  await page.getByRole("button", { name: "資料說明", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("沒有連接交易所");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("CSV export contains filtered rows, demo label and institutional buy and sell totals", async ({
  page,
}) => {
  await page.getByRole("searchbox").fill("2330");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出 CSV" }).click();
  const download = await downloadPromise;
  const content = await readFile(await download.path(), "utf8");
  expect(download.suggestedFilename()).toBe(
    "stock-insight-demo-2026-10-16.csv",
  );
  expect(content).toContain("外資買進_張");
  expect(content).toContain("外資賣出_張");
  expect(content).toContain("法人合計買賣超_張");
  expect(content).toContain('"模擬資料","2026-10-16","2330","台積電"');
  expect(content.split("\r\n")).toHaveLength(2);
});

test("mobile stays within viewport and supports chart, dialogs and table scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#metrics")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect(page.locator(".market-chart")).toBeVisible();
  const scroll = page.locator(".table-scroll");
  expect(
    await scroll.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  await page.locator('[data-dialog="settings"]').click();
  await expect(page.getByLabel("RSV 回溯週期")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "/tmp/stock-insight-mobile.png",
    fullPage: true,
  });
});

test("desktop screenshot and keyboard shortcut", async ({ page }) => {
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.getByRole("heading", { name: "台股研究室." }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.screenshot({
    path: "/tmp/stock-insight-desktop.png",
    fullPage: true,
  });
});
