import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.scorePulses = [];
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: pattern => {
      window.scorePulses.push({ pattern, time: performance.now() }); return true;
    } });
  });
  await page.goto("/");
});

test("tapping a stock coordinates short vibration pulses with the final animated score", async ({ page }) => {
  await page.locator('#stock-rows tr[data-symbol="2330"] .entry-score-button').tap();
  const score = page.locator(".entry-summary-head strong[data-score-target]");
  await expect(score).toHaveText(`${await score.getAttribute("data-score-target")} / 100`);
  await expect.poll(() => page.evaluate(() => window.scorePulses.at(-1)?.pattern)).toBe(18);
  const ticks = await page.evaluate(() => window.scorePulses.filter(pulse => pulse.pattern === 8));
  expect(ticks.length).toBeGreaterThan(0); expect(ticks.length).toBeLessThanOrEqual(6);
  for (let index = 1; index < ticks.length; index++) expect(ticks[index].time - ticks[index - 1].time).toBeGreaterThanOrEqual(100);
});

test("closing mid-animation cancels vibration without a completion pulse", async ({ page }) => {
  await page.locator('#stock-rows tr[data-symbol="2330"] .entry-score-button').tap();
  await expect.poll(() => page.evaluate(() => window.scorePulses.some(pulse => pulse.pattern === 8))).toBe(true);
  await page.locator(".info-dialog-handle").tap();
  await expect(page.locator("#info-dialog")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.scorePulses.at(-1)?.pattern)).toBe(0);
  expect(await page.evaluate(() => window.scorePulses.some(pulse => pulse.pattern === 18))).toBe(false);
});

test("reduced motion keeps a static score without vibration", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('#stock-rows tr[data-symbol="2330"] .entry-score-button').tap();
  const score = page.locator(".entry-summary-head strong[data-score-target]");
  await expect(score).toHaveText(`${await score.getAttribute("data-score-target")} / 100`);
  expect(await page.evaluate(() => window.scorePulses)).toEqual([]);
});

test("desktop mouse use and unsupported devices retain the score display", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('#stock-rows tr[data-symbol="2330"] .entry-score-button').click();
  const score = page.locator(".entry-summary-head strong[data-score-target]");
  await expect(score).toHaveText(`${await score.getAttribute("data-score-target")} / 100`);
  expect(await page.evaluate(() => window.scorePulses)).toEqual([]);
  await page.locator("#close-dialog").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => Object.defineProperty(navigator, "vibrate", { value: undefined }));
  await page.locator('#stock-rows tr[data-symbol="2330"] .entry-score-button').tap();
  await expect(score).toHaveText(`${await score.getAttribute("data-score-target")} / 100`);
});
