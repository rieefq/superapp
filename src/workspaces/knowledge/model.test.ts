import { describe, expect, it } from 'vitest'
import { fx } from '@/core/services/testFixtures'
import {
  activeFacetCount,
  countWords,
  effectiveSort,
  excerptOf,
  inScope,
  isIndexed,
  libraryQueryString,
  matchesFacets,
  matchesSection,
  matchesSmartFilter,
  memoryIdsIn,
  parseLibraryParams,
  parseTagInput,
  RECENT_MS,
  sameSection,
  sortItems,
  titleFromContent,
  type FilterContext,
} from './model'
import { newNoteHref } from './nav'

const NOW = 1_800_000_000_000
const ctx = (o: Partial<FilterContext> = {}): FilterContext => ({ held: new Set(), memory: new Set(), now: NOW, ...o })

describe('library URL state', () => {
  it('parses sections, facets and sort, ignoring junk', () => {
    const q = parseLibraryParams(new URLSearchParams('collection=col_1&q=pricing&kind=doc,nope,link&source=upload&project=prj_1&sort=used'))
    expect(q).toEqual({ section: { type: 'collection', id: 'col_1' }, q: 'pricing', kinds: ['doc', 'link'], sources: ['upload'], project: 'prj_1', sort: 'used' })
    expect(parseLibraryParams(new URLSearchParams('collection=none')).section).toEqual({ type: 'collection', id: null })
    expect(parseLibraryParams(new URLSearchParams('filter=held')).section).toEqual({ type: 'filter', id: 'held' })
    expect(parseLibraryParams(new URLSearchParams('filter=bogus&sort=bogus'))).toMatchObject({ section: { type: 'all' }, sort: null })
    expect(parseLibraryParams(new URLSearchParams('tag=Launch-Plan')).section).toEqual({ type: 'tag', tag: 'launch-plan' })
  })

  it('round-trips through the canonical query string (defaults omitted)', () => {
    const q = parseLibraryParams(new URLSearchParams('tag=pricing&q=annual plans&kind=note&project=none&sort=title'))
    expect(parseLibraryParams(new URLSearchParams(libraryQueryString(q)))).toEqual(q)
    expect(libraryQueryString({ section: { type: 'all' }, q: '  ', kinds: [], sources: [], project: null, sort: null })).toBe('')
  })

  it('sorts by relevance while searching unless told otherwise', () => {
    expect(effectiveSort({ q: 'x', sort: null })).toBe('relevance')
    expect(effectiveSort({ q: '', sort: null })).toBe('updated')
    expect(effectiveSort({ q: '', sort: 'relevance' })).toBe('updated')
    expect(effectiveSort({ q: 'x', sort: 'title' })).toBe('title')
  })

  it('compares sections and counts facets', () => {
    expect(sameSection({ type: 'collection', id: null }, { type: 'collection', id: null })).toBe(true)
    expect(sameSection({ type: 'collection', id: 'a' }, { type: 'collection', id: 'b' })).toBe(false)
    expect(sameSection({ type: 'all' }, { type: 'tag', tag: 'x' })).toBe(false)
    expect(activeFacetCount({ kinds: ['doc', 'note'], sources: ['upload'], project: 'prj_1' })).toBe(4)
  })

  it('N files a new note in the collection in view', () => {
    expect(newNoteHref('?collection=col_eng', '/knowledge')).toBe('/knowledge/new?collection=col_eng')
    expect(newNoteHref('?collection=none', '/knowledge')).toBe('/knowledge/new')
    expect(newNoteHref('?collection=col_eng', '/knowledge/kno_1')).toBe('/knowledge/new')
  })
})

