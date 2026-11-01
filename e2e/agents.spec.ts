import type { Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/** Rows of a persisted table (the app writes each table to localStorage, debounced). */
async function persisted<T>(page: Page, table: string): Promise<Record<string, T>> {
  return page.evaluate((t) => JSON.parse(localStorage.getItem(`atrium.db.${t}`) ?? '{}'), table)
}

/** Open an Agents route and wait for its stage (the first visit compiles the workspace on a cold dev server). */
async function openAgents(page: Page, path: string): Promise<void> {
  await open(page, path)
  await expect(page.locator('#main [data-region="stage"] h1').first()).toBeVisible({ timeout: 45_000 })
}

interface RunRow {
  id: string
  status: string
  agentId?: string
  steps: { status: string }[]
}

test.describe('Agents', () => {
  // The first visit compiles the workspace on a cold dev server; runs are simulated at 8× speed.
  test.describe.configure({ timeout: 120_000 })

  test('the run board bands every run; ?status=waiting shows only runs waiting on you', async ({ page }) => {
    await openAgents(page, '/agents')
    await expect(page.getByRole('heading', { name: 'All runs', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Needs you', exact: true })).toBeVisible()
    // The execution history is there too.
    await expect(page.getByRole('heading', { name: 'Earlier', exact: true })).toBeVisible()

    await openAgents(page, '/agents?status=waiting')
    const board = page.locator('[data-band]')
    await expect(board).toHaveCount(1)
    await expect(page.locator('[data-band="needs"] [data-run-row]')).toHaveCount(2)
    await expect(page.getByRole('article', { name: /^Approval: Herald wants to post weekly digest/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Status: Needs you/ })).toBeVisible()
  })

  test('approving Herald’s Slack post lets the run continue to success', async ({ page }) => {
    await openAgents(page, '/agents?status=waiting')
    const card = page.getByRole('article', { name: /^Approval: Herald wants to post weekly digest/ })
    await expect(card).toBeVisible()
    // High risk: the first press arms “Confirm approve”, the second approves.
    await card.getByRole('button', { name: 'Approve', exact: true }).click()
    await card.getByRole('button', { name: 'Confirm approve' }).click()
    await expect
      .poll(async () => (await persisted<RunRow>(page, 'runs'))['run_seed_herald_digest']?.status, { timeout: 20_000 })
      .toBe('succeeded')
    // It left Needs you; the run detail shows the result.
    await expect(page.locator('[data-run-row="run_seed_herald_digest"]')).toHaveCount(0)
    await openAgents(page, '/agents/agt_herald?run=run_seed_herald_digest')
    await expect(page.getByRole('heading', { name: 'Send weekly project digest', level: 2 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible()
    await expect(page.getByText('Approved by you', { exact: false }).first()).toBeVisible()
  })

  test('create an agent from a template and run it: the run appears live and completes', async ({ page }) => {
    await openAgents(page, '/agents/new')
    await page.getByRole('button', { name: /^Research analyst/ }).click()
    await expect(page.getByLabel('Name')).toHaveValue('Iris')
    await page.getByLabel('Name').fill('Iris Test')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Abilities', level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Brief', level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    // Review reads the effective policy back before anything exists.
    await expect(page.getByRole('heading', { name: 'Review', level: 2 })).toBeVisible()
    await expect(page.getByLabel('Read back')).toContainText('no model is called')
    await expect(page.getByLabel('Read back')).toContainText('Search the web')
    await page.getByRole('button', { name: 'Create agent' }).click()

    await expect(page).toHaveURL(/\/agents\/agt_[a-z0-9]+$/)
    const agentId = new URL(page.url()).pathname.split('/').pop()!
    await expect(page.getByRole('heading', { name: 'Iris Test', level: 1 })).toBeVisible({ timeout: 45_000 })
    // Its first instruction is ready in the composer.
    const composer = page.locator('#main [data-composer-input]').first()
    await expect(composer).toHaveValue(/analytics add-ons/)
    await composer.press('Enter')

    // The run appears live in Now…
    const live = page.getByRole('article', { name: /^Run: Summarize how mid-market logistics portals/ })
    await expect(live).toBeVisible()
    // …and completes.
    await expect
      .poll(async () => Object.values(await persisted<RunRow>(page, 'runs')).find((r) => r.agentId === agentId)?.status, { timeout: 30_000 })
      .toBe('succeeded')
    await expect(page.getByText('Its last run:')).toBeVisible()
    const runs = Object.values(await persisted<RunRow>(page, 'runs')).filter((r) => r.agentId === agentId)
    expect(runs).toHaveLength(1)
    expect(runs[0].steps.every((s) => s.status === 'done')).toBe(true)
  })

  test('pausing an agent disables Run now; resuming enables it', async ({ page }) => {
    await openAgents(page, '/agents/agt_scout')
    const runNow = page.getByRole('button', { name: 'Run now' })
    await expect(runNow).toBeEnabled()
    await page.getByRole('switch', { name: /Scout is active/ }).click()
    await expect(runNow).toBeDisabled()
    await expect(page.getByText('Scout is paused and takes no new work.')).toBeVisible()
    await expect.poll(async () => (await persisted<{ status: string }>(page, 'agents'))['agt_scout']?.status).toBe('paused')
    await page.getByRole('switch', { name: /Scout is paused/ }).click()
    await expect(runNow).toBeEnabled()
  })

  test('a capability grant can be set to deny, and the policy follows', async ({ page }) => {
    await openAgents(page, '/agents/agt_herald/configure')
    const row = page.locator('[data-ability="messages.send"]')
    await expect(row.getByText('Asks you first')).toBeVisible()
    await page.getByRole('radiogroup', { name: 'Access for Send messages' }).getByRole('radio', { name: 'Deny' }).click()
    await expect(row.getByText('Blocked')).toBeVisible()
    await expect
      .poll(async () => (await persisted<{ capabilities: { capability: string; mode: string }[] }>(page, 'agents'))['agt_herald']?.capabilities.find((g) => g.capability === 'messages.send')?.mode)
      .toBe('deny')
  })

  test('the roster shows the fleet: status counts, the live Now strip and cards', async ({ page }) => {
    await openAgents(page, '/agents/roster')
    const fleet = page.getByRole('radiogroup', { name: 'Fleet status' })
    await expect(fleet.getByRole('radio', { name: /Needs you\s*2/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Now', exact: true })).toBeVisible()
    await expect(page.getByRole('article', { name: 'Herald, Communications' })).toBeVisible()
    await fleet.getByRole('radio', { name: /Paused/ }).click()
    await expect(page).toHaveURL(/status=paused/)
    await expect(page.getByRole('article', { name: /^Archivist/ })).toBeVisible()
    await expect(page.getByRole('article', { name: 'Herald, Communications' })).toHaveCount(0)
  })
})
