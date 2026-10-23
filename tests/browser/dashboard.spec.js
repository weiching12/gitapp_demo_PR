import { test, expect } from "@playwright/test";
import { demoProvider } from "../../src/data.js";
import { getSnapshot } from "../../src/indicators.js";
import { isEtf } from "../../src/market-codec.js";

const cardFor = (page, symbol) => page.locator(`[data-watch-symbol="${symbol}"]`);
const detailsButtonFor = (page, symbol) => page.locator(`#institution-overview [data-institution-details="${symbol}"]`);
const openPage = async (page, name) => {
  await page.locator(`.sidebar [data-page="${name}"]`).click();
  await expect(page.locator(`[data-page-panel="${name}"]`).last()).toBeVisible();
};
async function openInstitutionDetails(page, symbol) {
  await openPage(page, "favorites");
  await page.locator('[data-overview="institutions"]').click();
  await detailsButtonFor(page, symbol).click();
  const dialog = page.locator("#institution-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-institution-symbol]")).toHaveAttribute("data-institution-symbol", symbol);
  return dialog;
}
async function closeInstitutionDetails(page) {
  const close = page.locator("#close-institution-dialog");
  if (await close.isVisible()) await close.click();
  else await page.locator("#institution-dialog .institution-dialog-handle").click();
  await expect(page.locator("#institution-dialog")).not.toBeVisible();
}
const formatted = (value, digits = 0) => value.toLocaleString("en-US", {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});
const signed = (value) => `${value > 0 ? "+" : ""}${formatted(value)}`;
const overviewFor = (page, symbol) => page.locator(`[data-overview-symbol="${symbol}"]`);
const institutionalNames = ["外資", "投信", "自營商"];
test("today price and volume column remains readable on desktop and horizontally scrollable on mobile", async ({ page }) => {
  await page.goto("/");
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".table-scroll thead th", { hasText: "今日量價" })).toBeVisible();
    await expect(page.locator(".table-scroll thead th", { hasText: "趨勢判斷" })).toBeVisible();
    await expect(page.locator("#stock-rows tr").first().locator(".price-volume-cell")).toContainText(/資料不足|倍均量/);
    await expect(page.locator("#stock-rows tr").first().locator(".trend-cell")).toContainText(/偏多|偏空|方向未明|資料不足/);
    const metrics = await page.locator(".table-scroll").evaluate((element) => ({
      client: element.clientWidth, content: element.scrollWidth,
    }));
    if (width <= 390) {
      expect(metrics.content).toBeGreaterThan(metrics.client);
      const trendEdge = await page.locator(".table-scroll thead th", { hasText: "趨勢判斷" }).evaluate((element) =>
        element.getBoundingClientRect().right);
      const viewportEdge = await page.locator(".table-scroll").evaluate((element) =>
        element.getBoundingClientRect().right);
      expect(trendEdge).toBeLessThanOrEqual(viewportEdge + 1);
    }
  }
});
const amountText = (shares) => {
  const lots = shares / 1000;
  const digits = Number.isInteger(lots) ? 0 : 2;
  return `${lots > 0 ? "+" : ""}${formatted(lots, digits)} 張`;
};
const moneyText = (amount) => `${amount > 0 ? "+" : ""}${formatted(amount / 100000000, 2)} 億`;
const dailyMoney = (history, name = "total") => history.reduce((total, bar) => total + bar.institutions
  .filter((item) => name === "total" || item.name === name)
  .reduce((net, item) => net + item.buy - item.sell, 0) * bar.close, 0);
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
  await expect(page.locator("#page-title")).toContainText("市場觀察清單");
  await expect(page.locator("#stocks-heading")).toHaveCount(0);
  await openPage(page, "favorites");
  await expect(page.locator(".watch-card")).toHaveCount(5);
  await expect(page.locator("#watchlist")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("#watchlist")).toHaveCSS("border-radius", "10px");
  await expect(page.locator("#stock-rows tr")).toHaveCount(14);
  await expect(page.locator("#table-load-trigger")).toBeHidden();
  await expect(page.locator("#table-summary")).toContainText("顯示 14 / 14 檔");
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
      await expect(dialog.locator(".watch-flow-total strong")).toHaveText(moneyText(bar.institutionalNet * bar.close));
      for (const item of bar.institutions) {
        const row = dialog.locator(`[data-institution="${item.name}"]`);
        await expect(row.locator(".watch-institution-value strong")).toHaveText(moneyText((item.buy - item.sell) * bar.close));
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
  await expect(page.locator(".stocks-panel")).toBeHidden();
  await expect(page.locator("#watchlist")).toBeVisible();
});

test("institutional details identify the selected stock and support keyboard, Escape and backdrop dismissal", async ({ page }) => {
  await openPage(page, "favorites");
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
  expect(await firstButton.evaluate((button) => button.matches(":focus-visible"))).toBe(true);

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
  await expect(dialog.locator(".watch-flow-total strong")).toHaveText(moneyText(latest.institutionalNet * latest.close));
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
  await openPage(page, "favorites");
  await expect(cardFor(page, "2317")).toBeVisible();
});

test("market defaults to favorites first, then highest gain, with symbol above company name", async ({ page }) => {
  const { stocks, info } = await demoProvider.load();
  const favorites = new Set(["2330", "2317", "0050", "3026", "6488"]);
  const expected = stocks.map((stock) => ({
    symbol: stock.symbol,
    favorite: favorites.has(stock.symbol),
    change: getSnapshot(stock, info.asOf).latest.changePercent,
  })).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.change - a.change || a.symbol.localeCompare(b.symbol));
  expect(await page.locator("#stock-rows tr").evaluateAll((rows) => rows.map((row) => row.dataset.symbol)))
    .toEqual(expected.map((stock) => stock.symbol));
  const identity = page.locator('#stock-rows tr[data-symbol="2330"] .stock-name');
  await expect(identity.locator("strong")).toHaveText("2330");
  await expect(identity.locator(":scope > span")).toContainText("台積電");
});

