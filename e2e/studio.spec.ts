import type { Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/** Studio (§6.8): the generation bar, the contact sheet, versions, Present mode, boards and honest labels. */

const bar = (page: Page) => page.locator('[data-studio-prompt-bar]')
const prompt = (page: Page) => bar(page).getByRole('textbox')
const frames = (page: Page) => page.getByRole('group', { name: 'Version frames' }).getByRole('button')

// Dev-server page loads are slow while many suites share the machine; journeys get room.
test.describe.configure({ timeout: 120_000 })

test.describe('Studio · generation', () => {
  // Real-time simulation, so the generating state is on screen long enough to assert on.
  test.use({ simSpeed: 1 })

  test('generate an image → it appears generating → ready → open → variation → 2 versions', async ({ page }) => {
    await open(page, '/studio')
    await bar(page).getByRole('radio', { name: 'Image', exact: true }).click()
    await prompt(page).fill('Lighthouse at dusk, coral and navy, wide banner')
    await prompt(page).press('Enter')

    // The asset appears at once, first on the sheet, in a generating state with its run's tape.
    const tile = page.locator('[data-asset-tile]').first()
    await expect(tile.getByRole('link')).toHaveAccessibleName(/^Lighthouse at dusk, coral and navy, wide banner — Image, generating, simulated$/)
    await expect(tile).toHaveAttribute('data-status', 'generating')
    await expect(tile.getByRole('img', { name: /^Step \d+ of \d+/ })).toBeVisible()
    await expect(tile).toHaveAttribute('data-status', 'ready', { timeout: 30_000 })
    await expect(tile.getByText('SIM', { exact: true })).toBeVisible()

    await tile.getByRole('link').click()
    await expect(page).toHaveURL(/\/studio\/ast_[a-z0-9]+$/)
    await expect(page.getByTestId('studio-sim-note')).toContainText('Simulated preview — no image model was called')
    await expect(frames(page)).toHaveCount(1)

    await page.getByRole('button', { name: 'Variation', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Generating v2' }).first()).toBeVisible()
    await expect(frames(page)).toHaveCount(2, { timeout: 30_000 })
    await expect(frames(page).nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Variation', { exact: true }).first()).toBeVisible()

    // ← switches back to v1; the Colophon says no model was called.
    await page.locator('body').press('ArrowLeft')
    await expect(frames(page).nth(0)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('No model was called').first()).toBeVisible()
  })
})

test.describe('Studio', () => {
  test('open the deck → Present → arrow through slides → Esc', async ({ page }) => {
    await open(page, '/studio')
    await page.getByRole('link', { name: 'Decks', exact: true }).click()
    await expect(page).toHaveURL(/kind=presentation/)
    await page.getByRole('link', { name: /^Lumen launch keynote — Deck/ }).click()
    await expect(page).toHaveURL(/\/studio\/ast_keynote$/)

    await page.getByRole('button', { name: 'Present (full screen)' }).click()
    const presenter = page.getByRole('dialog', { name: 'Presenting “Lumen launch keynote”' })
    await expect(presenter).toBeVisible()
    await expect(presenter).toContainText('1 / 8')
    await page.keyboard.press('ArrowRight')
    await expect(presenter).toContainText('2 / 8')
    await expect(presenter).toContainText('The Monday problem')
    await page.keyboard.press('ArrowRight')
    await expect(presenter).toContainText('3 / 8')
    await page.keyboard.press('ArrowLeft')
    await expect(presenter).toContainText('2 / 8')
    await page.keyboard.press('Escape')
    await expect(presenter).toBeHidden()
    // Back in the editor, on the slide we left.
    await expect(page.getByRole('heading', { name: 'Slide 2 of 8' })).toBeVisible()
  })

  test('edit a slide; the edit is kept on its version', async ({ page }) => {
    await open(page, '/studio/ast_keynote')
    await page.getByRole('button', { name: /^Slide 2: / }).click()
    const title = page.getByRole('textbox', { name: 'Slide title' })
    await title.fill('The Monday problem, in one picture')
    await expect(page.getByRole('button', { name: 'Slide 2: The Monday problem, in one picture' })).toBeVisible()
    await page.reload()
    await page.waitForSelector('[data-app-ready="true"]')
    await page.getByRole('button', { name: /^Slide 2: / }).click()
    await expect(page.getByRole('textbox', { name: 'Slide title' })).toHaveValue('The Monday problem, in one picture')
  })

  test('edit with an instruction makes a new version; A/B compare shows both', async ({ page }) => {
    await open(page, '/studio/ast_hero_copy')
    await expect(frames(page)).toHaveCount(1)
    const iterate = page.getByRole('textbox', { name: 'Instruction for a new version' })
    await iterate.fill('shorter, and turn it into an email')
    await iterate.press('Enter')
    await expect(frames(page)).toHaveCount(2, { timeout: 30_000 })
    await expect(page.getByText('Edited: shorter, and turn it into an email').first()).toBeVisible()
    await page.getByRole('button', { name: 'Compare A/B' }).click()
    const compare = page.getByLabel('Compare versions')
    await expect(compare).toBeVisible()
    await expect(compare).toContainText('v1')
    await page.getByRole('button', { name: 'Done comparing' }).click()
    await expect(compare).toBeHidden()
  })

  test('boards: create one, file a new asset on it, rename and delete it', async ({ page }) => {
    await open(page, '/studio')
    await page.getByRole('button', { name: 'New board' }).click()
    const name = page.getByRole('textbox', { name: 'New board name' })
    await name.fill('Spring campaign')
    await name.press('Enter')
    await expect(page).toHaveURL(/board=brd_/)
    await expect(page.getByRole('heading', { level: 1, name: 'Spring campaign' })).toBeVisible()
    await expect(page.getByText('This board is empty. What you generate here is filed on it.')).toBeVisible()

    await bar(page).getByRole('radio', { name: 'Doc', exact: true }).click()
    await prompt(page).fill('Three LinkedIn posts for the spring campaign')
    await prompt(page).press('Enter')
    const tile = page.locator('[data-asset-tile]').first()
    await expect(tile).toHaveAttribute('data-status', 'ready', { timeout: 30_000 })
    await expect(page.getByRole('link', { name: /^Spring campaign/ })).toContainText('1')

    // Rename from the stage header (inline), delete from the ⋯ menu: the asset stays, unfiled.
    await page.getByRole('heading', { level: 1 }).getByRole('button', { name: 'Spring campaign' }).click()
    const inline = page.getByRole('textbox', { name: 'Title' })
    await inline.fill('Spring launch')
    await inline.press('Enter')
    await expect(page.getByRole('link', { name: /^Spring launch/ })).toBeVisible()
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete board…' }).click()
    await page.getByRole('button', { name: 'Delete board', exact: true }).click()
    await expect(page.getByRole('link', { name: /^Spring launch/ })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'All assets' })).toBeVisible()
    await expect(page.locator('[data-asset-tile]').first().getByRole('link')).toHaveAccessibleName(/^Three LinkedIn posts/)
  })

  test('download a real PNG of the procedural render', async ({ page }) => {
    await open(page, '/studio/ast_key_art')
    await page.getByRole('button', { name: 'More actions' }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: /Download PNG image/ }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('hero-key-art-four-directions-v2.png')
  })
})
