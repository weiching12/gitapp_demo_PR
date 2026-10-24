import { test, expect } from "@playwright/test";

test("missing institution windows do not contribute to totals, coverage or ranking while real zero stays valid", async ({ page }) => {
  await page.route("**/src/provider.js*", (route) => route.fulfill({ contentType: "application/javascript",
    body: `import { demoProvider } from "/src/data.js";
      export async function loadMarketSummary() { throw new Error("API loading is unavailable in this demo fixture"); }
      export async function loadDataset() {
        const data = await demoProvider.load();
        data.dates = data.dates.slice(-20);
        data.stocks = data.stocks.slice(0, 6).map((stock, index) => ({ ...stock,
          symbol: String(9001 + index), name: ["完整資料", "真實零值", "當日缺漏", "法人歷史缺漏", "價格歷史缺漏", "未列報"][index],
          sector: index === 1 ? "C零值產業" : index === 2 ? "A缺漏產業" : "B有效產業", tradingDates: data.dates,
          history: data.dates.map((date, day) => {
            const net = [1000000, 0, 0, 9000000, 5000000, 0][index];
            return { date, open: 100, high: 100, low: 100, close: index === 4 && day === 18 ? 0 : 100, volume: 100000000,
              institutions: index === 2 || index === 5 || index === 3 && day === 18 ? []
                : ["外資", "投信", "自營商"].map((name, category) => ({ name, buy: category === 0 ? net : 0, sell: 0 })) };
          }) }));
        return data;
      }` }));
  await page.goto("/");
  // Missing institution data must not remove a stock's usable price information.
  await expect(page.locator('#stock-rows [data-symbol="9003"]')).toHaveCount(1);
  await page.locator('.sidebar [data-page="sectors"]').click();
  const valid = page.locator('[data-sector-name="B有效產業"]');
  const missing = page.locator('[data-sector-name="A缺漏產業"]');
  const zero = page.locator('[data-sector-name="C零值產業"]');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [period, count, lots, money] of [["day", 3, "+15,000 張", "+15.00 億"], ["5", 1, "+5,000 張", "+5.00 億"], ["20", 1, "+20,000 張", "+20.00 億"]]) {
      await page.locator(`[data-sector-window="${period}"]`).click();
      await expect(valid.locator('[data-sector-lots]')).toHaveText(lots);
      await expect(valid.locator('[data-sector-amount]')).toHaveText(money);
      await expect(valid.locator('[data-sector-coverage]')).toHaveCount(0);
      await expect(valid.locator('[data-sector-breadth]')).toHaveText(`買超 ${count}／${count} 檔`);
      if (period !== "day") await expect(valid.locator('.sector-identity p')).toContainText("TOP1·完整資料");
      await expect(zero.locator('[data-sector-lots]')).toHaveText("0 張");
      await expect(zero.locator('[data-sector-amount]')).toHaveText("0.00 億");
      await expect(zero.locator('[data-sector-breadth]')).toHaveText("買超 0／1 檔");
      for (const sort of ["name-asc", "net-desc", "net-asc"]) {
        await page.locator(`[data-sector-sort="${sort}"]`).click();
        await expect(missing.locator('.sector-rank')).toHaveText("");
        await expect(missing.locator('.sector-identity p')).not.toContainText("TOP1");
        await expect(missing.locator('[data-sector-amount]')).toHaveText("");
        await expect(missing.locator('[data-sector-lots]')).toHaveText("");
        await expect(missing.locator('[data-sector-breadth]')).toHaveText("");
        await expect(missing.locator('.sector-total i')).toHaveCount(0);
        await expect(valid.locator('.sector-rank')).toHaveText(sort === "net-asc" ? "2" : "1");
        await expect(zero.locator('.sector-rank')).toHaveText(sort === "net-asc" ? "1" : "2");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await valid.click();
    await expect(page.locator('#sector-dialog [data-sector-stock]')).toHaveCount(4);
    for (const [period, , lots, money] of [["day", 3, "+15,000 張", "+15.00 億"], ["5", 1, "+5,000 張", "+5.00 億"], ["20", 1, "+20,000 張", "+20.00 億"]]) {
      const summary = page.locator(`[data-sector-period="${period}"]`);
      await expect(summary.locator('[data-sector-summary="total"]')).toHaveText(lots);
      await expect(summary.locator('[data-sector-money="total"]')).toHaveText(money);
      await expect(summary.locator('[data-sector-coverage]')).toHaveCount(0);
      await expect(summary.locator('[data-sector-money="外資"]')).toHaveText(money);
      await expect(summary.locator('[data-sector-summary="外資"]')).toHaveText(lots);
      for (const name of ["投信", "自營商"])
        await expect(summary.locator(`[data-sector-summary="${name}"]`)).toHaveText("0 張");
    }
    await expect(page.locator('[data-sector-stock="9006"] [data-sector-net="day"] .institution-money')).toHaveText("");
    await expect(page.locator('[data-sector-stock="9006"] [data-sector-net="day"] .institution-lots')).toHaveText("");
    await expect(page.locator('[data-sector-stock="9006"] [data-institution-ratio]')).toHaveText("");
    await expect(page.locator('[data-sector-stock="9006"] .institution-sparkline')).toHaveCount(0);
    await page.locator('#sector-dialog').press("Escape");
  }
  await page.locator('.sidebar [data-page="market"]').click();
  const row = page.locator('#stock-rows [data-symbol="9003"]');
  await expect(row.locator('.net-cell-mobile .institution-net')).toHaveText("");
  await expect(row.locator('.net-cell-desktop .institution-net')).toHaveText("");
  await expect(row.locator('.net-cell-mobile .institution-leader')).toHaveText("");
  await expect(row.locator('.net-cell-desktop .institution-leader')).toHaveText("");
  await row.locator('[data-favorite]').click();
  await page.locator('.sidebar [data-page="favorites"]').click();
  await page.locator('[data-overview="institutions"]').click();
  for (const period of ["day", "5", "20"]) {
    await page.locator(`[data-institution-window="${period}"]`).click();
    for (const name of ["total", "外資", "投信", "自營商"]) {
      await expect(page.locator(`[data-overview-symbol="9003"] [data-overview-amount="${name}"]`)).toHaveText("");
      await expect(page.locator(`[data-overview-symbol="9003"] [data-overview-net="${name}"]`)).toHaveText("");
    }
  }
  await page.locator('[data-institution-details="9003"]').click();
  await expect(page.locator('#institution-dialog .watch-flow-total .institution-money')).toHaveText("");
  await expect(page.locator('#institution-dialog .watch-flow-amounts')).toHaveText("");
  await expect(page.locator('#institution-dialog')).not.toContainText("資料不足");
});