test("mobile table keeps prices and daily changes visible with volume beneath each close", async ({ page }) => {
  const { stocks, info } = await demoProvider.load();
  await expect(page.locator('[data-sort-heading="changePercent"]')).toHaveText(/日漲跌幅/);
  await expect(page.locator('[data-sort-heading="changePercent"]')).toBeVisible();
  await expect(page.locator(".mobile-change").first()).toBeHidden();
  await expect(page.locator('[data-sort-heading="changePercent"]')).not.toContainText("較前交易日");
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
    await expect(page.locator('[data-sort-heading="changePercent"]')).toBeHidden();
    const columns = await page.locator('.table-scroll').evaluate((table) => {
      const header = table.querySelector('.signal-heading').getBoundingClientRect();
      const cell = table.querySelector('.signal-cell').getBoundingClientRect();
      return { headerWidth: header.width, cellWidth: cell.width, offset: header.left - cell.left };
    });
    expect(columns.headerWidth).toBeCloseTo(160, 0);
    expect(columns.cellWidth).toBeCloseTo(160, 0);
    expect(columns.offset).toBeCloseTo(0, 0);
    await expect(page.locator('[data-sort-heading="close"]')).toContainText("收盤／漲跌");
    await expect(page.locator('#stock-rows tr').first().locator(".mobile-change")).toBeVisible();
    await expect(page.locator('#stock-rows tr').first().locator(".net-cell-mobile .institution-net")).toContainText("億");
    await expect(page.locator('#stock-rows tr').first().locator(".net-cell-mobile .institution-volume-share")).toHaveText(/^量 [+-]?\d+\.\d+%$/);
    await expect(page.locator('#stock-rows tr').first().locator(".net-cell-mobile .institution-leader")).toBeVisible();
    const mergedChange = await page.locator('#stock-rows tr').first().evaluate((row) => {
      const volume = getComputedStyle(row.querySelector(".stock-volume"));
      const change = getComputedStyle(row.querySelector(".mobile-change"));
      const close = getComputedStyle(row.querySelector(".stock-close"));
      const net = getComputedStyle(row.querySelector(".net-cell-mobile .institution-net"));
      const lots = getComputedStyle(row.querySelector(".net-cell-mobile .institution-volume-share"));
      const closeBox = row.querySelector(".stock-close").getBoundingClientRect();
      const changeBox = row.querySelector(".mobile-change").getBoundingClientRect();
      return {
        oldColumnWidth: row.querySelector(".change-cell").getBoundingClientRect().width,
        fontSize: [change.fontSize, volume.fontSize],
        fontWeight: [change.fontWeight, volume.fontWeight],
        lineHeight: [change.lineHeight, volume.lineHeight],
        primary: [close.fontSize, close.fontWeight, close.lineHeight, close.display],
        institutionPrimary: [net.fontSize, net.fontWeight, net.lineHeight, net.display],
        secondary: [volume.fontSize, volume.fontWeight, volume.lineHeight, volume.marginTop],
        institutionSecondary: [lots.fontSize, lots.fontWeight, lots.lineHeight, lots.marginTop],
        priceIsStacked: changeBox.top >= closeBox.bottom,
      };
    });
    expect(mergedChange.oldColumnWidth).toBe(0);
    expect(new Set(mergedChange.fontSize).size).toBe(1);
    expect(new Set(mergedChange.fontWeight).size).toBe(1);
    expect(new Set(mergedChange.lineHeight).size).toBe(1);
    expect(mergedChange.institutionPrimary).toEqual(mergedChange.primary);
    expect(mergedChange.institutionSecondary).toEqual(mergedChange.secondary);
    expect(mergedChange.priceIsStacked).toBe(true);
    await page.locator(".table-scroll").evaluate((element) => { element.scrollLeft = 0; });
    const issues = await page.locator(".table-scroll").evaluate((element) => {
      const rightEdge = element.getBoundingClientRect().right;
      const errors = [];
      const netHeading = element.querySelector("thead th:last-child");
      if (netHeading.getBoundingClientRect().width > 132.1)
        errors.push("institutional net column is wider than expected");
      for (const row of element.querySelectorAll("tbody tr")) {
        const cells = [...row.children];
        if (cells[1].getBoundingClientRect().right - cells[0].getBoundingClientRect().left > 132.1)
          errors.push("pinned columns consume too much space");
        for (const text of row.querySelectorAll(".stock-close, .stock-volume, .mobile-change")) {
          const range = document.createRange(); range.selectNodeContents(text);
          for (const rect of range.getClientRects()) if (rect.right > rightEdge + 1) errors.push("price, volume or daily change is outside the viewport");
        }
        const name = row.querySelector(".stock-name");
        if (name.scrollWidth > name.clientWidth + 1) errors.push("stock name does not wrap within its column");
        const volumeStyle = getComputedStyle(row.querySelector(".stock-volume"));
        const reasonStyle = getComputedStyle(row.querySelector(".signal-reason"));
        if (reasonStyle.fontSize !== volumeStyle.fontSize || reasonStyle.fontWeight !== volumeStyle.fontWeight)
          errors.push("signal reason typography differs from stock volume");
        const leader = row.querySelector(".institution-leader");
        if (leader.scrollWidth > leader.clientWidth + 1) errors.push("institutional leader does not wrap within its column");
      }
      return errors;
    });
    expect(issues, `Mobile market table at ${width}px`).toEqual([]);
    const nameStyles = await page.evaluate(() => {
      const read = (selector) => {
        const style = getComputedStyle(document.querySelector(selector));
        return { color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
      };
      return { market: read(".stock-name strong"), sector: read(".sector-identity h3") };
    });
    expect(nameStyles.market).toEqual(nameStyles.sector);
  }
});

test("stars update every favorite card immediately and persist after reload", async ({ page }) => {
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await expect(page.locator(".watch-card")).toHaveCount(6);
  await openPage(page, "favorites");
  await expect(cardFor(page, "2454")).toContainText("1,360.00");
  await page.reload();
  await openPage(page, "favorites");
  await expect(page.locator(".watch-card")).toHaveCount(6);
  await expect(page.locator("#favorite-count")).toHaveText("6");
  await cardFor(page, "2454").getByRole("button", { name: "移除聯發科自選" }).click();
  await expect(cardFor(page, "2454")).toHaveCount(0);
  await openPage(page, "market");
  await page.locator('[data-view="favorites"]').click();
  await expect(page.locator("#stock-rows tr")).toHaveCount(5);
  await expect(page.locator('[data-view="favorites"]')).toBeFocused();
  await page.reload();
  await expect(cardFor(page, "2454")).toHaveCount(0);
});

test("new requested favorites migrate once and stay removed after the user removes them", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites: ["2330"] })));
  await page.reload();
  await openPage(page, "favorites");
  await expect(page.locator(".watch-card")).toHaveCount(3);
  await expect(cardFor(page, "3026")).toBeVisible();
  await expect(cardFor(page, "6488")).toBeVisible();
  await cardFor(page, "3026").locator("[data-favorite]").click();
  await cardFor(page, "6488").locator("[data-favorite]").click();
  await page.reload();
  await openPage(page, "favorites");
  await expect(page.locator(".watch-card")).toHaveCount(1);
  await expect(cardFor(page, "2330")).toBeVisible();
});

test("empty favorites persist and offer a working path back to stock selection", async ({ page }) => {
  await openPage(page, "favorites");
  for (const symbol of ["2330", "2317", "0050", "3026", "6488"])
    await cardFor(page, symbol).locator("[data-favorite]").click();
  await expect(page.locator(".watch-card")).toHaveCount(0);
  await expect(page.locator("#watchlist-empty")).toBeVisible();
  await page.reload();
  await openPage(page, "favorites");
  await expect(page.locator(".watch-card")).toHaveCount(0);
  await expect(page.locator("#watchlist-count")).toHaveCount(0);
  await page.getByRole("button", { name: "前往選擇股票" }).click();
  await expect(page.locator(".table-scroll")).toBeFocused();
  await expect(page.locator("#stock-rows tr")).toHaveCount(14);
  await page.locator('#stock-rows [data-favorite="00878"]').click();
  await openPage(page, "favorites");
  await expect(page.locator(".watch-card")).toHaveCount(1);
  await expect(cardFor(page, "00878")).toBeVisible();
  await expect(page.locator("#watchlist-empty")).not.toBeVisible();
});

