import { test, expect } from "@playwright/test";

test("daily visitor API counts two browsers and deduplicates repeated visits", async ({ request }) => {
  const id = crypto.randomUUID(), second = crypto.randomUUID();
  const first = await request.post("/api/v1/presence", { data: { id } });
  expect(first.ok()).toBeTruthy();
  expect(first.headers()["cache-control"]).toBe("no-store");
  const initial = (await first.json()).today;
  expect(initial).toBeGreaterThanOrEqual(1);
  expect((await (await request.post("/api/v1/presence", { data: { id } })).json()).today).toBe(initial);
  expect((await (await request.post("/api/v1/presence", { data: { id: second } })).json()).today).toBe(initial + 1);
});

test("daily visitor badge records once per page load and reuses browser identity", async ({ page }) => {
  const ids = [];
  const reads = [];
  let count = 3, fail = false;
  await page.clock.install();
  await page.route("**/api/v1/market", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.route("**/api/v1/presence", async (route) => {
    if (route.request().method() === "POST") ids.push(route.request().postDataJSON().id);
    else reads.push(route.request().method());
    await route.fulfill(fail ? { status: 503, body: "unavailable" } : { json: { today: count, asOf: "2026-10-22" } });
  });
  await page.setViewportSize({ width: 768, height: 844 });
  await page.goto("/");
  await expect(page.locator("#online-count")).toHaveText("今日造訪人數 3 人");
  await expect(page.locator("#online-count")).toBeVisible();
  count = 5;
  await page.clock.runFor(60_000);
  await expect(page.locator("#online-count")).toHaveText("今日造訪人數 3 人");
  expect(ids).toHaveLength(1);
  expect(reads).toHaveLength(0);
  expect(new Set(ids).size).toBe(1);
  await page.evaluate(() => document.querySelector("#check-update").click());
  await expect(page.locator("#online-count")).toHaveText("今日造訪人數 5 人");
  expect(ids).toHaveLength(1);
  expect(reads).toEqual(["GET"]);
  await page.reload();
  await expect(page.locator("#online-count")).toHaveText("今日造訪人數 5 人");
  expect(new Set(ids).size).toBe(1);
  fail = true;
  await page.reload();
  await expect(page.locator("#online-count")).toHaveText("今日造訪人數暫無法取得");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
});
