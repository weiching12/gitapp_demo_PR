import { test, expect } from "@playwright/test";
import { demoProvider } from "../../src/data.js";
import { getSnapshot } from "../../src/indicators.js";

const cardFor = (page, symbol) => page.locator(`[data-watch-symbol="${symbol}"]`);
const detailsButtonFor = (page, symbol) => page.locator(`#institution-overview [data-institution-details="${symbol}"]`);
async function openInstitutionDetails(page, symbol) {
  await page.locator('[data-overview="institutions"]').click();
  await detailsButtonFor(page, symbol).click();
  const dialog = page.locator("#institution-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-institution-symbol]")).toHaveAttribute("data-institution-symbol", symbol);
  return dialog;
}
async function closeInstitutionDetails(page) {
  await page.locator("#close-institution-dialog").click();
  await expect(page.locator("#institution-dialog")).not.toBeVisible();
}
const formatted = (value, digits = 0) => value.toLocaleString("en-US", {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});
const signed = (value) => `${value > 0 ? "+" : ""}${formatted(value)}`;
const overviewFor = (page, symbol) => page.locator(`[data-overview-symbol="${symbol}"]`);
const institutionalNames = ["外資", "投信", "自營商"];
const amountText = (shares) => {
  const lots = shares / 1000;
  const digits = Number.isInteger(lots) ? 0 : 2;
  return `${lots > 0 ? "+" : ""}${formatted(lots, digits)} 張`;
};
function streakText(history, name) {
  const nets = history.map((bar) => {
    const item = bar.institutions.find((row) => row.name === name);
    return item.buy - item.sell;
  });
  const side = Math.sign(nets.at(-1));
  if (!side) return "當日持平";
  let days = 0;
  for (const net of nets.toReversed()) {
    if (Math.sign(net) !== side) break;
    days++;
  }
  return `${days === nets.length ? "至少" : ""}連${side > 0 ? "買" : "賣"}${days}日`;
}
const settleLayout = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve)),
));

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("all favorites show compact metrics with institutional details available separately", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "台股研究室." })).toBeVisible();
  await expect(page.locator(".watch-card")).toHaveCount(5);
  await expect(page.locator("#stock-rows tr")).toHaveCount(14);
  await expect(page.locator("#price-chart, #export-csv, #selected-title")).toHaveCount(0);
  await expect(cardFor(page, "2454")).toHaveCount(0);
  await expect(page.locator(".watch-card .watch-flow")).toHaveCount(0);
  await expect(page.locator("#institution-dialog")).not.toBeVisible();
  await expect(page.locator("#watchlist-grid [data-institution-details]")).toHaveCount(0);
  await expect(page.locator(".watch-card-footer")).toHaveCount(0);
  await expect(page.locator(".page-footer > span:nth-child(2)")).toHaveText("技術提示僅供研究參考。");
  const cardHeights = await page.locator(".watch-card").evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
  expect(Math.max(...cardHeights)).toBeLessThanOrEqual(500);
  const { stocks, info } = await demoProvider.load();
  async function checkAllFavorites(date) {
    for (const symbol of ["2330", "2317", "0050", "3026", "6488"]) {
      const { latest: bar } = getSnapshot(stocks.find((stock) => stock.symbol === symbol), date);
      const card = cardFor(page, symbol);
      const metrics = card.locator(".metric-number");
      await expect(metrics.nth(0)).toHaveText(formatted(bar.close, 2));
      await expect(metrics.nth(1)).toHaveText(formatted(bar.volume / 1000));
      await expect(metrics.nth(2)).toHaveText(formatted(bar.k, 2));
      await expect(metrics.nth(3)).toContainText(formatted(bar.deviation, 2));
      await expect(card).toContainText(`D 值 ${formatted(bar.d, 2)}`);
      await expect(card).toContainText(`季線 ${formatted(bar.ma60, 2)}`);
      const dialog = await openInstitutionDetails(page, symbol);
      await expect(dialog.locator(".watch-flow-total strong")).toHaveText(`${signed(bar.institutionalNet / 1000)} 張`);
      for (const item of bar.institutions) {
        const row = dialog.locator(`[data-institution="${item.name}"]`);
        await expect(row.locator("strong")).toHaveText(signed((item.buy - item.sell) / 1000));
        await expect(row.locator(".watch-flow-bar-row").nth(0)).toContainText(formatted(item.buy / 1000));
        await expect(row.locator(".watch-flow-bar-row").nth(1)).toContainText(formatted(item.sell / 1000));
      }
      await closeInstitutionDetails(page);
      await page.locator('[data-overview="price"]').click();
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

test("institutional details identify the selected stock and support keyboard, Escape and backdrop dismissal", async ({ page }) => {
  await page.locator('[data-overview="institutions"]').click();
  const firstButton = detailsButtonFor(page, "2330");
  await expect(firstButton).toHaveAccessibleName("查看台積電三大法人動向");
  await firstButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.locator("#institution-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-labelledby", "institution-heading");
  await expect(dialog).toHaveAccessibleName(/台積電.*三大法人動向/);
  await expect(dialog.locator("[data-institution-symbol]")).toHaveAttribute("data-institution-symbol", "2330");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(firstButton).toBeFocused();

  const secondButton = detailsButtonFor(page, "6488");
  await expect(secondButton).toHaveAccessibleName("查看環球晶三大法人動向");
  await secondButton.focus();
  await page.keyboard.press("Space");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(/環球晶.*三大法人動向/);
  await expect(dialog.locator("[data-institution-symbol]")).toHaveAttribute("data-institution-symbol", "6488");
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
  await expect(secondButton).toBeFocused();
  await openInstitutionDetails(page, "2317");
  await expect(dialog).toHaveAccessibleName(/鴻海.*三大法人動向/);
  await expect(page.locator("#close-institution-dialog")).toHaveAccessibleName("關閉法人動向");
  await closeInstitutionDetails(page);
  await expect(detailsButtonFor(page, "2317")).toBeFocused();
});

test("open institutional details stay current after a date change and close if their favorite is removed", async ({ page }) => {
  const dialog = await openInstitutionDetails(page, "2330");
  const { stocks } = await demoProvider.load();
  const date = "2026-09-08";
  // Updating the data state while a modal is open must refresh its existing content.
  await page.locator("#trade-date").evaluate((select, value) => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, date);
  const { latest } = getSnapshot(stocks.find((stock) => stock.symbol === "2330"), date);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".watch-flow-total strong")).toHaveText(`${signed(latest.institutionalNet / 1000)} 張`);
  await page.keyboard.press("Escape");
  await expect(detailsButtonFor(page, "2330")).toBeFocused();
  await openInstitutionDetails(page, "2330");
  await cardFor(page, "2330").locator('[data-favorite="2330"]').evaluate((button) => button.click());
  await expect(dialog).not.toBeVisible();
  await expect(cardFor(page, "2330")).toHaveCount(0);
  await expect(page.locator(".watch-card")).toHaveCount(4);
});

