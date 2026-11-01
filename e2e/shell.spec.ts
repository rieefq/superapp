import { test, expect, open } from './fixtures'

/**
 * The global shell (docs/DESIGN.md §3): rail and G-chords, the command center, the user menu,
 * the project switcher, Needs you, the Run Line → Inspector › Run, ?inspect= → Inspector › Item,
 * and the phone frame.
 */

test.describe('desktop shell', () => {
  test('rail navigation and G-chords', async ({ page }) => {
    await open(page, '/')
    const rail = page.getByRole('navigation', { name: 'Workspaces' })
    await rail.getByRole('link', { name: /^Chat/ }).click()
    await expect(page).toHaveURL(/\/chat$/)
    await expect(rail.getByRole('link', { name: /^Chat/ })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('banner', { name: 'Top bar' }).getByRole('button', { name: /Workspace: Chat/ })).toBeVisible()

    await page.keyboard.press('g')
    await page.keyboard.press('r')
    await expect(page).toHaveURL(/\/research$/)
    await page.keyboard.press('g')
    await page.keyboard.press('k')
    await expect(page).toHaveURL(/\/knowledge$/)
    await page.keyboard.press('g')
    await page.keyboard.press('h')
    await expect(page).toHaveURL(/\/$/)
  })

  test('⌘K finds “Atlas Lumen PRD” and opens it', async ({ page }) => {
    await open(page, '/')
    await page.keyboard.press('ControlOrMeta+k')
    const dialog = page.getByRole('dialog', { name: 'Command center' })
    await expect(dialog).toBeVisible()
    const input = dialog.getByRole('combobox', { name: 'Search or start' })
    await expect(input).toBeFocused()
    await input.fill('Atlas Lumen PRD')
    const option = dialog.getByRole('option', { name: /Atlas Lumen PRD/ }).first()
    await expect(option).toBeVisible()
    await expect(option).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/\/knowledge\/kno_lumen_prd/)
  })

  test('the user menu switches theme and it persists after reload', async ({ page }) => {
    await open(page, '/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: /^Account:/ }).click()
    await page.getByRole('button', { name: /^Theme/ }).click()
    await page.getByRole('menuitemradio', { name: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await page.waitForSelector('[data-app-ready="true"]')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('the project switcher scopes the shell', async ({ page }) => {
    await open(page, '/')
    const crumb = page.getByRole('button', { name: /^Project: All work/ })
    await expect(crumb).toBeVisible()
    await expect(page.getByTestId('project-rule')).toHaveCount(0)
    await page.keyboard.press('p')
    const switcher = page.getByRole('dialog', { name: 'Switch project' })
    await expect(switcher).toBeVisible()
    await switcher.getByRole('option', { name: /Atlas Portal v2/ }).click()
    await expect(page.getByRole('button', { name: /^Project: Atlas Portal v2/ })).toBeVisible()
    await expect(page.getByTestId('project-rule')).toBeVisible()
  })

  test('Needs you lists the seeded approvals and approving one updates the count', async ({ page }) => {
    await open(page, '/')
    const button = page.getByRole('button', { name: /^Needs you: \d+/ })
    await expect(button).toBeVisible()
    const before = Number((await button.getAttribute('aria-label'))!.match(/\d+/)![0])
    await button.click()
    const popover = page.getByRole('dialog', { name: 'Needs you and updates' })
    await expect(popover).toBeVisible()
    await expect(popover.getByText('Forge wants to run npm install stripe@^18 --save')).toBeVisible()
    await expect(popover.getByText('Herald wants to post weekly digest to #product')).toBeVisible()
    const card = popover.locator('section[aria-label="Approvals"] > *').filter({ hasText: 'npm install stripe' })
    await card.getByRole('button', { name: /^Approve/ }).first().click()
    await expect(page.getByRole('button', { name: new RegExp(`^Needs you: ${before - 1}\\b`) })).toBeVisible()
  })

  test('the Run Line shows runs in flight; clicking a pill opens Inspector › Run', async ({ page }) => {
    await open(page, '/')
    const line = page.getByRole('region', { name: 'Runs' })
    const pill = line.locator('button[data-status="waiting"]').first()
    await expect(pill).toBeVisible()
    const title = (await pill.innerText()).split('\n')[0].trim()
    await pill.click()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector).toBeVisible()
    await expect(inspector.getByRole('tab', { name: 'Run' })).toHaveAttribute('aria-selected', 'true')
    await expect(inspector.getByRole('heading', { level: 2 })).toContainText(title.replace('…', '').slice(0, 8))
  })

  test('?inspect= opens Inspector › Item; peeks push and Back pops', async ({ page }) => {
    await open(page, '/knowledge?inspect=knowledge:kno_lumen_prd')
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector).toBeVisible()
    await expect(inspector.getByRole('tab', { name: 'Item' })).toHaveAttribute('aria-selected', 'true')
    await expect(inspector.getByRole('heading', { name: 'Atlas Lumen PRD' })).toBeVisible()

    // A chip inside the panel peeks (pushes); browser Back pops back to the PRD.
    await inspector.getByRole('link', { name: 'Knowledge: Pricing strategy memo (draft)' }).first().click()
    await expect(page).toHaveURL(/inspect=knowledge(%3A|:)kno_pricing_memo/)
    await expect(inspector.getByRole('heading', { name: 'Pricing strategy memo (draft)' })).toBeVisible()
    await expect(inspector.getByRole('button', { name: /^Back/ })).toBeVisible()
    await page.goBack()
    await expect(inspector.getByRole('heading', { name: 'Atlas Lumen PRD' })).toBeVisible()
    await expect(inspector.getByRole('button', { name: /^Back/ })).toHaveCount(0)

    await inspector.getByRole('button', { name: /^Close Inspector/ }).click()
    await expect(inspector).toBeHidden()
    await expect(page).not.toHaveURL(/inspect=/)
  })
})

test.describe('phone shell', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('shows the bottom bar and never scrolls sideways', async ({ page }) => {
    await open(page, '/')
    const bar = page.getByRole('navigation', { name: 'Primary' })
    await expect(bar).toBeVisible()
    for (const name of ['Home', 'Chat', 'More']) await expect(bar.getByText(name, { exact: true })).toBeVisible()
    await expect(bar.getByRole('button', { name: /^Start/ })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Workspaces' })).toHaveCount(0)
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner)

    await bar.getByRole('button', { name: /^More/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Workspaces' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('link', { name: /Knowledge/ }).click()
    await expect(page).toHaveURL(/\/knowledge$/)
  })
})
