import { test, expect } from "@playwright/test";
import { demoProvider } from "../../src/data.js";
import { getSnapshot } from "../../src/indicators.js";

const cardFor = (page, symbol) => page.locator(`[data-watch-symbol="${symbol}"]`);
const formatted = (value, digits = 0) => value.toLocaleString("en-US", {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});
const signed = (value) => `${value > 0 ? "+" : ""}${formatted(value)}`;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("all favorites show computed metrics and institutional flows above the market table", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "台股研究室." })).toBeVisible();
  await expect(page.locator(".watch-card")).toHaveCount(3);
  await expect(page.locator("#stock-rows tr")).toHaveCount(12);
  await expect(page.locator("#price-chart, #export-csv, #selected-title")).toHaveCount(0);
  await expect(cardFor(page, "2454")).toHaveCount(0);
  const { stocks, info } = await demoProvider.load();
  async function checkAllFavorites(date) {
    for (const symbol of ["2330", "2317", "0050"]) {
      const { latest: bar } = getSnapshot(stocks.find((stock) => stock.symbol === symbol), date);
      const card = cardFor(page, symbol);
      const metrics = card.locator(".metric-number");
      await expect(metrics.nth(0)).toHaveText(formatted(bar.close, 2));
      await expect(metrics.nth(1)).toHaveText(formatted(bar.volume / 1000));
      await expect(metrics.nth(2)).toHaveText(formatted(bar.k, 2));
      await expect(metrics.nth(3)).toContainText(formatted(bar.deviation, 2));
      await expect(card).toContainText(`D 值 ${formatted(bar.d, 2)}`);
      await expect(card).toContainText(`季線 ${formatted(bar.ma60, 2)}`);
      await expect(card.locator(".watch-flow-total strong")).toHaveText(`${signed(bar.institutionalNet / 1000)} 張`);
      for (const item of bar.institutions) {
        const row = card.locator(`[data-institution="${item.name}"]`);
        await expect(row.locator("strong")).toHaveText(signed((item.buy - item.sell) / 1000));
        await expect(row.locator(".watch-flow-bar-row").nth(0)).toContainText(formatted(item.buy / 1000));
        await expect(row.locator(".watch-flow-bar-row").nth(1)).toContainText(formatted(item.sell / 1000));
      }
      await expect(card.locator(".watch-card-footer")).toContainText(date.replaceAll("-", "."));
    }
  }
  await checkAllFavorites(info.asOf);
  await page.locator("#trade-date").selectOption({ index: 8 });
  await checkAllFavorites(await page.locator("#trade-date").inputValue());
  expect(await page.evaluate(() =>
    document.querySelector("#watchlist").getBoundingClientRect().bottom <=
    document.querySelector(".stocks-panel").getBoundingClientRect().top,
  )).toBe(true);
});

test("table filters and sorting keep the full favorites overview unchanged", async ({ page }) => {
  await page.getByRole("searchbox").fill("0050");
  await expect(page.locator("#stock-rows tr")).toHaveCount(1);
  await page.locator("#sector-filter").selectOption("半導體");
  await expect(page.locator("#table-empty")).toBeVisible();
  await expect(page.locator(".watch-card")).toHaveCount(3);
  await page.getByRole("button", { name: "清除篩選" }).click();
  await page.locator('[data-sort="close"]').click();
  await expect(page.locator("#stock-rows tr").first()).toHaveAttribute("data-symbol", "2454");
  await page.locator('[data-sort="close"]').click();
  await expect(page.locator("#stock-rows tr").first()).toHaveAttribute("data-symbol", "00878");
  await page.getByRole("button", { name: "K 值低於 20", exact: true }).click();
  for (const row of await page.locator("#stock-rows tr").all())
    expect(Number(await row.locator(".k-cell").innerText())).toBeLessThan(20);
  await expect(page.locator(".watch-card")).toHaveCount(3);
  await expect(cardFor(page, "2317")).toBeVisible();
});

