import type { Page } from '@playwright/test'
import { test, expect, open } from './fixtures'

/**
 * Knowledge (§6.7): the shared memory layer. Every test starts from a fresh seeded world
 * (31 items in 6 collections); console errors fail the test.
 */

const RUNBOOK = [
  '# Quokka escalation runbook',
  '',
  'When a quokka incident is declared, page the on-call lead within 15 minutes.',
  'The quokka protocol requires a written timeline and a customer update every 30 minutes until the incident is resolved.',
  '',
].join('\n')

const results = (page: Page) => page.getByRole('list', { name: 'Knowledge items' })
const row = (page: Page, title: string) => results(page).getByRole('listitem').filter({ hasText: title })
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search Knowledge' })

/** Rows of a table as persisted in this browser (the app writes each table to localStorage). */
async function persisted<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate((t) => Object.values(JSON.parse(localStorage.getItem(`atrium.db.${t}`) ?? '{}')) as never[], table) as Promise<T[]>
}

async function uploadRunbook(page: Page) {
  await page.locator('input[data-knowledge-upload]').setInputFiles({ name: 'quokka-escalation-runbook.md', mimeType: 'text/markdown', buffer: Buffer.from(RUNBOOK) })
  await expect(row(page, 'Quokka escalation runbook')).toBeVisible()
}