test("table filters and sorting keep the full favorites overview unchanged", async ({ page }) => {
  await page.getByRole("searchbox").fill("0050");
  await expect(page.locator("#stock-rows tr")).toHaveCount(1);
  await page.locator("#sector-filter").selectOption("半導體");
  await expect(page.locator("#table-empty")).toBeVisible();
  await expect(page.locator(".watch-card")).toHaveCount(5);
  await page.getByRole("button", { name: "清除篩選" }).click();
  await page.locator('[data-sort="close"]').click();
  await expect(page.locator("#stock-rows tr").first()).toHaveAttribute("data-symbol", "2454");
  await page.locator('[data-sort="close"]').click();
  await expect(page.locator("#stock-rows tr").first()).toHaveAttribute("data-symbol", "00878");
  await page.getByRole("button", { name: "K 值低於 20", exact: true }).click();
  for (const row of await page.locator("#stock-rows tr").all())
    expect(Number(await row.locator(".k-cell").innerText())).toBeLessThan(20);
  await expect(page.locator(".watch-card")).toHaveCount(5);
  await expect(cardFor(page, "2317")).toBeVisible();
});

test("mobile table keeps prices and daily changes visible with volume beneath each close", async ({ page }) => {
  const { stocks, info } = await demoProvider.load();
  await expect(page.locator('[data-sort-heading="changePercent"]')).toContainText("較前交易日");
  await expect(page.locator('[data-sort-heading="volume"]')).toHaveCount(0);
  // Monday also compares with the previous trading session, rather than Sunday or five sessions ago.
  for (const date of [info.asOf, "2026-09-07"]) {
    await page.locator("#trade-date").selectOption(date);
    for (const stock of stocks) {
      const history = stock.history.filter((bar) => bar.date <= date);
      const current = history.at(-1), previous = history.at(-2);
      const change = (current.close / previous.close - 1) * 100;
      const row = page.locator(`#stock-rows tr[data-symbol="${stock.symbol}"]`);
      await expect(row.locator(".stock-close")).toHaveText(formatted(current.close, 2));
      await expect(row.locator(".price-cell .stock-volume")).toHaveText(`量 ${formatted(current.volume / 1000)} 張`);
      await expect(row.locator(".change-cell .change-chip")).toHaveText(`${change > 0 ? "+" : ""}${formatted(change, 2)}%`);
    }
  }
  for (const width of [320, 360, 390, 520, 700]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator(".table-scroll").evaluate((element) => { element.scrollLeft = 0; });
    const issues = await page.locator(".table-scroll").evaluate((element) => {
      const rightEdge = element.getBoundingClientRect().right;
      const errors = [];
      for (const row of element.querySelectorAll("tbody tr")) {
        const cells = [...row.children];
        if (cells[1].getBoundingClientRect().right - cells[0].getBoundingClientRect().left > 132.1)
          errors.push("pinned columns consume too much space");
        for (const text of row.querySelectorAll(".stock-close, .stock-volume, .change-cell .change-chip")) {
          const range = document.createRange(); range.selectNodeContents(text);
          for (const rect of range.getClientRects()) if (rect.right > rightEdge + 1) errors.push("price, volume or daily change is outside the viewport");
        }
        const name = row.querySelector(".stock-name");
        if (name.scrollWidth > name.clientWidth + 1) errors.push("stock name does not wrap within its column");
      }
      return errors;
    });
    expect(issues, `Mobile market table at ${width}px`).toEqual([]);
  }
});