test("KD settings recalculate every favorite and table suggestion and persist", async ({ page }) => {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("RSV 回溯週期").fill("14");
  await page.getByRole("button", { name: "指標儲存" }).click();
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

test("market sentiment stays on the latest five days when the table date changes", async ({ page }) => {
  const card = page.locator("#market-sentiment");
  await expect(card).toBeVisible();
  await expect(card.locator(".sentiment-score")).not.toHaveText("—");
  const firstDate = await page.locator("#trade-date").inputValue();
  await expect(card.locator(".sentiment-date")).toContainText(firstDate);
  const score = await card.locator(".sentiment-score").textContent();
  await page.locator("#trade-date").selectOption({ index: 1 });
  await expect(card.locator(".sentiment-score")).toHaveText(score);
  await expect(card.locator(".sentiment-date")).toContainText(firstDate);
  await card.getByRole("button").click();
  await expect(page.getByRole("dialog")).toContainText("市場漲跌家數");
  await expect(page.getByRole("dialog")).toContainText("最新資料日回推 5 個交易日");
  await expect(page.getByRole("dialog")).toContainText("ETF 與缺漏值不納入分母");
});

test("general settings persist the dark theme", async ({ page }) => {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("色彩主題").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "關閉視窗" }).click();
  await expect(page.locator("#market-sentiment > button")).toHaveCSS("background-color", "rgb(17, 27, 43)");
  await expect(page.locator("#sector-filter")).toHaveCSS("background-color", "rgb(13, 23, 38)");
  await expect(page.locator("#sector-filter")).toHaveCSS("color", "rgb(229, 237, 248)");
  const stockName = page.locator('#stock-rows [data-symbol="2330"] .stock-name');
  await expect(stockName.locator("strong")).toHaveCSS("color", "rgb(229, 237, 248)");
  await expect(stockName.locator(":scope > span")).toHaveCSS("color", "rgb(154, 171, 194)");
  await expect(page.locator('#stock-rows [data-symbol="2330"] th')).toHaveCSS("background-color", "rgb(17, 27, 43)");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(stockName.locator("strong")).toHaveCSS("color", "rgb(229, 237, 248)");
  await expect(stockName.locator(":scope > span")).toHaveCSS("color", "rgb(154, 171, 194)");
  await page.getByRole("button", { name: "自選總覽" }).click();
  await expect(page.locator(".overview-controls")).toHaveCSS("background-color", "rgb(17, 27, 43)");
  await page.locator("#watchlist-institutions-tab").click();
  await expect(page.locator(".overview-total").first()).toHaveCSS("background-color", "rgb(22, 34, 56)");
  await expect(page.locator(".overview-detail-button").first()).toHaveCSS("background-color", "rgb(22, 34, 56)");
  await expect(page.locator(".overview-metric .watch-streak").first()).not.toHaveCSS("background-color", "rgb(241, 245, 249)");
  await page.locator(".overview-detail-button").first().click();
  await expect(page.locator("#institution-dialog .institution-dialog-top")).toHaveCSS("background-color", "rgb(17, 27, 43)");
  await expect(page.locator("#institution-dialog .watch-flow-total")).toHaveCSS("background-color", "rgb(22, 34, 56)");
  await expect(page.locator("#institution-dialog .watch-total-history .watch-history")).toHaveCSS("background-color", "rgb(22, 34, 56)");
  await expect(page.locator("#institution-dialog .institution-dialog-footer")).toHaveCSS("background-color", "rgb(17, 27, 43)");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "法人買株" }).click();
  await page.locator("#sector-grid [data-sector-details]").first().click();
  await expect(page.locator("#sector-dialog .sector-dialog-top")).toHaveCSS("background-color", "rgb(17, 27, 43)");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("notification control lives in settings with a bell beside the trade date", async ({ page }) => {
  await expect(page.locator(".push-controls")).toHaveCount(0);
  const bell = page.locator(".date-notification-button");
  await expect(bell).toBeHidden();
  await page.locator("html").evaluate((root) => {
    root.querySelector(".date-notification-button").hidden = false;
  });
  await expect(bell).toBeVisible();
  await bell.evaluate((button) => { button.hidden = true; });
  await expect(bell).toBeHidden();
  await bell.evaluate((button) => { button.hidden = false; });
  await expect(bell).toBeVisible();
  await expect(page.locator("#update-countdown")).toContainText(/預計 (18:30|20:30) 更新 · \d{2,}:\d{2}:\d{2}/);
  await bell.click();
  await expect(page.getByRole("dialog")).toContainText("資料更新通知");
  await expect(page.locator("#settings-notifications")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "資料說明", exact: true }).click();
  await expect(page.locator("#settings-notifications")).toBeHidden();
});

test("technical suggestions explain each stock on the selected historical date", async ({ page }) => {
  await expect(page.locator('[data-symbol="2317"] .signal-badge')).toHaveText("留意賣點");
  await expect(cardFor(page, "2317").locator(".signal-badge")).toHaveText("留意賣點");
  await page.locator("#trade-date").selectOption("2026-09-08");
  await expect(page.locator('[data-symbol="2603"] .signal-badge')).toHaveText("反彈觀察");
  await expect(page.locator('[data-symbol="2603"] .signal-reason')).toContainText("MA20 趨勢尚未確認");
  await page.locator('#stock-rows [data-favorite="2603"]').click();
  await openPage(page, "favorites");
  await expect(cardFor(page, "2603").locator(".signal-badge")).toHaveText("反彈觀察");
});

test("technical and seasonal-position badges use borderless color fills", async ({ page }) => {
  const signal = page.locator("#stock-rows .signal-badge").first();
  const position = page.locator("#stock-rows .position-tag").first();
  await expect(signal).toHaveCSS("border-top-width", "0px");
  await expect(position).toHaveCSS("border-top-width", "0px");
});

test("desktop overview screenshot and keyboard search shortcut", async ({ page }, testInfo) => {
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.locator("#page-title").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.screenshot({ path: testInfo.outputPath("watchlist-desktop.png"), fullPage: true });
});

test("mobile cards swipe above the table and support table scrolling", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, "favorites");
  await expect(page.locator(".watch-card")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await openPage(page, "market");
  await page.locator(".table-scroll").focus();
  await expect(page.locator(".table-scroll")).toBeFocused();
  const signal = page.locator('[data-symbol="2317"] .signal-badge');
  await signal.scrollIntoViewIfNeeded();
  await expect(signal).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("watchlist-mobile.png"), fullPage: true });
});

test("phone price carousel supports swipe with dot pagination", async ({ page }) => {
  const { stocks } = await demoProvider.load();
  await page.evaluate((favorites) => localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites, catalogVersion: 2 })),
    stocks.map((stock) => stock.symbol));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await openPage(page, "favorites");
  const grid = page.locator("#watchlist-grid");
  const controls = page.locator("#watchlist-carousel-controls");
  await expect(page.locator(".watch-card")).toHaveCount(14);
  await expect(controls).toBeVisible();
  await expect(controls.locator("[data-carousel-index]")).toHaveCount(3);
  const toolbarStyles = await page.evaluate(() => {
    const toolbar = getComputedStyle(document.querySelector(".overview-controls"));
    const tabs = getComputedStyle(document.querySelector(".overview-tabs"));
    return { borderTop: toolbar.borderTopWidth, borderBottom: toolbar.borderBottomWidth, tabsBackground: tabs.backgroundColor };
  });
  expect(toolbarStyles).toEqual({ borderTop: "0px", borderBottom: "0px", tabsBackground: "rgb(255, 255, 255)" });
  const layout = await grid.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    visibleWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    firstWidth: element.querySelector(".watch-card").getBoundingClientRect().width,
  }));
  expect(layout.height).toBeLessThan(600);
  expect(layout.scrollWidth).toBeGreaterThan(layout.visibleWidth);
  expect(layout.firstWidth).toBeLessThan(layout.visibleWidth);
  await grid.evaluate((element) => { element.scrollLeft = element.querySelectorAll(".watch-card")[1].offsetLeft; });
  await settleLayout(page);
  expect(await grid.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await grid.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(page.locator(".watch-card").last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const cards = await grid.locator(".watch-card").evaluateAll((items) => items.map((card) => ({
      width: card.getBoundingClientRect().width,
      height: card.getBoundingClientRect().height,
      metrics: [...card.querySelectorAll(".metric-card")].map((metric) => ({
        width: metric.getBoundingClientRect().width,
        height: metric.getBoundingClientRect().height,
      })),
    })));
    expect(new Set(cards.map((card) => Math.round(card.width))).size).toBe(1);
    expect(new Set(cards.map((card) => Math.round(card.height))).size).toBe(1);
    for (const card of cards) {
      expect(new Set(card.metrics.map((metric) => Math.round(metric.width))).size).toBe(1);
      expect(new Set(card.metrics.map((metric) => Math.round(metric.height))).size).toBe(1);
    }
  }
  await page.setViewportSize({ width: 768, height: 844 });
  await expect(page.locator("#watchlist-carousel-controls")).toBeVisible();
  expect(await grid.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0);
});

test("favorite metrics remain unclipped across narrow screens, tablets and desktops", async ({ page }, testInfo) => {
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("RSV 回溯週期").fill("60");
  await page.getByLabel("K 平滑係數").fill("20");
  await page.getByLabel("D 平滑係數").fill("20");
  await page.getByRole("button", { name: "指標儲存" }).click();
  await openPage(page, "favorites");
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
          await expect(dialog.locator(`[data-institution="${name}"] [data-window="${days}"] .institution-money`))
            .toHaveText(moneyText(dailyMoney(history.slice(-days), name)));
        }
        await expect(dialog.locator(`.watch-total-history [data-window="${days}"] .institution-money`))
          .toHaveText(moneyText(dailyMoney(history.slice(-days))));
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
  await expect(page.locator(".brand-intro")).toHaveCount(0);
  await expect(page.locator('[data-page="about"]')).toHaveCount(0);
  await source.click();
  await expect(page.locator("#dialog-heading")).toHaveText("關於株研");
  await expect(page.locator(".source-about")).toContainText("從數據到洞察，讓每一項投資判斷都有跡可循。");
  await expect(page.locator(".source-about .about-hero")).toBeVisible();
  await expect(page.locator(".source-about .about-goal")).toHaveCount(5);
  await expect(page.locator(".source-about .about-status.available")).toHaveText("目前提供");
  await expect(page.locator(".source-about .about-goal").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("#source-data-heading")).toHaveText("資料來源與更新規則");
  await expect(page.getByRole("dialog")).toContainText("沒有連接交易所");
  await page.keyboard.press("Escape");
  await expect(source).toBeFocused();
});

