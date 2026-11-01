import { beforeEach, describe, expect, it } from 'vitest'
import { useContextStore } from '@/core/context'
import { db, emptyTables } from '@/core/db'
import { htmlToReadable, looksBinary } from '@/core/services/fileImport'
import {
  addKnowledgeToProject,
  createKnowledge,
  createLink,
  deleteKnowledgeItems,
  importFiles,
  knowledgeUsageIn,
  moveKnowledge,
  normalizeUrl,
  tagKnowledge,
  titleFromUrl,
  updateKnowledge,
  type ImportProgress,
} from '@/core/services/knowledge'
import { fx } from '@/core/services/testFixtures'

/** The Knowledge service enrichments this workspace relies on (src/core/services/knowledge.ts, fileImport.ts). */

beforeEach(() => {
  db.replaceAll(emptyTables())
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
})

const activity = () => db.all('activity').map((a) => a.summary)

describe('updateKnowledge', () => {
  it('logs one line per editing session when later saves are silent', () => {
    const item = createKnowledge({ title: 'Plan', content: 'v1' })
    updateKnowledge(item.id, { content: 'v2' })
    updateKnowledge(item.id, { content: 'v3' }, { silent: true })
    updateKnowledge(item.id, { content: 'v4' }, { silent: true })
    expect(db.get('knowledge', item.id)?.content).toBe('v4')
    expect(activity().filter((s) => s.startsWith('Edited'))).toEqual(['Edited “Plan”'])
  })

  it('sets Available to AI with a readable History line; Always is stored as the default', () => {
    const item = createKnowledge({ title: 'SLA', content: 'x' })
    updateKnowledge(item.id, { aiAvailability: 'cited' })
    expect(db.get('knowledge', item.id)?.aiAvailability).toBe('cited')
    expect(activity()).toContain('Set “SLA” to Available to AI: When cited')
    updateKnowledge(item.id, { aiAvailability: 'always' })
    expect(db.get('knowledge', item.id)?.aiAvailability).toBeUndefined()
    const before = db.all('activity').length
    updateKnowledge(item.id, { aiAvailability: 'always' })
    expect(db.all('activity')).toHaveLength(before)
  })

  it('names renames and moves plainly', () => {
    db.insert('collections', fx.collection({ id: 'col_1', name: 'Product' }))
    const item = createKnowledge({ title: 'Old', content: 'x' })
    updateKnowledge(item.id, { title: '  New   name ' })
    updateKnowledge(item.id, { collectionId: 'col_1' })
    expect(activity()).toEqual(expect.arrayContaining(['Renamed “Old” to “New name”', 'Moved “New name” to Product']))
  })
})

describe('links', () => {
  it('normalizes addresses and refuses non-web ones', () => {
    expect(normalizeUrl('stripe.com/docs')).toBe('https://stripe.com/docs')
    expect(normalizeUrl(' http://localhost:5173/x ')).toBe('http://localhost:5173/x')
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('not a url')).toBeNull()
    expect(normalizeUrl('intranet')).toBeNull()
    expect(titleFromUrl('https://docs.stripe.com/webhooks/best-practices')).toBe('Best practices · docs.stripe.com')
    expect(titleFromUrl('https://www.example.com/')).toBe('example.com')
  })

  it('saves the address and your notes only (nothing is fetched)', () => {
    const link = createLink({ url: 'docs.stripe.com/webhooks', notes: 'Retry with backoff. Verify signatures.', collectionId: null })
    expect(link).toMatchObject({ kind: 'link', title: 'Webhooks · docs.stripe.com', source: { type: 'manual', url: 'https://docs.stripe.com/webhooks' }, summary: 'Retry with backoff. Verify signatures.' })
    expect(link.content).toContain('<https://docs.stripe.com/webhooks>')
    expect(() => createLink({ url: 'ftp://files' })).toThrow(/web address/)
  })
})

