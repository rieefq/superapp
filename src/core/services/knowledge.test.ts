import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getContext, useContextStore } from '@/core/context'
import { db, emptyTables } from '@/core/db'
import { classifyFile, MAX_TEXT_BYTES, titleFromFilename } from './fileImport'
import {
  createCollection,
  createKnowledge,
  deleteCollection,
  deleteKnowledge,
  duplicateKnowledge,
  importFiles,
  matchesKnowledge,
  removeTag,
  renameTag,
  toggleKnowledgePinned,
  updateKnowledge,
  useKnowledge,
  useTags,
  wordCount,
} from './knowledge'
import { firstSentences } from './serviceHelpers'
import { fx } from './testFixtures'

beforeEach(() => {
  db.replaceAll(emptyTables())
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
})

afterEach(() => vi.unstubAllGlobals())

describe('createKnowledge', () => {
  it('applies defaults and logs activity', () => {
    const item = createKnowledge({ title: ' Notes ', content: 'Body', tags: ['#Launch Plan', 'launch-plan'] })
    expect(item).toMatchObject({
      title: 'Notes', kind: 'note', tags: ['launch-plan'], projectIds: [], collectionId: null,
      source: { type: 'manual' }, author: { type: 'user', id: 'usr_me' },
    })
    expect(db.all('activity')[0]).toMatchObject({ verb: 'created', summary: 'Added “Notes” to Knowledge' })
  })

  it('links the source, marks message backlinks and notifies for agent authors', () => {
    db.insert('agents', fx.agent({ id: 'agt_1', name: 'Scout' }))
    db.insert('messages', fx.message({ id: 'msg_1' }))
    const item = createKnowledge({
      title: 'From chat', content: 'x', source: { type: 'chat', ref: { kind: 'message', id: 'msg_1' } }, author: { type: 'agent', id: 'agt_1' },
    })
    expect(db.all('links')[0]).toMatchObject({ from: { kind: 'knowledge', id: item.id }, to: { kind: 'message', id: 'msg_1' }, rel: 'derived_from' })
    expect(db.get('messages', 'msg_1')?.derived).toEqual([{ kind: 'knowledge', id: item.id }])
    expect(db.all('notifications')[0]).toMatchObject({ kind: 'knowledge.added', title: 'Scout saved “From chat”' })
  })

  it('updates, pins, duplicates and deletes with cleanup', () => {
    const item = createKnowledge({ title: 'Doc', content: 'v1' })
    expect(updateKnowledge(item.id, { content: 'v2' })?.content).toBe('v2')
    expect(toggleKnowledgePinned(item.id)?.pinned).toBe(true)
    const copy = duplicateKnowledge(item.id)!
    expect(copy.title).toBe('Doc (copy)')
    expect(db.all('links').some((l) => l.from.id === copy.id && l.to.id === item.id)).toBe(true)

    db.insert('investigations', fx.investigation({ id: 'inv_1', knowledgeId: item.id }))
    db.insert('projects', fx.project({ id: 'prj_1', pinnedRefs: [{ kind: 'knowledge', id: item.id }] }))
    getContext().pin({ kind: 'knowledge', id: item.id })
    deleteKnowledge(item.id)
    expect(db.get('knowledge', item.id)).toBeUndefined()
    expect(db.get('investigations', 'inv_1')?.knowledgeId).toBeUndefined()
    expect(db.get('projects', 'prj_1')?.pinnedRefs).toEqual([])
    expect(getContext().pinned).toEqual([])
    expect(db.all('links')).toEqual([])
  })
})

