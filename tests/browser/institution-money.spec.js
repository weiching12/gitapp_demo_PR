import { test, expect } from "@playwright/test";

async function expectMoneyFirst(container) {
  const values = await container.evaluate((element) => {
    const primary = element.querySelector(".institution-money"), shares = element.querySelector(".institution-lots");
    return { amount: primary.textContent, shares: shares.textContent,
      mainSize: parseFloat(getComputedStyle(primary).fontSize), secondarySize: parseFloat(getComputedStyle(shares).fontSize),
      mainTop: primary.getBoundingClientRect().top, secondaryTop: shares.getBoundingClientRect().top };
  });
  expect(values.amount).toContain("億");
  expect(values.amount).not.toContain("估算");
  expect(values.shares).toContain("張");
  expect(values.mainSize).toBeGreaterThan(values.secondarySize);
  expect(values.secondarySize).toBe(12);
  expect(values.secondaryTop).toBeGreaterThan(values.mainTop);
}

test("sectors and their detailed stock rows show money first and lots second at every width", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.locator('.sidebar [data-page="sectors"]').click();
  for (const width of [320, 390, 700, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const card = page.locator(".sector-card").first();
    await expectMoneyFirst(card.locator(".sector-total"));
    await expect(card.locator(".sector-total")).not.toContainText("估算");
    if (width === 390) await page.screenshot({ path: testInfo.outputPath("sector-money-390.png") });
    await card.click();
    await expectMoneyFirst(page.locator('.sector-summary-values').first());
    await expectMoneyFirst(page.locator('.sector-stock-net').first());
    if (width === 390) await page.screenshot({ path: testInfo.outputPath("sector-detail-money-390.png") });
    await expect(page.locator("#sector-dialog")).not.toContainText("估算");
    expect(await page.locator("#sector-dialog").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.locator("#sector-dialog").press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("favorite institution cards and their details keep money primary when intervals change", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('.sidebar [data-page="favorites"]').click();
  await page.locator('[data-overview="institutions"]').click();
  for (const width of [320, 390, 700, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const period of ["day", "5", "20"]) {
      await page.locator(`[data-institution-window="${period}"]`).click();
      for (const name of ["total", "外資", "投信", "自營商"]) {
        const value = page.locator('.institution-overview-row').first().locator(`[data-overview-amount="${name}"]`).locator("..");
        await expectMoneyFirst(value);
      }
    }
    if (width === 390) await page.screenshot({ path: testInfo.outputPath("favorites-money-390.png") });
    await page.locator('.institution-overview-row').first().locator('[data-institution-details]').click();
    await expectMoneyFirst(page.locator('.watch-flow-total > div').first());
    await expectMoneyFirst(page.locator('.watch-total-history .watch-cumulative').first());
    await expectMoneyFirst(page.locator('.watch-institution-value').first());
    await expect(page.locator("#institution-dialog")).not.toContainText("估算");
    expect(await page.locator("#institution-dialog").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.locator("#institution-dialog").press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("sector ranking and TOP1 follow money when net share volume has the opposite sign", async ({ page }) => {
  await page.route("**/src/provider.js*", (route) => route.fulfill({ contentType: "application/javascript",
    body: `import { demoProvider } from "/src/data.js";
      export async function loadMarketSummary() { throw new Error("API loading is unavailable in this demo fixture"); }
      export async function loadDataset() {
        const data = await demoProvider.load();
        data.stocks = data.stocks.slice(0, 3).map((stock, index) => ({ ...stock,
          sector: index < 2 ? "半導體業" : "航運業", symbol: String(9001 + index),
          name: ["低價買超", "高價賣超", "小額賣超"][index],
          history: stock.history.map((bar) => {
            const close = [10, 2000, 10][index], net = [10000000, -100000, -100000][index];
            return { ...bar, open: close, high: close, low: close, close,
              institutions: ["外資", "投信", "自營商"].map((name, category) => ({name,
                buy: category === 0 ? Math.max(0, net) : 0, sell: category === 0 ? Math.max(0, -net) : 0 })) };
          }) }));
        return data;
      }` })) ;
  await page.goto("/");
  await page.locator('.sidebar [data-page="sectors"]').click();
  await page.locator('[data-sector-sort="net-desc"]').click();
  await expect(page.locator('.sector-card').first()).toHaveAttribute("data-sector-name", "航運業");
  const sector = page.locator('[data-sector-name="半導體業"]');
  await expect(sector.locator('[data-sector-amount]')).toHaveText("-1.00 億");
  await expect(sector.locator('[data-sector-lots]')).toHaveText("+9,900 張");
  await expect(sector.locator('.sector-identity p')).toContainText("TOP1·高價賣超");
  await page.locator('[data-sector-sort="net-asc"]').click();
  await expect(page.locator('.sector-card').first()).toHaveAttribute("data-sector-name", "半導體業");
});
