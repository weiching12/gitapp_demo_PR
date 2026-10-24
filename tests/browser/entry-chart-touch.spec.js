import { test, expect } from "@playwright/test";

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test("phone chart shows the touched trading day without a separate slider", async ({ page }) => {
  await page.goto("/");
  await page.locator("#stock-rows .entry-score-button").first().click();
  const chart = page.locator(".entry-price-chart");
  const plot = chart.locator(".entry-chart-plot");
  await expect(plot).toHaveAttribute("aria-valuemax", "30");
  await expect(chart.locator(".entry-chart-range")).toHaveCount(0);
  const first = await chart.locator(".entry-chart-points circle").first().boundingBox();
  await page.touchscreen.tap(first.x + first.width / 2, first.y + first.height / 2);
  await expect(plot).toHaveAttribute("aria-valuenow", "1");
  await expect(chart.locator(".entry-chart-note")).toContainText("收盤");
  const last = await chart.locator(".entry-chart-points circle").last().boundingBox();
  await page.touchscreen.tap(last.x + last.width / 2, last.y + last.height / 2);
  await expect(plot).toHaveAttribute("aria-valuenow", "30");
  expect(await chart.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
