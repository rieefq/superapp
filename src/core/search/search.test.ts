import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { createRng } from '@/lib/rng'
import { fx, syntheticWords } from './fixtures.test-utils'
import { __resetSearchForTests, getSearchIndexVersion, isSearchReady, retrieveKnowledge, search, subscribeSearchIndex } from './index'
import { stem, fold } from './text'

beforeEach(() => {
  db.replaceAll(emptyTables())
  __resetSearchForTests()
})

afterEach(() => {
  __resetSearchForTests()
  vi.useRealTimers()
})

const keys = (q: string, opts?: Parameters<typeof search>[1]) => search(q, opts).map((r) => `${r.kind}:${r.ref.id}`)

describe('search basics', () => {
  it('returns nothing for empty input, stopwords only, or no index', () => {
    db.insert('tasks', fx.task('t1', 'The plan'))
    expect(search('')).toEqual([])
    expect(search('   ')).toEqual([])
    expect(search('the and of ')).toEqual([])
  })

  it('builds lazily on the first query', () => {
    db.insert('tasks', fx.task('t1', 'Rotate API keys'))
    expect(isSearchReady()).toBe(false)
    expect(keys('rotate')).toEqual(['task:t1'])
    expect(isSearchReady()).toBe(true)
  })

  it('ranks title matches above body matches (title boost)', () => {
    db.insertMany('knowledge', [
      fx.knowledge('k_body', 'Quarterly notes', 'We discussed the Stripe invoices briefly before moving on to hiring and roadmap items.'),
      fx.knowledge('k_title', 'Stripe Billing migration plan', 'Steps, owners and timeline for the move.'),
    ])
    expect(keys('stripe')).toEqual(['knowledge:k_title', 'knowledge:k_body'])
  })

  it('matches inflections, case and diacritics', () => {
    db.insertMany('tasks', [
      fx.task('t1', 'Draft pricing tiers for Lumen'),
      fx.task('t2', 'Book the Café Société offsite'),
      fx.task('t3', 'Migrating invoices'),
    ])
    expect(keys('PRICE')).toEqual(['task:t1'])
    expect(keys('cafe societe')).toEqual(['task:t2'])
    expect(keys('migrated invoice')).toEqual(['task:t3'])
  })

  it('completes the word being typed as a prefix', () => {
    db.insertMany('tasks', [fx.task('t1', 'Stripe migration checklist'), fx.task('t2', 'Mobile layout fixes')])
    expect(keys('migr')).toEqual(['task:t1'])
    expect(keys('stripe mi')).toEqual(['task:t1'])
    expect(keys('m')).toEqual(expect.arrayContaining(['task:t1', 'task:t2']))
    // A trailing space means the word is complete: "migr" is not a word.
    expect(keys('migr ')).toEqual([])
  })

  it('treats a stopword being typed as optional ("for" on the way to "forge")', () => {
    db.insertMany('agents', [fx.agent('a1', 'Forge', 'Coding agent')])
    db.insertMany('tasks', [fx.task('t1', 'Plan review')])
    expect(keys('for')).toEqual(['agent:a1'])
    // "plan" is required; the optional "for…" neither demotes the plan task nor admits Forge on its own.
    const results = search('plan for')
    expect(results.map((r) => r.ref.id)).toEqual(['t1'])
    expect(results[0].score).toBeCloseTo(search('plan')[0].score, 10)
    // A real (non-stopword) prefix is required like any other term.
    expect(keys('plan fo').sort()).toEqual(['agent:a1', 'task:t1'])
  })

  it('prefers documents that match every term', () => {
    db.insertMany('tasks', [
      fx.task('t_one', 'Session cleanup'),
      fx.task('t_all', 'Session expiry after SSO login'),
      fx.task('t_other', 'Login page copy'),
    ])
    const results = keys('session login')
    expect(results[0]).toBe('task:t_all')
    expect(results).toHaveLength(3)
  })

  it('rewards the exact phrase and breaks ties by recency', () => {
    db.insertMany('tasks', [
      fx.task('t_phrase', 'session expiry token', { updatedAt: 1 }),
      fx.task('t_scrambled', 'session token expiry', { updatedAt: 2 }),
      fx.task('t_twin_old', 'Rotate signing keys', { updatedAt: 5 }),
      fx.task('t_twin_new', 'Rotate signing keys', { updatedAt: 9 }),
    ])
    const phrase = search('session expiry')
    expect(phrase.map((r) => r.ref.id)).toEqual(['t_phrase', 't_scrambled'])
    expect(phrase[0].score / phrase[1].score).toBeCloseTo(1.5, 5)
    expect(keys('rotate signing')).toEqual(['task:t_twin_new', 'task:t_twin_old'])
  })

  it('respects the limit', () => {
    db.insertMany('tasks', Array.from({ length: 30 }, (_, i) => fx.task(`t${i}`, `Launch task ${i}`)))
    expect(search('launch')).toHaveLength(20)
    expect(search('launch', { limit: 5 })).toHaveLength(5)
  })
})