test("stars update every favorite card immediately and persist after reload", async ({ page }) => {
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await expect(page.locator(".watch-card")).toHaveCount(4);
  await expect(cardFor(page, "2454")).toContainText("1,360.00");
  await page.reload();
  await expect(page.locator(".watch-card")).toHaveCount(4);
  await expect(page.locator("#favorite-count")).toHaveText("4");
  await page.locator('[data-view="favorites"]').click();
  await expect(page.locator("#stock-rows tr")).toHaveCount(4);
  await cardFor(page, "2454").getByRole("button", { name: "移除聯發科自選" }).click();
  await expect(cardFor(page, "2454")).toHaveCount(0);
  await expect(page.locator("#stock-rows tr")).toHaveCount(3);
  await expect(page.locator("#manage-favorites")).toBeFocused();
  await page.reload();
  await expect(cardFor(page, "2454")).toHaveCount(0);
});

test("empty favorites persist and offer a working path back to stock selection", async ({ page }) => {
  for (const symbol of ["2330", "2317", "0050"])
    await cardFor(page, symbol).locator("[data-favorite]").click();
  await expect(page.locator(".watch-card")).toHaveCount(0);
  await expect(page.locator("#watchlist-empty")).toBeVisible();
  await page.reload();
  await expect(page.locator(".watch-card")).toHaveCount(0);
  await expect(page.locator("#watchlist-count")).toHaveText("0 檔");
  await page.locator('[data-view="favorites"]').click();
  await expect(page.locator("#table-empty")).toBeVisible();
  await page.getByRole("button", { name: "前往選擇股票" }).click();
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(page.locator("#stock-rows tr")).toHaveCount(12);
  await page.locator('#stock-rows [data-favorite="00878"]').click();
  await expect(page.locator(".watch-card")).toHaveCount(1);
  await expect(cardFor(page, "00878")).toBeVisible();
  await expect(page.locator("#watchlist-empty")).not.toBeVisible();
});

test("KD settings recalculate every favorite and table suggestion and persist", async ({ page }) => {
  await page.getByRole("button", { name: "指標設定", exact: true }).click();
  await page.getByLabel("RSV 回溯週期").fill("14");
  await page.getByRole("button", { name: "儲存並重新計算" }).click();
  const { stocks, info } = await demoProvider.load();
  for (const stock of stocks) {
    const { latest, signal } = getSnapshot(stock, info.asOf, { period: 14, kSmooth: 3, dSmooth: 3 });
    await expect(page.locator(`[data-symbol="${stock.symbol}"] .signal-badge`)).toHaveAttribute("data-signal", signal.code);
    if (["2330", "2317", "0050"].includes(stock.symbol)) {
      const card = cardFor(page, stock.symbol);
      await expect(card).toContainText("(14, 3, 3)");
      await expect(card.locator(".metric-number").nth(2)).toHaveText(formatted(latest.k, 2));
      await expect(card.locator(".signal-badge")).toHaveText(signal.label);
    }
  }
  await page.reload();
  await expect(cardFor(page, "2330")).toContainText("(14, 3, 3)");
  await page.getByRole("button", { name: "判讀規則" }).click();
  await expect(page.getByRole("dialog")).toContainText("KD (14, 3, 3)");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "資料說明", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("沒有連接交易所");
});

test("technical suggestions explain each stock on the selected historical date", async ({ page }) => {
  await expect(page.locator('[data-symbol="2317"] .signal-badge')).toHaveText("留意賣點");
  await expect(cardFor(page, "2317").locator(".signal-badge")).toHaveText("留意賣點");
  await page.locator("#trade-date").selectOption("2026-09-08");
  await expect(page.locator('[data-symbol="2603"] .signal-badge')).toHaveText("反彈觀察");
  await expect(page.locator('[data-symbol="2603"] .signal-reason')).toContainText("MA20 趨勢尚未確認");
  await page.locator('#stock-rows [data-favorite="2603"]').click();
  await expect(cardFor(page, "2603").locator(".signal-badge")).toHaveText("反彈觀察");
});