test("stars update every favorite card immediately and persist after reload", async ({ page }) => {
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await expect(page.locator(".watch-card")).toHaveCount(6);
  await expect(cardFor(page, "2454")).toContainText("1,360.00");
  await page.reload();
  await expect(page.locator(".watch-card")).toHaveCount(6);
  await expect(page.locator("#favorite-count")).toHaveText("6");
  await page.locator('[data-view="favorites"]').click();
  await expect(page.locator("#stock-rows tr")).toHaveCount(6);
  await cardFor(page, "2454").getByRole("button", { name: "移除聯發科自選" }).click();
  await expect(cardFor(page, "2454")).toHaveCount(0);
  await expect(page.locator("#stock-rows tr")).toHaveCount(5);
  await expect(page.locator("#manage-favorites")).toBeFocused();
  await page.reload();
  await expect(cardFor(page, "2454")).toHaveCount(0);
});

test("new requested favorites migrate once and stay removed after the user removes them", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites: ["2330"] })));
  await page.reload();
  await expect(page.locator(".watch-card")).toHaveCount(3);
  await expect(cardFor(page, "3026")).toBeVisible();
  await expect(cardFor(page, "6488")).toBeVisible();
  await cardFor(page, "3026").locator("[data-favorite]").click();
  await cardFor(page, "6488").locator("[data-favorite]").click();
  await page.reload();
  await expect(page.locator(".watch-card")).toHaveCount(1);
  await expect(cardFor(page, "2330")).toBeVisible();
});

test("empty favorites persist and offer a working path back to stock selection", async ({ page }) => {
  for (const symbol of ["2330", "2317", "0050", "3026", "6488"])
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
  await expect(page.locator("#stock-rows tr")).toHaveCount(14);
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
    if (["2330", "2317", "0050", "3026", "6488"].includes(stock.symbol)) {
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
  await expect(page.locator(".watch-card")).toHaveCount(5);
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
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const dialog = await openInstitutionDetails(page, "2454");
    const report = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const clipped = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects())
          if (rect.left < bounds.left || rect.right > bounds.right)
            clipped.push(walker.currentNode.textContent.trim());
      }
      return { clipped, left: bounds.left, right: bounds.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    expect(report.clipped, `Clipped institutional details at ${width}px`).toEqual([]);
    expect(report.left).toBeGreaterThanOrEqual(0);
    expect(report.right).toBeLessThanOrEqual(width);
    expect(report.scrollWidth).toBeLessThanOrEqual(report.clientWidth);
    await page.screenshot({ path: testInfo.outputPath(`institutional-${width}.png`), fullPage: true });
    await closeInstitutionDetails(page);
  }
});