describe('coverage of entity kinds', () => {
  it('indexes every searchable table with the right kind and fields', () => {
    db.insert('projects', fx.project('p1', 'Atlas Portal', { goal: 'zephyrgoal adoption' }))
    db.insert('tasks', fx.task('t1', 'Task', { labels: ['zephyrlabel'] }))
    db.insert('threads', fx.thread('th1', 'Chat', ['m1']))
    db.insert('messages', fx.message('m1', 'th1', 'zephyrmessage text'))
    db.insert('knowledge', fx.knowledge('k1', 'Doc', 'body', { tags: ['zephyrtag'] }))
    db.insert('collections', fx.collection('c1', 'Zephyrcollection'))
    db.insert('investigations', fx.investigation('i1', 'Inv', null, { question: 'zephyrquestion?' }))
    db.insert('sources', fx.source('s1', 'i1', 'Src', 'snippet', { domain: 'zephyrdomain.example' }))
    db.insert('agents', fx.agent('a1', 'Agent', 'zephyrrole'))
    db.insert('workflows', fx.workflow('w1', 'Flow', 'zephyrflow digest'))
    db.insert('sessions', fx.session('se1', 'Session', ['zephyrprompt please']))
    db.insert('repos', fx.repo('r1', 'northwind/zephyrrepo', 'repo'))
    db.insert('assets', fx.asset('as1', 'Asset', 'zephyrprompt hero image'))
    db.insert('boards', fx.board('b1', 'Zephyrboard'))
    const found = new Set(search('zephyr', { limit: 50 }).map((r) => r.kind))
    expect([...found].sort()).toEqual(
      ['agent', 'asset', 'board', 'collection', 'investigation', 'knowledge', 'project', 'repo', 'session', 'source', 'task', 'thread', 'workflow'],
    )
  })
})

describe('filters', () => {
  beforeEach(() => {
    db.insertMany('projects', [fx.project('p1', 'Launch alpha'), fx.project('p2', 'Launch beta')])
    db.insertMany('tasks', [fx.task('t1', 'Launch checklist', { projectId: 'p1' }), fx.task('t2', 'Launch retro', { projectId: 'p2' })])
    db.insert('knowledge', fx.knowledge('k1', 'Launch playbook', 'shared', { projectIds: ['p2', 'p1'] }))
    db.insert('investigations', fx.investigation('i1', 'Competitors', 'p1'))
    db.insert('sources', fx.source('s1', 'i1', 'Launch teardown', 'How rivals launch'))
    db.insert('agents', fx.agent('a1', 'Launch herald', 'Comms'))
  })

  it('filters by kinds', () => {
    expect(keys('launch', { kinds: ['task'] }).sort()).toEqual(['task:t1', 'task:t2'])
    expect(keys('launch', { kinds: ['knowledge', 'source'] }).sort()).toEqual(['knowledge:k1', 'source:s1'])
  })

  it("filters by the entity's project (knowledge by membership, sources via their investigation)", () => {
    expect(keys('launch', { projectId: 'p1' }).sort()).toEqual(['knowledge:k1', 'project:p1', 'source:s1', 'task:t1'])
    const k1 = search('playbook', { projectId: 'p1' })[0]
    expect(k1.projectId).toBe('p1')
    expect(keys('launch', { projectId: null })).toHaveLength(7)
    db.update('investigations', 'i1', { projectId: 'p2' })
    expect(keys('teardown', { projectId: 'p1' })).toEqual([])
  })
})

describe('snippets', () => {
  it('excerpts the best-matching message of a thread and anchors it', () => {
    db.insert('threads', fx.thread('th1', 'Pricing chat', ['m1', 'm2', 'm3'], { projectId: 'p1' }))
    db.insertMany('messages', [
      fx.message('m1', 'th1', 'Hi! Can we talk about pricing?'),
      fx.message('m2', 'th1', 'Usage-based **pricing** suits freight customers with seasonal volume.'),
      fx.message('m3', 'th1', 'Thanks.'),
    ])
    const [result] = search('usage pricing')
    expect(result).toMatchObject({ kind: 'thread', title: 'Pricing chat', projectId: 'p1', anchor: { kind: 'message', id: 'm2' } })
    expect(result.snippet).toBe('Usage-based pricing suits freight customers with seasonal volume.')
    expect(result.highlights.map(([a, b]) => result.snippet.slice(a, b))).toEqual(['Usage', 'pricing'])
  })

  it('highlights only words matching the query', () => {
    const content = `${'Background paragraph about other topics. '.repeat(6)}The checkout latency spike on Oct 21 was caused by a cold cache. ${'More unrelated text. '.repeat(6)}`
    db.insert('knowledge', fx.knowledge('k1', 'Incident report', content))
    const [result] = search('latency caches')
    expect(result.snippet.length).toBeLessThanOrEqual(142)
    expect(result.snippet).toContain('checkout latency spike')
    const stems = new Set(['latency', 'caches'].map((w) => stem(fold(w))))
    expect(result.highlights.length).toBe(2)
    for (const [a, b] of result.highlights) expect(stems.has(stem(fold(result.snippet.slice(a, b))))).toBe(true)
  })
})

