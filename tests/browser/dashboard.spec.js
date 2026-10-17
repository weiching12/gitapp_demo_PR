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
  expect(content).toContain('"KD技術建議","技術判讀原因","MA20"');
  expect(content).toContain('"動能轉弱","K 下穿 D；等待止跌與趨勢確認"');
  expect(content).toContain('"模擬資料","2026-10-16","2330","台積電"');
  expect(content.split("\r\n")).toHaveLength(2);
});

test("mobile stays within viewport and supports chart, dialogs and table scrolling", async ({
  page,
}, testInfo) => {
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
    path: testInfo.outputPath("stock-insight-mobile.png"),
    fullPage: true,
  });
});

test("desktop screenshot and keyboard shortcut", async ({ page }, testInfo) => {
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.getByRole("heading", { name: "台股研究室." }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.screenshot({
    path: testInfo.outputPath("stock-insight-desktop.png"),
    fullPage: true,
  });
});

test("technical suggestions explain each stock and recalculate with date and KD settings", async ({ page }) => {
  await expect(page.getByRole("columnheader", { name: "KD 技術建議" })).toBeVisible();
  await expect(page.locator("#stock-rows .signal-badge")).toHaveCount(12);
  await expect(page.locator('[data-symbol="2317"] .signal-badge')).toHaveText("留意賣點");
  await expect(page.locator('[data-symbol="2382"] .signal-badge')).toHaveText("低檔觀察");
  await expect(page.locator('[data-symbol="2330"] .kd-detail')).toContainText("D ");
  await page.locator("#trade-date").selectOption("2026-09-08");
  await expect(page.locator('[data-symbol="2603"] .signal-badge')).toHaveText("反彈觀察");
  await expect(page.locator('[data-symbol="2603"] .signal-reason')).toContainText("MA20 趨勢尚未確認");

  await page.getByRole("button", { name: "指標設定", exact: true }).click();
  await page.getByLabel("RSV 回溯週期").fill("14");
  await page.getByRole("button", { name: "儲存並重新計算" }).click();
  const { stocks } = await demoProvider.load();
  const date = await page.locator("#trade-date").inputValue();
  for (const stock of stocks) {
    const { signal } = getSnapshot(stock, date, { period: 14, kSmooth: 3, dSmooth: 3 });
    const row = page.locator(`[data-symbol="${stock.symbol}"]`);
    await expect(row.locator(".signal-badge")).toHaveAttribute("data-signal", signal.code);
    await expect(row.locator(".signal-badge")).toHaveText(signal.label);
    await expect(row.locator(".signal-reason")).toHaveText(signal.reason);
  }
  await page.reload();
  await page.getByRole("button", { name: "判讀規則" }).click();
  await expect(page.getByRole("dialog")).toContainText("KD (14, 3, 3)");
});

test("mobile can scroll to suggestions and open the rules with keyboard dismissal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const signal = page.locator('[data-symbol="2317"] .signal-badge');
  await signal.scrollIntoViewIfNeeded();
  await expect(signal).toBeInViewport();
  await expect(signal).toHaveText("留意賣點");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "判讀規則" }).click();
  await expect(page.getByRole("dialog")).toContainText("低檔黃金交叉");
  await expect(page.getByRole("dialog")).toContainText("MA20 ≥ 前日 MA20");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("metric cards keep all numbers and labels within their bounds across responsive widths", async ({ page }, testInfo) => {
  const inspectCards = () => page.locator("#metrics").evaluate((grid) => {
    const clipped = [];
    const cards = [...grid.children];
    for (const [index, card] of cards.entries()) {
      const bounds = card.getBoundingClientRect();
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom)
            clipped.push({ index, text: node.textContent.trim() });
        }
      }
      for (const element of card.querySelectorAll(".metric-label,.metric-value,.metric-description,.metric-number"))
        if (element.scrollWidth > element.clientWidth + 1)
          clipped.push({ index, element: element.className });
    }
    return {
      clipped,
      columnCount: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size,
      rowHeights: cards.map((card) => Math.round(card.getBoundingClientRect().height)),
    };
  });

  for (const width of [320, 360, 390, 520, 521, 768, 1000, 1001, 1024, 1250, 1251, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const result = await inspectCards();
    expect(result.clipped, `Clipped metric content at ${width}px`).toEqual([]);
    expect(result.columnCount).toBe(width <= 1000 ? 2 : 4);
    expect(result.rowHeights[0]).toBe(result.rowHeights[1]);
  }

  // Check a four-digit stock price and the longest allowed KD settings.
  await page.locator('[data-select="2454"]').click();
  await page.getByRole("button", { name: "指標設定", exact: true }).click();
  await page.getByLabel("RSV 回溯週期").fill("60");
  await page.getByLabel("K 平滑係數").fill("20");
  await page.getByLabel("D 平滑係數").fill("20");
  await page.getByRole("button", { name: "儲存並重新計算" }).click();
  for (const width of [320, 390, 521, 1001, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect((await inspectCards()).clipped, `Clipped custom KD content at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.locator("#metrics").screenshot({ path: testInfo.outputPath("metrics-320.png") });
});
