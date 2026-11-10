/** Captures the screenshots used in the guides (docs/images). Run: npx playwright test -c docs/build/shots.config.ts */
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: /screenshots\.spec\.ts/, timeout: 180_000, workers: 3, reporter: 'list',
  use: { baseURL: 'http://localhost:4174', channel: 'chrome', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  webServer: { command: 'npm run preview:demo -w @pawsure/web', url: 'http://localhost:4174/demo.html', reuseExistingServer: true, timeout: 120_000, cwd: '../..' }
});