test("source dialog uses a consistent article type scale on desktop and phone", async ({ page }) => {
  for (const [width, expected] of [[1024, [24, 20, 18, 16, 14]], [390, [15, 15, 14, 14, 12]]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "資料說明", exact: true }).click();
    const sizes = await page.locator("#info-dialog").evaluate((dialog) => [
      "#dialog-heading", ".about-hero h2", ".about-goals-heading", ".about-goal h3", ".about-hero p",
    ].map((selector) => Number.parseFloat(getComputedStyle(dialog.querySelector(selector)).fontSize)));
    expect(sizes).toEqual(expected);
    await page.keyboard.press("Escape");
  }
});

test("watchlist tabs support keyboard selection and restore focus to the exact overview details button", async ({ page }) => {
  await openPage(page, "favorites");
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
  await openPage(page, "favorites");
  await page.getByRole("tab", { name: "法人總覽", exact: true }).click();
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(5);
  const noteLayout = await page.locator(".institution-overview-note").evaluate((note) => ({
    followsCards: Boolean(note.compareDocumentPosition(document.querySelector("#institution-overview-rows")) & Node.DOCUMENT_POSITION_PRECEDING),
    fontSize: getComputedStyle(note).fontSize,
  }));
  expect(noteLayout).toEqual({ followsCards: true, fontSize: "12px" });
  const windows = page.getByRole("group", { name: "法人累計區間" });
  for (const date of [info.asOf, "2026-09-08"]) {
    await page.locator("#trade-date").selectOption(date);
    await expect(page.locator("#institution-overview-date")).toHaveCount(0);
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
          await expect(row.locator(`[data-overview-amount="${name}"]`)).toHaveText(moneyText(dailyMoney(history.slice(-count), name)));
        }
        await expect(row.locator('[data-overview-net="total"]')).toHaveText(amountText(total));
        await expect(row.locator('[data-overview-amount="total"]')).toHaveText(moneyText(dailyMoney(history.slice(-count))));
        await expect(row.locator(".overview-total-context")).toHaveCount(0);
        for (const name of ["外資", "投信"])
          await expect(row.locator(`[data-overview-streak="${name}"]`)).toHaveText(streakText(history, name));
      }
    }
  }
  await openPage(page, "market");
  await page.getByRole("searchbox").fill("0050");
  await expect(page.locator("#stock-rows tr")).toHaveCount(1);
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(5);
  await page.locator("#sector-filter").selectOption("半導體");
  await expect(page.locator("#table-empty")).toBeVisible();
  await openPage(page, "favorites");
  await expect(overviewFor(page, "2330")).toBeVisible();
  await expect(overviewFor(page, "0050")).toBeVisible();
});

test("sector page aggregates institutional flows and sorts industries", async ({ page }) => {
  const { stocks, info } = await demoProvider.load();
  const companyStocks = stocks.filter((stock) => !isEtf(stock));
  await openPage(page, "sectors");
  await expect(page.locator('[data-sector-sort="name-asc"]')).toHaveAttribute("aria-pressed", "true");
  const sortedNames = [...new Set(companyStocks.map((stock) => stock.sector))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  expect(await page.locator("#sector-grid .sector-card").evaluateAll((cards) => cards.map((card) => card.dataset.sectorName))).toEqual(sortedNames);
  await page.locator('[data-sector-sort="net-desc"]').click();
  const windows = page.getByRole("group", { name: "法人買株累計區間" });
  const expected = (days) => {
    const totals = new Map();
    for (const stock of companyStocks) {
      const history = stock.history.filter((bar) => bar.date <= info.asOf).slice(-days);
      const total = dailyMoney(history);
      totals.set(stock.sector, (totals.get(stock.sector) ?? 0) + total);
    }
    return [...totals].sort((a, b) => b[1] - a[1]);
  };
  const expectedLeader = (sector, days) => {
    const members = companyStocks.filter((stock) => stock.sector === sector).map((stock) => {
      const history = stock.history.filter((bar) => bar.date <= info.asOf).slice(-days);
      const flows = Object.fromEntries(institutionalNames.map((name) => [name,
        history.reduce((sum, bar) => {
          const item = bar.institutions.find((institution) => institution.name === name);
          return sum + item.buy - item.sell;
        }, 0),
      ]));
      return { stock, flows, total: dailyMoney(history) };
    });
    const sectorTotal = members.reduce((sum, member) => sum + member.total, 0);
    const leader = members.reduce((best, member) =>
      sectorTotal < 0 ? member.total < best.total ? member : best
        : member.total > best.total ? member : best);
    return leader;
  };
  for (const [key, days, label] of [["day", 1, "當日"], ["5", 5, "5 日"], ["20", 20, "20 日"]]) {
    await windows.getByRole("button", { name: label, exact: true }).click();
    const ranked = expected(days);
    const cards = page.locator("#sector-grid .sector-card");
    await expect(cards).toHaveCount(ranked.length);
    for (let index = 0; index < ranked.length; index++) {
      await expect(cards.nth(index)).toHaveAttribute("data-sector-name", ranked[index][0]);
      await expect(cards.nth(index).locator(".sector-total strong")).toHaveText(moneyText(ranked[index][1]));
      const leader = expectedLeader(ranked[index][0], days);
      const note = await cards.nth(index).locator(".sector-identity p").innerText();
      expect(note).toContain(`TOP1·${leader.stock.name}`);
      if (key === "day") expect(note).not.toContain("當日");
      expect(note).not.toMatch(/檔|張|買最多|賣最多/);
      const history = leader.stock.history.filter((bar) => bar.date <= info.asOf);
      const change = days === 1 ? getSnapshot(leader.stock, info.asOf).latest.changePercent
        : (history.at(-1).close / history.at(-(days + 1)).close - 1) * 100;
      expect(note).toContain(`${change > 0 ? "+" : ""}${formatted(change, 2)}%`);
      expect(note.indexOf(`TOP1·${leader.stock.name}`)).toBeLessThan(note.indexOf(`${change > 0 ? "+" : ""}${formatted(change, 2)}%`));
    }
  }
  await page.locator('[data-sector-sort="net-asc"]').click();
  const ascending = expected(20).toReversed().map(([name]) => name);
  expect(await page.locator("#sector-grid .sector-card").evaluateAll((cards) => cards.map((card) => card.dataset.sectorName))).toEqual(ascending);
  await page.locator('[data-sector-sort="name-asc"]').click();
  const names = [...new Set(companyStocks.map((stock) => stock.sector))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  expect(await page.locator("#sector-grid .sector-card").evaluateAll((cards) => cards.map((card) => card.dataset.sectorName))).toEqual(names);
});

test("sector details show period totals and each constituent stock price and net lots", async ({ page }) => {
  const { stocks, info } = await demoProvider.load();
  const sectorName = [...new Set(stocks.map((stock) => stock.sector))]
    .find((name) => stocks.filter((stock) => stock.sector === name).length > 1);
  const members = stocks.filter((stock) => stock.sector === sectorName);
  const memberNet = (stock, institution, days) => stock.history
    .filter((bar) => bar.date <= info.asOf).slice(-days)
    .reduce((total, bar) => {
      const row = bar.institutions.find((item) => item.name === institution);
      return total + row.buy - row.sell;
    }, 0);
  const sectorNet = (institution, days) => members
    .reduce((total, stock) => total + memberNet(stock, institution, days), 0);
  const expectedTotal = (days) => institutionalNames
    .reduce((total, institution) => total + sectorNet(institution, days), 0);

  await openPage(page, "sectors");
  const card = page.locator(`#sector-grid [data-sector-details="${sectorName}"]`);
  await expect(card).toHaveAttribute("aria-haspopup", "dialog");
  await card.click();
  const dialog = page.locator("#sector-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(sectorName);
  await expect(dialog.locator("[data-sector-window]")).toHaveCount(0);
  for (const [key, days] of [["day", 1], ["5", 5], ["20", 20]]) {
    const summary = dialog.locator(`[data-sector-period="${key}"]`);
    await expect(summary.locator('[data-sector-summary="total"]')).toHaveText(amountText(expectedTotal(days)));
    for (const institution of institutionalNames)
      await expect(summary.locator(`[data-sector-summary="${institution}"]`))
        .toHaveText(amountText(sectorNet(institution, days)));
  }
  await expect(dialog.locator("[data-sector-stock]")).toHaveCount(members.length);
  for (const stock of members) {
    const row = dialog.locator(`[data-sector-stock="${stock.symbol}"]`);
    const latest = stock.history.filter((bar) => bar.date <= info.asOf).at(-1);
    await expect(row).toContainText(stock.name);
    await expect(row.locator("td:nth-child(2)")).toContainText(formatted(latest.close, 2));
    for (const [key, days] of [["day", 1], ["5", 5], ["20", 20]])
      await expect(row.locator(`[data-sector-net="${key}"] strong`))
        .toHaveText(moneyText(dailyMoney(stock.history.filter((bar) => bar.date <= info.asOf).slice(-days))));
  }

  await dialog.locator("#close-sector-dialog").click();
  await expect(dialog).not.toBeVisible();
  const refreshedCard = page.locator(`#sector-grid [data-sector-details="${sectorName}"]`);
  await expect(refreshedCard).toBeFocused();
  await refreshedCard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(refreshedCard).toBeFocused();
  expect(await refreshedCard.evaluate((card) => card.matches(":focus-visible"))).toBe(true);
});

test("mobile sector details close after a deliberate downward pull on the handle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, "sectors");
  const card = page.locator("#sector-grid [data-sector-details]").first();
  await card.click();
  const dialog = page.locator("#sector-dialog");
  const handle = dialog.locator(".sector-dialog-handle");
  await expect(dialog.locator("#close-sector-dialog")).toBeHidden();
  await expect(handle).toBeFocused();
  const pull = async (distance) => {
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + distance, { steps: 8 });
    await page.mouse.up();
  };

  await pull(45);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await pull(125);
  await expect(dialog).not.toBeVisible();
  await expect(card).toBeFocused();
  await card.click();
  await handle.click();
  await expect(dialog).not.toBeVisible();
  await card.click();
  await handle.press("Enter");
  await expect(dialog).not.toBeVisible();
  await card.press("Enter");
  await expect(handle).toBeFocused();
  expect(await handle.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(card).toBeFocused();
  expect(await card.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
});

test("mobile favorite institution details use the pull-down handle instead of a close button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, "favorites");
  await page.locator('[data-overview="institutions"]').click();
  const details = detailsButtonFor(page, "2330");
  await details.click();
  const dialog = page.locator("#institution-dialog");
  const handle = dialog.locator(".institution-dialog-handle");
  await expect(dialog.locator("#close-institution-dialog")).toBeHidden();
  await expect(handle).toBeVisible();
  expect((await handle.boundingBox()).height).toBeGreaterThanOrEqual(44);

  const box = await handle.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 125, { steps: 8 });
  await page.mouse.up();
  await expect(dialog).not.toBeVisible();
  await expect(details).toBeFocused();
});

test("mobile page supports pull to refresh without enabling double-tap zoom", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:5173", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS("touch-action", "manipulation");

  const refreshed = await page.evaluate(async () => {
    window.scrollTo(0, 0);
    let requested = false;
    window.addEventListener("stockapps:refresh", (event) => {
      requested = true;
      event.preventDefault();
    }, { once: true });
    const target = document.querySelector(".page-heading");
    const touch = (y) => new Touch({ identifier: 1, target, clientX: 190, clientY: y });
    target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(90)] }));
    target.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [touch(230)] }));
    target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [touch(230)] }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return requested;
  });
  expect(refreshed).toBe(true);
  await context.close();
});

