import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const localChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:5181',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync(localChrome) ? localChrome : undefined),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5181 --strictPort',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://ui-check.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ui_fixture' },
  },
});
