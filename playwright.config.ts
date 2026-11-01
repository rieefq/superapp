import { defineConfig, devices } from '@playwright/test'

/**
 * E2E runs against a Vite dev server. Use a unique port per concurrent runner:
 *   E2E_PORT=5311 npx playwright test e2e/chat.spec.ts
 */
const PORT = Number(process.env.E2E_PORT ?? 5299)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    env: { VITE_CACHE_DIR: `node_modules/.vite-e2e-${PORT}` },
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
