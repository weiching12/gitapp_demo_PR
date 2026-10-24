import { test, expect } from "@playwright/test";

const parts = {
  price: { track: "#watchlist-grid", card: ".watch-card", dots: "#watchlist-carousel-controls" },
  institutions: { track: "#institution-overview-rows", card: ".institution-overview-row", dots: "#institution-carousel-controls" },
};

for (const kind of Object.keys(parts)) test(`${kind} keeps the adjacent card when the current favorite is removed`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator('.sidebar [data-page="favorites"]').click();
  await page.locator(`[data-overview="${kind}"]`).click();
  const { track, card, dots } = parts[kind];
  const symbolAttribute = kind === "price" ? "data-watch-symbol" : "data-overview-symbol";
  const cards = page.locator(track).locator(card);
  for (const dot of [1, 2]) {
    await page.locator(`${dots} [data-carousel-index="${dot}"]`).click();
    const count = await cards.count(), index = Math.round(dot * (count - 1) / 2);
    const removed = await cards.nth(index).getAttribute(symbolAttribute);
    const expected = await cards.nth(index + 1 < count ? index + 1 : index - 1).getAttribute(symbolAttribute);
    if (kind === "price") await cards.nth(index).locator("[data-favorite]").click();
    else {
      await page.locator('.sidebar [data-page="market"]').click();
      await page.locator(`#stock-rows [data-favorite="${removed}"]`).click();
      await page.locator('.sidebar [data-page="favorites"]').click();
    }
    await expect(cards).toHaveCount(count - 1);
    await expect.poll(() => page.locator(track).evaluate((element, { card, symbolAttribute }) => {
      const left = element.getBoundingClientRect().left + parseFloat(getComputedStyle(element).paddingLeft);
      const closest = [...element.querySelectorAll(card)].reduce((a, b) =>
        Math.abs(a.getBoundingClientRect().left - left) <= Math.abs(b.getBoundingClientRect().left - left) ? a : b);
      return closest.getAttribute(symbolAttribute);
    }, { card, symbolAttribute })).toBe(expected);
    await expect(page.locator(`${dots} [aria-current="true"]`)).toHaveCount(1);
  }
});

