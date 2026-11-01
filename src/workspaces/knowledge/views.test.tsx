import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextStore } from '@/core/context'
import { db, emptyTables, useDB } from '@/core/db'
import { __resetSearchForTests } from '@/core/search'
import { fx } from '@/core/services/testFixtures'
import type { KnowledgeItem } from '@/core/types'
import { connectionCount, connectionsIn } from './connections'
import { AUTOSAVE_MS, useNoteEditor } from './editor'
import { runRetrievalLab } from './lab'

beforeEach(() => {
  db.replaceAll(emptyTables())
  __resetSearchForTests()
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('connectionsIn', () => {
  it('groups where an item came from and where it is used', () => {
    const k = { kind: 'knowledge', id: 'k' } as const
    db.insertMany('knowledge', [
      fx.knowledge({ id: 'k', title: 'Pricing memo', source: { type: 'chat', ref: { kind: 'message', id: 'm0' } } }),
      fx.knowledge({ id: 'k2', title: 'Persona' }),
    ])
    db.insertMany('investigations', [fx.investigation({ id: 'inv_report', knowledgeId: 'k' }), fx.investigation({ id: 'inv_used', runIds: ['r_research'] })])
    db.insertMany('sources', [fx.source({ id: 's1', investigationId: 'inv_src', knowledgeId: 'k' })])
    db.insert('investigations', fx.investigation({ id: 'inv_src' }))
    db.insertMany('tasks', [fx.task({ id: 't_origin', origin: k }), fx.task({ id: 't_ref' })])
    db.insertMany('runs', [
      fx.run({ id: 'r_chat', kind: 'chat', startedAt: 30, steps: [{ id: 's', kind: 'search', title: 'Searched', status: 'done', refs: [k] }] }),
      fx.run({ id: 'r_research', kind: 'research', startedAt: 20, steps: [{ id: 's', kind: 'read', title: 'Read', status: 'done', refs: [k] }] }),
      fx.run({ id: 'r_maker', kind: 'agent' }),
    ])
    const at = 1
    db.insertMany('links', [
      { id: 'l1', from: { kind: 'message', id: 'm1' }, to: k, rel: 'cites', createdAt: 5 },
      { id: 'l2', from: { kind: 'task', id: 't_ref' }, to: k, rel: 'references', createdAt: at },
      { id: 'l3', from: { kind: 'run', id: 'r_maker' }, to: k, rel: 'produced', createdAt: at },
      { id: 'l4', from: k, to: { kind: 'knowledge', id: 'k2' }, rel: 'references', createdAt: at },
      { id: 'l5', from: { kind: 'knowledge', id: 'k3' }, to: k, rel: 'derived_from', createdAt: at },
    ])
    const c = connectionsIn(useDB.getState(), 'k')
    expect(c.cameFrom).toEqual([{ kind: 'message', id: 'm0' }, { kind: 'investigation', id: 'inv_report' }, { kind: 'run', id: 'r_maker' }])
    expect(c.usedBy).toEqual(['r_chat', 'r_research'])
    expect(c.citedBy).toEqual([{ ref: { kind: 'message', id: 'm1' }, at: 5 }])
    expect(c.sourced.sort()).toEqual(['inv_src', 'inv_used'])
    // Tasks made from it live in "Made from this" (DerivedList); Connections keeps the ones that point at it.
    expect(c.tasks).toEqual(['t_ref'])
    expect(c.related).toEqual([{ kind: 'knowledge', id: 'k2' }])
    expect(connectionCount(c)).toBe(10)
    expect(connectionCount(connectionsIn(useDB.getState(), 'k2'))).toBe(1)
  })
})

describe('runRetrievalLab', () => {
  const doc = (o: Partial<KnowledgeItem>) => fx.knowledge({ kind: 'doc', ...o })

  it('mirrors a chat turn: held first, then retrieved passages with scores, capped; Never and When cited are withheld', () => {
    db.insertMany('knowledge', [
      doc({ id: 'held', title: 'Brand voice', content: 'Write calmly and plainly.' }),
      doc({ id: 'never', title: 'Webhook secrets', content: 'Stripe webhook retries use signing secrets.', aiAvailability: 'never' }),
      doc({ id: 'cited', title: 'Webhook notes', content: 'Stripe webhook retries back off over three days.', aiAvailability: 'cited' }),
      ...Array.from({ length: 9 }, (_, i) => doc({ id: `w${i}`, title: `Webhook guide ${i}`, content: `Stripe webhook retries part ${i}: retry ${'webhook '.repeat(i + 1)}` })),
    ])
    const result = runRetrievalLab('How do Stripe webhook retries work?', { projectId: null, held: ['held'], memory: [], autoRetrieve: true })
    expect(result.read).toHaveLength(6)
    expect(result.read[0]).toMatchObject({ reason: 'held', score: null })
    expect(result.read[0].item.id).toBe('held')
    expect(result.read.slice(1).every((e) => e.reason === 'retrieved' && (e.score ?? 0) > 0)).toBe(true)
    const scores = result.read.slice(1).map((e) => e.score ?? 0)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(result.beyond.length).toBeGreaterThan(0)
    const shown = [...result.read, ...result.beyond].map((e) => e.item.id)
    expect(shown).not.toContain('never')
    expect(shown).not.toContain('cited')
    expect(result.withheld.map((k) => k.id).sort()).toEqual(['cited', 'never'])
    expect(result.eligible).toBe(11)
  })

  it('reads only held items when auto-retrieve is off, and nothing for an empty question', () => {
    db.insertMany('knowledge', [doc({ id: 'held', title: 'Brand voice', content: 'Write calmly.' }), doc({ id: 'x', title: 'Webhooks', content: 'Stripe webhook retries.' })])
    const off = runRetrievalLab('stripe webhook retries', { projectId: null, held: ['held'], memory: [], autoRetrieve: false })
    expect(off.read.map((e) => e.item.id)).toEqual(['held'])
    expect(runRetrievalLab('  ', { projectId: null, held: ['held'], memory: [], autoRetrieve: true }).read).toEqual([])
  })

  it('scopes to a project: other projects’ items are left out', () => {
    db.insertMany('knowledge', [
      doc({ id: 'mine', title: 'Webhooks A', content: 'Stripe webhook retries.', projectIds: ['prj_1'] }),
      doc({ id: 'other', title: 'Webhooks B', content: 'Stripe webhook retries.', projectIds: ['prj_2'] }),
      doc({ id: 'global', title: 'Webhooks C', content: 'Stripe webhook retries.' }),
    ])
    const r = runRetrievalLab('stripe webhook retries', { projectId: 'prj_1', held: [], memory: [], autoRetrieve: true })
    expect(r.read.map((e) => e.item.id)).toEqual(['mine', 'global'])
  })
})

describe('useNoteEditor', () => {
  it('turns a draft into a note on its first words, keeps the title in step, and logs one line', () => {
    vi.useFakeTimers()
    const onCreated = vi.fn()
    const { result, rerender } = renderHook((props: { item?: KnowledgeItem }) => useNoteEditor({ item: props.item, isNew: !props.item, collectionId: 'col_1', projectId: 'prj_1', onCreated }), { initialProps: {} })
    act(() => result.current.setDraft('   '))
    act(() => void vi.advanceTimersByTime(AUTOSAVE_MS + 10))
    expect(db.all('knowledge')).toHaveLength(0)

    act(() => result.current.setDraft('# Deploy freeze\n\nNo deploys on Fridays.'))
    expect(result.current.status).toBe('dirty')
    act(() => void vi.advanceTimersByTime(AUTOSAVE_MS + 10))
    const [note] = db.all('knowledge')
    expect(note).toMatchObject({ title: 'Deploy freeze', kind: 'note', collectionId: 'col_1', projectIds: ['prj_1'] })
    expect(onCreated).toHaveBeenCalledWith(note.id)
    expect(result.current.status).toBe('saved')

    rerender({ item: db.get('knowledge', note.id) })
    act(() => result.current.setDraft('# Deploy freeze (Q4)\n\nNo deploys on Fridays.'))
    act(() => void vi.advanceTimersByTime(AUTOSAVE_MS + 10))
    expect(db.get('knowledge', note.id)?.title).toBe('Deploy freeze (Q4)')
    act(() => result.current.lockTitle())
    act(() => result.current.setDraft('# Something else\n\nBody'))
    act(() => result.current.flush())
    expect(db.get('knowledge', note.id)).toMatchObject({ title: 'Deploy freeze (Q4)', content: '# Something else\n\nBody' })
    expect(db.all('activity').map((a) => a.verb)).toEqual(['created'])
  })

  it('edits an existing item: first save logs "Edited", later saves are silent, leaving saves', () => {
    vi.useFakeTimers()
    db.insert('knowledge', fx.knowledge({ id: 'k', title: 'Plan', content: 'v1' }))
    const { result, unmount } = renderHook(() => useNoteEditor({ item: db.get('knowledge', 'k'), isNew: false }))
    act(() => result.current.setDraft('v2'))
    act(() => void vi.advanceTimersByTime(AUTOSAVE_MS + 10))
    act(() => result.current.setDraft('v3'))
    act(() => void vi.advanceTimersByTime(AUTOSAVE_MS + 10))
    act(() => result.current.setDraft('v4'))
    unmount()
    expect(db.get('knowledge', 'k')?.content).toBe('v4')
    expect(db.all('activity').map((a) => a.summary)).toEqual(['Edited “Plan”'])
  })
})