test("desktop overview screenshot and keyboard search shortcut", async ({ page }, testInfo) => {
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.getByRole("heading", { name: "台股研究室." }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.screenshot({ path: testInfo.outputPath("watchlist-desktop.png"), fullPage: true });
});

test("mobile cards stack with the table below and support scrolling and dialogs", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".watch-card")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "管理自選" }).click();
  await expect(page.getByRole("searchbox")).toBeFocused();
  const signal = page.locator('[data-symbol="2317"] .signal-badge');
  await signal.scrollIntoViewIfNeeded();
  await expect(signal).toBeInViewport();
  await page.getByRole("button", { name: "判讀規則" }).click();
  await expect(page.getByRole("dialog")).toContainText("低檔黃金交叉");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("watchlist-mobile.png"), fullPage: true });
});

test("favorite metrics remain unclipped across narrow screens, tablets and desktops", async ({ page }, testInfo) => {
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await page.getByRole("button", { name: "指標設定", exact: true }).click();
  await page.getByLabel("RSV 回溯週期").fill("60");
  await page.getByLabel("K 平滑係數").fill("20");
  await page.getByLabel("D 平滑係數").fill("20");
  await page.getByRole("button", { name: "儲存並重新計算" }).click();
  for (const width of [320, 360, 390, 520, 521, 768, 1000, 1001, 1024, 1250, 1251, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const report = await page.locator("#watchlist-grid").evaluate((grid) => {
      const clipped = [];
      for (const card of grid.querySelectorAll(".watch-card, .metric-card")) {
        const bounds = card.getBoundingClientRect();
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          for (const rect of range.getClientRects())
            if (rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom)
              clipped.push(walker.currentNode.textContent.trim());
        }
      }
      return { clipped, documentWidth: document.documentElement.scrollWidth };
    });
    expect(report.clipped, `Clipped content at ${width}px`).toEqual([]);
    expect(report.documentWidth).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 320, height: 1000 });
  await cardFor(page, "2454").screenshot({ path: testInfo.outputPath("favorite-320.png") });
});

test("institutional 5/20-session totals and foreign/trust streaks update with the selected date", async ({ page }) => {
  const { stocks, info } = await demoProvider.load();
  for (const date of [info.asOf, "2026-09-08"]) {
    await page.locator("#trade-date").selectOption(date);
    for (const symbol of ["2330", "2317", "0050"]) {
      const history = stocks.find((stock) => stock.symbol === symbol).history.filter((bar) => bar.date <= date);
      const card = cardFor(page, symbol);
      for (const days of [5, 20]) {
        let total = 0;
        for (const name of ["外資", "投信", "自營商"]) {
          const sum = history.slice(-days).reduce((net, bar) => {
            const item = bar.institutions.find((row) => row.name === name);
            return net + item.buy - item.sell;
          }, 0);
          total += sum;
          await expect(card.locator(`[data-institution="${name}"] [data-window="${days}"] b`))
            .toHaveText(`${signed(sum / 1000)} 張`);
        }
        await expect(card.locator(`.watch-total-history [data-window="${days}"] b`))
          .toHaveText(`${signed(total / 1000)} 張`);
      }
      for (const name of ["外資", "投信"]) {
        const nets = history.map((bar) => {
          const item = bar.institutions.find((row) => row.name === name);
          return item.buy - item.sell;
        });
        const side = Math.sign(nets.at(-1));
        let days = 0;
        for (const value of nets.toReversed()) {
          if (!side || Math.sign(value) !== side) break;
          days++;
        }
        const label = side === 0 ? "當日持平" : `${days === nets.length ? "至少" : ""}連${side > 0 ? "買" : "賣"}${days}日`;
        await expect(card.locator(`[data-institution="${name}"] [data-streak]`)).toHaveText(label);
      }
      await expect(card.locator('[data-institution="自營商"] [data-streak]')).toHaveCount(0);
    }
  }
});
