import { test, expect } from "@playwright/test";

test("research center preserves favorites and opens existing score detail", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await expect(page.locator("#page-title")).toContainText("株研追蹤");
  await expect(page.locator("#page-description")).toContainText("前一交易日分數變化與必要條件異動");
  await expect(page.locator(".date-control")).toBeHidden();
  await expect(page.locator("#watchlist h2")).toHaveCount(0);
  await expect(page.locator("#legacy-watchlist")).toBeHidden();
  await expect(page.locator("#research-stats")).toContainText("追蹤股票");
  const card = page.locator(".research-card").first();
  await expect(card).toBeVisible();
  await expect(card.locator(".research-delta")).toContainText("較 10/15");
  await expect(card.locator(".research-delta")).toHaveAttribute("title", /2026-10-15 .* 分 → 2026-10-16 .* 分；本機示範資料歷史重算/);
  await expect(card.locator(".research-card-more")).toHaveCount(0);
  await expect(card.locator(".research-card-review")).toHaveCount(0);
  await expect(card.locator(".research-stock")).not.toContainText("評分交易日");
  await expect(card.locator(".research-stock")).toContainText("模擬重算");
  await card.locator(".research-card-main").click();
  await expect(page.locator(".research-edit")).toHaveCount(0);
  await expect(page.locator(".research-detail")).toContainText("追蹤價格表現");
  await expect(page.locator(".research-detail")).toContainText("加入時與目前研究差異");
  await expect(page.locator("#research-note-form")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  const same = page.locator(".research-card").first();
  await same.locator(".research-card-main").click();
  await expect(page.locator(".research-detail")).toContainText("研究追蹤");
  await expect(page.locator("#dialog-heading")).toContainText("株研評分");
});

test("a saved stock shows research history only when opened from research tracking", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  const symbol = await page.locator(".research-card").first().getAttribute("data-research-symbol");
  await page.getByRole("button", { name: "市場觀察清單" }).first().click();
  await page.locator(`#stock-rows tr[data-symbol="${symbol}"]`).click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator(".research-detail")).toHaveCount(0);
  await page.locator("#close-dialog").click();
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await page.locator(`.research-card[data-research-symbol="${symbol}"] .research-card-main`).click();
  await expect(page.locator(".research-detail")).toContainText("研究追蹤");
});

test("pointer clicks do not leave a focus ring but keyboard focus remains visible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  const card = page.locator(".research-card-main").first();
  await card.click();
  await page.locator("#close-dialog").click();
  await expect(page.locator("#info-dialog")).toBeHidden();
  await card.focus();
  await expect(card).toBeFocused();
  expect(await card.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
  await page.keyboard.press("Tab");
  await card.focus();
  expect(await card.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
});

test.use({ viewport: { width: 390, height: 844 } });
test("phone research cards fit the viewport and remain operable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await expect(page.locator("#page-description")).toBeVisible();
  await expect(page.locator("#research-list .research-card").first()).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const heading = await page.locator(".page-heading").evaluate((node) => {
      const title = node.querySelector("#page-title").getBoundingClientRect();
      const date = node.querySelector("#research-date").getBoundingClientRect();
      const description = node.querySelector("#page-description").getBoundingClientRect();
      return { titleRight: title.right, dateLeft: date.left, dateRight: date.right, dateBottom: date.bottom, descriptionTop: description.top, viewportWidth: window.innerWidth };
    });
    expect(heading.dateLeft).toBeGreaterThanOrEqual(heading.titleRight - 1);
    expect(heading.dateRight).toBeLessThanOrEqual(heading.viewportWidth + 1);
    expect(heading.dateBottom).toBeLessThan(heading.descriptionTop);
    const bounds = await page.locator(".research-center").evaluate((node) => ({
      left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right,
      width: window.innerWidth,
    }));
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
  }
  await page.locator("#research-filter").selectOption("important");
  await page.locator("#research-filter").selectOption("all");
  await page.locator("#research-list .research-card-main").first().click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  const facts = await page.locator(".research-tracking-facts").evaluate((node) => {
    const rows = [...node.children].map((row) => row.getBoundingClientRect());
    const bounds = node.getBoundingClientRect();
    return { width: bounds.width, scrollWidth: node.scrollWidth, singleColumn: rows.every((row, index) => index === 0 || row.top > rows[index - 1].top) };
  });
  expect(facts.scrollWidth).toBeLessThanOrEqual(facts.width + 1);
  expect(facts.singleColumn).toBe(true);
});

test("research tracking always compares the latest available trading day", async ({ page }) => {
  await page.goto("/");
  await page.locator("#trade-date").selectOption("2026-10-15");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await expect(page.locator(".date-control")).toBeHidden();
  await expect(page.locator("#research-date")).toContainText("2026-10-16");
  await expect(page.locator(".research-card").first()).not.toContainText("評分交易日");
});

test("reloading the phone keeps the selected main page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await page.reload();
  await expect(page.locator("#page-title")).toContainText("株研追蹤");
  await page.getByRole("button", { name: "法人買株" }).first().click();
  await page.reload();
  await expect(page.locator("#page-title")).toContainText("法人買株");
});

test("desktop market date label and selector stay on one line", async ({ page }) => {
  await page.setViewportSize({ width: 830, height: 956 });
  await page.goto("/");
  const positions = await page.locator(".date-control").evaluate((control) => {
    const label = control.querySelector("label").getBoundingClientRect();
    const select = control.querySelector("select").getBoundingClientRect();
    return { labelY: label.y, labelRight: label.right, selectY: select.y, selectLeft: select.left };
  });
  expect(Math.abs(positions.labelY - positions.selectY)).toBeLessThan(12);
  expect(positions.labelRight).toBeLessThan(positions.selectLeft);
});

test("phone history review opens on demand and chart responds to touch and keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  const card = page.locator(".research-card").first();
  await expect(card.locator(".research-card-review")).toHaveCount(0);
  const alignment = await card.locator(".research-stock-head").evaluate((node) => {
    const code = node.querySelector(".research-code").getBoundingClientRect();
    const name = node.querySelector("strong").getBoundingClientRect();
    return { codeY: code.y, nameY: name.y, gap: name.left - code.right };
  });
  expect(Math.abs(alignment.codeY - alignment.nameY)).toBeLessThan(5);
  expect(alignment.gap).toBeGreaterThanOrEqual(0);
  await page.locator(".research-card-main").first().click();
  await expect(page.locator(".research-review-detail")).toContainText("第 5 個交易日");
  const chart = page.locator(".research-chart-plot");
  await expect(chart).toBeVisible();
  await chart.focus();
  await chart.press("ArrowLeft");
  await expect(chart).toHaveAttribute("aria-valuenow", /\d+/);
  await page.locator('[data-review-mode="actual"]').click();
  await expect(page.locator(".research-price-chart")).toHaveAttribute("data-mode", "actual");
  await page.locator('[data-review-range="20"]').click();
  await expect(page.locator(".research-price-chart")).toHaveAttribute("data-range", "20");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