describe('incremental updates', () => {
  it('sees inserts, edits and deletes made after the index was built', () => {
    db.insert('tasks', fx.task('t1', 'Write release notes'))
    expect(keys('release')).toEqual(['task:t1'])
    db.insert('tasks', fx.task('t2', 'Release checklist'))
    expect(keys('release').sort()).toEqual(['task:t1', 'task:t2'])
    db.update('tasks', 't1', { title: 'Write changelog' })
    expect(keys('release')).toEqual(['task:t2'])
    expect(keys('changelog')).toEqual(['task:t1'])
    db.remove('tasks', 't2')
    expect(keys('release')).toEqual([])
    expect(keys('rele')).toEqual([])
  })

  it('re-indexes a thread when its messages stream in', () => {
    db.insert('threads', fx.thread('th1', 'Chat', ['m1']))
    db.insert('messages', fx.message('m1', 'th1', 'Hello'))
    expect(keys('quarterly')).toEqual([])
    db.update('messages', 'm1', { content: 'Hello — the quarterly forecast' })
    expect(keys('quarterly')).toEqual(['thread:th1'])
  })

  it('syncs in the background (debounced) and notifies subscribers', () => {
    vi.useFakeTimers()
    db.insert('tasks', fx.task('t1', 'Alpha'))
    search('alpha')
    const listener = vi.fn()
    subscribeSearchIndex(listener)
    vi.advanceTimersByTime(0) // query-time build notifies asynchronously
    listener.mockClear()
    const version = getSearchIndexVersion()

    db.insert('tasks', fx.task('t2', 'Beta'))
    vi.advanceTimersByTime(249)
    expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getSearchIndexVersion()).toBe(version + 1)

    // Unrelated tables do not trigger re-indexing.
    db.insert('notifications', { id: 'n1', kind: 'system', title: 'x', tone: 'neutral', createdAt: 0 })
    vi.advanceTimersByTime(1000)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('performance', () => {
  it('answers queries over 2,500 knowledge items (+ tasks and threads) in under 20ms', () => {
    const rng = createRng(42).next
    const vocab = [
      ...syntheticWords(rng, 4000),
      'stripe', 'migration', 'pricing', 'customer', 'churn', 'interview', 'launch', 'lumen', 'session', 'expiry', 'login',
      'quarterly', 'revenue', 'forecast', 'rate', 'limits', 'freight', 'portal', 'invoice', 'analytics',
    ]
    const sentence = () => {
      const n = 8 + Math.floor(rng() * 8)
      const words: string[] = []
      for (let i = 0; i < n; i++) words.push(vocab[Math.floor(rng() * vocab.length)])
      return `${words.join(' ')}.`
    }
    const paragraph = () => Array.from({ length: 3 + Math.floor(rng() * 3) }, sentence).join(' ')
    db.insertMany('knowledge', Array.from({ length: 2500 }, (_, i) =>
      fx.knowledge(`k${i}`, sentence(), Array.from({ length: 3 }, paragraph).join('\n\n'), { tags: [vocab[i % vocab.length]], updatedAt: i }),
    ))
    db.insertMany('tasks', Array.from({ length: 600 }, (_, i) => fx.task(`t${i}`, sentence(), { description: paragraph(), updatedAt: i })))
    db.insertMany('threads', Array.from({ length: 200 }, (_, i) => fx.thread(`th${i}`, sentence(), [0, 1, 2, 3, 4].map((m) => `m${i}_${m}`))))
    db.insertMany('messages', Array.from({ length: 1000 }, (_, i) => fx.message(`m${Math.floor(i / 5)}_${i % 5}`, `th${Math.floor(i / 5)}`, paragraph())))

    const buildStart = performance.now()
    search('warmup')
    const buildMs = performance.now() - buildStart

    const queries = [
      'stripe migration', 'pricing', 'pri', 'customer churn interview', 'launch plan for lumen', 'ka', 'session expiry after sso login',
      'quarterly revenue forecast', 'mi', 'rate limits', 'freight portal invoice analytics', 'lo', 'tor', 'revenue', 'churn',
    ]
    const times: number[] = []
    for (let round = 0; round < 2; round++) {
      for (const q of queries) {
        const t0 = performance.now()
        const results = search(q)
        times.push(performance.now() - t0)
        expect(results.length).toBeGreaterThan(0)
      }
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const sorted = [...times].sort((a, b) => a - b)
    const p90 = sorted[Math.floor(sorted.length * 0.9)]

    const retrievalTimes: number[] = []
    for (const q of ['How should we price the stripe migration for freight customers?', 'customer churn interview revenue forecast']) {
      const t0 = performance.now()
      expect(retrieveKnowledge(q).length).toBe(5)
      retrievalTimes.push(performance.now() - t0)
    }
    console.info(
      `[search perf] build ${buildMs.toFixed(0)}ms · query avg ${avg.toFixed(2)}ms · p90 ${p90.toFixed(2)}ms · ` +
        `retrieval (incl. first build) ${retrievalTimes.map((t) => t.toFixed(1)).join(' / ')}ms`,
    )
    expect(avg).toBeLessThan(20)
    expect(retrievalTimes[1]).toBeLessThan(20)
  }, 60_000)
})