test("institutional 5/20-session totals and foreign/trust streaks update with the selected date", async ({ page }) => {
  const { stocks, info } = await demoProvider.load();
  for (const date of [info.asOf, "2026-09-08"]) {
    await page.locator("#trade-date").selectOption(date);
    for (const symbol of ["2330", "2317", "0050", "3026", "6488"]) {
      const history = stocks.find((stock) => stock.symbol === symbol).history.filter((bar) => bar.date <= date);
      const dialog = await openInstitutionDetails(page, symbol);
      for (const days of [5, 20]) {
        let total = 0;
        for (const name of ["外資", "投信", "自營商"]) {
          const sum = history.slice(-days).reduce((net, bar) => {
            const item = bar.institutions.find((row) => row.name === name);
            return net + item.buy - item.sell;
          }, 0);
          total += sum;
          await expect(dialog.locator(`[data-institution="${name}"] [data-window="${days}"] b`))
            .toHaveText(`${signed(sum / 1000)} 張`);
        }
        await expect(dialog.locator(`.watch-total-history [data-window="${days}"] b`))
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
        await expect(dialog.locator(`[data-institution="${name}"] [data-streak]`)).toHaveText(label);
      }
      await expect(dialog.locator('[data-institution="自營商"] [data-streak]')).toHaveCount(0);
      await closeInstitutionDetails(page);
    }
  }
});

test("source information lives in the sidebar and opens one accessible explanation", async ({ page }) => {
  const source = page.getByRole("button", { name: "資料說明", exact: true });
  await expect(source).toHaveCount(1);
  await expect(page.locator('.sidebar button.nav-item[data-dialog="source"]')).toHaveCount(1);
  await expect(source).toContainText("資料說明");
  await expect(page.locator("main .demo-notice, .topbar [data-dialog=source]")).toHaveCount(0);
  await source.click();
  await expect(page.getByRole("dialog")).toContainText("沒有連接交易所");
  await page.keyboard.press("Escape");
  await expect(source).toBeFocused();
});

