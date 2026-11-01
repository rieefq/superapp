import { describe, expect, it } from 'vitest'
import { parseQuery } from './query'
import { bestSnippet, buildSnippet, highlightText, SNIPPET_LENGTH } from './snippet'
import { fold, stem } from './text'

const spec = (q: string) => parseQuery(q, null, { prefix: false }).highlight
const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

describe('buildSnippet', () => {
  it('returns short text whole, with highlight ranges on the matched words', () => {
    const text = 'Stripe billing migration plan for invoices'
    const s = buildSnippet(text, spec('invoice migrations'))
    expect(s.text).toBe(text)
    expect(s.highlights.map(([a, b]) => s.text.slice(a, b))).toEqual(['migration', 'invoices'])
    expect(s.distinct).toBe(2)
  })

  it('excerpts ~140 characters around the match with ellipses and word boundaries', () => {
    const text = `${filler(60)} the checkout latency spike happened during peak hours ${filler(60)}`
    const s = buildSnippet(text, spec('latency spike'))
    expect(s.text.startsWith('…')).toBe(true)
    expect(s.text.endsWith('…')).toBe(true)
    expect(s.text.length).toBeLessThanOrEqual(SNIPPET_LENGTH + 2)
    const inner = s.text.slice(1, -1)
    expect(text.includes(inner)).toBe(true)
    expect(inner.startsWith('word')).toBe(true)
    expect(s.highlights.map(([a, b]) => s.text.slice(a, b))).toEqual(['latency', 'spike'])
  })

  it('prefers the window with the most distinct query terms', () => {
    const text = `pricing ${filler(40)} pricing ${filler(40)} usage based pricing model ${filler(40)}`
    const s = buildSnippet(text, spec('usage pricing'))
    expect(s.text).toContain('usage based pricing')
    expect(s.distinct).toBe(2)
  })

  it('every highlight covers a word whose stem is in the query', () => {
    const text = `${filler(10)} Priced plans, pricing pages and PRICES ${filler(30)}`
    const s = buildSnippet(text, spec('price'))
    expect(s.highlights).toHaveLength(3)
    for (const [a, b] of s.highlights) expect(stem(fold(s.text.slice(a, b)))).toBe(stem('price'))
  })

  it('clips from the start without highlights when nothing matches', () => {
    const text = filler(80)
    const s = buildSnippet(text, spec('absent'))
    expect(s.highlights).toEqual([])
    expect(s.text.endsWith('…')).toBe(true)
    expect(s.text.length).toBeLessThanOrEqual(SNIPPET_LENGTH)
  })
})

describe('bestSnippet', () => {
  it('picks the field with the most distinct matches and keeps its anchor', () => {
    const s = bestSnippet(
      [
        { text: 'We should look at pricing later', anchor: { kind: 'message', id: 'm1' } },
        { text: 'Usage-based pricing works for logistics', anchor: { kind: 'message', id: 'm2' } },
      ],
      spec('usage pricing'),
    )
    expect(s.anchor).toEqual({ kind: 'message', id: 'm2' })
    expect(s.text).toBe('Usage-based pricing works for logistics')
  })

  it('falls back to the first non-empty field', () => {
    expect(bestSnippet([{ text: '' }, { text: 'Project description' }], spec('zzz')).text).toBe('Project description')
  })
})

describe('highlightText', () => {
  it('highlights stems, diacritics and the word being typed', () => {
    const title = 'Café pricing for Atlas Lumen'
    const ranges = highlightText(title, 'cafe prices lum')
    expect(ranges.map(([a, b]) => title.slice(a, b))).toEqual(['Café', 'pricing', 'Lumen'])
    expect(highlightText(title, '')).toEqual([])
  })
})
