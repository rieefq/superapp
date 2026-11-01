import { beforeEach, describe, expect, it } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { fx } from './fixtures.test-utils'
import { __resetSearchForTests, retrieveKnowledge, splitPassages } from './index'

const sentence = (topic: string, i: number) => `Sentence ${i} talks about ${topic} in some detail for the reader.`
const paragraph = (topic: string, sentences = 8) => Array.from({ length: sentences }, (_, i) => sentence(topic, i)).join(' ')

describe('splitPassages', () => {
  it('packs paragraphs into ~700-character passages without losing text', () => {
    const blocks = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${'word '.repeat(30).trim()}`)
    const content = blocks.join('\n\n')
    const passages = splitPassages(content)
    expect(passages.length).toBeGreaterThan(2)
    for (const p of passages) expect(p.length).toBeLessThanOrEqual(700)
    expect(passages.join('\n\n')).toBe(content)
  })

  it('never ends a passage on a heading', () => {
    const content = ['# Overview', 'a'.repeat(400), '## Pricing', 'b'.repeat(400)].join('\n\n')
    expect(splitPassages(content)).toEqual([`# Overview\n\n${'a'.repeat(400)}`, `## Pricing\n\n${'b'.repeat(400)}`])
  })

  it('splits oversized paragraphs at sentence ends, line breaks, or whitespace', () => {
    const long = paragraph('freight', 60)
    const bySentence = splitPassages(long)
    expect(bySentence.length).toBeGreaterThan(3)
    for (const p of bySentence) {
      expect(p.length).toBeLessThanOrEqual(700)
      expect(p.endsWith('.')).toBe(true)
    }
    const csv = Array.from({ length: 200 }, (_, i) => `account_${i},Meridian Freight,${1000 + i}`).join('\n')
    const rows = splitPassages(csv)
    expect(rows.length).toBeGreaterThan(5)
    for (const p of rows) expect(p.split('\n').every((line) => /^account_\d+,/.test(line))).toBe(true)
    const unbroken = 'x'.repeat(3000)
    expect(splitPassages(unbroken).every((p) => p.length <= 980)).toBe(true)
    expect(splitPassages(unbroken).join('')).toBe(unbroken)
  })

  it('returns nothing for empty content', () => {
    expect(splitPassages('  \n\n ')).toEqual([])
  })
})

describe('retrieveKnowledge', () => {
  beforeEach(() => {
    db.replaceAll(emptyTables())
    __resetSearchForTests()
  })

  it('returns the most relevant passage of each item', () => {
    const content = [
      paragraph('onboarding'),
      paragraph('authentication'),
      paragraph('webhooks'),
      'Rate limits: the public API allows 600 requests per minute per key. Bursts above the limit return HTTP 429 with a Retry-After header.',
      paragraph('pagination'),
    ].join('\n\n')
    db.insertMany('knowledge', [
      fx.knowledge('k_api', 'Public API guide', content),
      fx.knowledge('k_other', 'Team offsite', paragraph('the offsite agenda')),
    ])
    const [top, ...rest] = retrieveKnowledge('What are the API rate limits per minute?')
    expect(top.item.id).toBe('k_api')
    expect(top.passage).toContain('600 requests per minute')
    expect(top.passage.length).toBeLessThanOrEqual(700)
    expect(rest.every((r) => r.item.id !== 'k_api')).toBe(true)
  })

  it('prefers the project, keeps unscoped items lower, and excludes other projects', () => {
    const text = 'Churn interviews with logistics customers: onboarding friction and missing invoice exports.'
    db.insertMany('knowledge', [
      fx.knowledge('k_p1', 'Churn notes', text, { projectIds: ['p1'] }),
      fx.knowledge('k_none', 'Churn notes', text),
      fx.knowledge('k_p2', 'Churn notes', text, { projectIds: ['p2'] }),
    ])
    const scoped = retrieveKnowledge('churn interviews', { projectId: 'p1' })
    expect(scoped.map((r) => r.item.id)).toEqual(['k_p1', 'k_none'])
    expect(scoped[1].score).toBeCloseTo(scoped[0].score * 0.6, 10)
    expect(retrieveKnowledge('churn interviews').map((r) => r.item.id).sort()).toEqual(['k_none', 'k_p1', 'k_p2'])
    // Explicit ids (pinned context) are eligible whatever their project.
    expect(retrieveKnowledge('churn', { projectId: 'p1', ids: ['k_p2'] }).map((r) => r.item.id)).toEqual(['k_p2'])
  })

  it('applies the limit (default 5) and ignores queries without terms or matches', () => {
    db.insertMany('knowledge', Array.from({ length: 8 }, (_, i) => fx.knowledge(`k${i}`, `Launch note ${i}`, 'Lumen launch checklist item')))
    expect(retrieveKnowledge('lumen launch')).toHaveLength(5)
    expect(retrieveKnowledge('lumen launch', { limit: 2 })).toHaveLength(2)
    expect(retrieveKnowledge('the of and')).toEqual([])
    expect(retrieveKnowledge('nonexistentword')).toEqual([])
    expect(retrieveKnowledge('')).toEqual([])
  })

  it('uses the summary or title when an item has no content, and follows edits', () => {
    db.insert('knowledge', fx.knowledge('k_link', 'Design tokens article', '', { summary: 'How to name semantic color tokens.' }))
    expect(retrieveKnowledge('semantic tokens')[0].passage).toBe('How to name semantic color tokens.')
    db.update('knowledge', 'k_link', { content: 'Tokens should describe intent, not appearance: use surface-raised rather than gray-100.' })
    expect(retrieveKnowledge('appearance intent')[0].passage).toContain('surface-raised')
    db.remove('knowledge', 'k_link')
    expect(retrieveKnowledge('appearance intent')).toEqual([])
  })
})
