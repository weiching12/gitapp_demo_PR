import { test, expect } from "@playwright/test";

test("real presence API counts two browsers and deduplicates repeated heartbeats", async ({ request }) => {
  const id = crypto.randomUUID(), second = crypto.randomUUID();
  const first = await request.post("/api/v1/presence", { data: { id } });
  expect(first.ok()).toBeTruthy();
  expect(first.headers()["cache-control"]).toBe("no-store");
  const initial = (await first.json()).online;
  expect(initial).toBeGreaterThanOrEqual(1);
  expect((await (await request.post("/api/v1/presence", { data: { id } })).json()).online).toBe(initial);
  expect((await (await request.post("/api/v1/presence", { data: { id: second } })).json()).online).toBe(initial + 1);
});

test("online badge refreshes, reuses browser identity and reports connection failures", async ({ page }) => {
  const ids = [];
  let count = 3, fail = false;
  await page.clock.install();
  await page.route("**/api/v1/market", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.route("**/api/v1/presence", async (route) => {
    ids.push(route.request().postDataJSON().id);
    await route.fulfill(fail ? { status: 503, body: "unavailable" } : { json: { online: count, windowSeconds: 90 } });
  });
  await page.setViewportSize({ width: 768, height: 844 });
  await page.goto("/");
  await expect(page.locator("#online-count")).toHaveText("在線 3 人");
  await expect(page.locator("#online-count")).toBeVisible();
  count = 5;
  await page.clock.runFor(30_000);
  await expect(page.locator("#online-count")).toHaveText("在線 5 人");
  expect(new Set(ids).size).toBe(1);
  await page.reload();
  await expect(page.locator("#online-count")).toHaveText("在線 5 人");
  expect(new Set(ids).size).toBe(1);
  fail = true;
  await page.clock.runFor(30_000);
  await expect(page.locator("#online-count")).toHaveText("在線人數暫無法取得");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
});
