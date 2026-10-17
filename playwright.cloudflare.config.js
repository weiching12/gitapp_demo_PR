import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/cloudflare-browser",
  outputDir: "./.wrangler/test-results-cloudflare",
  workers: 1,
  use: {
    baseURL: process.env.STOCK_BASE_URL || "http://127.0.0.1:8787",
    viewport: { width: 1440, height: 1100 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH,
      args: ["--no-sandbox", "--disable-dev-shm-usage"] },
    screenshot: "only-on-failure",
  },
});
