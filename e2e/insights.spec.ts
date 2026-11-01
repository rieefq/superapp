import type { Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/** The Overview's run count (the KPI figure is rendered from the same number). */
const overview = (page: Page) => page.getByTestId('insights-overview')
const runCount = async (page: Page) => Number(await overview(page).getAttribute('data-runs'))
const kpi = (page: Page, label: RegExp) => page.getByRole('region', { name: 'Key figures' }).getByRole('link', { name: label })
/** A figure card on the Overview (the Run Line is also a region named "Runs", so scope to the page). */
const card = (page: Page, name: string) => overview(page).getByRole('region', { name, exact: true })

test.describe('Insights', () => {
  test('renders the tiles, the four figures and the tables without errors', async ({ page }) => {
    await open(page, '/insights')
    await expect(overview(page)).toBeVisible()
    const figures = page.getByRole('region', { name: 'Key figures' })
    for (const label of ['Runs', 'Success rate', 'Waited on you', 'Spend · this month', 'Tokens', 'Median run', 'Tasks completed']) {
      await expect(figures.getByText(label, { exact: true })).toBeVisible()
    }
    const runs = await runCount(page)
    expect(runs).toBeGreaterThan(5)
    await expect(kpi(page, /^Runs: \d+/)).toContainText(String(runs))
    // Honesty: the seeded world is simulated, so costs are estimates (§8.4).
    await expect(page.getByRole('note', { name: 'About these numbers' })).toContainText('Costs shown are estimates; simulated runs spend nothing.')
    // The four figures, each with a chart (or bar list) and a table twin.
    for (const name of ['Runs', 'Spend', 'Tokens by run kind', 'Approval wait']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
    await expect(page.locator('[aria-roledescription="chart"]').first()).toBeVisible()
    await expect(page.getByRole('list', { name: 'Tokens by run kind' }).getByRole('listitem').first()).toBeVisible()
    await expect(page.getByRole('table', { name: 'Agents' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Workflows' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Top failure reasons' })).toBeVisible()

    // Every chart has its table: the Runs figure as a table lists one row per day.
    const runsCard = card(page, 'Runs')
    await runsCard.getByRole('button', { name: 'View as table' }).click()
    const twin = runsCard.getByRole('region', { name: /Runs per day by outcome \(table\)/ })
    await expect(twin).toBeVisible()
    await expect(twin.getByRole('row')).toHaveCount(9) // header + 8 local days the 7-day window touches
    // Other views of the same figure: by kind (stacked area with crosshair) and by hour (heatmap).
    await runsCard.getByRole('button', { name: 'Show chart' }).click()
    await runsCard.getByRole('radio', { name: 'Kind' }).click()
    await expect(runsCard.locator('[aria-roledescription="chart"]')).toBeVisible()
    await runsCard.getByRole('radio', { name: 'Hour' }).click()
    await expect(runsCard.getByRole('group', { name: /Heatmap of hourly activity/ })).toBeVisible()
  })

  test('changing the range updates the run count', async ({ page }) => {
    await open(page, '/insights')
    const week = await runCount(page)
    await page.getByRole('radiogroup', { name: 'Range' }).getByRole('radio', { name: '30d' }).click()
    await expect(page).toHaveURL(/range=30d/)
    await expect.poll(() => runCount(page)).toBeGreaterThan(week)
    const month = await runCount(page)
    await expect(kpi(page, /^Runs: \d+/)).toContainText(String(month))
    await page.getByRole('radiogroup', { name: 'Range' }).getByRole('radio', { name: '24h' }).click()
    await expect.poll(() => runCount(page)).toBeLessThan(week)
    // The 24-hour range buckets by hour.
    const runsCard = card(page, 'Runs')
    await runsCard.getByRole('button', { name: 'View as table' }).click()
    await expect(runsCard.getByRole('columnheader', { name: 'Hour' })).toBeVisible()
    // The range survives a reload (it lives in the URL).
    await page.reload()
    await page.waitForSelector('[data-app-ready="true"]')
    await expect(page.getByRole('radiogroup', { name: 'Range' }).getByRole('radio', { name: '24h' })).toHaveAttribute('aria-checked', 'true')
  })

  test('the provider filter separates live from simulated runs', async ({ page }) => {
    await open(page, '/insights')
    await page.getByRole('radiogroup', { name: 'Provider' }).getByRole('radio', { name: 'Live' }).click()
    await expect.poll(() => runCount(page)).toBe(0)
    // Fewer than five runs: an explanation and a way to start (§6.10).
    await expect(page.getByText('No runs in this period yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start research…' })).toBeVisible()
  })

  test('clicking a history row navigates to the run', async ({ page }) => {
    await open(page, '/insights/history')
    const table = page.getByRole('table', { name: /^Runs/ })
    const firstRow = table.locator('tbody tr').first()
    await expect(firstRow).toBeVisible()
    const href = await firstRow.locator('[data-run-link]').getAttribute('href')
    expect(href).toBeTruthy()
    // Click the row (not the link): the row opens the run where it lives.
    await firstRow.locator('td').nth(3).click()
    await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === href)
  })

  test('history searches, sorts and paginates', async ({ page }) => {
    await open(page, '/insights/history?range=30d')
    const table = page.getByRole('table', { name: /^Runs/ })
    const rows = table.locator('tbody tr')
    await expect(rows).toHaveCount(25)
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText(/1–25 of \d+/)
    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText(/26–/)

    // Sort by cost, most expensive first.
    await table.getByRole('button', { name: 'Cost' }).click()
    await expect(page).toHaveURL(/sort=cost%3Adesc|sort=cost:desc/)
    const costs = await rows.locator('td:nth-child(7)').allInnerTexts()
    const values = costs.map((c) => Number(c.replace(/[^0-9.]/g, '')))
    expect(values).toEqual([...values].sort((a, b) => b - a))

    // Search narrows the list to matching runs.
    await page.getByRole('searchbox', { name: 'Search runs' }).fill('support triage')
    await expect(page).toHaveURL(/q=support/)
    await expect(rows.first()).toContainText(/Support triage/i)
    for (const text of await rows.locator('td:first-child').allInnerTexts()) expect(text.toLowerCase()).toContain('support triage')
  })

  test('a failure reason drills into its failed runs and a number drills into history', async ({ page }) => {
    await open(page, '/insights?range=30d')
    const failures = card(page, 'Top failure reasons')
    await failures.getByRole('link', { name: 'Show runs' }).first().click()
    await expect(page).toHaveURL(/\/insights\/history\?.*reason=.*status=failed|\/insights\/history\?.*status=failed.*reason=/)
    await expect(page.getByRole('list', { name: 'Drill-down' })).toContainText('Failure')
    const rows = page.getByRole('table', { name: /^Runs/ }).locator('tbody tr')
    await expect(rows.first()).toBeVisible()
    for (const row of await rows.all()) await expect(row.getByRole('img', { name: 'Failed' })).toBeVisible()
    // Removing the drill-down keeps the other filters.
    await page.getByRole('button', { name: 'Remove failure filter' }).click()
    await expect(page).toHaveURL(/status=failed/)
    await expect(page).toHaveURL(/range=30d/)

    // An agent row in the Overview drills into that agent's runs.
    await page.getByRole('link', { name: 'Overview' }).click()
    await page.getByRole('table', { name: 'Agents' }).locator('tbody tr').first().locator('td').nth(1).click()
    await expect(page).toHaveURL(/\/insights\/history\?.*agent=agt_/)
    await expect(page.getByRole('list', { name: 'Drill-down' })).toContainText('Agent')
  })

  test('the journal filters by actor and exports what it shows', async ({ page }) => {
    await open(page, '/insights/journal')
    const journal = page.getByTestId('insights-journal')
    await expect(journal.getByRole('listitem').first()).toBeVisible()
    await page.getByRole('combobox', { name: 'Actor' }).click()
    await page.getByRole('option', { name: 'You', exact: true }).click()
    await expect(page).toHaveURL(/actor=me/)
    await expect.poll(async () => [...new Set(await journal.locator('li .font-medium').allInnerTexts())]).toEqual(['You'])
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export JSON' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^atrium-journal-\d{4}-\d{2}-\d{2}\.json$/)
    const body = JSON.parse(await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8')))
    expect(body.kind).toBe('atrium.activity-journal')
    expect(body.events.length).toBeGreaterThan(0)
    expect(body.events.every((e: { actor: { type: string } }) => e.actor.type === 'user')).toBe(true)
  })
})
