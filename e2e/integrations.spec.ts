import type { Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/**
 * Integrations (docs/DESIGN.md §6.11): the catalog, connecting a simulated service, governing what
 * agents may do with it, disconnecting through the ReadBack confirm, and the Anthropic key form —
 * which validates locally and never calls the network in tests.
 */

/**
 * Client-side navigations can commit late while simulated runs stream (router updates are React
 * transitions); assertions that follow a navigation get extra room.
 */
const afterNav = expect.configure({ timeout: 15_000 })

const header = (page: Page) => page.locator('[data-region="stage"] > header').first()
const statusChip = (page: Page) => header(page).locator('[data-status]')

/** Persisted connection row (the app writes tables to localStorage). */
async function connectionRow(page: Page, id: string) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem('atrium.db.connections')
    return raw ? (JSON.parse(raw) as Record<string, { status: string; scopes: { capability: string; mode: string }[] }>)[key] : undefined
  }, id)
}

async function disconnectWithConfirm(page: Page, name: string) {
  await page.getByRole('button', { name: `Disconnect ${name}`, exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: `Disconnect ${name}?` })
  await expect(dialog).toBeVisible()
  // Cancel is the default focus for a destructive confirm.
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test.describe('Integrations', () => {
  test('the catalog leads with AI models, then Connected, with honest LIVE / SIMULATED badges', async ({ page }) => {
    await open(page, '/integrations')
    const sections = page.locator('#main section[aria-labelledby^="integrations-"] h2')
    await expect(sections.first()).toHaveText('AI models')
    await expect(sections.nth(1)).toHaveText('Connected')

    const simulator = page.locator('[data-card="simulator"]')
    await expect(simulator).toContainText('Always on')
    await expect(simulator).toContainText('SIMULATED')
    await expect(page.locator('[data-card="anthropic"]')).toContainText('LIVE')
    await expect(page.locator('[data-card="anthropic"]')).toContainText('Not connected')
    // Seeded: Jira's token expired; it is listed first among the connected.
    await expect(page.locator('#main section[aria-labelledby="integrations-connected"] [data-card]').first()).toHaveAttribute('data-card', 'jira')
    await expect(page.locator('[data-card="jira"]')).toContainText('Error')
    await expect(page.locator('[data-card="github"]')).toContainText(/\d+ uses/)

    // Search narrows every section.
    await page.getByLabel('Search integrations').fill('send messages')
    await expect(page.locator('[data-card]')).toHaveCount(2)
    await expect(page.locator('[data-card="slack"]')).toBeVisible()
    await expect(page.locator('[data-card="gmail"]')).toBeVisible()
    await page.getByLabel('Search integrations').fill('zzzz')
    await expect(page.getByText('No integrations match “zzzz”')).toBeVisible()
    await page.getByRole('button', { name: 'Show every integration' }).click()
    await expect(page.locator('[data-card="simulator"]')).toBeVisible()

    // The list pane filters by category.
    await page.getByRole('list', { name: 'Integration filters' }).getByRole('link', { name: /^Communication/ }).click()
    await expect(page).toHaveURL(/\/integrations\?category=communication$/)
    await afterNav(page.getByRole('heading', { level: 1, name: 'Communication' })).toBeVisible()
    await afterNav(page.locator('[data-card]')).toHaveCount(3)
  })

  test('connect Slack (simulated), set Send messages to deny, disconnect with confirm', async ({ page }) => {
    await open(page, '/integrations/slack')
    await expect(page.getByRole('heading', { level: 1, name: 'Slack' })).toBeVisible()
    await expect(page.getByText('Simulated — nothing leaves your browser.').first()).toBeVisible()

    // The seeded world has Slack connected: disconnect first. The ReadBack lists who loses it.
    await expect(statusChip(page)).toHaveAttribute('data-status', 'connected')
    await page.getByRole('button', { name: 'Disconnect Slack', exact: true }).click()
    const readBack = page.getByRole('alertdialog', { name: 'Disconnect Slack?' })
    await expect(readBack.getByLabel('What changes')).toContainText('Herald')
    await expect(readBack.getByLabel('What changes')).toContainText('blocked')
    // Cancel keeps it connected.
    await readBack.getByRole('button', { name: 'Cancel' }).click()
    await expect(statusChip(page)).toHaveAttribute('data-status', 'connected')
    await disconnectWithConfirm(page, 'Slack')
    await expect(statusChip(page)).toHaveAttribute('data-status', 'disconnected')

    // Connect (simulated): a short local handshake, then Connected.
    await page.getByRole('button', { name: 'Connect Slack', exact: true }).click()
    await expect(statusChip(page)).toHaveAttribute('data-status', 'connected')
    await expect(statusChip(page)).toHaveText('Connected')
    await expect(page.getByText('Slack connected (simulated)')).toBeVisible()

    // Govern it: Send messages → Deny (saved instantly and persisted).
    const policy = page.getByRole('radiogroup', { name: 'Send messages through Slack' })
    await policy.getByRole('radio', { name: 'Deny' }).click()
    await expect(policy.getByRole('radio', { name: 'Deny' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('Blocked. Runs that try to send messages through Slack stop at that step.')).toBeVisible()
    await expect.poll(async () => (await connectionRow(page, 'slack'))?.scopes.find((s) => s.capability === 'messages.send')?.mode).toBe('deny')

    // A simulated test is labeled simulated.
    await page.getByRole('button', { name: 'Test connection' }).click()
    await expect(page.getByRole('status').getByText('Simulated connection is responding')).toBeVisible()

    await disconnectWithConfirm(page, 'Slack')
    await expect(statusChip(page)).toHaveAttribute('data-status', 'disconnected')
    await expect.poll(async () => (await connectionRow(page, 'slack'))?.status).toBe('disconnected')
    // History is kept: the activity log tells the story.
    await expect(page.getByRole('list', { name: 'Activity' })).toContainText('set “Send messages” to Deny')
  })

  test('the Anthropic form rejects a malformed key without calling the network', async ({ page }) => {
    const external: string[] = []
    page.on('request', (r) => {
      if (!r.url().startsWith('http://localhost')) external.push(r.url())
    })
    await open(page, '/integrations/anthropic')
    await expect(page.getByText('Your key is stored only in this browser and sent directly to Anthropic.', { exact: false })).toBeVisible()
    const key = page.getByLabel('API key', { exact: true })
    await expect(key).toHaveAttribute('type', 'password')
    await key.fill('not-a-real-key')
    await page.getByRole('button', { name: 'Save key and connect' }).click()
    await expect(page.getByText('Anthropic API keys start with “sk-ant-”.', { exact: false })).toBeVisible()
    await expect(key).toHaveAttribute('aria-invalid', 'true')
    await expect(statusChip(page)).toHaveAttribute('data-status', 'available')
    expect(await page.evaluate(() => localStorage.getItem('atrium.secrets') ?? '')).not.toContain('not-a-real-key')

    // Fixing it clears the error as you type.
    await key.fill('sk-ant-api03-e2e-0000')
    await expect(page.getByText('Anthropic API keys start with', { exact: false })).toBeHidden()
    expect(external.filter((u) => u.includes('anthropic'))).toEqual([])
  })

  test('connecting Anthropic enables Claude models in every model picker at once (no request is made)', async ({ page }) => {
    const external: string[] = []
    page.on('request', (r) => {
      if (!r.url().startsWith('http://localhost')) external.push(r.url())
    })
    await open(page, '/integrations/anthropic')
    await page.getByLabel('API key', { exact: true }).fill('sk-ant-api03-e2e-0000')
    await page.getByRole('button', { name: 'Save key and connect' }).click()
    await expect(statusChip(page)).toHaveAttribute('data-status', 'connected')
    await expect(page.getByText('Connected as API key …0000')).toBeVisible()
    // The key is never displayed in full.
    await expect(page.getByText('sk-ant-api03-e2e-0000')).toHaveCount(0)

    await page.getByRole('button', { name: /^Default model/ }).click()
    const opus = page.getByRole('radio', { name: /Claude Opus 5\.5/ })
    await expect(opus).toBeVisible()
    await expect(opus).not.toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    expect(external).toEqual([])

    // Disconnecting removes the key from this browser.
    await disconnectWithConfirm(page, 'Anthropic')
    await expect(statusChip(page)).toHaveAttribute('data-status', 'disconnected')
    expect(await page.evaluate(() => localStorage.getItem('atrium.secrets') ?? '')).not.toContain('sk-ant-api03-e2e-0000')
  })

  test('cards move with the arrow keys and Space inspects one', async ({ page }) => {
    await open(page, '/integrations')
    const first = page.locator('[data-card="simulator"]')
    await first.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('[data-card="anthropic"]')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(first).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press(' ')
    await expect(page).toHaveURL(/inspect=integration%3Aanthropic/)
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await afterNav(inspector.getByRole('heading', { name: 'Anthropic' })).toBeVisible()
    await expect(inspector.getByText('Not connected').first()).toBeVisible()
    await inspector.getByRole('button', { name: 'Manage' }).click()
    await expect(page).toHaveURL(/\/integrations\/anthropic/)
    await afterNav(page.getByRole('heading', { level: 1, name: 'Anthropic' })).toBeVisible()
  })

  test('Jira’s expired token shows the error, the fix, and reconnects', async ({ page }) => {
    await open(page, '/integrations/jira')
    await expect(statusChip(page)).toHaveAttribute('data-status', 'error')
    await expect(page.getByText('Jira reported an error')).toBeVisible()
    await page.getByRole('button', { name: 'Test connection' }).click()
    await expect(page.getByRole('status').getByText('Reconnect Jira to get a new simulated token.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Reconnect' }).first().click()
    await expect(statusChip(page)).toHaveAttribute('data-status', 'connected')
  })
})