describe('sections, smart filters and facets', () => {
  it('matches collections (and items without one), tags and scope', () => {
    const a = fx.knowledge({ id: 'a', collectionId: 'col_1', tags: ['pricing'], projectIds: ['prj_1'] })
    const b = fx.knowledge({ id: 'b', collectionId: null })
    expect(matchesSection(a, { type: 'collection', id: 'col_1' }, ctx())).toBe(true)
    expect(matchesSection(b, { type: 'collection', id: null }, ctx())).toBe(true)
    expect(matchesSection(a, { type: 'collection', id: null }, ctx())).toBe(false)
    expect(matchesSection(a, { type: 'tag', tag: 'pricing' }, ctx())).toBe(true)
    expect(inScope(a, 'prj_1')).toBe(true)
    expect(inScope(b, 'prj_1')).toBe(false)
    expect(inScope(b, null)).toBe(true)
  })

  it('applies each smart filter from the item and the context', () => {
    const recent = fx.knowledge({ id: 'r', updatedAt: NOW - RECENT_MS + 1000 })
    const old = fx.knowledge({ id: 'o', createdAt: 1, updatedAt: NOW - RECENT_MS - 1000 })
    expect(matchesSmartFilter(recent, 'recent', ctx())).toBe(true)
    expect(matchesSmartFilter(old, 'recent', ctx())).toBe(false)
    expect(matchesSmartFilter(old, 'held', ctx({ held: new Set(['o']) }))).toBe(true)
    expect(matchesSmartFilter(old, 'memory', ctx({ memory: new Set(['o']) }))).toBe(true)
    expect(matchesSmartFilter(fx.knowledge({ source: { type: 'research', ref: { kind: 'investigation', id: 'inv_1' } } }), 'research', ctx())).toBe(true)
    expect(matchesSmartFilter(fx.knowledge({ source: { type: 'upload' } }), 'uploads', ctx())).toBe(true)
    expect(matchesSmartFilter(fx.knowledge({ source: { type: 'manual', ref: { kind: 'message', id: 'msg_1' } } }), 'chat', ctx())).toBe(true)
    expect(matchesSmartFilter(fx.knowledge({ author: { type: 'agent', id: 'agt_1' } }), 'agents', ctx())).toBe(true)
    expect(matchesSmartFilter(fx.knowledge({ simulated: true }), 'simulated', ctx())).toBe(true)
    expect(matchesSmartFilter(fx.knowledge(), 'simulated', ctx())).toBe(false)
  })

  it('filters by kind, source and project (including "no project")', () => {
    const item = fx.knowledge({ kind: 'doc', source: { type: 'upload' }, projectIds: ['prj_1'] })
    const none = { kinds: [], sources: [], project: null }
    expect(matchesFacets(item, { ...none, kinds: ['doc'] })).toBe(true)
    expect(matchesFacets(item, { ...none, kinds: ['note'] })).toBe(false)
    expect(matchesFacets(item, { ...none, sources: ['manual'] })).toBe(false)
    expect(matchesFacets(item, { ...none, project: 'prj_1' })).toBe(true)
    expect(matchesFacets(item, { ...none, project: 'none' })).toBe(false)
    expect(matchesFacets(fx.knowledge({ projectIds: [] }), { ...none, project: 'none' })).toBe(true)
  })

  it('collects project memory for the scope, or every project when unscoped', () => {
    const projects = {
      prj_1: fx.project({ id: 'prj_1', pinnedRefs: [{ kind: 'knowledge', id: 'a' }, { kind: 'task', id: 't' }] }),
      prj_2: fx.project({ id: 'prj_2', pinnedRefs: [{ kind: 'knowledge', id: 'b' }] }),
    }
    expect([...memoryIdsIn(projects, 'prj_1')]).toEqual(['a'])
    expect([...memoryIdsIn(projects, null)].sort()).toEqual(['a', 'b'])
  })
})

describe('sorting and item facts', () => {
  const items = [
    fx.knowledge({ id: 'a', title: 'beta 10', updatedAt: 3 }),
    fx.knowledge({ id: 'b', title: 'Alpha', updatedAt: 1 }),
    fx.knowledge({ id: 'c', title: 'beta 9', updatedAt: 2 }),
  ]
  it('sorts by updated, title (natural, case-insensitive) and usage', () => {
    expect(sortItems(items, 'updated', () => 0).map((k) => k.id)).toEqual(['a', 'c', 'b'])
    expect(sortItems(items, 'title', () => 0).map((k) => k.id)).toEqual(['b', 'c', 'a'])
    const used: Record<string, number> = { b: 5, c: 5, a: 1 }
    expect(sortItems(items, 'used', (id) => used[id]).map((k) => k.id)).toEqual(['c', 'b', 'a'])
    expect(sortItems(items, 'relevance', () => 0)).not.toBe(items)
  })

  it('knows which files were not indexed', () => {
    expect(isIndexed(fx.knowledge({ kind: 'file', file: { name: 'deck.pdf', mime: 'application/pdf', size: 1 } }))).toBe(false)
    expect(isIndexed(fx.knowledge({ kind: 'file', file: { name: 'photo.png', mime: 'image/png', size: 1 } }))).toBe(false)
    expect(isIndexed(fx.knowledge({ kind: 'file', file: { name: 'retro.csv', mime: 'text/csv', size: 1 } }))).toBe(true)
    expect(isIndexed(fx.knowledge({ kind: 'note' }))).toBe(true)
  })

  it('derives excerpts, titles, word counts and tags', () => {
    expect(excerptOf({ summary: '  Short summary. ', content: 'ignored' })).toBe('Short summary.')
    expect(excerptOf({ content: '# Heading\n\nSome **bold** text.' })).toBe('Heading Some bold text.')
    expect(excerptOf({ content: 'word '.repeat(100) }, 40).length).toBeLessThanOrEqual(41)
    expect(titleFromContent('\n\n# Launch plan  \nbody')).toBe('Launch plan')
    expect(titleFromContent('- first item')).toBe('first item')
    expect(titleFromContent('   ')).toBe('')
    expect(titleFromContent('x'.repeat(120))).toHaveLength(80)
    expect(countWords("It's a well-known 2-step plan.")).toBe(5)
    expect(parseTagInput('#Launch plan, q4,, #Q4')).toEqual(['launch-plan', 'q4', 'q4'])
  })
})
