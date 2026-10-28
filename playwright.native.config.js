import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/native-browser", outputDir: "./.wrangler/test-results-native", workers: 1,
  use: { baseURL: "http://127.0.0.1:5175", viewport: { width: 390, height: 844 }, serviceWorkers: "block",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } },
  webServer: { command: "npm run dev:native -- --port 5175 --strictPort", url: "http://127.0.0.1:5175", reuseExistingServer: !process.env.CI },
});