test("market headings use clean sort icons and compact phone date controls", async ({ page }, testInfo) => {
  await openPage(page, "market");
  await expect(page.locator(".table-scroll-hint, #date-hint")).toHaveCount(0);
  await expect(page.locator("#trade-date")).not.toHaveAttribute("aria-describedby", "date-hint");
  await expect(page.locator(".table-scroll [data-sort] svg.sort-icon")).toHaveCount(6);
  await expect(page.locator(".table-scroll thead")).not.toContainText("↕");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const headers = await page.locator(".table-scroll thead th").evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], shadow: style.boxShadow };
    }));
    expect(headers.every((header) => header.background === "rgb(255, 255, 255)" && header.borders.every((border) => border === "0px") && header.shadow === "none")).toBe(true);
    const note = page.locator(".signal-note > span");
    if (width <= 700) {
      await expect(note).toBeHidden();
      await expect(page.locator(".signal-note")).toBeHidden();
      const placement = await page.evaluate(() => {
        const title = document.querySelector("#page-title").getBoundingClientRect();
        const date = document.querySelector("#trade-date").getBoundingClientRect();
        return { gap: date.left - title.right, overlap: Math.min(title.bottom, date.bottom) - Math.max(title.top, date.top), titleHeight: title.height };
      });
      expect(placement.gap).toBeGreaterThanOrEqual(4);
      expect(placement.overlap).toBeGreaterThan(10);
      expect(placement.titleHeight).toBeLessThanOrEqual(24);
      await expect(page.locator('.filter-tabs [data-view="all"] .filter-label-mobile')).toBeVisible();
      await expect(page.locator('.filter-tabs [data-view="all"] .filter-label-mobile')).toHaveText("全部");
      await expect(page.locator('.filter-tabs [data-view="favorites"] .filter-label-mobile')).toHaveText("自選");
      await expect(page.locator('.filter-tabs [data-view="all"]')).toHaveCSS("font-weight", "700");
      await expect(page.locator(".net-heading-mobile")).toBeVisible();
      await expect(page.locator(".net-heading-desktop")).toBeHidden();
      const firstScreenColumns = await page.evaluate(() => {
        const viewport = document.querySelector(".table-scroll").getBoundingClientRect();
        const stock = document.querySelector(".table-scroll thead th:nth-child(2)").getBoundingClientRect();
        const close = document.querySelector('[data-sort-heading="close"]').getBoundingClientRect();
        const net = document.querySelector(".net-heading-mobile").getBoundingClientRect();
        return { order: [stock.left, close.left, net.left], netRight: net.right, viewportRight: viewport.right };
      });
      expect(firstScreenColumns.order[0]).toBeLessThan(firstScreenColumns.order[1]);
      expect(firstScreenColumns.order[1]).toBeLessThan(firstScreenColumns.order[2]);
      expect(firstScreenColumns.netRight).toBeCloseTo(firstScreenColumns.viewportRight, 0);
    } else {
      await expect(page.locator(".net-heading-mobile")).toBeHidden();
      await expect(page.locator(".net-heading-desktop")).toBeVisible();
      await expect(note).toBeVisible();
      await expect(page.locator('.signal-note [data-dialog="signals"]')).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 390) await page.screenshot({ path: testInfo.outputPath("market-heading-390.png") });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator('.filter-tabs [data-view="favorites"]').click();
  await expect(page.locator('.filter-tabs [data-view="favorites"]')).toHaveCSS("font-weight", "700");
  const heading = page.locator('[data-sort-heading="close"]');
  await heading.locator("button").click();
  await expect(heading).toHaveAttribute("aria-sort", "descending");
  await expect(heading.locator(".sort-up")).toHaveCSS("opacity", "0.3");
  await heading.locator("button").press("Enter");
  await expect(heading).toHaveAttribute("aria-sort", "ascending");
  await expect(heading.locator(".sort-down")).toHaveCSS("opacity", "0.3");
});

