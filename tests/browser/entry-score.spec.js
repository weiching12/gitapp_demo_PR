import { test, expect } from "@playwright/test";

test("entry score stays usable in the market list, detail dialog and phone scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-sort-heading="entryScore"]')).toContainText("株研評分");
  await expect(page.locator('[data-sort-heading="entryScore"]')).toHaveAttribute("aria-sort", "descending");
  const rows = page.locator("#stock-rows tr");
  await expect(rows.first().locator(".entry-score-button")).toBeVisible();
  const initialScores = await rows.locator(".entry-score-button strong").allTextContents();
  const initialNumeric = initialScores.map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);
  expect(initialNumeric).toEqual([...initialNumeric].sort((a, b) => b - a));
  await expect(rows.first().locator(".entry-score-button")).not.toContainText("核心條件未完整");
  await expect(rows.first().locator(".entry-score-button")).not.toContainText("核心條件已通過");
  const firstListScore = await rows.first().locator(".entry-score-button strong").textContent();
  await rows.first().locator(".entry-score-button").click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator("#dialog-content")).toContainText("波段順勢進場");
  await expect(page.locator("#dialog-content")).toContainText("進場位置與風險");
  await expect(page.locator(".entry-summary-head > strong")).toHaveText(firstListScore);
  await expect(page.locator(".entry-condition")).toHaveCount(5);
  await expect(page.locator(".entry-condition-data").first()).toBeHidden();
  await page.locator("#close-dialog").click();
  await page.locator('[data-sort="entryScore"]').click();
  const scores = await rows.locator(".entry-score-button strong").allTextContents();
  const numeric = scores.map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);
  expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows.first().locator(".entry-score-button")).toBeVisible();
  const bounds = await page.locator(".table-scroll").evaluate((element) =>
    ({ client: element.clientWidth, content: element.scrollWidth }));
  expect(bounds.content).toBeGreaterThan(bounds.client);
  await rows.first().locator(".entry-score-button").click();
  await expect(page.locator("#info-dialog")).toBeVisible();
});
