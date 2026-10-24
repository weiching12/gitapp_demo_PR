import { test, expect } from "@playwright/test";

test("entry score stays usable in the market list, detail dialog and phone scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-sort-heading="entryScore"]')).toContainText("株研評分");
  await expect(page.locator('[data-sort-heading="entryScore"]')).toHaveAttribute("aria-sort", "descending");
  const rows = page.locator("#stock-rows tr");
  await expect(rows.first().locator(".entry-score-button")).toBeVisible();
  const initialScores = await rows.locator(".entry-score-button strong").allTextContents();
  const initialNumeric = initialScores.map((value) => Number(value)).filter(Number.isFinite);
  expect(initialNumeric).toEqual([...initialNumeric].sort((a, b) => b - a));
  await expect(rows.first().locator(".entry-score-button")).toHaveText(/^\d+\.\d{2}$/);
  const firstListScore = await rows.first().locator(".entry-score-button strong").textContent();
  const firstSymbol = await rows.first().getAttribute("data-symbol");
  await rows.first().locator(".entry-score-button").click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator(".entry-dialog-sector")).not.toBeEmpty();
  await expect(page.locator("#dialog-heading")).toHaveText(new RegExp(`^${firstSymbol} .+｜株研評分$`));
  await expect(page.locator("#dialog-content")).toContainText("波段順勢進場");
  await expect(page.locator("#dialog-content")).toContainText("進場位置與風險");
  await expect(page.locator(".entry-summary-reason")).toHaveCount(0);
  await expect(page.locator(".entry-summary-head strong")).toContainText(firstListScore);
  await expect(page.locator(".entry-summary-head strong")).toHaveAttribute("data-score-target", String(Number(firstListScore)));
  await expect(page.locator(".entry-summary-facts dd").last()).toContainText(firstListScore);
  const chart = page.locator(".entry-price-chart");
  await expect(chart).toContainText("近 30 個交易日收盤價走勢");
  await expect(chart.locator(".entry-chart-points circle")).toHaveCount(30);
  await expect(chart.locator(".entry-chart-range")).toHaveCount(0);
  const plot = chart.locator(".entry-chart-plot");
  const closes = JSON.parse(await plot.getAttribute("data-points")).map((point) => point.close)
    .filter((close) => Number.isFinite(close) && close > 0);
  const trend = closes.at(-1) > closes[0] ? "up" : closes.at(-1) < closes[0] ? "down" : "flat";
  await expect(chart).toHaveAttribute("data-trend", trend);
  const { stroke, tone } = await chart.evaluate((element) => {
    const kind = element.dataset.trend;
    const raw = getComputedStyle(document.documentElement).getPropertyValue(
      kind === "up" ? "--up" : kind === "down" ? "--down" : "--accent");
    const probe = document.createElement("span");
    probe.style.color = raw;
    element.append(probe);
    const tone = getComputedStyle(probe).color;
    probe.remove();
    return { stroke: getComputedStyle(element.querySelector("svg path")).stroke, tone };
  });
  expect(stroke).toBe(tone);
  const box = await plot.boundingBox();
  await page.mouse.click(box.x + 10, box.y + box.height / 2);
  await expect(chart.locator(".entry-chart-note")).toContainText("收盤");
  await expect(plot).toHaveAttribute("aria-valuenow", "1");
  await page.keyboard.press("ArrowRight");
  await expect(plot).toHaveAttribute("aria-valuenow", "2");
  await expect(page.locator(".entry-core-panel .entry-condition")).toHaveCount(5);
  await expect(page.locator(".entry-condition-icon svg")).toHaveCount(5);
  await expect(page.locator(".entry-condition-data").first()).toBeHidden();
  await page.locator(".entry-condition summary").first().click();
  await expect(page.locator(".entry-condition-data").first()).toBeVisible();
  await expect(page.locator(".entry-dialog-meta")).not.toContainText("未還原價格");
  await expect(page.locator(".entry-category")).toHaveCount(5);
  await expect(page.locator(".entry-category").first().locator("div span")).toContainText("權重 25% · 基礎貢獻");
  await expect(page.locator(".entry-category").first().locator("small")).toHaveText(/^\d+\.\d{2} 分$/);
  const excluded = page.locator(".entry-category.excluded");
  if (await excluded.count()) {
    await expect(excluded.first().locator("div span")).toContainText("基礎貢獻 0.00");
    await expect(page.locator(".entry-summary-head span")).toHaveText("核心條件不通過");
  }
  await page.locator(".entry-more > details").first().locator("summary").click();
  await expect(page.locator(".entry-more .entry-guide-item").first()).toBeVisible();
  await page.locator(".entry-metrics summary").click();
  await expect(page.locator(".entry-metrics .entry-guide-item")).toHaveCount(4);
  await page.locator("#close-dialog").click();
  await page.locator('[data-sort="entryScore"]').click();
  const scores = await rows.locator(".entry-score-button strong").allTextContents();
  const numeric = scores.map((value) => Number(value)).filter(Number.isFinite);
  expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows.first().locator(".entry-score-button")).toBeVisible();
  const bounds = await page.locator(".table-scroll").evaluate((element) =>
    ({ client: element.clientWidth, content: element.scrollWidth }));
  expect(bounds.content).toBeGreaterThan(bounds.client);
  await rows.first().locator(".entry-score-button").click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator(".entry-price-chart svg circle")).toHaveCount(30);
  const chartBounds = await page.locator(".entry-price-chart").evaluate((element) =>
    ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(chartBounds.scroll).toBeLessThanOrEqual(chartBounds.width);
});
