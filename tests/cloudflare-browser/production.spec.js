import { test, expect } from "@playwright/test";
import { getSnapshot } from "../../src/indicators.js";

test("real API mode shows 14 stocks including both requested favorites and correct statistics", async ({ page, request }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#stock-rows tr")).toHaveCount(14);
  await expect(page.locator(".watch-card")).toHaveCount(5);
  await expect(page.locator(".demo-badge")).toHaveText("FinMind 日資料");
  await expect(page.locator("body")).not.toContainText("模擬資料");
  const date = await page.locator("#trade-date").inputValue();
  for (const symbol of ["3026", "6488"]) {
    const response = await request.get(`/api/stocks/${symbol}`);
    expect(response.status()).toBe(200);
    const payload = await response.json();
    const snapshot = getSnapshot(payload.stock, date);
    const card = page.locator(`[data-watch-symbol="${symbol}"]`);
    await expect(card).toContainText(symbol === "3026" ? "禾伸堂" : "環球晶");
    await expect(card.locator(".watch-symbol")).toContainText(symbol === "3026" ? "上市" : "上櫃");
    await expect(card.locator(".metric-number").nth(0)).toHaveText(snapshot.latest.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const sum = payload.stock.history.filter((bar) => bar.date <= date).slice(-20)
      .reduce((net, bar) => net + bar.institutions.reduce((n, item) => n + item.buy - item.sell, 0), 0);
    const text = await card.locator('.watch-total-history [data-window="20"] b').innerText();
    expect(Number(text.replaceAll(",", "").replace("張", "").trim())).toBeCloseTo(sum / 1000, 2);
  }
  await page.getByRole("button", { name: "資料說明", exact: true }).click();
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
  }
  await page.screenshot({ path: testInfo.outputPath("real-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-watch-symbol="6488"]').screenshot({ path: testInfo.outputPath("globalwafers-mobile.png") });
});