test("watchlist tabs support keyboard selection and restore focus to the exact overview details button", async ({ page }) => {
  const tabs = page.getByRole("tablist", { name: "自選總覽視角" });
  const price = tabs.getByRole("tab", { name: "價量總覽", exact: true });
  const institutions = tabs.getByRole("tab", { name: "法人總覽", exact: true });
  await expect(price).toHaveAttribute("aria-selected", "true");
  await expect(price).toHaveAttribute("tabindex", "0");
  await expect(price).toHaveAttribute("aria-controls", "watchlist-grid");
  await expect(institutions).toHaveAttribute("tabindex", "-1");
  await expect(page.locator("#watchlist-grid")).toHaveAttribute("role", "tabpanel");
  await expect(page.locator("#watchlist-grid")).toHaveAttribute("aria-labelledby", "watchlist-price-tab");
  await expect(page.locator("#institution-overview")).toBeHidden();
  await price.focus();
  await page.keyboard.press("ArrowRight");
  await expect(institutions).toBeFocused();
  await expect(institutions).toHaveAttribute("aria-selected", "true");
  await expect(institutions).toHaveAttribute("tabindex", "0");
  await expect(institutions).toHaveAttribute("aria-controls", "institution-overview");
  await expect(price).toHaveAttribute("aria-selected", "false");
  await expect(price).toHaveAttribute("tabindex", "-1");
  await expect(page.locator("#watchlist-grid")).toBeHidden();
  await expect(page.locator("#institution-overview")).toHaveAttribute("role", "tabpanel");
  await expect(page.locator("#institution-overview")).toHaveAttribute("aria-labelledby", "watchlist-institutions-tab");
  await expect(page.locator("#institution-overview")).toBeVisible();
  const trigger = overviewFor(page, "6488").locator('[data-institution-details="6488"]');
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#institution-dialog")).toHaveAccessibleName(/環球晶.*三大法人動向/);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await institutions.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(price).toBeFocused();
  await expect(price).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(institutions).toBeFocused();
  await expect(page.locator("#institution-overview")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(price).toBeFocused();
  await expect(page.locator("#watchlist-grid")).toBeVisible();
});

test("institutional overview compares every favorite using independent day, 5 and 20-session sums and streaks", async ({ page }) => {
  const { stocks, info } = await demoProvider.load();
  await page.getByRole("tab", { name: "法人總覽", exact: true }).click();
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(5);
  const windows = page.getByRole("group", { name: "法人累計區間" });
  for (const date of [info.asOf, "2026-09-08"]) {
    await page.locator("#trade-date").selectOption(date);
    await expect(page.locator("#institution-overview-date")).toContainText(date);
    for (const [key, count, label] of [["day", 1, "當日"], ["5", 5, "近 5 日"], ["20", 20, "近 20 日"]]) {
      await windows.getByRole("button", { name: label, exact: true }).click();
      await expect(windows.locator(`[data-institution-window="${key}"]`)).toHaveAttribute("aria-pressed", "true");
      await expect(windows.locator('[aria-pressed="true"]')).toHaveCount(1);
      for (const symbol of ["2330", "2317", "0050", "3026", "6488"]) {
        const stock = stocks.find((item) => item.symbol === symbol);
        const history = stock.history.filter((bar) => bar.date <= date);
        const row = overviewFor(page, symbol);
        await expect(row).toContainText(stock.name);
        await expect(row).toContainText(symbol);
        let total = 0;
        for (const name of institutionalNames) {
          const sum = history.slice(-count).reduce((net, bar) => {
            const item = bar.institutions.find((institution) => institution.name === name);
            return net + item.buy - item.sell;
          }, 0);
          total += sum;
          await expect(row.locator(`[data-overview-net="${name}"]`)).toHaveText(amountText(sum));
        }
        await expect(row.locator('[data-overview-net="total"]')).toHaveText(amountText(total));
        await expect(row.locator(".overview-total-context")).toHaveCount(0);
        for (const name of ["外資", "投信"])
          await expect(row.locator(`[data-overview-streak="${name}"]`)).toHaveText(streakText(history, name));
      }
    }
  }
  await page.getByRole("searchbox").fill("0050");
  await expect(page.locator("#stock-rows tr")).toHaveCount(1);
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(5);
  await page.locator("#sector-filter").selectOption("半導體");
  await expect(page.locator("#table-empty")).toBeVisible();
  await expect(overviewFor(page, "2330")).toBeVisible();
  await expect(overviewFor(page, "0050")).toBeVisible();
});

test("both overview modes follow all favorites and retain the zero-favorite selection path", async ({ page }) => {
  const { stocks } = await demoProvider.load();
  await page.evaluate((favorites) => localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites, catalogVersion: 2 })), stocks.map((stock) => stock.symbol));
  await page.reload();
  await expect(page.locator(".watch-card")).toHaveCount(14);
  await page.getByRole("tab", { name: "法人總覽", exact: true }).click();
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(14);
  for (const stock of stocks) await expect(overviewFor(page, stock.symbol)).toBeVisible();
  await page.getByRole("searchbox").fill("2454");
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(13);
  await expect(overviewFor(page, "2454")).toHaveCount(0);
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await expect(overviewFor(page, "2454")).toBeVisible();
  await page.getByRole("tab", { name: "價量總覽", exact: true }).click();
  await expect(cardFor(page, "2454")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites: [], catalogVersion: 2 })));
  await page.reload();
  await expect(page.locator("#watchlist-empty")).toBeVisible();
  await expect(page.locator(".watch-card")).toHaveCount(0);
  await page.getByRole("tab", { name: "法人總覽", exact: true }).click();
  await expect(page.locator("#watchlist-empty")).toBeVisible();
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(0);
  await page.getByRole("button", { name: "前往選擇股票", exact: true }).click();
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.locator('#stock-rows [data-favorite="00878"]').click();
  await expect(overviewFor(page, "00878")).toBeVisible();
  await expect(page.locator("#watchlist-empty")).toBeHidden();
});

