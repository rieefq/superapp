import type { Locator, Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/** A step node on the canvas, by its label. */
const node = (page: Page, label: string) => page.locator(`.wf-node[data-node-label="${label}"]`)
const editor = (page: Page) => page.getByTestId('wf-editor')

/** Drag from one port to another (React Flow listens to pointer events on the handles). */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  if (!a || !b) throw new Error('port not visible')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2 + 4, (a.y + b.y) / 2, { steps: 8 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
}

test.describe('Workflows', () => {
  test('Weekly project digest: Test run lights up the steps, waits at the approval, then succeeds', async ({ page }) => {
    await open(page, '/workflows')
    await page.getByRole('list', { name: 'Workflows' }).getByRole('link', { name: /^Weekly project digest/ }).click()
    await expect(page).toHaveURL(/\/workflows\/wfl_digest/)
    await expect(editor(page)).toBeVisible()
    await expect(page.locator('.wf-node')).toHaveCount(7)

    // Test run reads the plan back first: simulator, what it can do, the estimate.
    await page.getByRole('button', { name: 'Test run' }).click()
    const dialog = page.getByRole('dialog', { name: /Test run “Weekly project digest”/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Read back')).toContainText('Workflow run')
    await expect(dialog.getByLabel('Read back')).toContainText('asks you')
    await dialog.getByRole('button', { name: 'Run', exact: true }).click()

    // Nodes light up as the run walks the graph, then the run waits at "Review before posting".
    await expect(node(page, 'Mondays at 09:00')).toHaveAttribute('data-state', 'done')
    await expect(node(page, 'Review before posting')).toHaveAttribute('data-state', 'waiting', { timeout: 30_000 })
    await expect(node(page, 'Write the digest')).toHaveAttribute('data-state', 'done')
    await expect(node(page, 'Post to #product')).toHaveAttribute('data-state', 'pending')
    await expect(page.getByTestId('wf-overlay')).toHaveAttribute('data-run-status', 'waiting')

    // One decision: approving the review step posts without a second card (HIGH risk asks twice).
    const card = editor(page).getByRole('article', { name: /^Approval:/ })
    await expect(card).toContainText('post to #product')
    await expect(card).toContainText('Slack (simulated)')
    await card.getByRole('button', { name: 'Approve', exact: true }).click()
    await card.getByRole('button', { name: 'Confirm approve' }).click()

    await expect(page.getByTestId('wf-overlay')).toHaveAttribute('data-run-status', 'succeeded', { timeout: 30_000 })
    for (const label of ['Mondays at 09:00', 'Write the digest', 'Review before posting', 'Post to #product', 'Log & notify']) {
      await expect(node(page, label)).toHaveAttribute('data-state', 'done')
    }
    await expect(page.getByTestId('wf-runs-bar')).toContainText('Done')
    // The run is recorded with the workflow and opens from the runs drawer.
    await page.getByTestId('wf-runs-bar').click()
    await expect(page.getByRole('table', { name: 'Runs of this workflow' })).toBeVisible()
  })

  test('create from a template, add a step, connect it, and validation updates', async ({ page }) => {
    await open(page, '/workflows/new')
    await page.getByRole('button', { name: /^Weekly digest/ }).click()
    await expect(editor(page)).toBeVisible()
    await expect(page.locator('.wf-node')).toHaveCount(6)
    await expect(page.getByTestId('wf-issue-count')).toHaveCount(0)
    // New workflows start off.
    await expect(page.getByRole('switch', { name: /Off\. Turn on/ })).toHaveAttribute('aria-checked', 'false')

    // Add a condition after the agent step: it takes over the agent's connection as its Yes branch.
    await node(page, 'Write the digest').locator('.wf-node__focus').click()
    await page.getByRole('button', { name: 'Add step (N)' }).click()
    await page.getByRole('menuitem', { name: /^Condition/ }).click()
    await expect(page.locator('.wf-node')).toHaveCount(7)
    await expect(node(page, 'Check something')).toBeVisible()
    // Its No branch is missing: a warning appears on the canvas and in the problems list.
    await expect(page.getByTestId('wf-issue-count')).toContainText('1 warning')
    await expect(page.getByTestId('wf-issues')).toContainText('no “false” branch')
    // The selected step's settings are in Inspector › Item.
    await expect(page.getByTestId('step-form')).toContainText('Condition')

    // Connect No → "Save the digest to Knowledge"; the warning goes away.
    await page.getByRole('button', { name: 'Fit the view' }).click()
    const edgesBefore = await page.locator('.react-flow__edge').count()
    await drag(page, node(page, 'Check something').locator('.react-flow__handle[data-handleid="false"]'), node(page, 'Save the digest to Knowledge').locator('.react-flow__handle-top'))
    await expect(page.locator('.react-flow__edge')).toHaveCount(edgesBefore + 1)
    await expect(page.getByTestId('wf-issue-count')).toHaveCount(0)
  })

  test('the Outline is a full editor: numbered steps, settings, add and delete', async ({ page }) => {
    await open(page, '/workflows/wfl_triage?view=outline')
    const outline = page.getByRole('list', { name: 'Steps of Support triage' })
    await expect(outline).toBeVisible()
    await expect(outline).toContainText('Check “Urgent?”')
    await expect(outline).toContainText('Yes →')
    await expect(outline).toContainText('No →')
    // A row opens the same settings as the canvas.
    await outline.locator('[data-outline-step]').filter({ hasText: 'Create Linear issue' }).getByRole('button').first().click()
    await expect(page.getByTestId('step-form')).toContainText('Linear')
    // Add a delay after it through the row menu, then delete it again (Undo toast).
    await page.getByRole('button', { name: 'More for Create Linear issue' }).click()
    await page.getByRole('menuitem', { name: 'Add delay after' }).click()
    await expect(outline).toContainText('Wait 1 hour')
    await page.getByRole('button', { name: 'More for Wait 1 hour' }).click()
    await page.getByRole('menuitem', { name: 'Delete step' }).click()
    await expect(outline).not.toContainText('Wait 1 hour')
    await expect(page.getByText('Deleted “Wait 1 hour”')).toBeVisible()
  })

  test('Describe it drafts a template-based workflow and says how it was made', async ({ page }) => {
    await open(page, '/workflows/new')
    await page.getByLabel('Describe it').fill('Every Monday at 9, summarize last week’s project activity and post it to #product — ask me before posting.')
    await page.getByRole('button', { name: /Draft workflow/ }).click()
    await expect(editor(page)).toBeVisible()
    const notes = page.getByTestId('wf-draft-notes')
    await expect(notes).toContainText('Template-based draft')
    await expect(notes).toContainText('not AI')
    await expect(page.locator('.wf-node').first()).toBeVisible()
    await expect(page.locator('.wf-node[data-type="approval"]')).toHaveCount(1)
  })

  test('turning a workflow on reads back what it will do first', async ({ page }) => {
    await open(page, '/workflows/wfl_assets')
    await page.getByRole('switch', { name: /Off\. Turn on/ }).click()
    const dialog = page.getByRole('dialog', { name: /Turn on “Launch asset pipeline”/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Read back')).toContainText('Generate media')
    await dialog.getByRole('button', { name: 'Turn on' }).click()
    await expect(page.getByRole('switch', { name: /Enabled\. Turn off/ })).toHaveAttribute('aria-checked', 'true')
  })
})
