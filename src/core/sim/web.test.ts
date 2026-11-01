import { describe, expect, it } from 'vitest'
import { createRng } from '@/lib/rng'
import { PUBLICATIONS, buildSearchQuery, formatSearchOutput, isSimulatedDomain, searchSimulatedWeb } from './web'

describe('simulated web corpus', () => {
  it('only uses fictional publications on .example domains', () => {
    for (const p of PUBLICATIONS) expect(isSimulatedDomain(p.domain)).toBe(true)
    expect(new Set(PUBLICATIONS.map((p) => p.domain)).size).toBe(PUBLICATIONS.length)
    expect(isSimulatedDomain('example.com')).toBe(false)
  })

  it('generates cautious, templated, deterministic results', () => {
    const run = () =>
      searchSimulatedWeb({
        question: 'Why do logistics customers churn?',
        angle: 'Which early signals tend to show up before logistics customers churn?',
        angleIndex: 1,
        count: 4,
        rng: createRng(42),
        keyPrefix: 's1',
      })
    const results = run()
    expect(results).toHaveLength(4)
    expect(run()).toEqual(results)
    for (const r of results) {
      expect(r.url).toMatch(/^https:\/\/[a-z0-9-]+\.example\/[a-z-]+\/[a-z0-9-]+$/)
      expect(r.snippet).not.toMatch(/\d/)
      expect(r.summary).toContain('no web page was fetched')
      expect(r.credibility).toBeGreaterThanOrEqual(0.4)
      expect(r.credibility).toBeLessThanOrEqual(0.9)
      expect(r.angleIndex).toBe(1)
    }
    expect(new Set(results.map((r) => r.title)).size).toBe(4)
    expect(results.map((r) => r.key)).toEqual(['s1-0', 's1-1', 's1-2', 's1-3'])
  })

  it('names comparison subjects and avoids reusing publications', () => {
    const usedDomains = new Set<string>()
    const a = searchSimulatedWeb({ question: 'Tidewell vs Freightly for mid-market carriers', angle: 'pricing', angleIndex: 0, count: 3, rng: createRng(1), keyPrefix: 'a', usedDomains })
    const b = searchSimulatedWeb({ question: 'Tidewell vs Freightly for mid-market carriers', angle: 'integrations', angleIndex: 1, count: 3, rng: createRng(2), keyPrefix: 'b', usedDomains })
    expect(new Set([...a, ...b].map((r) => r.domain)).size).toBe(6)
    expect([...a, ...b].some((r) => r.mentions.length > 0)).toBe(true)
  })

  it('builds queries and readable output', () => {
    expect(buildSearchQuery('Tidewell vs Freightly for mid-market carriers', 'How do they compare on pricing and packaging?')).toBe('Tidewell vs Freightly pricing packaging')
    expect(buildSearchQuery('Why do logistics customers churn?', '', { contrarian: true })).toBe('logistics customers churn criticism limitations')
    const out = formatSearchOutput('q', searchSimulatedWeb({ question: 'pricing tiers', angle: '', angleIndex: 0, count: 2, rng: createRng(3), keyPrefix: 'x' }))
    expect(out).toMatch(/^Query: "q"\n\n1\. .+ — .+ \(.+\.example\)\n2\. /)
    expect(out).toContain('simulated web corpus')
  })
})
