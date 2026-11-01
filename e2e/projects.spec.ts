import type { Locator, Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/** The board column a card is in (data-board-column of its column). */
const columnOf = (card: Locator) => card.evaluate((el) => (el.closest('[data-board-column]') as HTMLElement | null)?.dataset.boardColumn ?? null)

/** A pointer drag (the board's drag-and-drop is pointer based, with a 5px threshold). */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 8, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + 40, { steps: 12 })
  await page.mouse.up()
}

/** Drive a task's agent run to Review: approve requests and retry a failed run along the way. */
async function untilReview(page: Page, drawer: Locator) {
  await expect
    .poll(
      async () => {
        const status = (await drawer.getByRole('button', { name: /^Status:/ }).getAttribute('aria-label')) ?? ''
        if (/Review/.test(status)) return 'review'
        const approve = drawer.getByRole('button', { name: 'Approve', exact: true })
        if (await approve.count()) {
          await approve.first().click().catch(() => {})
          const confirm = drawer.getByRole('button', { name: /Confirm approve/ })
          if (await confirm.count()) await confirm.first().click().catch(() => {})
        }
        const retry = drawer.getByRole('button', { name: 'Try again' })
        if (await retry.count()) {
          await retry.click()
          await page.getByRole('dialog', { name: /^Assign to/ }).getByRole('button', { name: /Assign and start/ }).click()
        }
        return status
      },
      { timeout: 45_000, intervals: [400] },
    )
    .toBe('review')
}

