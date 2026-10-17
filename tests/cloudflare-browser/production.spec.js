import { test, expect } from "@playwright/test";
import { getSnapshot } from "../../src/indicators.js";

test("real API mode shows 14 stocks including both requested favorites and correct statistics", async ({ page, request }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#stock-rows tr")).toHaveCount(14);
  await expect(page.locator(".watch-card")).toHaveCount(5);
  await expect(page.locator(".watch-card .watch-flow")).toHaveCount(0);
  await expect(page.locator("#institution-dialog")).not.toBeVisible();
  await expect(page.locator("#watchlist-grid [data-institution-details]")).toHaveCount(0);
  await expect(page.locator(".demo-badge")).toHaveText("每日收盤資料");
  await expect(page.locator("main")).not.toContainText("FinMind");
  await expect(page.locator(".watch-card-footer")).toHaveCount(0);
  await expect(page.locator(".page-footer > span:nth-child(2)")).toHaveText("技術提示僅供研究參考。");
  await expect(page.locator("body")).not.toContainText("模擬資料");
  await expect(page.locator("main .demo-notice, .topbar [data-dialog=source]")).toHaveCount(0);
  await expect(page.locator('.sidebar .nav-item[data-dialog="source"]')).toHaveAccessibleName("資料說明");
  await expect(page.locator('[data-sort-heading="changePercent"]')).toHaveText(/日漲跌幅/);
  await expect(page.locator('[data-sort-heading="changePercent"]')).not.toContainText("較前交易日");
  await expect(page.locator('[data-sort-heading="volume"]')).toHaveCount(0);
  const date = await page.locator("#trade-date").inputValue();
  for (const symbol of ["3026", "6488"]) {
    await page.locator('[data-overview="price"]').click();
    const response = await request.get(`/api/stocks/${symbol}`);
    expect(response.status()).toBe(200);
    const payload = await response.json();
    const snapshot = getSnapshot(payload.stock, date);
    const card = page.locator(`[data-watch-symbol="${symbol}"]`);
    await expect(card).toContainText(symbol === "3026" ? "禾伸堂" : "環球晶");
    await expect(card.locator(".watch-symbol")).toContainText(symbol === "3026" ? "上市" : "上櫃");
    await expect(card.locator(".metric-number").nth(0)).toHaveText(snapshot.latest.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const marketRow = page.locator(`#stock-rows tr[data-symbol="${symbol}"]`);
    await expect(marketRow.locator(".stock-close")).toHaveText(snapshot.latest.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    await expect(marketRow.locator(".price-cell .stock-volume")).toHaveText(`量 ${(snapshot.latest.volume / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 })} 張`);
    const institutionNets = snapshot.latest.institutions.map((item) => ({ name: item.name, net: item.buy - item.sell }));
    const totalNet = institutionNets.reduce((sum, item) => sum + item.net, 0);
    const extreme = totalNet > 0 ? Math.max(...institutionNets.map((item) => item.net))
      : Math.min(...institutionNets.map((item) => item.net));
    const leader = totalNet === 0 ? "合計持平"
      : `${institutionNets.filter((item) => item.net === extreme).map((item) => item.name).join("、")}${totalNet > 0 ? "買超" : "賣超"}最多`;
    await expect(marketRow.locator(".institution-leader")).toHaveText(leader);
    const sum = payload.stock.history.filter((bar) => bar.date <= date).slice(-20)
      .reduce((net, bar) => net + bar.institutions.reduce((n, item) => n + item.buy - item.sell, 0), 0);
    await page.locator('[data-overview="institutions"]').click();
    const details = page.locator(`#institution-overview [data-institution-details="${symbol}"]`);
    await details.click();
    const dialog = page.locator("#institution-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText("FinMind");
    await expect(dialog.locator("[data-institution-symbol]")).toHaveAttribute("data-institution-symbol", symbol);
    const text = await dialog.locator('.watch-total-history [data-window="20"] b').innerText();
    expect(Math.abs(Number(text.replaceAll(",", "").replace("張", "").trim()) - sum / 1000)).toBeLessThanOrEqual(0.005001);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(details).toBeFocused();
  }
  await page.getByRole("button", { name: "資料說明", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("FinMind");
  await expect(page.getByRole("dialog")).toContainText("未還原價格");
  await expect(page.getByRole("dialog")).toContainText("21:00–21:52");
  await page.keyboard.press("Escape");
  await page.locator("#trade-date").selectOption({ index: 5 });
  await expect(page.locator(".watch-card")).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("real data stays within desktop and phone widths", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".watch-card")).toHaveCount(5);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('[data-overview="price"]').click();
    const report = await page.locator("#watchlist-grid").evaluate((grid) => {
      const clipped = [];
      for (const card of grid.querySelectorAll(".watch-card, .metric-card")) {
        const bounds = card.getBoundingClientRect();
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(walker.currentNode);
          for (const rect of range.getClientRects()) if (rect.left < bounds.left || rect.right > bounds.right)
            clipped.push(walker.currentNode.textContent.trim());
        }
      }
      return { clipped, width: document.documentElement.scrollWidth };
    });
    expect(report.clipped, `Clipping at ${width}px`).toEqual([]);
    expect(report.width).toBeLessThanOrEqual(width);
    await page.locator('[data-overview="institutions"]').click();
    await page.locator('#institution-overview [data-institution-details="6488"]').click();
    const dialog = page.locator("#institution-dialog");
    await expect(dialog).toBeVisible();
    const dialogReport = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const clipped = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) if (rect.left < bounds.left || rect.right > bounds.right)
          clipped.push(walker.currentNode.textContent.trim());
      }
      return { clipped, left: bounds.left, right: bounds.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    expect(dialogReport.clipped, `Dialog clipping at ${width}px`).toEqual([]);
    expect(dialogReport.left).toBeGreaterThanOrEqual(0);
    expect(dialogReport.right).toBeLessThanOrEqual(width);
    expect(dialogReport.scrollWidth).toBeLessThanOrEqual(dialogReport.clientWidth);
    await page.screenshot({ path: testInfo.outputPath(`real-institutional-${width}.png`), fullPage: true });
    await page.locator("#close-institution-dialog").click();
    await expect(dialog).not.toBeVisible();
  }
  await page.locator('[data-overview="price"]').click();
  await page.screenshot({ path: testInfo.outputPath("real-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-watch-symbol="6488"]').screenshot({ path: testInfo.outputPath("globalwafers-mobile.png") });
});

test("real-data institutional overview compares every favorite at each cumulative window and historical date", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator(".watch-card")).toHaveCount(5);
  const stocks = await Promise.all(["2330", "2317", "0050", "3026", "6488"].map(async (symbol) => {
    const response = await request.get(`/api/stocks/${symbol}`);
    expect(response.status()).toBe(200);
    return (await response.json()).stock;
  }));
  await page.getByRole("tab", { name: "法人總覽", exact: true }).click();
  await expect(page.locator("#watchlist-grid")).toBeHidden();
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(5);
  for (const index of [0, 5]) {
    await page.locator("#trade-date").selectOption({ index });
    const date = await page.locator("#trade-date").inputValue();
    await expect(page.locator("#institution-overview-date")).toContainText(date);
    for (const [key, count] of [["day", 1], ["5", 5], ["20", 20]]) {
      const selected = page.locator(`[data-institution-window="${key}"]`);
      await selected.click();
      await expect(selected).toHaveAttribute("aria-pressed", "true");
      for (const stock of stocks) {
        const row = page.locator(`[data-overview-symbol="${stock.symbol}"]`);
        const history = stock.history.filter((bar) => bar.date <= date).slice(-count);
        let total = 0;
        let complete = history.length === count;
        for (const name of ["外資", "投信", "自營商"]) {
          const values = history.map((bar) => {
            const item = bar.institutions.find((institution) => institution.name === name);
            return item ? item.buy - item.sell : null;
          });
          const cell = row.locator(`[data-overview-net="${name}"]`);
          if (history.length < count || values.some((value) => value === null)) {
            complete = false;
            await expect(cell).toHaveText("資料不足");
          } else {
            const sum = values.reduce((net, value) => net + value, 0);
            total += sum;
            expect(Math.abs(Number((await cell.innerText()).replaceAll(",", "").replace("張", "").trim()) - sum / 1000)).toBeLessThanOrEqual(0.005001);
          }
        }
        const totalCell = row.locator('[data-overview-net="total"]');
        if (complete) expect(Math.abs(Number((await totalCell.innerText()).replaceAll(",", "").replace("張", "").trim()) - total / 1000)).toBeLessThanOrEqual(0.005001);
        else await expect(totalCell).toHaveText("資料不足");
      }
    }
  }
  const trigger = page.locator('[data-overview-symbol="6488"] [data-institution-details="6488"]');
  await trigger.click();
  await expect(page.locator("#institution-dialog")).toHaveAccessibleName(/環球晶.*三大法人動向/);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByRole("searchbox").fill("3026");
  await expect(page.locator("#stock-rows tr")).toHaveCount(1);
  await expect(page.locator("#institution-overview-rows article")).toHaveCount(5);
});

test("real institutional comparison stays readable on phones and tablets", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "法人總覽", exact: true }).click();
  await page.locator('[data-institution-window="20"]').click();
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const report = await page.locator("#institution-overview").evaluate((element) => {
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
      const smallTargets = [...element.querySelectorAll("button")].flatMap((button) => {
        if (!button.getClientRects().length) return [];
        const bounds = button.getBoundingClientRect();
        return bounds.width < 44 || bounds.height < 44 ? [button.textContent.trim()] : [];
      });
      return { clipped, smallTargets, width: document.documentElement.scrollWidth };
    });
    expect(report.clipped, `Real comparison clipping at ${width}px`).toEqual([]);
    expect(report.smallTargets, `Real comparison small controls at ${width}px`).toEqual([]);
    expect(report.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`real-overview-${width}.png`), fullPage: true });
  }
});