test("market favorite toggles preserve the user's row and horizontal scroll on phones, tablets and desktop", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 720 });
    await page.reload();
    const table = page.locator(".table-scroll");
    const star = page.locator('#stock-rows [data-favorite="2454"]');
    const row = page.locator('#stock-rows tr[data-symbol="2454"]');
    await star.scrollIntoViewIfNeeded();
    await row.evaluate((element) => window.scrollBy({ top: element.getBoundingClientRect().top - 220, behavior: "instant" }));
    await table.evaluate((element) => { element.scrollLeft = 180; });
    await settleLayout(page);
    const before = { top: (await row.boundingBox()).y, left: await table.evaluate((element) => element.scrollLeft) };
    await expect(star).toBeInViewport();
    await star.click();
    await expect(page.locator(".watch-card")).toHaveCount(6);
    await expect(star).toBeFocused();
    await settleLayout(page);
    expect(Math.abs((await row.boundingBox()).y - before.top), `Added row moved at ${width}px`).toBeLessThanOrEqual(2);
    expect(await table.evaluate((element) => element.scrollLeft)).toBe(before.left);

    await page.locator('[data-view="favorites"]').click();
    await expect(page.locator("#stock-rows tr")).toHaveCount(6);
    const symbols = await page.locator("#stock-rows tr").evaluateAll((rows) => rows.map((element) => element.dataset.symbol));
    const nextSymbol = symbols[symbols.indexOf("2454") + 1];
    expect(nextSymbol).toBeTruthy();
    await star.scrollIntoViewIfNeeded();
    await row.evaluate((element) => window.scrollBy({ top: element.getBoundingClientRect().top - 220, behavior: "instant" }));
    await table.evaluate((element) => { element.scrollLeft = 180; });
    await settleLayout(page);
    const removal = { top: (await row.boundingBox()).y, left: await table.evaluate((element) => element.scrollLeft) };
    await star.click();
    await expect(page.locator("#stock-rows tr")).toHaveCount(5);
    const nextRow = page.locator(`#stock-rows tr[data-symbol="${nextSymbol}"]`);
    await expect(nextRow.locator("[data-favorite]")).toBeFocused();
    await settleLayout(page);
    const afterRemoval = await nextRow.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      return { top, documentTop: top + window.scrollY, maxScroll: Math.max(0, document.documentElement.scrollHeight - window.innerHeight) };
    });
    const expectedScroll = Math.max(0, Math.min(afterRemoval.maxScroll, afterRemoval.documentTop - removal.top));
    // Keep the row in place wherever the page's remaining scroll range permits it.
    expect(Math.abs(afterRemoval.top - (afterRemoval.documentTop - expectedScroll)), `Neighbor row moved at ${width}px`).toBeLessThanOrEqual(2);
    expect(await table.evaluate((element) => element.scrollLeft)).toBe(removal.left);
    await expect(page.locator('[data-view="favorites"]')).toHaveClass(/active/);
  }
});

test("phone and tablet controls remain touch-sized with readable sticky navigation and pinned stock columns", async ({ page }, testInfo) => {
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("tab", { name: "價量總覽", exact: true }).click();
    const undersized = await page.locator('.sidebar .nav-item, [role="tab"], #manage-favorites, #trade-date, .search-box, #sector-filter, .filter-tabs button, #stock-rows [data-favorite]').evaluateAll((controls) => controls.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width && rect.height && (rect.width < 44 || rect.height < 44)
        ? [{ control: element.getAttribute("aria-label") || element.textContent.trim(), width: rect.width, height: rect.height }]
        : [];
    }));
    expect(undersized, `Small touch targets at ${width}px`).toEqual([]);
    // The implicit label's padding is part of the search field's touch target.
    await page.locator(".search-box").click({ position: { x: 2, y: 2 } });
    await expect(page.getByRole("searchbox")).toBeFocused();
    for (const item of await page.locator('.sidebar nav .nav-item > span:first-of-type').all()) await expect(item).toBeVisible();
    await page.getByRole("searchbox").scrollIntoViewIfNeeded();
    expect(await page.locator(".sidebar").evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
    expect((await page.locator(".sidebar").boundingBox()).y).toBeGreaterThanOrEqual(-1);
    const pinning = await page.locator(".table-scroll").evaluate((element) => {
      element.scrollLeft = 0;
      const cells = [...element.querySelector("tbody tr").children];
      const before = cells.slice(0, 3).map((cell) => cell.getBoundingClientRect().left);
      element.scrollLeft = 180;
      const after = cells.slice(0, 3).map((cell) => cell.getBoundingClientRect().left);
      return { moved: after.map((left, i) => left - before[i]), scroll: element.scrollLeft };
    });
    if (pinning.scroll > 0) {
      expect(Math.abs(pinning.moved[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(pinning.moved[1])).toBeLessThanOrEqual(1);
      expect(Math.abs(pinning.moved[2] + pinning.scroll)).toBeLessThanOrEqual(1);
    }
    await page.getByRole("tab", { name: "法人總覽", exact: true }).click();
    const overviewReport = await page.locator("#institution-overview").evaluate((element) => {
      const clipped = [];
      for (const row of element.querySelectorAll("article")) {
        const bounds = row.getBoundingClientRect();
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(walker.currentNode);
          for (const rect of range.getClientRects()) if (rect.left < bounds.left || rect.right > bounds.right)
            clipped.push(walker.currentNode.textContent.trim());
        }
      }
      return { clipped, width: document.documentElement.scrollWidth };
    });
    expect(overviewReport.clipped, `Overview clipping at ${width}px`).toEqual([]);
    expect(overviewReport.width).toBeLessThanOrEqual(width);
    for (const control of await page.locator("#institution-overview [data-institution-window], #institution-overview [data-institution-details]").all()) {
      const bounds = await control.boundingBox();
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.width).toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath(`institutional-overview-${width}.png`), fullPage: true });
  }
});

