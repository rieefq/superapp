import { readFile } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/** Rows of one persisted table (the app writes each table to localStorage). */
async function persistedCount(page: Page, table: string): Promise<number> {
  return page.evaluate((t) => Object.keys(JSON.parse(localStorage.getItem(`atrium.db.${t}`) ?? '{}')).length, table)
}

const sectionRow = (page: Page, name: string) => page.getByRole('list', { name: 'Settings sections' }).getByRole('link', { name })

/**
 * Activate a control from the keyboard (focus + Enter). Update toasts from simulated runs finishing
 * at 8× stack over the bottom-right of the stage, where the Data actions sit; the keyboard path is
 * what a keyboard user takes anyway, and toasts never block it.
 */
async function press(locator: Locator) {
  await locator.focus()
  await expect(locator).toBeFocused()
  await locator.press('Enter')
}

/** Type the confirmation word into the open alert dialog and confirm. */
async function typeToConfirm(page: Page, word: string, button: string) {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  const confirm = dialog.getByRole('button', { name: button, exact: true })
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('textbox').fill(word)
  // ⏎ confirms once the typed word matches (§3.10).
  await dialog.getByRole('textbox').press('Enter')
  await expect(dialog).toBeHidden()
}

/** Click Export JSON and return the downloaded file's name and parsed contents. */
async function exportJson(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), press(page.getByRole('button', { name: 'Export JSON' }))])
  const path = await download.path()
  const text = await readFile(path, 'utf8')
  return { name: download.suggestedFilename(), path, text, json: JSON.parse(text) as { app: string; data: Record<string, Record<string, unknown>> } }
}