describe('bulk', () => {
  beforeEach(() => {
    db.insert('collections', fx.collection({ id: 'col_r', name: 'Research' }))
    db.insert('projects', fx.project({ id: 'prj_1', name: 'Lumen Launch' }))
    db.insertMany('knowledge', [fx.knowledge({ id: 'a', title: 'A' }), fx.knowledge({ id: 'b', title: 'B', tags: ['x'] }), fx.knowledge({ id: 'c', title: 'C', collectionId: 'col_r' })])
  })

  it('moves, tags and files items, with a History line on each changed item', () => {
    expect(moveKnowledge(['a', 'b', 'c'], 'col_r')).toBe(2)
    expect(db.all('knowledge').every((k) => k.collectionId === 'col_r')).toBe(true)
    expect(tagKnowledge(['a', 'b'], '#X')).toBe(1)
    expect(db.get('knowledge', 'a')?.tags).toEqual(['x'])
    expect(addKnowledgeToProject(['a', 'c'], 'prj_1')).toBe(2)
    expect(addKnowledgeToProject(['a'], 'prj_1')).toBe(0)
    expect(activity()).toEqual(expect.arrayContaining(['Moved “A” to Research', 'Moved “B” to Research', 'Tagged “A” #x', 'Added “A” to Lumen Launch']))
    expect(() => moveKnowledge(['a'], 'col_gone')).toThrow()
  })

  it('deletes several items and cleans up their references', () => {
    useContextStore.getState().pin({ kind: 'knowledge', id: 'a' })
    expect(deleteKnowledgeItems(['a', 'b', 'missing'])).toBe(2)
    expect(db.all('knowledge').map((k) => k.id)).toEqual(['c'])
    expect(useContextStore.getState().pinned).toEqual([])
  })
})

describe('usage', () => {
  it('counts the runs whose steps read an item, newest first, once per run', () => {
    db.insertMany('runs', [
      fx.run({ id: 'r1', startedAt: 10, steps: [{ id: 's1', kind: 'search', title: 'Searched', status: 'done', refs: [{ kind: 'knowledge', id: 'k' }] }, { id: 's2', kind: 'read', title: 'Read', status: 'done', refs: [{ kind: 'knowledge', id: 'k' }] }] }),
      fx.run({ id: 'r2', startedAt: 20, steps: [{ id: 's1', kind: 'read', title: 'Read', status: 'done', refs: [{ kind: 'knowledge', id: 'k' }, { kind: 'task', id: 't' }] }] }),
    ])
    const usage = knowledgeUsageIn(db.all('runs').reduce((acc, r) => ({ ...acc, [r.id]: r }), {}))
    expect(usage.get('k')).toEqual({ runIds: ['r2', 'r1'], lastAt: 20 })
    expect(usage.has('t')).toBe(false)
  })
})

describe('imports', () => {
  it('reports per-file progress and can leave errors to the host', async () => {
    const events: Pick<ImportProgress, 'index' | 'status' | 'error'>[] = []
    const broken = new File(['x'], 'broken.txt', { type: 'text/plain' })
    Object.defineProperty(broken, 'text', { value: () => Promise.reject(new Error('Permission denied')) })
    const items = await importFiles([new File(['# Hi\n\nHello there.'], 'hi.md', { type: 'text/markdown' }), broken], {
      notifyErrors: false,
      onProgress: (e) => events.push({ index: e.index, status: e.status, error: e.error }),
    })
    expect(items).toHaveLength(1)
    expect(events).toEqual([
      { index: 0, status: 'reading', error: undefined },
      { index: 0, status: 'done', error: undefined },
      { index: 1, status: 'reading', error: undefined },
      { index: 1, status: 'error', error: 'Permission denied' },
    ])
    expect(db.all('notifications')).toEqual([])
  })

  it('extracts the readable text of HTML pages for real', async () => {
    const html = `<!doctype html><html><head><title>Webhook guide</title><style>p{}</style><script>track()</script></head>
      <body><nav>Home · Docs</nav><h1>Retries</h1><p>Stripe retries <b>failed</b> webhooks for 3 days.</p>
      <ul><li>Use idempotency keys</li><li>Verify signatures</li></ul><table><tr><td>Attempt</td><td>Delay</td></tr></table>
      <pre>curl -X POST</pre></body></html>`
    expect(htmlToReadable(html)).toEqual({
      title: 'Webhook guide',
      text: '# Retries\n\nStripe retries failed webhooks for 3 days.\n\n- Use idempotency keys\n\n- Verify signatures\n\n| Attempt | Delay |\n\n```\ncurl -X POST\n```',
    })
    const [item] = await importFiles([new File([html], 'saved-page.html', { type: 'text/html' })])
    expect(item).toMatchObject({ kind: 'doc', title: 'Webhook guide' })
    expect(item.summary).toMatch(/^Stripe retries failed webhooks for 3 days\./)
    expect(item.content).not.toContain('track()')
  })

  it('treats text files that are really binary honestly', async () => {
    expect(looksBinary('abc\u0000def')).toBe(true)
    expect(looksBinary('plain text')).toBe(false)
    const [item] = await importFiles([new File([new Uint8Array([104, 105, 0, 1, 2])], 'data.txt', { type: 'text/plain' })])
    expect(item.kind).toBe('file')
    expect(item.content).toContain('looks like binary data')
  })
})
