import type { Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/** Session rows of a table as persisted in this browser (the app writes tables to localStorage). */
async function persisted<T>(page: Page, table: string): Promise<Record<string, T>> {
  return page.evaluate((t) => JSON.parse(localStorage.getItem(`atrium.db.${t}`) ?? '{}'), table)
}

interface SessionRow {
  status: string
  changes: { path: string; review?: string }[]
  turns: { runId?: string }[]
  pr?: { number: number; status: string; simulated: boolean }
}

const stage = (page: Page) => page.locator('[data-region="stage"]')
const changedFiles = (page: Page) => page.getByRole('listbox', { name: 'Changed files' }).getByRole('option')

test.describe('Code', () => {
  // Whole journeys (a simulated turn end to end) on a dev server: allow for a slow, shared machine.
  test.describe.configure({ timeout: 120_000 })

  test('reviews the seeded SSO session: accept both files, then apply to the branch', async ({ page }) => {
    await open(page, '/code')
    await page.getByRole('link', { name: /Fix session expiry after SSO login/ }).first().click()
    await expect(page).toHaveURL(/\/code\/ses_sso/)
    await expect(stage(page).getByRole('heading', { name: 'Fix session expiry after SSO login' })).toBeVisible()
    await expect(stage(page).getByText('Needs review').first()).toBeVisible()

    await stage(page).getByRole('tab', { name: /^Changes/ }).click()
    await expect(changedFiles(page)).toHaveCount(2)
    // Accept the first file; the selection moves on to the next file to review, then accept that one too.
    await changedFiles(page).first().click()
    await stage(page).getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(changedFiles(page).first()).toHaveAttribute('aria-label', /accepted/)
    await expect(changedFiles(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    await stage(page).getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(changedFiles(page).nth(1)).toHaveAttribute('aria-label', /accepted/)
    await expect(page.getByRole('region', { name: 'Review decision' })).toContainText('2 files · +40 −7 · 2 accepted')

    // Apply (the review bar's ▾ menu): approved, simulated, no pull request.
    await page.getByRole('button', { name: 'More review actions' }).click()
    await page.getByRole('menuitem', { name: /Apply to branch only/ }).click()
    await expect(stage(page).locator('header').getByText('Approved', { exact: true })).toBeVisible()
    // Persistence is batched: poll the stored rows.
    await expect.poll(async () => (await persisted<SessionRow>(page, 'sessions')).ses_sso.status).toBe('approved')
    const sessions = await persisted<SessionRow>(page, 'sessions')
    expect(sessions.ses_sso.changes.every((c) => c.review === 'accepted')).toBe(true)
    // The linked task follows the session.
    await expect.poll(async () => (await persisted<{ status: string }>(page, 'tasks')).tsk_sso_fix.status).toBe('done')
  })

  test('starts a session on the demo repo: steps stream, a command asks first, then it needs review', async ({ page }) => {
    await open(page, '/code')
    const composer = page.locator('#main [data-composer-input]').first()
    await composer.fill('Add input validation to the invoice total formatting')
    await composer.press('Enter')
    await expect(page).toHaveURL(/\/code\/ses_[a-z0-9]+/)
    const sessionId = new URL(page.url()).pathname.split('/')[2]

    // Steps stream into the activity timeline.
    const steps = page.locator('ol[aria-label^="Steps of"] li[data-step-id]')
    await expect(steps.first()).toBeVisible()
    await expect.poll(async () => steps.count(), { timeout: 20_000 }).toBeGreaterThan(2)

    // Running the tests is gated: an inline approval card for the command appears.
    const card = page.getByRole('article', { name: /^Approval: Forge wants to run/ })
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toContainText('npm test')
    await card.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(card).toContainText(/Approved by you/)

    // The turn finishes: Needs review, with changes to review and simulated checks.
    await expect(stage(page).getByText('Needs review').first()).toBeVisible({ timeout: 40_000 })
    await expect(changedFiles(page).first()).toBeVisible()
    expect(await changedFiles(page).count()).toBeGreaterThan(0)
    await expect.poll(async () => (await persisted<SessionRow>(page, 'sessions'))[sessionId]?.status).toBe('needs_review')
    const sessions = await persisted<SessionRow>(page, 'sessions')
    expect(sessions[sessionId].changes.length).toBeGreaterThan(0)
    await expect(page.getByText('No model was called').first()).toBeVisible()
  })

  test('the repo explorer opens src/auth/session.ts and starts a session about it', async ({ page }) => {
    await open(page, '/code/repos/rep_atlas')
    await expect(stage(page).getByRole('heading', { name: 'northwind/atlas-portal' })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Filter files by name' }).fill('session')
    const tree = page.getByRole('tree', { name: /Files in northwind\/atlas-portal/ })
    await tree.getByRole('treeitem', { name: 'session.ts', exact: true }).click()
    await expect(page).toHaveURL(/path=src%2Fauth%2Fsession\.ts/)
    await expect(stage(page).getByText('export function startSession').first()).toBeVisible()
    await expect(stage(page).getByText(/\d+ lines/).first()).toBeVisible()

    await page.getByRole('button', { name: 'Start a session about this file' }).click()
    await expect(page).toHaveURL(/\/code\/new\?repo=rep_atlas&path=src%2Fauth%2Fsession\.ts/)
    await expect(page.getByRole('textbox', { name: 'Instruction' })).toHaveValue('In src/auth/session.ts: ')
  })

  test('Approve & open PR is one decision: confirm once, the pull request (simulated) opens with no second card', async ({ page }) => {
    await open(page, '/code/ses_sso/changes')
    await page.getByRole('button', { name: 'Accept all' }).click()
    await page.getByRole('button', { name: 'Approve & open PR (simulated)' }).click()
    await page.getByRole('button', { name: 'Confirm: open PR (simulated)' }).click()
    await expect(page.getByRole('region', { name: 'Review decision' })).toContainText(/Pull request #\d+ \(simulated\) is open/, { timeout: 30_000 })
    type ApprovalRow = { status: string; capability: string; resolution?: { note?: string } }
    const confirmed = async () =>
      Object.values(await persisted<ApprovalRow>(page, 'approvals')).filter((a) => a.capability === 'repo.pull_request' && a.resolution?.note === 'Confirmed in review').length
    await expect.poll(confirmed).toBe(1)
    const approvals = await persisted<ApprovalRow>(page, 'approvals')
    expect(Object.values(approvals).some((a) => a.capability === 'repo.pull_request' && a.status === 'pending')).toBe(false)
    await page.getByRole('button', { name: 'Merge (simulated)' }).click()
    await expect(page.getByRole('region', { name: 'Review decision' })).toContainText(/Merged pull request #\d+ \(simulated\)/)
  })

  test('connects a GitHub repository live (GitHub mocked) and reads a file from it', async ({ page }) => {
    await page.route('https://api.github.com/**', async (route) => {
      const url = new URL(route.request().url())
      const headers = { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '52', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800), 'x-ratelimit-resource': 'core', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-ratelimit-resource' }
      if (url.pathname === '/rate_limit') return route.fulfill({ json: { resources: { core: { limit: 60, remaining: 52, reset: Math.floor(Date.now() / 1000) + 1800 } } }, headers })
      if (url.pathname === '/repos/octo/widgets') {
        return route.fulfill({ json: { name: 'widgets', full_name: 'octo/widgets', owner: { login: 'octo' }, default_branch: 'main', description: 'Widgets for tests', language: 'TypeScript', stargazers_count: 7, html_url: 'https://github.com/octo/widgets', private: false }, headers })
      }
      if (url.pathname.startsWith('/repos/octo/widgets/git/trees/main')) {
        return route.fulfill({ json: { truncated: false, tree: [{ path: 'src', type: 'tree' }, { path: 'src/widget.ts', type: 'blob', size: 64 }, { path: 'README.md', type: 'blob', size: 20 }] }, headers })
      }
      return route.fulfill({ status: 200, json: {}, headers })
    })
    await page.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({ body: 'export const widget = 1\nexport const size = 2\n', contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' } }))

    await open(page, '/code')
    await stage(page).getByRole('button', { name: 'Connect repository' }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect a repository' })
    await expect(dialog).toContainText('52/60 requests left this hour', { timeout: 20_000 })
    await dialog.getByRole('textbox', { name: 'GitHub repository' }).fill('https://github.com/octo/widgets')
    await dialog.getByRole('button', { name: 'Connect' }).click()
    await expect(page).toHaveURL(/\/code\/repos\/rep_/)
    await expect(stage(page).getByRole('heading', { name: 'octo/widgets' })).toBeVisible()
    await page.getByRole('tree', { name: /Files in octo\/widgets/ }).getByRole('treeitem', { name: 'widget.ts' }).click()
    await expect(stage(page).getByText('export const widget = 1').first()).toBeVisible()
    await expect(page.getByRole('list', { name: 'Repositories and sessions' })).toContainText('octo/widgets')
  })
})