test("sector data stays on the latest complete date while other pages retain their selected date", async ({ page }) => {
  const { info } = await demoProvider.load();
  await openPage(page, "sectors");
  const latest = await page.locator("#sector-grid").innerText();
  await expect(page.locator("#trade-date")).toBeHidden();
  await expect(page.locator("#trade-date")).toBeDisabled();
  await expect(page.locator("#date-hint")).toHaveCount(0);
  await openPage(page, "market");
  await page.locator("#trade-date").selectOption("2026-09-08");
  await openPage(page, "sectors");
  await expect(page.locator("#sector-grid")).toHaveText(latest, { useInnerText: true });
  await page.locator("#sector-grid [data-sector-details]").first().click();
  await expect(page.locator("#sector-dialog-meta")).toHaveText(`最新完整交易日 ${info.asOf}`);
  await page.locator("#close-sector-dialog").click();
  await openPage(page, "favorites");
  await expect(page.locator("#trade-date")).toBeVisible();
  await expect(page.locator("#trade-date")).toHaveValue("2026-09-08");
  await expect(page.locator("#watchlist h2")).toHaveCount(0);
  await expect(page.locator("#page-title")).toContainText("自選總覽");
  await expect(page.locator("#manage-favorites, .watchlist-heading")).toHaveCount(0);
});

test("mobile market filters share one row with a compact sector control", async ({ page }) => {
  for (const width of [320, 390, 600]) {
    await page.setViewportSize({ width, height: 844 });
    const controls = await page.evaluate(() => {
      const rect = (selector) => {
        const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        topbarDisplay: getComputedStyle(document.querySelector(".topbar")).display,
        titleFontSize: parseFloat(getComputedStyle(document.querySelector("#page-title")).fontSize),
        descriptionDisplay: getComputedStyle(document.querySelector("#page-description")).display,
        signalNoteDisplay: getComputedStyle(document.querySelector(".signal-note")).display,
        filterBackground: getComputedStyle(document.querySelector('[aria-label="清單篩選"]')).backgroundColor,
        filters: [...document.querySelectorAll(".filter-tabs button")].map(node => node.getBoundingClientRect().y),
        filterButtons: [...document.querySelectorAll(".filter-tabs button")].map((node) => ({
          height: node.getBoundingClientRect().height,
          fontSize: parseFloat(getComputedStyle(node).fontSize),
        })),
        search: rect(".search-box"), sector: rect("#sector-filter"),
        searchFontSize: parseFloat(getComputedStyle(document.querySelector("#stock-search")).fontSize),
        sectorFontSize: parseFloat(getComputedStyle(document.querySelector("#sector-filter")).fontSize),
        toolbarPadding: parseFloat(getComputedStyle(document.querySelector(".table-toolbar")).paddingTop),
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(controls.topbarDisplay).toBe("none");
    expect(controls.titleFontSize).toBe(17);
    expect(controls.descriptionDisplay).toBe("none");
    expect(controls.signalNoteDisplay).toBe("none");
    expect(controls.filterBackground).toBe("rgb(255, 255, 255)");
    expect(new Set(controls.filters).size).toBe(1);
    expect(controls.sector.width).toBeLessThan(controls.search.width);
    expect(controls.sector.width / controls.search.width).toBeLessThanOrEqual(0.65);
    expect(controls.search.height).toBe(controls.sector.height);
    expect(controls.sector.x).toBeLessThan(controls.search.x);
    expect(controls.search.height).toBe(34);
    expect(controls.filterButtons.every(({ height, fontSize }) => height >= 34 && height <= 36 && fontSize === 12)).toBe(true);
    expect(controls.searchFontSize).toBe(12);
    expect(controls.sectorFontSize).toBe(12);
    expect(controls.toolbarPadding).toBe(6);
    expect(controls.scrollWidth).toBeLessThanOrEqual(width);
  }
});

test("market filter buttons retain their width and the page fits after selecting low K", async ({ page }) => {
  for (const width of [320, 390, 600]) {
    await page.setViewportSize({ width, height: 844 });
    let originalButtons;
    for (const view of ["all", "oversold", "favorites", "above", "below", "all"]) {
      await page.locator(`[data-view="${view}"]`).click();
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        page: document.documentElement.scrollWidth,
        buttons: [...document.querySelectorAll(".filter-tabs button")].map((button) => ({
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        })),
      }));
      expect(layout.page).toBeLessThanOrEqual(layout.viewport);
      expect(layout.buttons.every(({ width: buttonWidth, height }) =>
        Math.abs(buttonWidth - layout.buttons[0].width) <= 1 && height >= 34 && height <= 36)).toBe(true);
      if (originalButtons) expect(layout.buttons).toEqual(originalButtons);
      else originalButtons = layout.buttons;
      if (view === "below") {
        const deviations = await page.locator("#stock-rows .deviation").evaluateAll((elements) =>
          elements.map((element) => Number(element.textContent.replace("%", ""))));
        expect(deviations.length).toBeGreaterThan(0);
        expect(deviations.every((value) => value < 0)).toBe(true);
      }
    }
  }
});

for (const width of [320, 390, 520, 768, 1440]) test(`sector details fit the viewport at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 });
  await openPage(page, "sectors");
  await page.locator("#sector-grid [data-sector-details]").first().click();
  const dialog = page.locator("#sector-dialog");
  await expect(dialog).toBeVisible();
  const layout = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, width: rect.width, bottom: rect.bottom, viewport: innerHeight };
  });
  if (width <= 520) {
    expect(layout.x).toBe(0);
    expect(layout.width).toBe(width);
    expect(layout.bottom).toBeGreaterThanOrEqual(layout.viewport - 1);
  }
  expect(layout.x).toBeGreaterThanOrEqual(0);
  expect(layout.x + layout.width).toBeLessThanOrEqual(width);
  await expect(dialog.locator(".sector-stock-scroll")).toBeVisible();
  await expect(dialog.locator(".sector-summary-period")).toHaveCount(3);
  const overflow = await dialog.evaluate((element) =>
    [...element.querySelectorAll(".sector-dialog-body, .sector-stock-scroll, .sector-detail-heading, .sector-summary-period, .sector-stock-net strong")]
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => node.className || node.tagName));
  expect(overflow).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`sector-details-${width}.png`) });
  if (width <= 520) {
    await expect(dialog.locator("#close-sector-dialog")).toBeHidden();
    await dialog.locator("[data-sector-stock]").last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`sector-stocks-${width}.png`) });
    await page.keyboard.press("Escape");
  } else {
    await expect(dialog.locator("#close-sector-dialog")).toBeVisible();
    await dialog.locator("#close-sector-dialog").click();
  }
  await expect(dialog).not.toBeVisible();
});

test("both overview modes follow all favorites and retain the zero-favorite selection path", async ({ page }) => {
  const { stocks } = await demoProvider.load();
  await page.evaluate((favorites) => localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites, catalogVersion: 2 })), stocks.map((stock) => stock.symbol));
  await page.reload();
  await openPage(page, "favorites");
  await expect(page.locator(".watch-card")).toHaveCount(14);
  await page.getByRole("tab", { name: "法人總覽", exact: true }).click();
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(14);
  for (const stock of stocks) await expect(overviewFor(page, stock.symbol)).toBeVisible();
  await openPage(page, "market");
  await page.getByRole("searchbox").fill("2454");
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await openPage(page, "favorites");
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(13);
  await expect(overviewFor(page, "2454")).toHaveCount(0);
  await openPage(page, "market");
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await openPage(page, "favorites");
  await expect(overviewFor(page, "2454")).toBeVisible();
  await page.getByRole("tab", { name: "價量總覽", exact: true }).click();
  await expect(cardFor(page, "2454")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites: [], catalogVersion: 2 })));
  await page.reload();
  await openPage(page, "favorites");
  await expect(page.locator("#watchlist-empty")).toBeVisible();
  await expect(page.locator(".watch-card")).toHaveCount(0);
  await page.getByRole("tab", { name: "法人總覽", exact: true }).click();
  await expect(page.locator("#watchlist-empty")).toBeVisible();
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(0);
  await page.getByRole("button", { name: "前往選擇股票", exact: true }).click();
  await expect(page.locator(".table-scroll")).toBeFocused();
  await page.locator('#stock-rows [data-favorite="00878"]').click();
  await openPage(page, "favorites");
  await expect(overviewFor(page, "00878")).toBeVisible();
  await expect(page.locator("#watchlist-empty")).toBeHidden();
});

test("favorite changes stay on the market page and preserve the table position", async ({ page }) => {
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
    await settleLayout(page);
    await expect(page.locator('.sidebar [data-page="market"]')).toHaveAttribute("aria-current", "page");
    await expect(star).toBeFocused();
    if (width <= 700) {
      await expect(star).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(row).toHaveCSS("background-color", "rgb(255, 255, 255)");
    }
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

test("primary navigation keeps market, favorites and sectors as separate pages", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".stocks-panel")).toBeVisible();
  await page.locator('#stock-rows [data-favorite="2454"]').click();
  await expect(page.locator(".stocks-panel")).toBeVisible();
  await expect(page.locator("#watchlist")).toBeHidden();
  await openPage(page, "favorites");
  await expect(cardFor(page, "2454")).toBeVisible();
  await expect(page.locator("#page-title")).toContainText("自選總覽");
  await openPage(page, "sectors");
  await expect(page.locator("#sector-grid .sector-card")).toHaveCount(5);
  await expect(page.locator("#page-title")).toContainText("法人買株");
  await expect(page.locator("#sector-page h1, #sector-page h2")).toHaveCount(0);
  await page.locator(".brand").click();
  await expect(page.locator(".stocks-panel")).toBeVisible();
  await expect(page.locator("#page-title")).toContainText("市場觀察清單");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("page titles keep one anchor across market, favorites and sector pages", async ({ page }) => {
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 900 });
    const positions = [];
    for (const name of ["market", "favorites", "sectors"]) {
      await openPage(page, name);
      await settleLayout(page);
      const box = await page.locator("#page-title").boundingBox();
      positions.push({ name, x: box.x, y: box.y });
    }
    const comparisons = width === 320 ? positions.filter(({ name }) => name === "sectors") : positions.slice(1);
    for (const position of comparisons) {
      expect(Math.abs(position.x - positions[0].x), `${position.name} title x at ${width}px`).toBeLessThanOrEqual(1);
      expect(Math.abs(position.y - positions[0].y), `${position.name} title y at ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});