for (const kind of Object.keys(parts)) test(`${kind} carousel follows its responsive layout and supports dot navigation`, async ({ page }, testInfo) => {
  await page.goto("/");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('.sidebar [data-page="favorites"]').click();
  await page.locator(`[data-overview="${kind === "price" ? "price" : "institutions"}"]`).click();
  const config = parts[kind], track = page.locator(config.track), dots = page.locator(config.dots);
  const buttons = dots.locator("[data-carousel-index]");
  for (const width of [320, 390, 700, 701, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (kind === "institutions" && width > 700) {
      await expect(dots).toBeHidden();
      await expect(track).toHaveCSS("display", "grid");
      await expect(track).toHaveCSS("scroll-snap-type", "none");
      const layout = await track.evaluate((element, selector) => {
        const cards = [...element.querySelectorAll(selector)].map((card) => card.getBoundingClientRect());
        return {
          stacked: cards.every((card, index) => index === 0 || card.top >= cards[index - 1].bottom),
          fullWidth: cards.every((card) => Math.abs(card.width - element.clientWidth) <= 1),
          overflow: element.scrollWidth > element.clientWidth || document.documentElement.scrollWidth > innerWidth,
        };
      }, config.card);
      expect(layout).toEqual({ stacked: true, fullWidth: true, overflow: false });
      continue;
    }
    await expect(dots).toBeVisible();
    await expect(buttons).toHaveCount(3);
    await buttons.first().click();
    await expect(buttons.first()).toHaveAttribute("aria-current", "true");
    const placement = await page.evaluate(({ track, dots }) => {
      const cards = document.querySelector(track).getBoundingClientRect();
      const pagination = document.querySelector(dots).getBoundingClientRect();
      const active = document.querySelector(`${dots} [aria-current="true"] .carousel-dot`);
      const inactive = document.querySelector(`${dots} [aria-current="false"] .carousel-dot`);
      return {
        below: pagination.top >= cards.bottom - 1,
        center: Math.abs(pagination.left + pagination.width / 2 - (cards.left + cards.width / 2)),
        snap: getComputedStyle(document.querySelector(track)).scrollSnapType,
        activeWidth: active.getBoundingClientRect().width,
        inactiveWidth: inactive.getBoundingClientRect().width,
        activeColor: getComputedStyle(active).backgroundColor,
        inactiveColor: getComputedStyle(inactive).backgroundColor,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    }, config);
    expect(placement).toMatchObject({ below: true, snap: "x mandatory", activeWidth: 24, inactiveWidth: 8,
      activeColor: "rgb(37, 99, 235)", inactiveColor: "rgb(203, 213, 225)", overflow: false });
    expect(placement.center).toBeLessThanOrEqual(1);
    await buttons.last().click();
    await expect(buttons.last()).toHaveAttribute("aria-current", "true");
    const alignment = await track.evaluate((element, selector) => {
      const last = element.querySelectorAll(selector)[4].getBoundingClientRect();
      return last.left - element.getBoundingClientRect().left - parseFloat(getComputedStyle(element).paddingLeft);
    }, config.card);
    expect(Math.abs(alignment)).toBeLessThanOrEqual(1);
    await buttons.last().press("Home");
    await expect(buttons.first()).toBeFocused();
    await expect(buttons.first()).toHaveAttribute("aria-current", "true");
    await buttons.first().press("ArrowRight");
    await expect(buttons.nth(1)).toHaveAttribute("aria-current", "true");
    await track.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect(buttons.last()).toHaveAttribute("aria-current", "true");
    if (width === 390) await page.screenshot({ path: testInfo.outputPath(`${kind}-dots-390.png`) });
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const transitions = await dots.locator(".carousel-dot").first().evaluate((element) => ({
    property: getComputedStyle(element).transitionProperty,
    duration: getComputedStyle(element).transitionDuration,
  }));
  expect(transitions.property).toBe("width, background-color");
  expect(transitions.duration).toBe("0.22s, 0.22s");
});

test("carousel dots stay in sync after switching overviews, changing intervals and removing favorites", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator('.sidebar [data-page="favorites"]').click();
  const priceDots = page.locator('#watchlist-carousel-controls [data-carousel-index]');
  const institutionDots = page.locator('#institution-carousel-controls [data-carousel-index]');
  await priceDots.nth(2).click();
  await expect(priceDots.nth(2)).toHaveAttribute("aria-current", "true");
  await page.locator('[data-overview="institutions"]').click();
  await institutionDots.last().click();
  await expect(institutionDots.last()).toHaveAttribute("aria-current", "true");
  await page.locator('[data-institution-window="20"]').click();
  await expect(institutionDots.last()).toHaveAttribute("aria-current", "true");
  await page.locator('[data-overview="price"]').click();
  await expect(priceDots.nth(2)).toHaveAttribute("aria-current", "true");
  await page.locator('#watchlist-grid .watch-card').nth(2).locator('[data-favorite]').click();
  await expect(priceDots).toHaveCount(3);
  await expect(institutionDots).toHaveCount(3);
  await expect(page.locator('#watchlist-carousel-controls [aria-current="true"]')).toHaveCount(1);
  await page.locator('#watchlist-carousel-controls [data-carousel-index="0"]').click();
  for (let remaining = 4; remaining > 1; remaining--) {
    await page.locator('#watchlist-grid .watch-card').first().locator('[data-favorite]').click();
    if (remaining > 2) {
      await expect(priceDots).toHaveCount(3);
      await expect(institutionDots).toHaveCount(3);
      await expect(page.locator('#watchlist-carousel-controls [aria-current="true"]')).toHaveCount(1);
    }
  }
  await expect(page.locator('#watchlist-carousel-controls')).toBeHidden();
  await page.locator('#watchlist-grid .watch-card').first().locator('[data-favorite]').click();
  await expect(page.locator('#watchlist-empty')).toBeVisible();
  await expect(page.locator('#watchlist-carousel-controls')).toBeHidden();
});

test("three dots represent beginning, middle and end for any favorite count", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const symbols = await page.locator('#stock-rows tr[data-symbol]').evaluateAll((rows) => rows.map((row) => row.dataset.symbol));
  for (const count of [2, 3, 6, symbols.length]) {
    await page.evaluate((favorites) => localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites, catalogVersion: 2 })), symbols.slice(0, count));
    await page.reload();
    await page.locator('.sidebar [data-page="favorites"]').click();
    for (const kind of Object.keys(parts)) {
      await page.locator(`[data-overview="${kind}"]`).click();
      const { track, card, dots } = parts[kind];
      const buttons = page.locator(`${dots} [data-carousel-index]`);
      await expect(page.locator(track).locator(card)).toHaveCount(count);
      await expect(buttons).toHaveCount(3);
      for (const position of [0, 1, 2]) {
        if (count === 2 && position === 1) {
          await expect(buttons.nth(position)).toHaveAttribute("aria-disabled", "true");
          continue;
        }
        await buttons.nth(position).click();
        await expect(buttons.nth(position)).toHaveAttribute("aria-current", "true");
        const target = Math.round(position * (count - 1) / 2);
        await expect.poll(() => page.locator(track).evaluate((element, { card, target }) =>
          Math.abs(element.querySelectorAll(card)[target].getBoundingClientRect().left - element.getBoundingClientRect().left - parseFloat(getComputedStyle(element).paddingLeft)),
        { card, target })).toBeLessThanOrEqual(1);
      }
      if (count === 2) {
        await buttons.first().press("Home");
        await buttons.first().press("ArrowRight");
        await expect(buttons.last()).toBeFocused();
        await expect(buttons.last()).toHaveAttribute("aria-current", "true");
      }
    }
  }
});

