import type { Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/**
 * Research (§6.5): start an investigation from the brief, watch sources stream in, read the report,
 * save it to Knowledge (the knowledge item links back), and follow a citation in a seeded report.
 */

const QUESTION = 'How are mid-market freight forwarders adopting customer portals?'

const inspector = (page: Page) => page.locator('[data-region="inspector"]').first()

/** Rows of a persisted table (the app writes each table to localStorage). */
async function persisted<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate((t) => {
    const raw = localStorage.getItem(`atrium.db.${t}`)
    return raw ? (Object.values(JSON.parse(raw)) as T[]) : []
  }, table)
}

/** Fill the brief and start a standard investigation; returns its id. */
async function startInvestigation(page: Page): Promise<string> {
  await open(page, '/research/new')
  const question = page.getByRole('textbox', { name: 'Research question' })
  await expect(question).toBeFocused()
  await question.fill(QUESTION)
  // The brief reads back the plan before anything runs: depth expectations, angles, honest sources.
  await page.getByRole('radio', { name: 'Quick', exact: true }).click()
  await expect(page.getByText('One combined search and a short synthesis')).toBeVisible()
  await page.getByRole('radio', { name: 'Standard', exact: true }).click()
  await expect(page.getByText('A search per angle, then a cited report')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Angles' }).or(page.getByRole('list', { name: 'Angles' }))).toBeVisible()
  await expect(page.getByText('Web results are simulated in this build.').first()).toBeVisible()
  await question.press('Enter')
  await expect(page).toHaveURL(/\/research\/inv_[a-z0-9]+$/)
  return new URL(page.url()).pathname.split('/').pop()!
}

test.describe('Research · live run', () => {
  // Slow enough to watch the sources arrive (a standard run takes ~12 s at 2×).
  test.use({ simSpeed: 2 })

  test('start an investigation → sources stream in → report → Save to Knowledge → backlink', async ({ page }) => {
    test.setTimeout(90_000)
    const id = await startInvestigation(page)

    // Live: the frontier strip shows the run, and sources appear on the board as Scout finds them.
    await expect(page.getByRole('region', { name: 'Research in progress' })).toBeVisible()
    const sources = page.getByRole('list', { name: 'Sources' })
    await expect.poll(async () => sources.getByRole('listitem').count(), { timeout: 30_000 }).toBeGreaterThan(0)
    // Simulated web sources are labeled as such on the board.
    await expect(sources.getByRole('img', { name: /^Simulated web result/ }).first()).toBeVisible({ timeout: 30_000 })

    // The report lands in place of the board, with the simulated-sources banner and citations.
    const report = page.getByRole('article', { name: 'Report' })
    await expect(report).toBeVisible({ timeout: 45_000 })
    await expect(report.getByText(/^Cites \d+ simulated sources? — not fetched from the web\.$/)).toBeVisible()
    await expect(report.getByRole('heading', { name: 'Executive summary' })).toBeVisible()
    await expect(page.getByText('Ready for review').first()).toBeVisible()

    // Save to Knowledge (idempotent): the button turns into a link to the saved item.
    await report.getByRole('button', { name: 'Save to Knowledge' }).click()
    await expect(page.getByText('Saved to Knowledge').first()).toBeVisible()
    await expect(report.getByRole('button', { name: /^In Knowledge/ })).toBeVisible()
    type Item = { id: string; source: { ref?: { kind: string; id: string } } }
    const savedFrom = async () => (await persisted<Item>(page, 'knowledge')).filter((k) => k.source.ref?.kind === 'investigation' && k.source.ref.id === id)
    await expect.poll(async () => (await savedFrom()).length).toBe(1)
    // A second press opens the saved item instead of saving another copy.
    const saved = await savedFrom()

    // The knowledge item links back to the investigation (Inspector › Item › Links › Came from).
    await page.goto(`/research/${id}?inspect=knowledge:${saved[0].id}`)
    await page.waitForSelector('[data-app-ready="true"]')
    const links = inspector(page).getByRole('region', { name: 'Links' })
    await expect(links).toBeVisible()
    await expect(links.getByText('Came from')).toBeVisible()
    await expect(links.getByRole('link', { name: /How are mid-market freight forwarders/ }).first()).toBeVisible()

    // The investigation lists what it led to.
    await page.goto(`/research/${id}`)
    await page.waitForSelector('[data-app-ready="true"]')
    await expect(page.getByRole('region', { name: 'Led to' })).toContainText('Knowledge')
  })
})

test.describe('Research', () => {
  test('open the seeded complete investigation and click a citation', async ({ page }) => {
    await open(page, '/research/inv_tidewell')
    const report = page.getByRole('article', { name: 'Report' })
    await expect(report.getByRole('heading', { name: 'Executive summary' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /Who does Tidewell sell to/ })).toBeVisible()
    await expect(report.getByText('Cites 8 simulated sources — not fetched from the web.')).toBeVisible()

    // [3] is Tidewell's (simulated) pricing page: clicking it opens the source in Inspector › Item.
    await report.getByRole('button', { name: /^Source 3: Pricing — Tidewell/ }).first().click()
    await expect(page).toHaveURL(/[?&]source=src_tidewell_3/)
    const panel = inspector(page)
    await expect(panel.getByRole('heading', { name: 'Pricing — Tidewell' })).toBeVisible()
    await expect(panel.getByText('Simulated web result').first()).toBeVisible()
    await expect(panel.getByRole('meter', { name: 'Credibility' })).toBeVisible()

    // [1] comes from your knowledge base, and says so.
    await report.getByRole('button', { name: /^Source 1: Freightly product notes/ }).first().click()
    await expect(panel.getByRole('heading', { name: 'Freightly product notes' })).toBeVisible()
    await expect(panel.getByText('Your knowledge').first()).toBeVisible()
  })

  test('sources can be filtered, discarded and restored; findings can be pinned', async ({ page }) => {
    await open(page, '/research/inv_tidewell/sources')
    const list = page.getByRole('list', { name: 'Sources' })
    await expect(list.getByRole('listitem')).toHaveCount(10)
    await page.getByRole('button', { name: /^Discard “Analyst note: customer portals in freight”/ }).click()
    await expect(page.getByText(/^Discarded “Analyst note/)).toBeVisible()
    await expect(list.getByRole('listitem')).toHaveCount(9)
    await page.getByRole('tab', { name: /^Discarded/ }).click()
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await page.getByRole('button', { name: /^Restore “Analyst note/ }).click()
    await expect(page.getByText('No sources match these filters.')).toBeVisible()

    await page.getByRole('tab', { name: /^Findings/ }).first().click()
    await expect(page).toHaveURL(/\/research\/inv_tidewell\/findings/)
    const findings = page.getByRole('list', { name: 'Findings' })
    await expect(findings.getByRole('listitem')).toHaveCount(6)
    await expect(findings.getByRole('button', { name: 'Unpin this finding' })).toHaveCount(2)
    await findings.getByRole('button', { name: /^Pin this finding/ }).first().click()
    await expect(findings.getByRole('button', { name: 'Unpin this finding' })).toHaveCount(3)
  })

  test('export downloads Markdown with the simulated notice; delete asks first', async ({ page }) => {
    await open(page, '/research/inv_churn')
    const report = page.getByRole('article', { name: 'Report' })
    await expect(report).toBeVisible()
    const download = page.waitForEvent('download')
    await report.getByRole('button', { name: 'Export .md' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('why-do-logistics-customers-churn.md')
    const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'))
    expect(text.split('\n')[0]).toMatch(/^> \*\*Simulated content\.\*\* Generated by Atrium's local simulator on /)

    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: /Delete investigation/ }).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await expect(dialog.getByText(/Delete “Why do logistics customers churn\?”/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect(page).toHaveURL(/\/research$/)
    await expect(page.getByRole('link', { name: /Why do logistics customers churn/ })).toHaveCount(0)
  })
})
