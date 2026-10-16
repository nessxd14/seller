import { defineConfig } from '@playwright/test'

// Suite de regresión de impresión (solo desarrollo): npx playwright test -c playwright.print.config.ts
export default defineConfig({
  testDir: './e2e',
  testMatch: /print-documentos\.spec\.ts/,
  fullyParallel: false,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:5199', viewport: { width: 1280, height: 900 } },
  webServer: {
    command: 'vite --port 5199 --strictPort --host 127.0.0.1',
    env: { VITE_POS_MODE: 'mock' },
    url: 'http://127.0.0.1:5199/print-harness.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
