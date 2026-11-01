import { describe, expect, it } from 'vitest'
import { analyze, fold, stem, tokenize, toPlainText } from './text'

describe('fold', () => {
  it('lowercases, strips diacritics and apostrophes', () => {
    expect(fold('Café Déjà Vu')).toBe('cafe deja vu')
    expect(fold('Morgan’s')).toBe('morgans')
    expect(fold("don't")).toBe('dont')
    expect(fold('ÅNGSTRÖM')).toBe('angstrom')
  })
})

describe('stem', () => {
  const same = (...words: string[]) => expect(new Set(words.map(stem)).size).toBe(1)

  it('maps inflections to one form', () => {
    same('price', 'prices', 'pricing', 'priced')
    same('invoice', 'invoices', 'invoicing', 'invoiced')
    same('migrate', 'migrated', 'migrating')
    same('run', 'runs', 'running')
    same('class', 'classes')
    same('story', 'stories')
    same('cache', 'caches', 'cached')
    same('match', 'matches', 'matched')
    same('agree', 'agreed')
    same('make', 'making')
    same('bill', 'bills', 'billing', 'billed')
    same('ship', 'shipping', 'shipped')
    same('box', 'boxes')
    same('test', 'tests', 'testing', 'tested')
  })

  it('leaves short words, non-words and protected endings alone', () => {
    expect(stem('sso')).toBe('sso')
    expect(stem('v2')).toBe('v2')
    expect(stem('status')).toBe('status')
    expect(stem('analysis')).toBe('analysis')
    expect(stem('string')).toBe('string')
    expect(stem('thing')).toBe('thing')
  })
})

describe('tokenize', () => {
  it('returns offsets into the original text and flags stopwords', () => {
    const text = 'The Café’s SSO-login (v2) is broken!'
    const tokens = tokenize(text)
    expect(tokens.map((t) => text.slice(t.start, t.end))).toEqual(['The', 'Café’s', 'SSO', 'login', 'v2', 'is', 'broken'])
    expect(tokens.map((t) => t.isTerm)).toEqual([false, true, true, true, true, false, true])
    expect(tokens[1]).toMatchObject({ surface: 'cafes', stem: stem('cafe') })
  })

  it('keeps combining marks inside decomposed words', () => {
    const decomposed = 'Café opening'
    expect(tokenize(decomposed).map((t) => t.surface)).toEqual(['cafe', 'opening'])
  })

  it('analyze drops stopwords and one-letter tokens', () => {
    expect(analyze('A plan for the Q1 launch, e-invoicing included').map((t) => t.surface)).toEqual(['plan', 'q1', 'launch', 'invoicing', 'included'])
  })
})

describe('toPlainText', () => {
  it('strips markdown syntax but keeps the words', () => {
    const md = [
      '# Launch plan',
      '',
      'See the [pricing memo](https://example.com/memo) and **bold** _claims_ about `use_auth_token`.',
      '',
      '- first item',
      '1. numbered',
      '> quoted',
      '',
      '| Tier | Price |',
      '| --- | --- |',
      '| Pro | $49 |',
      '```ts',
      'const x = 1',
      '```',
    ].join('\n')
    const plain = toPlainText(md)
    expect(plain).toContain('Launch plan See the pricing memo and bold claims about use_auth_token.')
    expect(plain).toContain('first item numbered quoted')
    expect(plain).toContain('Tier · Price')
    expect(plain).toContain('const x = 1')
    expect(plain).not.toMatch(/[#*`>]|https?:|---/)
  })
})
