import { test as base, expect, type Page } from '@playwright/test'

/**
 * Shared e2e fixture:
 * - every test starts from a fresh first-run world (storage cleared → app re-seeds)
 * - console errors and uncaught page errors fail the test (opt out per test with `allowConsoleErrors`)
 * - `simSpeed` (default 8) speeds up simulated runs so tests stay fast
 */
type Fixtures = {
  allowConsoleErrors: boolean
  simSpeed: number
  theme: 'dark' | 'light'
  consoleErrors: string[]
}

export const test = base.extend<Fixtures>({
  allowConsoleErrors: [false, { option: true }],
  simSpeed: [8, { option: true }],
  theme: ['dark', { option: true }],
  consoleErrors: [async ({ page, allowConsoleErrors, simSpeed, theme }, use) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    await page.addInitScript(
      ({ speed, theme }) => {
        // Fresh world once per test (not on every navigation within the test).
        if (!sessionStorage.getItem('e2e.initialized')) {
          localStorage.clear()
          sessionStorage.setItem('e2e.initialized', '1')
          localStorage.setItem(
            'atrium.settings',
            JSON.stringify({
              state: { settings: { simulation: { speed }, appearance: { theme, density: 'comfortable', reduceMotion: 'reduce' }, onboarded: true } },
              version: 1,
            }),
          )
        }
      },
      { speed: simSpeed, theme },
    )
    await use(errors)
    if (!allowConsoleErrors) {
      const real = errors.filter((e) => !/Download the React DevTools|\[vite\]/.test(e))
      expect(real, `console/page errors:\n${real.join('\n')}`).toEqual([])
    }
  }, { auto: true }],
})

export { expect }

/** Navigate and wait for the app shell to be ready. */
export async function open(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await page.waitForSelector('[data-app-ready="true"]', { timeout: 20_000 })
}