test.describe('Knowledge', () => {
  test('upload → search with highlight → open → hold → a new chat answer cites it', async ({ page }) => {
    await open(page, '/knowledge')
    await expect(page.getByRole('heading', { name: 'All knowledge' })).toBeVisible()
    await expect(results(page).getByRole('listitem')).toHaveCount(31)

    // Upload: read locally, shows per-file progress, then the item is in the library.
    await uploadRunbook(page)
    await expect(page.getByRole('region', { name: 'Adding to Knowledge' })).toContainText('read locally, never uploaded')
    await expect(results(page).getByRole('listitem')).toHaveCount(32)

    // Real local full-text search: the body text matches, with highlighted terms.
    await search(page).fill('quokka protocol')
    await expect(results(page).getByRole('listitem')).toHaveCount(1)
    const hit = row(page, 'Quokka escalation runbook')
    await expect(hit.locator('mark').filter({ hasText: /^protocol$/i })).toHaveCount(1)
    await expect(hit.locator('mark').filter({ hasText: /^quokka$/i }).first()).toBeVisible()
    await expect(page).toHaveURL(/q=quokka\+protocol/)

    // Open the reader.
    await hit.getByRole('link', { name: 'Quokka escalation runbook' }).click()
    await expect(page).toHaveURL(/\/knowledge\/kno_[a-z0-9]+$/)
    const id = new URL(page.url()).pathname.split('/').pop()!
    await expect(page.getByRole('heading', { level: 1, name: 'Quokka escalation runbook' })).toBeVisible()
    await expect(page.getByRole('article')).toContainText('The quokka protocol requires a written timeline')

    // Hold it: it rides along in every new AI action.
    await page.locator('[data-region="stage"] header').getByRole('button', { name: /^Hold/ }).first().click()
    await expect(page.getByRole('button', { name: 'Holding 1 item' })).toBeVisible()

    // A new chat question (from Home) reads it and cites it.
    await open(page, '/')
    const composer = page.locator('#main [data-composer-input]').first()
    await composer.fill('What does the quokka protocol require during an incident?')
    await expect(page.getByText('Reads as a question')).toBeVisible()
    await composer.press('Enter')
    await expect(page).toHaveURL(/\/chat\/thr_[a-z0-9]+/)
    const threadId = new URL(page.url()).pathname.split('/').pop()!
    type Msg = { threadId: string; role: string; status: string; content: string; citations?: { ref: { kind: string; id: string } }[] }
    await expect
      .poll(async () => (await persisted<Msg>(page, 'messages')).find((m) => m.threadId === threadId && m.role === 'assistant')?.status, { timeout: 30_000 })
      .toBe('complete')
    const answer = (await persisted<Msg>(page, 'messages')).find((m) => m.threadId === threadId && m.role === 'assistant')!
    expect(answer.citations?.map((c) => c.ref.id)).toContain(id)
    expect(answer.content).toMatch(/quokka/i)
    type Link = { from: { kind: string }; to: { id: string }; rel: string }
    expect((await persisted<Link>(page, 'links')).some((l) => l.rel === 'cites' && l.from.kind === 'message' && l.to.id === id)).toBe(true)

    // Back in Knowledge, the item shows who used it: the chat run that read it and the answer that cited it.
    await open(page, `/knowledge/${id}`)
    const connections = page.locator('section[aria-labelledby="kn-connections"]')
    await connections.scrollIntoViewIfNeeded()
    await expect(connections.getByRole('heading', { name: 'Used by' })).toBeVisible()
    await expect(connections.getByRole('heading', { name: 'Cited by' })).toBeVisible()
    await expect(connections).toContainText('What does the quokka protocol require')
    await expect(page.getByRole('article')).toContainText('used by 1 run')
  })

  test('edit a note: autosaves, one History line per session, persists after reload', async ({ page }) => {
    await open(page, '/knowledge/kno_rust_plan')
    await expect(page.getByRole('heading', { level: 1, name: 'Rust learning plan' })).toBeVisible()
    await page.keyboard.press('e')
    await expect(page).toHaveURL(/edit=1/)
    const editor = page.locator('[data-knowledge-editor]')
    await expect(editor).toBeFocused()
    await editor.press('Control+End')
    await editor.pressSequentially('\n\nWeek 4: ownership drills with the zebra checklist.')
    await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'saved')
    await editor.pressSequentially(' Then lifetimes.')
    await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'saved')

    // Done (Esc) returns to the reader with the new text.
    await editor.press('Escape')
    await expect(page).not.toHaveURL(/edit=1/)
    await expect(page.getByRole('article')).toContainText('ownership drills with the zebra checklist. Then lifetimes.')

    await page.reload()
    await page.waitForSelector('[data-app-ready="true"]')
    await expect(page.getByRole('article')).toContainText('ownership drills with the zebra checklist. Then lifetimes.')
    type Act = { target: { id: string }; verb: string }
    const edits = (await persisted<Act>(page, 'activity')).filter((a) => a.target.id === 'kno_rust_plan' && a.verb === 'edited')
    expect(edits).toHaveLength(1)
  })

  test('N starts a draft that becomes a note on its first words, filed in the collection in view', async ({ page }) => {
    await open(page, '/knowledge?collection=col_engineering')
    await expect(page.getByRole('heading', { name: 'Engineering' })).toBeVisible()
    await page.keyboard.press('n')
    await expect(page).toHaveURL(/\/knowledge\/new\?collection=col_engineering/)
    const editor = page.locator('[data-knowledge-editor]')
    await expect(editor).toBeFocused()
    await editor.pressSequentially('# Deploy freeze checklist\n\nNo deploys after 3pm on Fridays.')
    // The draft becomes an item: the URL swaps to its id without losing the editor or its text.
    await expect(page).toHaveURL(/\/knowledge\/kno_[a-z0-9]+\?edit=1/)
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue('# Deploy freeze checklist\n\nNo deploys after 3pm on Fridays.')
    await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'saved')
    await expect(page.getByRole('heading', { level: 1, name: 'Deploy freeze checklist' })).toBeVisible()
    await editor.press('Escape')

    await page.getByRole('button', { name: /^Engineering/ }).first().click()
    await expect(row(page, 'Deploy freeze checklist')).toBeVisible()
    await expect(results(page).getByRole('listitem')).toHaveCount(8)
  })

  test('bulk: select with X, move to a collection and tag in one go', async ({ page }) => {
    await open(page, '/knowledge?collection=col_notes')
    await expect(results(page).getByRole('listitem')).toHaveCount(4)
    // Keyboard: focus the first row, X selects, ↓ then X selects the next.
    await results(page).locator('[data-row-link]').first().focus()
    await page.keyboard.press('x')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('x')
    const bar = page.getByRole('toolbar', { name: 'Selected items' })
    await expect(bar).toContainText('2 selected')

    await bar.getByRole('button', { name: 'Tag' }).click()
    await page.getByRole('textbox', { name: 'Tag' }).fill('reading-list')
    await page.getByRole('button', { name: 'Add to 2 items' }).click()
    await expect(page.getByText('Tagged #reading-list')).toBeVisible()

    await bar.getByRole('button', { name: 'Move' }).click()
    await page.getByRole('menuitem', { name: 'Research' }).click()
    await expect(page.getByText('Moved 2 items to Research')).toBeVisible()
    await expect(results(page).getByRole('listitem')).toHaveCount(2)

    await page.getByRole('button', { name: /^reading-list/ }).first().click()
    await expect(page).toHaveURL(/tag=reading-list/)
    await expect(results(page).getByRole('listitem')).toHaveCount(2)
  })

  test('retrieval lab: real passages with scores; Available to AI: Never takes an item out', async ({ page }) => {
    await open(page, '/knowledge/retrieval')
    await expect(page.getByRole('heading', { name: 'What would the AI retrieve?' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Question' }).fill('What is the support SLA for severity one tickets?')
    const read = page.locator('section[aria-labelledby="lab-read"]')
    await expect(read.getByRole('listitem').first()).toBeVisible()
    await expect(read).toContainText('Support SLA policy')
    await expect(read.getByRole('status')).toContainText(/\d+ passages? · \d+ items eligible/)
    await expect(read.locator('mark').first()).toBeVisible()

    // Set the SLA policy to Never: the lab stops reading it and says why.
    await open(page, '/knowledge/kno_sla_policy')
    await page.getByRole('article').getByRole('radio', { name: 'Never' }).click()
    await expect(page.getByText('Available to AI: Never').first()).toBeVisible()
    await open(page, '/knowledge/retrieval?q=What+is+the+support+SLA+for+severity+one+tickets%3F')
    await expect(read.getByRole('listitem').first()).toBeVisible()
    await expect(read).not.toContainText('Support SLA policy')
    await expect(page.locator('section[aria-labelledby="lab-withheld"]')).toContainText('Support SLA policy')
  })

  test('add a link (not fetched), then delete it with a confirm', async ({ page }) => {
    await open(page, '/knowledge')
    await page.getByRole('button', { name: 'Add link' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add a link' })
    await expect(dialog).toContainText('isn’t fetched')
    await dialog.getByRole('textbox', { name: /Address/ }).fill('not a url')
    await dialog.getByRole('button', { name: 'Save link' }).click()
    await expect(dialog).toContainText('doesn’t look like a web address')
    await dialog.getByRole('textbox', { name: /Address/ }).fill('docs.stripe.com/webhooks/best-practices')
    await dialog.getByRole('textbox', { name: /Notes/ }).fill('Retry with exponential backoff; verify signatures.')
    await dialog.getByRole('button', { name: 'Save link' }).click()
    await expect(page).toHaveURL(/\/knowledge\/kno_/)
    await expect(page.getByRole('heading', { level: 1, name: 'Best practices · docs.stripe.com' })).toBeVisible()
    await expect(page.getByRole('article')).toContainText('Not fetched')

    await page.getByRole('button', { name: 'More actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Delete…' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Delete “Best practices · docs.stripe.com”?')
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(page).toHaveURL(/\/knowledge$/)
    await expect(row(page, 'Best practices · docs.stripe.com')).toHaveCount(0)
  })
})
