import type { Locator, Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/*
 * Chat (docs/DESIGN.md §6.2): send → streamed simulated answer, citations, retry, Turn into → Task and
 * → Research, rename + delete, and a .txt attachment read locally and acknowledged.
 */

const composer = (page: Page) => page.locator('#main [data-composer-input]')
const turns = (page: Page) => page.locator('#main article[data-message-id]')

async function ask(page: Page, text: string) {
  await composer(page).fill(text)
  await composer(page).press('Enter')
}

/** The answer turn finished streaming: no longer busy, actions shown, the Colophon in place. */
async function expectAnswered(answer: Locator) {
  await expect(answer).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  await expect(answer.getByRole('toolbar', { name: 'Answer actions' })).toBeVisible()
}

/** Rows of a table as this browser persisted them. */
async function persisted<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate((t) => {
    const raw = localStorage.getItem(`atrium.db.${t}`)
    return raw ? Object.values(JSON.parse(raw)) : []
  }, table) as Promise<T[]>
}

test.describe('Chat', () => {
  test('a new conversation streams a simulated answer to completion', async ({ page }) => {
    await open(page, '/chat')
    await expect(page.getByRole('heading', { name: 'What are we working on?' })).toBeVisible()
    await ask(page, 'Give me 5 ideas for improving onboarding')
    await expect(page).toHaveURL(/\/chat\/thr_[a-z0-9]+$/)
    const answer = turns(page).nth(1)
    // While it writes, the composer offers Stop; then the answer settles with its Colophon.
    await expect(page.getByRole('button', { name: 'Stop the reply' })).toBeVisible()
    await expectAnswered(answer)
    await expect(page.getByRole('button', { name: 'Stop the reply' })).toBeHidden()
    await expect(answer).toHaveAttribute('aria-label', /Simulator \(simulated\)/)
    await expect(answer.getByText('No model was called')).toBeVisible()
    await expect(answer.getByRole('img', { name: /^Simulated: produced by Atrium/ }).first()).toBeVisible()
    await expect(answer.locator('.atr-md > ol > li')).toHaveCount(5)
    // The thread is in the list, titled from the question.
    await expect(page.locator('[data-region="list"]').getByRole('link', { name: /ideas for improving onboarding/i })).toBeVisible()
  })

  test('a knowledge question is answered with citations and a Sources row', async ({ page }) => {
    await open(page, '/chat/new')
    // Only what the Context Line shows reaches the model: wait for the Likely match, then send.
    await composer(page).fill('What does ADR-012 say about refreshing session tokens?')
    await expect(page.getByRole('group', { name: 'Context for this action' })).toContainText('ADR-012: Session tokens & refresh')
    await composer(page).press('Enter')
    const answer = turns(page).nth(1)
    await expectAnswered(answer)
    await expect(answer.getByRole('button', { name: /^Searched knowledge/ })).toBeVisible()
    await expect(answer.getByText('Sources', { exact: true })).toBeVisible()
    await expect(answer.getByRole('link', { name: 'Knowledge: ADR-012: Session tokens & refresh' }).first()).toBeVisible()
    // An inline [n] marker opens the cited item in Inspector › Item.
    const marker = answer.getByRole('button', { name: /^Source \d+: / }).first()
    await expect(marker).toBeVisible()
    await marker.click()
    await expect(page.locator('[data-inspector-tab="item"]')).toBeVisible()
    await expect(page.locator('[data-inspector-tab="item"]').getByText('Knowledge', { exact: true }).first()).toBeVisible()
  })

  test('retry regenerates the latest answer with a fresh run', async ({ page }) => {
    await open(page, '/chat/new')
    await ask(page, 'Explain idempotency keys in two sentences')
    await expect(page).toHaveURL(/\/chat\/thr_[a-z0-9]+$/)
    const answer = turns(page).nth(1)
    await expectAnswered(answer)
    const handle = answer.getByRole('button', { name: /^Handle RUN-/ }).first()
    const before = await handle.getAttribute('aria-label')
    await answer.getByRole('button', { name: 'Retry with Simulator · Swift' }).click()
    await expect(answer.getByRole('button', { name: /^Handle RUN-/ }).first()).not.toHaveAttribute('aria-label', before ?? '')
    await expectAnswered(answer)
    await expect(turns(page)).toHaveCount(2)
  })

  test('Turn into → Task files the task in the thread’s project and shows it under the answer', async ({ page }) => {
    await open(page, '/chat/thr_stripe_risks')
    const answer = turns(page).last()
    await answer.hover()
    await answer.getByRole('button', { name: 'Turn into…' }).click()
    await page.getByRole('menuitem', { name: 'Task' }).click()
    const sheet = page.getByRole('dialog', { name: /^Turn into from/ })
    await expect(sheet).toBeVisible()
    await sheet.getByLabel('Title').fill('Rehearse the backfill on a production-sized copy')
    await sheet.getByRole('button', { name: 'Create', exact: true }).click()
    // Created where you are: a toast with a link, and the task under the answer it came from.
    await expect(page.getByText(/^Created · TSK-[A-Z0-9]{4}$/)).toBeVisible()
    await expect(page).toHaveURL(/\/chat\/thr_stripe_risks/)
    const chip = answer.getByRole('link', { name: 'Task: Rehearse the backfill on a production-sized copy' })
    await expect(chip).toBeVisible()
    // Filed in the conversation's project, with the message as its origin (as persisted on this device).
    await expect
      .poll(async () => {
        const tasks = await persisted<{ title: string; projectId: string | null; origin?: { kind: string } }>(page, 'tasks')
        const task = tasks.find((t) => t.title === 'Rehearse the backfill on a production-sized copy')
        return task && `${task.projectId} · ${task.origin?.kind}`
      })
      .toBe('prj_atlas · message')
    // The chip opens it in Inspector › Item, in its project.
    await chip.click()
    const inspector = page.locator('[data-inspector-tab="item"]')
    await expect(inspector.getByRole('heading', { name: 'Rehearse the backfill on a production-sized copy' })).toBeVisible()
    await expect(inspector.getByText('Atlas Portal v2').first()).toBeVisible()
  })

  test('Turn into → Research starts an investigation and opens it', async ({ page }) => {
    await open(page, '/chat/thr_tidewell')
    const answer = turns(page).last()
    await answer.hover()
    await answer.getByRole('button', { name: 'Turn into…' }).click()
    await page.getByRole('menuitem', { name: 'Research' }).click()
    const sheet = page.getByRole('dialog', { name: /^Turn into from/ })
    await expect(sheet.getByRole('radio', { name: 'Research' })).toHaveAttribute('aria-checked', 'true')
    await sheet.getByLabel('Question').fill('How does Tidewell price usage-based plans for mid-market freight?')
    await sheet.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(page).toHaveURL(/\/research\/inv_[a-z0-9]+/)
    await expect
      .poll(async () => {
        const investigations = await persisted<{ question: string; origin?: { kind: string } }>(page, 'investigations')
        return investigations.find((i) => i.question.startsWith('How does Tidewell price usage-based plans'))?.origin?.kind
      })
      .toBe('message')
  })

  test('rename a conversation inline, then delete it after confirming', async ({ page }) => {
    await open(page, '/chat/thr_okrs')
    await page.locator('[data-region="stage"] header h1 button').click()
    const title = page.getByRole('textbox', { name: 'Title' })
    await title.fill('Q1 OKRs — second pass')
    await title.press('Enter')
    await expect(page.locator('[data-region="stage"] header h1')).toHaveText('Q1 OKRs — second pass')
    const list = page.locator('[data-region="list"]')
    await expect(list.getByRole('link', { name: 'Q1 OKRs — second pass' })).toBeVisible()

    await page.locator('[data-region="stage"] header').getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete…' }).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /Delete/ }))
    await expect(dialog).toContainText('Delete “Q1 OKRs — second pass”?')
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page).toHaveURL(/\/chat$/)
    await expect(page.getByText('Deleted “Q1 OKRs — second pass”')).toBeVisible()
    await expect(list.getByRole('link', { name: 'Q1 OKRs — second pass' })).toHaveCount(0)
  })

  test('an attached .txt file is read locally, saved to Knowledge and acknowledged in the answer', async ({ page }) => {
    await open(page, '/chat/new')
    await page.locator('#main input[type="file"]').setInputFiles({
      name: 'beta-notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('We shipped the beta to five customers. Two asked for CSV export. The team will add export next sprint.'),
    })
    await expect(page.getByRole('group', { name: 'Context for this action' })).toContainText('beta-notes.txt')
    await ask(page, 'Summarize this')
    const prompt = turns(page).first()
    await expect(prompt.getByRole('list', { name: 'Attachments' })).toContainText('beta-notes.txt')
    await expect(prompt.getByRole('button', { name: 'In Knowledge' })).toBeVisible()
    const answer = turns(page).nth(1)
    await expectAnswered(answer)
    await expect(answer).toContainText('beta-notes.txt')
    await expect(answer).toContainText('five customers')
    await expect
      .poll(async () => (await persisted<{ title: string; source: { type: string } }>(page, 'knowledge')).some((k) => k.source.type === 'upload' && k.title === 'Beta notes'))
      .toBe(true)
  })

  test('the list searches messages, and the thread menu is keyboard reachable', async ({ page }) => {
    await open(page, '/chat')
    await page.getByRole('searchbox', { name: 'Search conversations' }).or(page.getByLabel('Search conversations')).first().fill('Meridian')
    const results = page.locator('[data-region="list"]').getByRole('list', { name: 'Search results' })
    await expect(results.getByRole('link', { name: /Session expiry after SSO login/ })).toBeVisible()
    await results.getByRole('link', { name: /Session expiry after SSO login/ }).click()
    await expect(page).toHaveURL(/\/chat\/thr_sso_bug\?m=/)
    await expect(page.locator('[data-region="stage"] header h1')).toHaveText('Session expiry after SSO login')
  })
})