test("smooth dot navigation retains the selected card after a responsive resize", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator('.sidebar [data-page="favorites"]').click();
  for (const kind of Object.keys(parts)) {
    await page.locator(`[data-overview="${kind === "price" ? "price" : "institutions"}"]`).click();
    const config = parts[kind], last = page.locator(`${config.dots} [data-carousel-index]`).last();
    await last.click();
    const distance = () => page.locator(config.track).evaluate((element, card) => {
      const cards = element.querySelectorAll(card);
      return Math.abs(cards[cards.length - 1].getBoundingClientRect().left - element.getBoundingClientRect().left - parseFloat(getComputedStyle(element).paddingLeft));
    }, config.card);
    await expect.poll(distance).toBeLessThanOrEqual(1);
    await expect(last).toHaveAttribute("aria-current", "true");
    for (const width of [1440, 390, 701, 700, 320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(last).toHaveAttribute("aria-current", "true");
      if (kind === "institutions" && width > 700) {
        await expect(page.locator(config.dots)).toBeHidden();
        continue;
      }
      await expect(page.locator(config.dots)).toBeVisible();
      await expect.poll(distance).toBeLessThanOrEqual(1);
    }
  }
});

test("a native touch swipe snaps to a card and updates the active dot", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:5173", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.locator('.sidebar [data-page="favorites"]').tap();
    const session = await context.newCDPSession(page);
    for (const kind of Object.keys(parts)) {
      await page.locator(`[data-overview="${kind === "price" ? "price" : "institutions"}"]`).tap();
      const track = page.locator(parts[kind].track);
      await page.locator(`${parts[kind].dots} [data-carousel-index="0"]`).tap();
      const bounds = await track.boundingBox();
      const start = bounds.x + bounds.width - 25, y = bounds.y + 80;
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start, y }] });
      for (let step = 1; step <= 12; step++) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start - step * 22, y }] });
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(page.locator(`${parts[kind].dots} [data-carousel-index="0"]`)).toHaveAttribute("aria-current", "false");
      expect(await track.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }
  } finally { await context.close(); }
});
