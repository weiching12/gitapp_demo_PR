import { test, expect } from "@playwright/test";

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test("phone chart shows the touched trading day without a separate slider", async ({ page }) => {
  await page.goto("/");
  await page.locator("#stock-rows .entry-score-button").first().click();
  const chart = page.locator(".entry-price-chart");
  const plot = chart.locator(".entry-chart-plot");
  await expect(chart.locator("h3")).toBeVisible();
  await expect(chart.locator(".entry-chart-readout")).toBeHidden();
  await expect(plot).toHaveAttribute("aria-valuemax", "30");
  await expect(chart.locator(".entry-chart-range")).toHaveCount(0);
  const first = await chart.locator(".entry-chart-points circle").first().boundingBox();
  await page.touchscreen.tap(first.x + first.width / 2, first.y + first.height / 2);
  await expect(plot).toHaveAttribute("aria-valuenow", "1");
  expect(await plot.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
  await expect(chart.locator("h3")).toBeVisible();
  await expect(chart.locator(".entry-chart-hint")).toHaveCount(0);
  const last = await chart.locator(".entry-chart-points circle").last().boundingBox();
  await page.touchscreen.tap(last.x + last.width / 2, last.y + last.height / 2);
  await expect(plot).toHaveAttribute("aria-valuenow", "30");
  const box = await plot.boundingBox();
  const stableY = box.y;
  const y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width - 8, y, id: 1 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: first.x + first.width / 2, y, id: 1 }] });
  await expect(chart.locator(".entry-chart-readout")).toBeVisible();
  await expect(chart.locator("h3")).toBeHidden();
  expect((await plot.boundingBox()).y).toBe(stableY);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(plot).toHaveAttribute("aria-valuenow", "1");
  const firstDate = JSON.parse(await plot.getAttribute("data-points"))[0].date.slice(5).replace("-", "/");
  await expect(chart.locator(".entry-chart-selected-date")).toHaveText(firstDate);
  await expect(chart.locator(".entry-chart-selected-volume")).toContainText("張");
  await expect(chart.locator(".entry-chart-selected-change")).toContainText("%");
  await expect(chart.locator("h3")).toBeVisible();
  await expect(chart.locator(".entry-chart-readout")).toBeHidden();
  expect((await plot.boundingBox()).y).toBe(stableY);
  expect(await chart.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("dragging the phone chart does not scroll the detail panel", async ({ page }) => {
  await page.goto("/");
  await page.locator("#stock-rows .entry-score-button").first().click();
  const dialog = page.locator("#info-dialog");
  const plot = dialog.locator(".entry-chart-plot");
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  const startScroll = await dialog.evaluate((element) => element.scrollTop);
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width - 12, y: box.y + box.height * 0.35, id: 1 }] });
  for (let step = 1; step <= 5; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width - 12 - step * (box.width - 24) / 5, y: box.y + box.height * (0.35 + step * 0.08), id: 1 }] });
  }
  await expect(dialog.locator(".entry-chart-readout")).toBeVisible();
  await expect.poll(async () => Number(await plot.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(2);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(await dialog.evaluate((element) => element.scrollTop)).toBe(startScroll);
});
