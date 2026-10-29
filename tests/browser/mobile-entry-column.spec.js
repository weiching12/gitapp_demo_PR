import { test, expect } from "@playwright/test";

test("phone score header, values and availability labels fit the column in both themes", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator("#stock-rows .entry-score-button").first()).toBeVisible();
  const labels = ["較前期 +99.99", "較前期 -99.99", "較前期 0.00", "當日資料不足",
    "前期資料不足", "尚無前期資料", "前期無法比較"];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [320, 360, 390, 430, 520, 700]) {
      await page.setViewportSize({ width, height: 844 });
      const problems = await page.locator("#stock-rows .entry-cell").evaluateAll((cells, labels) => {
        const problems = [];
        const textFits = (element, outer) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return [...range.getClientRects()].every((rect) => rect.left >= outer.left - 1 && rect.right <= outer.right + 1);
        };
        cells.slice(0, labels.length).forEach((cell, index) => {
          const button = cell.querySelector("button"), score = button.querySelector("strong"), label = button.querySelector("small");
          score.textContent = "100.00";
          label.textContent = labels[index];
          const rect = cell.getBoundingClientRect(), target = button.getBoundingClientRect();
          if (target.left < rect.left || target.right > rect.right || target.height < 44 ||
              !textFits(score, target) || !textFits(label, target) || label.scrollWidth > label.clientWidth + 1)
            problems.push({ label: labels[index], cell: rect.width, button: target.width, height: target.height });
        });
        const header = document.querySelector('[data-sort-heading="entryScore"]');
        if (!textFits(header.querySelector("button"), header.getBoundingClientRect())) problems.push("header overflows");
        if (document.documentElement.scrollWidth > innerWidth) problems.push("page overflows");
        return problems;
      }, labels);
      expect(problems, `${theme} ${width}px`).toEqual([]);
      if (width === 390) {
        await page.locator(".table-scroll").scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`phone-score-${theme}.png`) });
      }
    }
  }
});
