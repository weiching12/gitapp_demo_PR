import { test, expect } from "@playwright/test";

async function loadMarket(page, count = 150, initialCount = 30) {
  await page.route("**/src/provider.js", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `import { demoProvider } from "/src/data.js";
      export async function loadDataset() {
        const data = await demoProvider.load();
        data.stocks = Array.from({ length: ${count} }, (_, index) => {
          const stock = structuredClone(data.stocks[index % data.stocks.length]);
          return { ...stock, symbol: String(1000 + index), name: "測試股票" + index };
        });
        return data;
      }`,
  }));
  await page.goto("/");
  if (initialCount) await expect(page.locator("#stock-rows tr")).toHaveCount(initialCount);
}

test("market batches remain reachable and reset correctly after a large filtered list", async ({ page }) => {
  await loadMarket(page);
  for (const count of [60, 90, 120, 150]) {
    await page.locator("#table-load-trigger").scrollIntoViewIfNeeded();
    await expect(page.locator("#stock-rows tr")).toHaveCount(count);
  }
  await expect(page.locator("#table-load-trigger")).toBeHidden();
  await page.locator("#stock-search").fill("測試股票1");
  await expect(page.locator("#stock-rows tr")).toHaveCount(30);
  await page.locator("#table-load-trigger").scrollIntoViewIfNeeded();
  await expect(page.locator("#stock-rows tr")).toHaveCount(60);
  await page.locator("#table-load-trigger").scrollIntoViewIfNeeded();
  await expect(page.locator("#stock-rows tr")).toHaveCount(61);
  await expect(page.locator("#table-load-trigger")).toBeHidden();
});

test("batch loading fills a tall viewport until the trigger moves below it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 5000 });
  await loadMarket(page, 150, null);
  await expect.poll(() => page.locator("#stock-rows tr").count()).toBeGreaterThanOrEqual(90);
});

test("phone filter labels fit inside every button", async ({ page }) => {
  await page.goto("/");
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const clipped = await page.locator(".filter-tabs button").evaluateAll((buttons) => buttons.flatMap((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      const text = range.getBoundingClientRect(), rect = button.getBoundingClientRect();
      return text.left < rect.left || text.right > rect.right ? [button.textContent] : [];
    }));
    expect(clipped, `Filter text at ${width}px`).toEqual([]);
  }
});

test("filter keyboard order follows the visible order at phone and desktop widths", async ({ page }) => {
  await page.goto("/");
  for (const width of [390, 1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const first = page.locator(width <= 700 ? "#sector-filter" : "#stock-search");
    const second = page.locator(width <= 700 ? "#stock-search" : "#sector-filter");
    await first.focus();
    await page.keyboard.press("Tab");
    await expect(second).toBeFocused();
    const firstRect = await first.boundingBox(), secondRect = await second.boundingBox();
    expect(firstRect.x).toBeLessThan(secondRect.x);
  }
});

test("mobile prices and changes fit inside their cell for high-priced stocks", async ({ page }) => {
  await page.route("**/src/provider.js", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `import { demoProvider } from "/src/data.js";
      export async function loadDataset() {
        const data = await demoProvider.load();
        for (const stock of data.stocks) for (const bar of stock.history) {
          for (const key of ["open", "high", "low", "close"]) bar[key] *= 12;
        }
        return data;
      }`,
  }));
  await page.goto("/");
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    const errors = await page.locator("#stock-rows .price-cell").evaluateAll((cells) => cells.flatMap((cell) => {
      const rect = cell.getBoundingClientRect();
      return [...cell.querySelectorAll(".stock-close, .mobile-change")].flatMap((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left < rect.left || bounds.right > rect.right
          ? [cell.closest("tr").dataset.symbol + ": price spills outside cell"] : [];
      });
    }));
    expect(errors, `Price cell at ${width}px`).toEqual([]);
  }
});

test("phone sector amounts and percentages align and fit for every period", async ({ page }) => {
  await page.route("**/src/provider.js", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `import { demoProvider } from "/src/data.js";
      export async function loadDataset() {
        const data = await demoProvider.load();
        data.stocks.forEach((stock, index) => {
          stock.sector = ["電腦及週邊設備業", "電子零組件業", "半導體業"][index % 3];
          for (const bar of stock.history) for (const institution of bar.institutions) {
            institution.buy *= 100; institution.sell *= 100;
          }
        });
        return data;
      }`,
  }));
  await page.goto("/");
  await page.locator('[data-page="sectors"]').click();
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    for (const period of ["day", "5", "20"]) {
      await page.locator(`[data-sector-window="${period}"]`).click();
      const issues = await page.locator("#sector-grid .sector-card").evaluateAll((cards) => cards.flatMap((card) => {
        const name = card.querySelector(".sector-identity h3").getBoundingClientRect();
        const amount = card.querySelector(".sector-total strong");
        const change = card.querySelector(".sector-change");
        const textBounds = (element) => {
          const range = document.createRange(); range.selectNodeContents(element);
          return range.getBoundingClientRect();
        };
        const lots = textBounds(amount), percentage = textBounds(change), bounds = card.getBoundingClientRect();
        return [
          Math.abs(lots.right - percentage.right) > 1 && "amount and percentage do not share the right edge",
          lots.left < name.right && "amount overlaps the sector name",
          lots.right > bounds.right && "amount extends outside the card",
        ].filter(Boolean).map((issue) => `${card.dataset.sectorName}: ${issue}`);
      }));
      expect(issues, `Sector numbers at ${width}px / ${period}`).toEqual([]);
    }
  }
});