test("reading copy and metadata stay legible across mobile, tablet and desktop views", async ({ page }) => {
  async function expectLegible(scope = "body") {
    const undersized = await page.locator(scope).evaluate((root) => {
      const small = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const element = node.parentElement;
        if (!node.textContent.trim() || element.closest(".sr-only, svg, script, style, [aria-hidden='true']")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (![...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0)) continue;
        const size = parseFloat(getComputedStyle(element).fontSize);
        if (size < 12) small.push({ text: node.textContent.trim(), size });
      }
      return small;
    });
    expect(undersized).toEqual([]);
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[data-overview="price"]').click();
    const sizes = await page.locator(".panel-subtitle, .watchlist-heading p, .metric-label, .metric-description, .signal-reason").evaluateAll((elements) =>
      elements.filter((element) => element.getClientRects().length).map((element) => parseFloat(getComputedStyle(element).fontSize)));
    expect(Math.min(...sizes), `Reading copy at ${width}px`).toBeGreaterThanOrEqual(14);
    expect(await page.locator(".search-box input").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await expectLegible();
    await page.locator('[data-overview="institutions"]').click();
    await expectLegible();
    for (const name of ["source", "methodology", "settings"]) {
      await page.locator(`.sidebar [data-dialog="${name}"]`).click();
      await expect(page.locator("#info-dialog")).toBeVisible();
      await expectLegible("#info-dialog");
      await page.locator("#close-dialog").click();
    }
    await page.locator('#institution-overview [data-institution-details="6488"]').click();
    await expectLegible("#institution-dialog");
    await closeInstitutionDetails(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `Page overflow at ${width}px`).toBeLessThanOrEqual(width);
  }
});

test("phone institutional rows align values and keep interval switching available while scrolling", async ({ page }) => {
  const { stocks } = await demoProvider.load();
  await page.evaluate((favorites) => localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites, catalogVersion: 2 })), stocks.map((stock) => stock.symbol));
  await page.reload();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 520, 700]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[data-overview="institutions"]').click();
    await page.locator('[data-institution-window="20"]').click();
    await expect(page.locator(".institution-overview-row")).toHaveCount(14);
    const report = await page.locator(".institution-overview-row").evaluateAll((rows) => rows.flatMap((row) => {
      const issues = [];
      const fields = [...row.querySelectorAll(".overview-metric")];
      for (const field of fields) if (field.scrollWidth > field.clientWidth + 1) issues.push("field overflow");
      const components = fields.slice(1).map((field) => field.querySelector("dd").getBoundingClientRect());
      if (!components.every((rect, index) => Math.abs(rect.right - components[0].right) <= 1 && (!index || rect.top > components[index - 1].bottom)))
        issues.push("institution values do not align in distinct rows");
      return issues;
    }));
    expect(report, `Mobile comparisons at ${width}px`).toEqual([]);
    await page.locator('.institution-overview-row').nth(10).evaluate((row) => row.scrollIntoView({ block: "start", behavior: "instant" }));
    await settleLayout(page);
    const interval = await page.locator(".institution-window").boundingBox();
    const nav = await page.locator(".sidebar").boundingBox();
    expect(interval.y).toBeGreaterThanOrEqual(nav.y + nav.height);
    expect(interval.y + interval.height).toBeLessThan(844);
    await page.locator('[data-institution-window="5"]').click();
    await expect(page.locator('[data-institution-window="5"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-institution-window="5"]')).toBeFocused();
  }
});
