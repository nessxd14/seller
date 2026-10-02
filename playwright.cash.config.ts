import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'cash-connected.spec.ts',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5181', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1 --port 5180 --strictPort', url: 'http://127.0.0.1:5180', reuseExistingServer: true },
    { command: 'npm --prefix ../caja-cation run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5181', reuseExistingServer: true },
  ],
})