test.describe('Projects', () => {
  test('the index lists projects with My tasks; ?new=1 opens New project', async ({ page }) => {
    await open(page, '/projects')
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible()
    for (const name of ['Atlas Portal v2', 'Lumen Launch', 'Q4 Competitive Landscape']) {
      await expect(page.locator('[data-project-card]', { hasText: name })).toBeVisible()
    }
    await page.getByRole('button', { name: 'New project' }).first().click()
    await expect(page).toHaveURL(/\/projects\?new=1/)
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await expect(dialog).toBeVisible()
    // A name is required.
    await dialog.getByRole('button', { name: 'Create project' }).click()
    await expect(dialog.getByText('Give the project a name.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/\/projects$/)
  })

  test('create a project → add a task → drag it to In progress → assign it to an agent → the run starts and the task reaches Review', async ({ page }) => {
    await open(page, '/projects?new=1')
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await dialog.getByLabel('Name').fill('Harbor Pilot')
    await dialog.getByLabel('Goal').fill('Two design partners live on the harbor pilot by December.')
    await dialog.getByRole('button', { name: 'Create project' }).click()
    await expect(page).toHaveURL(/\/projects\/prj_[a-z0-9]+$/)
    await expect(page.getByRole('heading', { name: 'Harbor Pilot', level: 1 })).toBeVisible()
    await expect(page.getByText('Two design partners live on the harbor pilot by December.')).toBeVisible()

    // Tasks › Board: an empty project still has its columns, each with a quick add.
    await page.getByRole('link', { name: /^Tasks/ }).click()
    await expect(page.getByText('Break the goal into tasks')).toBeVisible()
    await page.getByRole('button', { name: 'Add a task to To do' }).click()
    await page.getByLabel('New task in To do').fill('Draft the pilot plan')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    const card = page.locator('[data-board-card]', { hasText: 'Draft the pilot plan' })
    await expect(card).toBeVisible()
    expect(await columnOf(card)).toBe('todo')

    // Drag it to In progress.
    await drag(page, card, page.locator('[data-board-column="in_progress"] [data-column-list]'))
    await expect.poll(() => columnOf(card)).toBe('in_progress')

    // Open the drawer (?task=) and assign it to Scout through the ReadBack confirm.
    await card.locator('[data-card-open]').click()
    await expect(page).toHaveURL(/[?&]task=tsk_/)
    const drawer = page.locator('[data-task-drawer]')
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: /^Assignee:/ }).click()
    await page.getByRole('option', { name: /^Scout/ }).click()
    const assign = page.getByRole('dialog', { name: 'Assign to Scout' })
    await expect(assign.getByLabel('Read back')).toContainText('Agent run')
    await expect(assign.getByLabel('Read back')).toContainText('no model is called')
    await assign.getByRole('button', { name: /Assign and start/ }).click()

    // The run starts and shows live in the drawer, then the task reaches Review (never Done by itself).
    await expect(drawer.getByRole('region', { name: 'Agent run' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: /^Assignee: Scout/ })).toBeVisible()
    await untilReview(page, drawer)
    await expect(drawer.getByRole('region', { name: 'Review' })).toContainText('Ready for your review')
    await expect.poll(() => columnOf(card)).toBe('review')

    // Approving the review completes it.
    await drawer.getByRole('button', { name: 'Approve review' }).click()
    await expect(drawer.getByRole('button', { name: /^Status: Done/ })).toBeVisible()
    await expect.poll(() => columnOf(card)).toBe('done')
  })

  test('set a project as the scope and see other workspaces filter to it', async ({ page }) => {
    await open(page, '/projects/prj_atlas')
    await page.getByRole('button', { name: 'Work in this project' }).click()
    await expect(page.getByRole('button', { name: 'In scope' })).toHaveAttribute('aria-pressed', 'true')
    // The top bar's project crumb follows the scope.
    await expect(page.getByRole('banner')).toContainText('Atlas Portal v2')

    // Home filters to the scope (client-side: scope lives in the context store, not the URL).
    const rail = page.getByRole('navigation', { name: 'Workspaces' })
    await rail.getByRole('link', { name: /^Home/ }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Filtered to' })).toContainText('Atlas Portal v2')

    // So does My tasks, with a local Show all.
    await rail.getByRole('link', { name: /^Projects/ }).click()
    await page.getByRole('link', { name: /^My tasks/ }).first().click()
    await expect(page).toHaveURL(/\/projects\/my-tasks/)
    await expect(page.getByText('Filtered to')).toBeVisible()
    const scopedRows = await page.locator('[data-list-row]').count()
    await page.getByRole('button', { name: 'Show all' }).click()
    await expect.poll(() => page.locator('[data-list-row]').count()).toBeGreaterThan(scopedRows)

    // The index marks the project in scope; "Show all work" in its menu clears the scope.
    await rail.getByRole('link', { name: /^Projects/ }).click()
    const atlas = page.locator('[data-project-card]', { hasText: 'Atlas Portal v2' })
    await expect(atlas).toContainText('In scope')
    await atlas.getByRole('button', { name: 'More actions for Atlas Portal v2' }).click()
    await page.getByRole('menuitem', { name: 'Show all work' }).click()
    await expect(atlas).not.toContainText('In scope')
  })

  test('keyboard: Space picks a card up, arrows move it, Space drops it; Move to… in the card menu', async ({ page }) => {
    await open(page, '/projects/prj_atlas/tasks?view=board')
    const card = page.locator('[data-board-card]', { hasText: 'Spike: SCIM provisioning' })
    await expect(card).toBeVisible()
    expect(await columnOf(card)).toBe('backlog')
    await card.locator('[data-card-open]').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Space')
    await expect.poll(() => columnOf(card)).toBe('todo')

    // Escape cancels a held card.
    await card.locator('[data-card-open]').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    await expect.poll(() => columnOf(card)).toBe('todo')

    // The menu equivalent of a drag.
    await card.hover()
    await card.getByRole('button', { name: /^Actions for/ }).click()
    await page.getByRole('menuitemradio', { name: 'Review' }).click()
    await expect.poll(() => columnOf(card)).toBe('review')
  })

  test('the task drawer edits, completes subtasks and deletes', async ({ page }) => {
    await open(page, '/projects/prj_atlas?task=tsk_stripe_migration')
    const drawer = page.locator('[data-task-drawer]')
    // The drawer is the task lens (loaded on demand); a cold dev server can take a while the first time.
    await expect(drawer).toBeVisible({ timeout: 30_000 })
    // The live coding run shows in the drawer with its approval inline.
    await expect(drawer.getByRole('region', { name: 'Agent run' })).toContainText('Forge')

    await drawer.getByRole('region', { name: 'Description' }).getByRole('button', { name: 'Edit' }).click()
    await drawer.getByLabel('Title').fill('Migrate invoices to Stripe Billing (phase 1)')
    await drawer.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('complementary').getByRole('heading', { name: 'Migrate invoices to Stripe Billing (phase 1)' })).toBeVisible()

    await drawer.getByLabel('Add a subtask').fill('Confirm the rollout window')
    await drawer.getByLabel('Add a subtask').press('Enter')
    await expect(drawer.getByText('Confirm the rollout window')).toBeVisible()

    await drawer.getByRole('button', { name: 'Delete task' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete task' }).click()
    await expect(page).not.toHaveURL(/task=/)
    await expect(page.locator('[data-board-card]', { hasText: 'Migrate invoices' })).toHaveCount(0)
  })

  test('My tasks groups by due date and completes with Undo', async ({ page }) => {
    await open(page, '/projects/my-tasks')
    await expect(page.getByRole('heading', { name: 'My tasks', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Overdue/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Today/ })).toBeVisible()
    const row = page.locator('li', { hasText: 'Submit monthly expense report' })
    await row.getByRole('button', { name: 'Mark “Submit monthly expense report” done' }).click()
    // The row stays in place, done, so a slip is one click to undo.
    await expect(row.getByRole('button', { name: 'Reopen “Submit monthly expense report”' })).toBeVisible()
    await expect(page.getByText(/Done: “Submit monthly expense report”/)).toBeVisible()
    await row.getByRole('button', { name: 'Reopen “Submit monthly expense report”' }).click()
    await expect(row.getByRole('button', { name: 'Mark “Submit monthly expense report” done' })).toBeVisible()
  })
})
