import { test, expect } from "@playwright/test";

const geometry = (page) => page.locator('.overview-tabs').evaluate((tabs) => {
  const bounds = (element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height };
  };
  const controls = tabs.parentElement, style = getComputedStyle(controls);
  return {
    tabs: bounds(tabs), views: bounds(tabs.querySelector('.overview-view-tabs')),
    price: bounds(tabs.querySelector('[data-overview="price"]')),
    institutions: bounds(tabs.querySelector('[data-overview="institutions"]')),
    indicator: bounds(tabs.querySelector('.overview-tab-indicator')),
    period: bounds(tabs.querySelector('.institution-window')),
    right: controls.getBoundingClientRect().right - parseFloat(style.paddingRight),
    overflow: document.documentElement.scrollWidth > innerWidth,
  };
});

test("overview tabs slide and expand to contain right aligned periods at every width", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('[data-page="favorites"]').click();
  await expect(page.getByRole('tablist', { name: '自選總覽視角' }).getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.overview-tabs .institution-window button')).toHaveCount(3);
  for (const width of [320, 390, 700, 768, 1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[data-overview="price"]').click();
    await expect(page.locator('.institution-window')).toBeHidden();
    const compact = await geometry(page);
    expect(Math.abs(compact.indicator.left - compact.price.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(compact.indicator.width - compact.price.width)).toBeLessThanOrEqual(1);
    await page.locator('[data-overview="institutions"]').click();
    await expect(page.locator('.overview-tabs .institution-window')).toBeVisible();
    const expanded = await geometry(page);
    expect(expanded.tabs.width).toBeGreaterThan(compact.tabs.width);
    expect(Math.abs(expanded.tabs.right - expanded.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(expanded.indicator.left - expanded.institutions.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(expanded.indicator.right - expanded.institutions.right)).toBeLessThanOrEqual(1);
    expect(expanded.views.right).toBeLessThan(expanded.period.left);
    expect(expanded.period.right).toBeLessThanOrEqual(expanded.tabs.right);
    expect(expanded.tabs.height).toBe(compact.tabs.height);
    expect(expanded.overflow).toBe(false);
    for (const period of ['5', '20', 'day']) {
      await page.locator(`[data-institution-window="${period}"]`).click();
      await expect(page.locator(`[data-institution-window="${period}"]`)).toHaveAttribute('aria-pressed', 'true');
    }
    if ([390, 1440].includes(width)) await page.screenshot({ path: testInfo.outputPath(`overview-tabs-${width}.png`) });
  }
});

test("overview expansion animates smoothly and settles after rapid switching", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  await page.locator('[data-page="favorites"]').click();
  const before = await geometry(page);
  await page.locator('[data-overview="institutions"]').click();
  await page.waitForTimeout(80);
  const during = await geometry(page);
  expect(during.tabs.width).toBeGreaterThan(before.tabs.width);
  expect(during.tabs.width).toBeLessThan(during.right - during.tabs.left - 1);
  await expect.poll(async () => {
    const current = await geometry(page);
    return Math.abs(current.tabs.right - current.right);
  }).toBeLessThanOrEqual(1);
  const transition = await page.locator('.overview-tab-indicator').evaluate(element => getComputedStyle(element).transitionProperty);
  expect(transition).toBe('left, width');
  for (const kind of ['price', 'institutions', 'price', 'institutions'])
    await page.locator(`[data-overview="${kind}"]`).click();
  await expect.poll(async () => {
    const current = await geometry(page);
    return Math.abs(current.indicator.left - current.institutions.left);
  }).toBeLessThanOrEqual(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.overview-tab-indicator')).toHaveCSS('transition-property', 'none');
});

test("overview keyboard navigation and visible focus survive the nested period controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('[data-page="favorites"]').click();
  const price = page.locator('[data-overview="price"]'), institutions = page.locator('[data-overview="institutions"]');
  await price.focus();
  await page.keyboard.press('ArrowRight');
  await expect(institutions).toBeFocused();
  await expect(institutions).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-institution-window="day"]')).toBeFocused();
  await page.keyboard.press('Tab');
  const five = page.locator('[data-institution-window="5"]');
  await expect(five).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(five).toHaveAttribute('aria-pressed', 'true');
  expect(await five.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await institutions.focus();
  await page.keyboard.press('Home');
  await expect(price).toBeFocused();
  await expect(price).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.institution-window')).toBeHidden();
});

test("overview and sector controls share white surfaces and gray sliding selections", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const checkControl = async (selector, activeSelector, indicatorSelector) => {
    const control = page.locator(selector);
    await expect(control).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(control.locator(indicatorSelector)).toHaveCSS('background-color', 'rgb(238, 242, 247)');
    const delta = await control.evaluate((group, { activeSelector, indicatorSelector }) => {
      const active = group.querySelector(activeSelector).getBoundingClientRect();
      const indicator = group.querySelector(indicatorSelector).getBoundingClientRect();
      return Math.max(Math.abs(active.left - indicator.left), Math.abs(active.width - indicator.width), Math.abs(active.height - indicator.height));
    }, { activeSelector, indicatorSelector });
    expect(delta).toBeLessThanOrEqual(1);
  };
  for (const width of [320, 390, 700, 701, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[data-page="favorites"]').click();
    for (const kind of ['price', 'institutions']) {
      await page.locator(`[data-overview="${kind}"]`).click();
      await checkControl('.overview-tabs', '[aria-selected="true"]', '.overview-tab-indicator');
    }
    for (const period of ['day', '5', '20']) {
      await page.locator(`[data-institution-window="${period}"]`).click();
      await checkControl('.institution-window', '[aria-pressed="true"]', '.segmented-indicator');
    }
    await page.locator('[data-page="sectors"]').click();
    for (const sort of ['name-asc', 'net-desc', 'net-asc']) {
      await page.locator(`[data-sector-sort="${sort}"]`).click();
      await checkControl('.sector-sort-tabs', '[aria-pressed="true"]', '.segmented-indicator');
    }
    for (const period of ['day', '5', '20']) {
      await page.locator(`[data-sector-window="${period}"]`).click();
      await checkControl('.sector-period', '[aria-pressed="true"]', '.segmented-indicator');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if ([390, 1440].includes(width)) await page.screenshot({ path: testInfo.outputPath(`sector-controls-${width}.png`) });
  }
});

test("institution overview uses aligned shared desktop headings and keeps labels on phone cards", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('[data-page="favorites"]').click();
  await page.locator('[data-overview="institutions"]').click();
  const heading = page.locator('.institution-overview-head');
  await expect(heading.locator('span')).toHaveText(['股票', '合計買賣超', '外資', '投信', '自營商']);
  for (const width of [701, 768, 900, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(heading).toBeVisible();
    for (const period of ['day', '20']) {
      await page.locator(`[data-institution-window="${period}"]`).click();
      const issues = await page.locator('.institution-overview-row').evaluateAll(rows => rows.flatMap(row => {
        const headings = [...document.querySelectorAll('.institution-overview-metric-headings span')];
        return [...row.querySelectorAll('.overview-metric')].flatMap((field, index) => {
          const label = field.querySelector('dt');
          return [
            Math.abs(field.getBoundingClientRect().left - headings[index].getBoundingClientRect().left) > 1 && 'column heading is misaligned',
            label.getBoundingClientRect().width > 1 && 'repeated label remains visible',
            field.scrollWidth > field.clientWidth + 1 && 'numeric field overflows',
          ].filter(Boolean);
        });
      }));
      expect(issues, `Shared institutional headings at ${width}px / ${period}`).toEqual([]);
    }
    if (width === 1440) {
      const heights = await page.locator('.institution-overview-row').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
      expect(Math.max(...heights)).toBeLessThanOrEqual(100);
      await page.screenshot({ path: testInfo.outputPath('institution-headings-desktop.png') });
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(heading).toBeHidden();
  const labels = page.locator('.institution-overview-row').first().locator('dt');
  await expect(labels).toHaveText(['合計買賣超', '外資', '投信', '自營商']);
  expect(await labels.evaluateAll(elements => elements.every(element => element.getBoundingClientRect().width > 1))).toBe(true);
});
