import type { Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/** The hero composer's input (the shell's `/` focuses it too). */
const composer = (page: Page) => page.locator('#main [data-composer-input]').first()
const needsYou = (page: Page) => page.locator('section[aria-labelledby="home-needs-you"]')

/** Messages of a thread as persisted in this browser (the app writes tables to localStorage). */
async function persistedMessages(page: Page, threadId: string) {
  return page.evaluate((id) => {
    const raw = localStorage.getItem('atrium.db.messages')
    const rows = raw ? (Object.values(JSON.parse(raw)) as { threadId: string; role: string; status: string; simulated?: boolean }[]) : []
    return rows.filter((m) => m.threadId === id)
  }, threadId)
}

test.describe('Home', () => {
  test('renders the status line and the state sentence', async ({ page }) => {
    await open(page, '/')
    const status = page.getByLabel('Status')
    await expect(status).toContainText(/running/i)
    await expect(status).toContainText(/need you/i)
    await expect(status).toContainText(/today/i)
    // The seeded world has requests waiting: the sentence is derived from data.
    await expect(page.getByTestId('home-sentence')).toHaveText(/things are waiting on you|is waiting on you/)
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'In flight' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  })

  test('Needs you shows the two seeded approvals; approving one removes it and updates the badge', async ({ page }) => {
    await open(page, '/')
    const section = needsYou(page)
    const cards = section.getByRole('article', { name: /^Approval:/ })
    await expect(cards).toHaveCount(2)
    const badge = page.getByRole('button', { name: /^Needs you: \d+$/ })
    const before = Number((await badge.getAttribute('aria-label'))?.match(/\d+/)?.[0])
    // The medium-risk command approves on the first press (high risk needs a second one).
    const forge = cards.filter({ hasText: 'npm install' })
    await forge.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(section.getByRole('article', { name: /^Approval:/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: `Needs you: ${before - 1}` })).toBeVisible()
  })

  /** Ask from Home; returns the new thread id once the simulated answer has completed. */
  async function askFromHome(page: Page): Promise<string> {
    await open(page, '/')
    await composer(page).fill('What is our refund policy for annual plans?')
    await expect(page.getByText('Reads as a question')).toBeVisible()
    await composer(page).press('Enter')
    await expect(page).toHaveURL(/\/chat\/thr_[a-z0-9]+/)
    const threadId = new URL(page.url()).pathname.split('/').pop()!
    // The answer streams from the local simulator and completes.
    await expect
      .poll(async () => (await persistedMessages(page, threadId)).find((m) => m.role === 'assistant')?.status, { timeout: 20_000 })
      .toBe('complete')
    return threadId
  }

  test('Ask from the hero composer lands in /chat/<id>; the simulated answer completes', async ({ page }) => {
    const threadId = await askFromHome(page)
    const answer = (await persistedMessages(page, threadId)).find((m) => m.role === 'assistant')
    expect(answer?.simulated).toBe(true)
  })

  test('the asked answer shows its SIM Colophon in the transcript', async ({ page }) => {
    await askFromHome(page)
    // Needs the Chat workspace's transcript (it docks a composer); skipped while Chat is a placeholder.
    const chatBuilt = (await page.locator('#main [data-composer-input]').count()) > 0
    test.skip(!chatBuilt, 'The Chat workspace does not render transcripts yet')
    await expect(page.getByText('No model was called').first()).toBeVisible()
  })

  test('Research opens the Start sheet prefilled; Start creates an investigation', async ({ page }) => {
    await open(page, '/')
    await page.getByRole('radio', { name: 'Research', exact: true }).click()
    const question = 'What are the failure modes of Stripe webhook retries during migration?'
    await composer(page).fill(question)
    await composer(page).press('Enter')
    const sheet = page.getByRole('dialog', { name: 'Start' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name: 'New research' })).toBeVisible()
    await expect(sheet.getByLabel('Question')).toHaveValue(question)
    await expect(sheet.getByRole('radio', { name: 'Research' })).toHaveAttribute('aria-checked', 'true')
    // The ReadBack reads the plan back before anything runs.
    await expect(sheet.getByRole('region', { name: 'Read back' })).toContainText('no model is called')
    await sheet.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(page).toHaveURL(/\/research\/inv_[a-z0-9]+/)
  })

  test('⌘⏎ starts in the background and shows the toast', async ({ page }) => {
    await open(page, '/')
    await page.getByRole('radio', { name: 'Ask', exact: true }).click()
    await composer(page).fill('Summarize the Atlas Lumen PRD in three bullets')
    await composer(page).press('Control+Enter')
    await expect(page.getByText(/^Started in background · RUN-[A-Z0-9]{4}$/)).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    // The draft was sent: the composer is empty again.
    await expect(composer(page)).toHaveValue('')
  })

  test('first run shows the boot log and can be dismissed', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('e2e.first-run')) return
      sessionStorage.setItem('e2e.first-run', '1')
      const raw = localStorage.getItem('atrium.settings')
      const s = raw ? JSON.parse(raw) : { state: { settings: {} }, version: 1 }
      s.state.settings.onboarded = false
      localStorage.setItem('atrium.settings', JSON.stringify(s))
    })
    await open(page, '/')
    const welcome = page.getByRole('region', { name: 'Welcome to Atrium' })
    await expect(welcome).toBeVisible()
    await expect(welcome.getByLabel('Boot log')).toContainText(/knowledge · \d+ items indexed/)
    await expect(welcome.getByLabel('Boot log')).toContainText('simulator ready')
    await expect(welcome.getByText('Projects scope')).toBeVisible()
    await expect(welcome.getByText('Run in background')).toBeVisible()
    await welcome.getByRole('button', { name: 'Got it' }).click()
    await expect(welcome).toBeHidden()
    await page.reload()
    await page.waitForSelector('[data-app-ready="true"]')
    await expect(page.getByTestId('home-sentence')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Welcome to Atrium' })).toBeHidden()
  })
})
