import { test, expect } from "@playwright/test";

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test("phone chart shows the touched trading day with precise date controls", async ({ page }) => {
  await page.goto("/");
  await page.locator("#stock-rows .entry-score-button").first().click();
  const chart = page.locator(".entry-price-chart");
  const plot = chart.locator(".entry-chart-plot");
  await expect(plot).toHaveAttribute("aria-valuemax", "30");
  await expect(chart.locator(".entry-chart-range")).toHaveCount(1);
  const first = await chart.locator(".entry-chart-points circle").first().boundingBox();
  await page.touchscreen.tap(first.x + first.width / 2, first.y + first.height / 2);
  await expect(plot).toHaveAttribute("aria-valuenow", "1");
  await expect(chart.locator(".entry-chart-note")).toContainText("收盤");
  const last = await chart.locator(".entry-chart-points circle").last().boundingBox();
  await page.touchscreen.tap(last.x + last.width / 2, last.y + last.height / 2);
  await expect(plot).toHaveAttribute("aria-valuenow", "30");
  expect(await chart.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

for (const width of [320, 390]) {
  test(`date controls stay synchronized at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.locator("#stock-rows .entry-score-button").first().click();
    const chart = page.locator(".entry-price-chart");
    const plot = chart.locator(".entry-chart-plot");
    await chart.locator('[data-chart-step="-1"]').click();
    await expect(plot).toHaveAttribute("aria-valuenow", "29");
    await expect(chart.locator(".entry-chart-range")).toHaveValue("28");
    await chart.locator(".entry-chart-range").fill("0");
    await expect(plot).toHaveAttribute("aria-valuenow", "1");
    await expect(chart.locator('[data-chart-step="-1"]')).toBeDisabled();
    await chart.locator('[data-chart-step="1"]').click();
    await expect(plot).toHaveAttribute("aria-valuenow", "2");
    await chart.locator("[data-chart-latest]").click();
    await expect(plot).toHaveAttribute("aria-valuenow", "30");
    await expect(chart.locator("[data-chart-latest]")).toBeDisabled();
    expect(await chart.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}
