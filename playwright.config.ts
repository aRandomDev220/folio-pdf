import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

const cached = `${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
export const executablePath = process.env.FOLIO_BROWSER || (existsSync(cached) ? cached : undefined);
/**
 * Playwright's bundled headless shell cannot load Chrome extensions; the
 * 'chromium' channel opts into the full new-headless build for those specs.
 */
export const browserOptions = executablePath ? { executablePath } : { channel: 'chromium' as const };
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 1000 }, launchOptions: { executablePath } },
  webServer: { command: 'npm run dev -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173/viewer.html', reuseExistingServer: !process.env.CI },
});
