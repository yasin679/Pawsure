/**
 * End-to-end tests (Playwright) against the shareable demo build: the real React app, API and database (PGlite)
 * running in the browser, so each test starts from a fresh demo household. Uses the installed Chrome.
 * Run: npm run e2e   → report in e2e/report, raw results in e2e/results/results.json, spreadsheet via npm run e2e:sheet
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'e2e/results/results.json' }], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  use: {
    baseURL: 'http://localhost:4174',
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000
  },
  webServer: {
    command: 'npm run build:demo -w @pawsure/web && npm run preview:demo -w @pawsure/web',
    url: 'http://localhost:4174/demo.html',
    reuseExistingServer: true,
    timeout: 180_000
  }
});
