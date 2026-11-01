import { describe, expect, it } from 'vitest'
import { stableId } from './ids'
import { detectComparison, excerpt, keyTerms, shorten, slugify, stem, titleFromText, topicPhrase } from './text'

describe('keyTerms', () => {
  it('keeps informative words in order, proper nouns cased', () => {
    expect(keyTerms('Why do logistics customers churn?')).toEqual(['logistics', 'customers', 'churn'])
    expect(keyTerms('How does Tidewell position against us?', 3)).toEqual(['Tidewell', 'position'])
    expect(keyTerms('Usage-based pricing trends in B2B SaaS', 4)).toEqual(['usage-based', 'pricing', 'B2B', 'SaaS'])
  })
})

describe('topicPhrase', () => {
  it.each([
    ['Why do logistics customers churn?', 'logistics customers churn'],
    ['How does Tidewell position against us?', 'Tidewell position'],
    ['EU e-invoicing mandate: impact on Atlas', 'EU e-invoicing mandate'],
    ['Usage-based pricing trends in B2B SaaS', 'usage-based pricing trends in B2B SaaS'],
    ['Should we build or buy our analytics layer?', 'build or buy the analytics layer'],
  ])('%s → %s', (q, topic) => {
    expect(topicPhrase(q)).toBe(topic)
  })
})

describe('detectComparison', () => {
  it.each([
    ['Tidewell vs Freightly: which fits mid-market carriers?', { a: 'Tidewell', b: 'Freightly' }],
    ['Stripe Billing vs Chargebee for usage-based pricing', { a: 'Stripe Billing', b: 'Chargebee' }],
    ['Should we use Stripe vs Chargebee?', { a: 'Stripe', b: 'Chargebee' }],
    ['compare Tidewell and Freightly on pricing', { a: 'Tidewell', b: 'Freightly' }],
    ['Should we build or buy our analytics layer?', { a: 'build', b: 'buy' }],
    ['What is the difference between REST and GraphQL for mobile clients?', { a: 'REST', b: 'GraphQL' }],
  ])('%s', (q, expected) => {
    expect(detectComparison(q)).toEqual(expected)
  })

  it('returns null for non-comparisons', () => {
    expect(detectComparison('Why do logistics customers churn?')).toBeNull()
  })
})

describe('string helpers', () => {
  it('shortens at word boundaries and builds titles and slugs', () => {
    expect(shorten('one two three four five', 14)).toBe('one two three…')
    expect(titleFromText('fix session expiry after SSO login. Also check refresh.')).toBe('Fix session expiry after SSO login')
    expect(slugify('Fix session expiry after SSO login!')).toBe('fix-session-expiry-after-sso-login')
    expect(slugify('Ünïcode — résumé')).toBe('unicode-resume')
  })

  it('extracts clean prose excerpts from markdown', () => {
    expect(excerpt('# Title\n\nCustomers mention **slow onboarding**. Support mattered less. More text here.', 60)).toBe('Customers mention slow onboarding. Support mattered less.')
  })

  it('stems related word forms together', () => {
    expect(stem('expiry')).toBe(stem('expires'))
    expect(stem('expired')).toBe('expir')
    expect(stem('sessions')).toBe('session')
  })

  it('derives stable ids', () => {
    expect(stableId('src', 'run_1', 'web', 2)).toBe(stableId('src', 'run_1', 'web', 2))
    expect(stableId('src', 'run_1', 'web', 2)).not.toBe(stableId('src', 'run_1', 'web', 3))
    expect(stableId('src', 'a')).toMatch(/^src_[0-9a-z]{10}$/)
  })
})