describe('importFiles', () => {
  it('reads Markdown for real: title, content and a first-sentences summary', async () => {
    const md = '# Pricing memo\n\nWe propose three tiers. Each tier maps to a usage band! Details follow.\n'
    const [item] = await importFiles([new File([md], 'q4_pricing-memo.md', { type: 'text/markdown' })], { projectId: 'prj_1', collectionId: 'col_1' })
    expect(item).toMatchObject({
      kind: 'doc', title: 'Q4 pricing memo', content: md, summary: 'We propose three tiers. Each tier maps to a usage band!',
      source: { type: 'upload' }, projectIds: ['prj_1'], collectionId: 'col_1',
      file: { name: 'q4_pricing-memo.md', mime: 'text/markdown', size: md.length },
    })
    expect(db.all('activity')[0]).toMatchObject({ verb: 'imported', summary: 'Imported “Q4 pricing memo” into Knowledge' })
  })

  it('imports CSV as a dataset with a real shape summary, and code as a fenced snippet', async () => {
    const csv = 'account,arr_usd,"region, hq"\nMeridian,120000,"EU, Rotterdam"\nCoastal,80000,US\n'
    const [data, code] = await importFiles([
      new File([csv], 'top accounts.csv', { type: '' }),
      new File(['export const x = 1\n'], 'x.ts', { type: '' }),
    ])
    expect(data).toMatchObject({ kind: 'dataset', summary: '2 rows × 3 columns: account, arr_usd, region, hq.' })
    expect(data.content.startsWith('```csv\n')).toBe(true)
    expect(data.file?.mime).toBe('text/csv')
    expect(code).toMatchObject({ kind: 'snippet', content: '```typescript\nexport const x = 1\n```', summary: 'TypeScript file, 2 lines.' })
  })

  it('truncates large text files at 400 KB with a note', async () => {
    const big = 'a'.repeat(MAX_TEXT_BYTES + 5_000)
    const [item] = await importFiles([new File([big], 'huge.log', { type: 'text/plain' })])
    expect(item.content).toContain('Only the first 400.0 KB')
    expect(item.content.length).toBeLessThan(big.length)
    expect(item.summary).toContain('partially imported')
  })

  it('stores a downscaled JPEG preview for images', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1600, height: 900, close })))
    const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as unknown as HTMLCanvasElement['getContext'])
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA')

    const [item] = await importFiles([new File([new Uint8Array([137, 80, 78, 71])], 'hero-shot.png', { type: 'image/png' })])
    expect(item).toMatchObject({ kind: 'file', title: 'Hero shot', summary: 'PNG image, 1600 × 900 px.' })
    expect(item.file?.previewUrl).toBe('data:image/jpeg;base64,AAAA')
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 480, 270)
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.82)
    expect(close).toHaveBeenCalled()
    expect(item.content).toContain('1600 × 900 px')
    expect(item.content).toContain('No captioning or text recognition (OCR) was run')
  })

  it('falls back to metadata when images cannot be decoded (jsdom has no canvas)', async () => {
    const [item] = await importFiles([new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' })])
    expect(item.kind).toBe('file')
    expect(item.file?.previewUrl).toBeUndefined()
    expect(item.content).toContain('Preview: not available')
  })

  it('is honest about PDFs and other binaries', async () => {
    const [pdf, bin] = await importFiles([
      new File([new Uint8Array([37, 80, 68, 70])], 'Board deck.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array([0, 1])], 'archive.zip', { type: 'application/zip' }),
    ])
    expect(pdf).toMatchObject({ kind: 'file', title: 'Board deck' })
    expect(pdf.content).toContain('Text extraction from PDFs isn’t available in this build')
    expect(bin.content).toContain('can’t be read in the browser')
    expect(bin.summary).toContain('contents not extracted')
  })

  it('skips unreadable files with a warning and keeps going', async () => {
    const broken = new File(['x'], 'notes.txt', { type: 'text/plain' })
    Object.defineProperty(broken, 'text', { value: () => Promise.reject(new Error('Permission denied')) })
    const items = await importFiles([broken, new File(['ok'], 'ok.txt', { type: 'text/plain' })])
    expect(items.map((i) => i.title)).toEqual(['Ok'])
    expect(db.all('notifications')[0]).toMatchObject({ title: 'Couldn’t import notes.txt', body: 'Permission denied', tone: 'warning' })
  })
})

describe('collections and tags', () => {
  it('deleting a collection keeps its items without a collection', () => {
    const col = createCollection({ name: 'Brand' })
    db.insert('knowledge', fx.knowledge({ id: 'k1', collectionId: col.id }))
    db.insert('agents', fx.agent({ id: 'agt_1', knowledgeScope: { all: false, collectionIds: [col.id], projectIds: [] } }))
    deleteCollection(col.id)
    expect(db.get('knowledge', 'k1')?.collectionId).toBeNull()
    expect(db.get('agents', 'agt_1')?.knowledgeScope.collectionIds).toEqual([])
    expect(db.all('activity').at(-1)?.summary).toContain('1 item kept')
  })

  it('renames (merging duplicates) and removes tags across items', () => {
    db.insertMany('knowledge', [
      fx.knowledge({ id: 'k1', tags: ['pricing', 'q4'] }),
      fx.knowledge({ id: 'k2', tags: ['pricing', 'strategy'] }),
      fx.knowledge({ id: 'k3', tags: ['other'] }),
    ])
    expect(renameTag('pricing', 'Strategy')).toBe(2)
    expect(db.get('knowledge', 'k1')?.tags).toEqual(['strategy', 'q4'])
    expect(db.get('knowledge', 'k2')?.tags).toEqual(['strategy'])
    expect(renderHook(() => useTags()).result.current).toEqual([
      { tag: 'strategy', count: 2 },
      { tag: 'other', count: 1 },
      { tag: 'q4', count: 1 },
    ])
    expect(removeTag('#strategy')).toBe(2)
    expect(db.get('knowledge', 'k2')?.tags).toEqual([])
  })
})

describe('filters and helpers', () => {
  it('matches by collection, project, kind, tag and query words', () => {
    const item = fx.knowledge({ title: 'Stripe Billing migration plan', content: 'Move invoices.', tags: ['billing'], projectIds: ['prj_1'], collectionId: 'col_1' })
    expect(matchesKnowledge(item, { query: 'stripe INVOICES' })).toBe(true)
    expect(matchesKnowledge(item, { query: 'stripe refunds' })).toBe(false)
    expect(matchesKnowledge(item, { collectionId: null })).toBe(false)
    expect(matchesKnowledge(item, { collectionId: 'col_1', projectId: 'prj_1', kind: ['note', 'doc'], tag: '#Billing' })).toBe(true)
  })

  it('useKnowledge sorts pinned first, then most recent', () => {
    db.insertMany('knowledge', [
      fx.knowledge({ id: 'old', updatedAt: 1 }),
      fx.knowledge({ id: 'new', updatedAt: 3 }),
      fx.knowledge({ id: 'pinned', updatedAt: 2, pinned: true }),
    ])
    expect(renderHook(() => useKnowledge()).result.current.map((k) => k.id)).toEqual(['pinned', 'new', 'old'])
  })

  it('counts words and derives summaries and titles', () => {
    expect(wordCount('## Hello, world — it’s a re-run of 3 tests!')).toBe(8)
    expect(firstSentences('# Title\n\n```js\ncode()\n```\nFirst one. Second one? Third.')).toBe('First one. Second one?')
    expect(firstSentences('Version 2.5 ships soon, e.g. next week. Then more.', 1)).toBe('Version 2.5 ships soon, e.g. next week.')
    expect(titleFromFilename('meeting_notes-2026.TXT')).toBe('Meeting notes 2026')
    expect(classifyFile({ name: 'a.unknown', type: 'text/x-custom' })).toBe('text')
    expect(classifyFile({ name: 'IMG.HEIC', type: 'image/heic' })).toBe('image')
  })
})
