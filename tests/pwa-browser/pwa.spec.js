import { test, expect } from "@playwright/test";

test("manifest and install icons are served with the expected metadata", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: "株研｜台股研究室", short_name: "株研", display: "standalone" });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ sizes: "512x512", type: "image/png" }),
    expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
  ]));
  for (const icon of manifest.icons) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toBe("image/png");
  }
});

test("installed shell starts offline and identifies saved data", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#page-title")).toContainText("市場觀察清單");
  await expect(page.locator("#app-status")).toContainText(/目前離線，顯示 \d{4}-\d{2}-\d{2} 已保存資料/);
  await expect(page.locator("#app-status")).toBeVisible();
});

test("returning to a backgrounded app checks for a service worker update", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);

  const canObserveRegistration = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    try {
      window.__pwaUpdateChecks = 0;
      const observeUpdate = async () => {
        window.__pwaUpdateChecks += 1;
      };
      registration.update = observeUpdate;
      return registration.update === observeUpdate;
    } catch {
      return false;
    }
  });
  test.skip(!canObserveRegistration, "Browser does not allow observing ServiceWorkerRegistration.update");

  await page.evaluate(() => {
    const currentTime = Date.now();
    Date.now = () => currentTime + 61_000;
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__pwaUpdateChecks)).toBeGreaterThan(0);
});

test("standalone app shows the branded launch animation once per session", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    if (!sessionStorage.getItem("splash-test-ready")) {
      sessionStorage.removeItem("stock-insight-splash-seen");
      sessionStorage.setItem("splash-test-ready", "1");
    }
  });
  await page.goto("/");
  const splash = page.locator("#app-splash");
  await expect(splash).toBeVisible();
  await expect(splash).toContainText("株研");
  await expect(splash).toHaveCount(0, { timeout: 2_000 });
  await page.reload();
  await expect(page.locator("#app-splash")).toBeHidden();
});
