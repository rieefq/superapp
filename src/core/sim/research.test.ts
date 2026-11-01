import { describe, expect, it } from 'vitest'
import { createRng } from '@/lib/rng'
import { buildFollowUpSection, buildReport, deriveAngles, investigationTitle, synthesizeFindings, type NumberedSource } from './research'

const src = (n: number, o: Partial<NumberedSource> = {}): NumberedSource => ({
  n,
  id: `src_${n}`,
  title: `Source ${n}`,
  kind: 'web',
  simulated: true,
  status: 'read',
  credibility: 0.75,
  domain: `pub${n}.example`,
  publication: `Publication ${n}`,
  angleIndex: 0,
  ...o,
})

describe('angles and titles', () => {
  it('derives 3–4 templated sub-questions by question shape', () => {
    expect(deriveAngles('Why do logistics customers churn?')).toEqual([
      'Which drivers are most often cited when logistics customers churn?',
      'Which early signals tend to show up before logistics customers churn?',
      'What interventions are discussed, and what supports them?',
      'What do our own notes and customer conversations suggest?',
    ])
    expect(deriveAngles('Tidewell vs Freightly', 3)[0]).toBe('How do Tidewell and Freightly differ in scope and capabilities?')
    expect(deriveAngles('EU e-invoicing mandate: impact on Atlas', 4, { projectName: 'Atlas Portal v2' })[1]).toBe('Which parts of Atlas Portal v2 and operations would be affected?')
    expect(investigationTitle('why do logistics customers churn??')).toBe('Why do logistics customers churn')
  })
})

describe('synthesizeFindings', () => {
  const sources = [
    src(1, { kind: 'knowledge', simulated: false, credibility: 0.9, passage: 'Churned customers mentioned slow onboarding. Support mattered less.', angleIndex: undefined }),
    src(2, { angleIndex: 0 }),
    src(3, { angleIndex: 0 }),
    src(4, { angleIndex: 1, status: 'discarded' }),
    src(5, { angleIndex: 1 }),
  ]

  it('leads with quotes from knowledge, cites only usable sources and stays within the count', () => {
    const findings = synthesizeFindings({ question: 'Why do logistics customers churn?', angles: ['A?', 'B?'], sources, count: 4, rng: createRng(1) })
    expect(findings).toHaveLength(4)
    expect(findings[0]).toMatchObject({ sourceIds: ['src_1'], confidence: 'medium' })
    expect(findings[0].text).toContain('“Churned customers mentioned slow onboarding. Support mattered less.”')
    expect(findings.flatMap((f) => f.sourceIds)).not.toContain('src_4')
    for (const f of findings) expect(f.text).not.toMatch(/\d+%/)
  })

  it('still returns at least three findings with thin material', () => {
    const findings = synthesizeFindings({ question: 'Pricing tiers', angles: ['First?', 'Second?', 'Third?'], sources: [], count: 3, rng: createRng(2) })
    expect(findings).toHaveLength(3)
    expect(findings.every((f) => f.confidence === 'low' && f.sourceIds.length === 0)).toBe(true)
  })
})

describe('buildReport', () => {
  it('cites sources by their position and states the method honestly', () => {
    const sources = [src(1, { kind: 'knowledge', simulated: false, title: 'Churn interviews' }), src(2, { mentions: ['Tidewell'] }), src(3, { status: 'discarded' })]
    const report = buildReport({
      title: 'Tidewell vs Freightly',
      question: 'Tidewell vs Freightly for carriers?',
      depth: 'standard',
      angles: ['A?'],
      findings: [{ text: 'Finding one.', sourceIds: ['src_2', 'src_1'] }, { text: 'Uses a discarded source.', sourceIds: ['src_3'] }],
      sources,
      rng: createRng(1),
    })
    expect(report).toContain('1. Finding one. [1][2]')
    expect(report).toContain('2. Uses a discarded source.\n')
    expect(report).toContain('| Dimension | Tidewell | Freightly | What to verify |')
    expect(report).toContain('Of 2 sources consulted, 1 came from your knowledge base')
    expect(report).toContain('1 is a simulated web source')
    expect(report).toContain('1 discarded source was excluded')
    expect(report).toContain('- [1] Churn interviews — your knowledge base')
    expect(report).toContain('- [2] Source 2 — Publication 2, pub2.example · simulated')
    expect(report).not.toContain('[3]')
  })

  it('formats follow-up sections with new sources', () => {
    const section = buildFollowUpSection({ question: 'Which onboarding steps matter most?', findings: [{ text: 'Setup matters.', sourceIds: ['src_2'] }], sources: [src(1), src(2)], newSourceIds: ['src_2'] })
    expect(section).toContain('## Follow-up: Which onboarding steps matter most')
    expect(section).toContain('- Setup matters. [2]')
    expect(section).toContain('New sources:\n- [2] Source 2')
  })
})