test("phone and tablet controls remain touch-sized with readable sticky navigation and pinned stock columns", async ({ page }, testInfo) => {
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await openPage(page, "market");
    if (width <= 520) {
      await expect(page.locator('.sidebar [data-page="market"] .nav-label-mobile')).toBeVisible();
      const navLabels = await page.locator(".sidebar nav [data-page] .nav-label-mobile").evaluateAll((labels) => labels.map((label) => {
        const rect = label.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }));
      for (let index = 1; index < navLabels.length; index++) {
        expect(navLabels[index].left).toBeGreaterThanOrEqual(navLabels[index - 1].right);
      }
    }
    const undersized = await page.locator('.sidebar .nav-item, [role="tab"], #trade-date, .search-box, #sector-filter, .filter-tabs button, #stock-rows [data-favorite]').evaluateAll((controls, viewportWidth) => controls.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const compact = viewportWidth <= 700 && element.matches('[role="tab"], .search-box, #sector-filter, .filter-tabs button');
      const compactFavorite = viewportWidth <= 700 && element.matches('#stock-rows [data-favorite]');
      const minWidth = compactFavorite ? 32 : compact ? 40 : 44;
      const minHeight = compact ? 34 : 44;
      return rect.width && rect.height && (rect.width < minWidth || rect.height < minHeight)
        ? [{ control: element.getAttribute("aria-label") || element.textContent.trim(), width: rect.width, height: rect.height }]
        : [];
    }), width);
    expect(undersized, `Small touch targets at ${width}px`).toEqual([]);
    // The implicit label's padding is part of the search field's touch target.
    await page.locator(".search-box").click({ position: { x: 2, y: 2 } });
    await expect(page.getByRole("searchbox")).toBeFocused();
    for (const item of await page.locator('.sidebar nav [data-page] > .nav-label').all())
      if (width <= 520) await expect(item).toBeHidden(); else await expect(item).toBeVisible();
    if (width <= 520) await expect(page.locator('.sidebar nav [data-page] > .nav-label-mobile').first()).toBeVisible();
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
    await openPage(page, "favorites");
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
    await openPage(page, "favorites");
    await page.locator('[data-overview="price"]').click();
    const sizes = await page.locator(".panel-subtitle, .metric-label, .metric-description").evaluateAll((elements) =>
      elements.filter((element) => element.getClientRects().length).map((element) => parseFloat(getComputedStyle(element).fontSize)));
    expect(Math.min(...sizes), `Reading copy at ${width}px`).toBeGreaterThanOrEqual(width <= 700 ? 12 : 14);
    expect(await page.locator(".search-box input").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(width <= 700 ? 12 : 16);
    if (width <= 700) {
      const tradeDate = await page.locator("#trade-date").evaluate((element) => ({
        fontSize: parseFloat(getComputedStyle(element).fontSize),
        width: element.getBoundingClientRect().width,
      }));
      expect(tradeDate.fontSize).toBe(12);
      if (width <= 520) expect(tradeDate.width).toBeLessThanOrEqual(150);
    }
    await expectLegible();
    await page.locator('[data-overview="institutions"]').click();
    if (width <= 700) {
      const overviewToolbar = await page.locator(".overview-controls.institutional-active").evaluate((toolbar) => ({
        padding: parseFloat(getComputedStyle(toolbar).paddingTop),
        groups: [...toolbar.querySelectorAll(".overview-tabs, .institution-window")].map((group) => group.getBoundingClientRect().height),
        buttons: [...toolbar.querySelectorAll("button")].map((button) => ({
          height: button.getBoundingClientRect().height,
          fontSize: parseFloat(getComputedStyle(button).fontSize),
        })),
      }));
      expect(overviewToolbar.padding).toBe(6);
      expect(overviewToolbar.groups.every((height) => height <= 40)).toBe(true);
      expect(overviewToolbar.buttons.every(({ height, fontSize }) => height >= 34 && height <= 36 && fontSize === 12)).toBe(true);
    }
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
    await openPage(page, "sectors");
    await expectLegible("#sector-page");
    const trailingBlank = await page.evaluate(() => document.documentElement.scrollHeight - Math.max(window.innerHeight,
      document.querySelector(".page-footer").getBoundingClientRect().bottom + window.scrollY));
    expect(trailingBlank).toBeLessThanOrEqual(2);
    const sectorControls = await page.locator("[data-sector-sort], [data-sector-window]").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height, top: Math.round(rect.top) };
    }));
    expect(sectorControls.every(({ width: controlWidth, height }) => controlWidth >= 40 && height >= 34)).toBe(true);
    expect(new Set(sectorControls.map(({ top }) => top)).size).toBe(width <= 360 ? 2 : 1);
    if (width <= 700) {
      expect(sectorControls.every(({ height }) => height <= 36)).toBe(true);
      const groupHeights = await page.locator(".sector-sort-tabs, .sector-period").evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height));
      expect(Math.max(...groupHeights)).toBeLessThanOrEqual(40);
      const rows = await page.locator("#sector-grid .sector-main").evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height));
      // The 12px breadth label adds one metadata line; long TOP1 names may wrap.
      expect(Math.max(...rows)).toBeLessThanOrEqual(115);
    }
    if (width <= 700) {
      const phoneSizes = await page.evaluate(() => ({
        page: parseFloat(getComputedStyle(document.querySelector("#page-title")).fontSize),
        sector: parseFloat(getComputedStyle(document.querySelector(".sector-identity h3")).fontSize),
      }));
      expect(phoneSizes).toEqual({ page: 17, sector: 14 });
      const toolbarLabelSizes = await page.locator(".sector-toolbar .sector-sort-control > span, .sector-toolbar .sector-period-control > span").evaluateAll((elements) =>
        elements.map((element) => parseFloat(getComputedStyle(element).fontSize)));
      const toolbarButtonSizes = await page.locator(".sector-toolbar button").evaluateAll((elements) =>
        elements.map((element) => parseFloat(getComputedStyle(element).fontSize)));
      expect(toolbarLabelSizes).toEqual([12, 12]);
      expect(toolbarButtonSizes).toEqual([12, 12, 12, 12, 12, 12]);
      const sectorRow = await page.locator("#sector-grid .sector-card").first().evaluate((card) => {
        const name = card.querySelector(".sector-identity h3");
        const note = card.querySelector(".sector-identity p");
        const lots = card.querySelector(".sector-total strong");
        const change = card.querySelector(".sector-change");
        const style = (element) => getComputedStyle(element);
        return {
          nameSize: parseFloat(style(name).fontSize),
          lotsSize: parseFloat(style(lots).fontSize),
          changeSize: parseFloat(style(change).fontSize),
          nameTop: name.getBoundingClientRect().top,
          lotsTop: lots.getBoundingClientRect().top,
          changeTop: change.getBoundingClientRect().top,
          noteSize: parseFloat(style(note).fontSize),
          noteColor: style(note).color,
          spans: [...note.querySelectorAll("span")].map((span) => ({
            size: parseFloat(style(span).fontSize), color: style(span).color,
          })),
        };
      });
      expect(sectorRow.nameSize).toBe(14);
      expect(sectorRow.lotsSize).toBe(14);
      expect(sectorRow.changeSize).toBe(12);
      expect(Math.abs(sectorRow.nameTop - sectorRow.lotsTop)).toBeLessThanOrEqual(3);
      expect(sectorRow.changeTop).toBeGreaterThan(sectorRow.lotsTop);
      expect(sectorRow.noteSize).toBe(12);
      expect(sectorRow.spans).toEqual([
        { size: 12, color: sectorRow.noteColor },
        { size: 12, color: sectorRow.noteColor },
      ]);
      const noteStyles = await page.locator(".sector-identity p").evaluateAll((notes) => notes.map((note) => {
        const style = getComputedStyle(note);
        return { overflow: style.overflow, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace };
      }));
      expect(noteStyles.every((style) => style.overflow === "visible" && style.textOverflow === "clip" && style.whiteSpace === "normal")).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `Page overflow at ${width}px`).toBeLessThanOrEqual(width);
  }
});