test.describe('Settings', () => {
  test('switching to the light theme applies at once, confirms inline and survives a reload', async ({ page }) => {
    await open(page, '/settings/appearance')
    await expect(page.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.getByRole('radio', { name: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('#setting-theme')).toContainText('Saved')
    await expect(sectionRow(page, 'Appearance')).toContainText('Light')

    await page.reload()
    await page.waitForSelector('[data-app-ready="true"]')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
  })

  test('Export JSON downloads a real file without API keys', async ({ page }) => {
    await open(page, '/settings/data')
    // Put a key in the local vault, then reload so the app holds it.
    await page.evaluate(() =>
      localStorage.setItem('atrium.secrets', JSON.stringify({ state: { secrets: { anthropic: { apiKey: 'sk-ant-e2e-secret-123' } } }, version: 1 })),
    )
    await page.reload()
    await page.waitForSelector('[data-app-ready="true"]')
    await expect(page.locator('#setting-storage')).toContainText('1 key')

    const file = await exportJson(page)
    expect(file.name).toMatch(/^atrium-export-\d{4}-\d{2}-\d{2}\.json$/)
    expect(file.json.app).toBe('atrium')
    expect(Object.keys(file.json.data.projects).length).toBeGreaterThan(0)
    expect(Object.keys(file.json.data.runs).length).toBeGreaterThan(0)
    expect(file.text).not.toContain('sk-ant-e2e-secret-123')
    await expect(page.getByText('Export downloaded')).toBeVisible()
  })

  test('Reset demo world restores the seeded data after Erase everything', async ({ page }) => {
    await open(page, '/settings/data')
    const seededProjects = await persistedCount(page, 'projects')
    expect(seededProjects).toBeGreaterThan(0)

    await press(page.getByRole('button', { name: 'Erase everything…' }))
    await typeToConfirm(page, 'erase', 'Erase everything')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Everything was erased')).toBeVisible()
    await expect.poll(() => persistedCount(page, 'projects')).toBe(0)

    await open(page, '/settings/data')
    await expect(page.locator('#setting-storage')).toContainText('0 of 20 tables in use')
    await expect(page.getByText('The database is empty.')).toBeVisible()

    await press(page.getByRole('button', { name: 'Reset demo world…' }))
    await typeToConfirm(page, 'reset', 'Reset demo world')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Demo world reset')).toBeVisible()
    await expect.poll(() => persistedCount(page, 'projects')).toBe(seededProjects)
    await expect(page.getByText('Atlas Portal v2').first()).toBeVisible()
  })

  test('Import JSON rejects a stranger file, then restores an export after review', async ({ page }) => {
    await open(page, '/settings/data')
    const file = await exportJson(page)
    const tasks = Object.keys(file.json.data.tasks).length

    await page.locator('[data-testid="import-file"]').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"other"}') })
    await expect(page.getByRole('alert')).toContainText('Couldn’t import “notes.json”')
    await expect(page.getByRole('alert')).toContainText('This isn’t an Atrium export')

    await press(page.getByRole('button', { name: 'Erase everything…' }))
    await typeToConfirm(page, 'erase', 'Erase everything')
    await expect.poll(() => persistedCount(page, 'tasks')).toBe(0)

    await open(page, '/settings/data')
    await page.locator('[data-testid="import-file"]').setInputFiles(file.path)
    const review = page.getByRole('alertdialog', { name: /Replace your data with/ })
    await expect(review).toBeVisible()
    await expect(review.getByRole('list', { name: 'What the file contains' })).toContainText('Tasks')
    await press(review.getByRole('button', { name: 'Replace my data' }))
    await expect(review).toBeHidden()
    await expect(page.getByText(/^Imported “/)).toBeVisible()
    await expect.poll(() => persistedCount(page, 'tasks')).toBe(tasks)
    await expect(page.locator('#setting-storage')).toContainText('20 of 20 tables in use')
  })

  test('Permissions explain the default policy live and Revoke takes back an “Always allow”', async ({ page }) => {
    await open(page, '/settings/permissions')
    // Give Forge an "Always allow" for running commands, as the approval card would.
    await page.evaluate(() => {
      const agents = JSON.parse(localStorage.getItem('atrium.db.agents') ?? '{}') as Record<string, { name: string; capabilities: { capability: string; mode: string; always?: boolean }[] }>
      const forge = Object.values(agents).find((a) => a.name === 'Forge')!
      forge.capabilities = forge.capabilities.map((g) => (g.capability === 'shell.execute' ? { ...g, mode: 'allow', always: true } : g))
      localStorage.setItem('atrium.db.agents', JSON.stringify(agents))
    })
    await page.reload()
    await page.waitForSelector('[data-app-ready="true"]')

    const policy = page.locator('#setting-policy')
    await expect(policy).toContainText('Balanced · asks before 9 of 17')
    await page.getByRole('radio', { name: /Autonomous/ }).click()
    await expect(policy).toContainText('Autonomous · asks before 3 of 17')
    await expect(sectionRow(page, 'Permissions & safety')).toContainText('Autonomous')

    const allowed = page.locator('#setting-always-allow')
    await expect(allowed).toContainText('Forge')
    await press(allowed.getByRole('button', { name: 'Revoke: always allow Forge to run commands' }))
    await expect(page.getByText('Forge will ask before it can run commands')).toBeVisible()
    await expect(allowed).toContainText('No standing permissions')
    await expect
      .poll(() =>
        page.evaluate(() => {
          const agents = JSON.parse(localStorage.getItem('atrium.db.agents') ?? '{}') as Record<string, { name: string; capabilities: { capability: string; mode: string; always?: boolean }[] }>
          return Object.values(agents).find((a) => a.name === 'Forge')!.capabilities.find((g) => g.capability === 'shell.execute')?.mode
        }),
      )
      .toBe('ask')
  })

  test('Find a setting jumps to it, and the budget validates and saves as you type', async ({ page }) => {
    await open(page, '/settings')
    await page.getByPlaceholder('Find a setting').fill('budget')
    await page.getByRole('button', { name: /Monthly budget/ }).click()
    await expect(page).toHaveURL(/\/settings\/budgets#monthly-budget$/)
    const input = page.locator('#setting-monthly-budget input')
    await expect(input).toBeFocused()

    await input.fill('abc')
    await expect(page.locator('#setting-monthly-budget')).toContainText('Enter an amount in dollars')
    await input.fill('80')
    await expect(page.locator('#setting-monthly-budget')).not.toContainText('Enter an amount')
    await page.getByPlaceholder('Find a setting').fill('')
    await expect(sectionRow(page, 'Budgets')).toContainText('$80')
    await expect(page.locator('#setting-month')).toContainText('of $80')
  })

  test('every section opens from the list with its own form', async ({ page }) => {
    await open(page, '/settings')
    const sections = ['Profile', 'Appearance', 'Models', 'Permissions & safety', 'Budgets', 'Notifications', 'Keyboard', 'Simulator', 'Data', 'About']
    for (const name of sections) {
      await sectionRow(page, name).click()
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    }
    await expect(page.getByRole('table', { name: 'What’s real in this build' })).toBeVisible()
    // Old names still lead somewhere.
    await open(page, '/settings/safety')
    await expect(page).toHaveURL(/\/settings\/permissions$/)
  })
})

test.describe('Settings on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the list comes first; a section opens full screen with a way back', async ({ page }) => {
    await open(page, '/settings')
    await expect(page.getByPlaceholder('Find a setting')).toBeVisible()
    await sectionRow(page, 'Notifications').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
    await page.getByRole('switch', { name: /Focus mode/ }).click()
    await expect(page.locator('#setting-focus-mode')).toContainText('Saved')
    await page.getByRole('button', { name: 'Back to the list' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(sectionRow(page, 'Notifications')).toContainText('Focus')
    // No horizontal page scroll at phone width.
    const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