test("phone institutional rows align values and keep interval switching available while scrolling", async ({ page }) => {
  const { stocks } = await demoProvider.load();
  await page.evaluate((favorites) => localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites, catalogVersion: 2 })), stocks.map((stock) => stock.symbol));
  await page.reload();
  await openPage(page, "favorites");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 520, 700]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[data-overview="institutions"]').click();
    await expect(page.locator("#watchlist")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator("#watchlist")).toHaveCSS("padding", "8px 0px 12px");
    await page.locator('[data-institution-window="20"]').click();
    await expect(page.locator(".institution-overview-row")).toHaveCount(14);
    const carousel = page.locator("#institution-overview-rows");
    const controls = page.locator("#institution-carousel-controls");
    await expect(controls).toBeVisible();
    const dimensions = await carousel.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      visibleWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dimensions.height).toBeLessThan(500);
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.visibleWidth);
    const cardStyles = await page.evaluate(() => {
      const read = (selector) => {
        const element = document.querySelector(selector);
        const style = getComputedStyle(element);
        return {
          width: element.getBoundingClientRect().width,
          flexBasis: style.flexBasis,
          padding: style.padding,
          borderTopWidth: style.borderTopWidth,
          borderTopColor: style.borderTopColor,
          borderRadius: style.borderRadius,
          background: style.backgroundColor,
        };
      };
      return { price: read(".watch-card"), institutions: read(".institution-overview-row") };
    });
    expect(cardStyles.institutions.width).toBeGreaterThan(0);
    expect(cardStyles.institutions.width).toBeLessThanOrEqual(374);
    const { width: priceWidth, ...priceAppearance } = cardStyles.price;
    const { width: institutionWidth, ...institutionAppearance } = cardStyles.institutions;
    expect(institutionAppearance).toEqual(priceAppearance);
    await carousel.evaluate((element) => { element.scrollLeft = element.querySelectorAll(".institution-overview-row")[1].offsetLeft; });
    await settleLayout(page);
    expect(await carousel.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await carousel.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect(page.locator(".institution-overview-row").last()).toBeInViewport();
    await page.locator('[data-institution-window="5"]').click();
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
    await page.locator('[data-institution-window="day"]').click();
    await expect(page.locator('[data-institution-window="day"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-institution-window="day"]')).toBeFocused();
    await carousel.evaluate((element) => { element.scrollLeft = 0; });
  }
});

test("phone institution interval changes preserve the current card and scroll position", async ({ page }) => {
  const { stocks } = await demoProvider.load();
  await page.evaluate((favorites) => localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites, catalogVersion: 2 })), stocks.map((stock) => stock.symbol));
  await page.reload();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 600 });
    await openPage(page, "favorites");
    await page.locator('[data-overview="institutions"]').click();
    await expect(page.locator('#institution-carousel-controls')).toBeVisible();
    await page.locator('#institution-overview-rows').evaluate((element) => {
      element.scrollLeft = element.querySelectorAll('.institution-overview-row')[10].offsetLeft;
    });
    await settleLayout(page);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await settleLayout(page);
    const row = await page.locator('.institution-overview-row').nth(10).elementHandle();
    const position = () => page.evaluate(() => ({
      scrollY,
      carouselLeft: document.querySelector('#institution-overview-rows').scrollLeft,
      toolbarTop: document.querySelector('.overview-controls').getBoundingClientRect().top,
    }));
    for (const key of ["5", "20", "day", "5"]) {
      const before = await position();
      await page.locator(`[data-institution-window="${key}"]`).click();
      await settleLayout(page);
      const after = await position();
      expect(await row.evaluate((element) => element.isConnected)).toBe(true);
      expect(Math.abs(after.scrollY - before.scrollY)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.carouselLeft - before.carouselLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.toolbarTop - before.toolbarTop)).toBeLessThanOrEqual(1);
      await expect(page.locator(`[data-institution-window="${key}"]`)).toHaveAttribute('aria-pressed', 'true');
    }
  }
});

test("touch closes ranking details without leaving a focus ring", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:5173", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator('.sidebar [data-page="sectors"]').tap();
  const card = page.locator("#sector-grid .sector-card").first();
  await card.tap();
  await expect(page.locator("#sector-dialog")).toBeVisible();
  const handle = page.locator(".sector-dialog-handle");
  expect((await handle.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(handle).not.toBeFocused();
  expect(await handle.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
  await handle.tap();
  await expect(page.locator("#sector-dialog")).not.toBeVisible();
  await expect(card).not.toBeFocused();
  expect(await card.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
  await page.locator('.sidebar [data-page="favorites"]').tap();
  await page.locator('[data-overview="institutions"]').tap();
  const details = page.locator('#institution-overview [data-institution-details="2330"]');
  await details.tap();
  await expect(page.locator('#institution-dialog')).toBeVisible();
  expect((await page.locator('#institution-dialog').boundingBox()).y).toBeGreaterThanOrEqual(15);
  await expect(page.locator('#institution-dialog :focus-visible')).toHaveCount(0);
  const institutionHandle = page.locator('.institution-dialog-handle');
  await expect(page.locator('#close-institution-dialog')).toBeHidden();
  expect((await institutionHandle.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await institutionHandle.tap();
  await expect(page.locator('#institution-dialog')).not.toBeVisible();
  await expect(details).not.toBeFocused();
  expect(await details.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
  await page.locator('.sidebar [data-page="market"]').tap();
  const favorite = page.locator('#stock-rows [data-favorite="2330"]');
  await favorite.tap();
  await expect(favorite).not.toBeFocused();
  expect(await favorite.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
  await page.getByRole("button", { name: "資料說明", exact: true }).tap();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator("#info-dialog :focus-visible")).toHaveCount(0);
  await page.locator("#close-dialog").tap();
  await context.close();
});
