import { describe, expect, it } from 'vitest'
import { depthExpectation } from '@/core/sim/research'
import type { Investigation, Run, RunStep, Source } from '@/core/types'
import {
  citedNumbers,
  citedSimulatedCount,
  exampleQuestions,
  exportFileName,
  findingsBrief,
  formatDurationRange,
  groupInvestigations,
  matchesQuery,
  meterCells,
  openQuestions,
  phaseOfStep,
  planChecklist,
  readingSourceIds,
  reportMarkdown,
  researchPhases,
  sourceOrigin,
  sourceStats,
  taskTitle,
} from './logic'

const inv = (o: Partial<Investigation> = {}): Investigation => ({
  id: 'inv_1',
  title: 'Tidewell positioning',
  question: 'Who does Tidewell sell to?',
  projectId: null,
  status: 'review',
  depth: 'standard',
  angles: ['Who they sell to', 'Pricing', 'Gaps'],
  sourceIds: ['s1', 's2', 's3'],
  findings: [],
  runIds: [],
  createdAt: 1,
  updatedAt: 1,
  ...o,
})

const src = (id: string, o: Partial<Source> = {}): Source => ({
  id,
  investigationId: 'inv_1',
  kind: 'web',
  title: `Source ${id}`,
  snippet: '',
  credibility: 0.7,
  status: 'read',
  simulated: true,
  addedAt: 1,
  domain: `${id}.example`,
  url: `https://${id}.example/a`,
  ...o,
})

const step = (o: Partial<RunStep>): RunStep => ({ id: Math.random().toString(36).slice(2), kind: 'think', title: 'Step', status: 'done', ...o })

describe('groups and search', () => {
  it('groups by status in the workspace order and drops empty groups', () => {
    const groups = groupInvestigations([
      inv({ id: 'a', status: 'complete', updatedAt: 3 }),
      inv({ id: 'b', status: 'running', updatedAt: 2 }),
      inv({ id: 'c', status: 'draft', updatedAt: 1 }),
      inv({ id: 'd', status: 'complete', updatedAt: 9 }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['Running', 'Complete', 'Drafts'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['d', 'a'])
  })

  it('matches the title or the question, case-insensitively', () => {
    expect(matchesQuery(inv(), 'tidewell')).toBe(true)
    expect(matchesQuery(inv(), 'SELL')).toBe(true)
    expect(matchesQuery(inv(), 'churn')).toBe(false)
    expect(matchesQuery(inv(), '  ')).toBe(true)
  })
})

describe('sources', () => {
  it('tells knowledge, simulated web and manual sources apart and counts them', () => {
    expect(sourceOrigin({ kind: 'knowledge', simulated: false })).toBe('knowledge')
    expect(sourceOrigin({ kind: 'web', simulated: true })).toBe('web')
    expect(sourceOrigin({ kind: 'web', simulated: false })).toBe('manual')
    const stats = sourceStats([
      src('s1', { status: 'cited' }),
      src('s2', { kind: 'knowledge', simulated: false }),
      src('s3', { status: 'discarded' }),
      src('s4', { status: 'queued', simulated: false }),
    ])
    expect(stats).toMatchObject({ total: 4, active: 3, cited: 1, read: 1, queued: 1, discarded: 1, knowledge: 1, simulated: 1, manual: 1 })
  })

  it('counts the simulated sources a report cites', () => {
    const sources = [src('s1'), src('s2', { kind: 'knowledge', simulated: false }), src('s3')]
    expect(citedNumbers('One [1] and two [2, 3]. A [link](x) and [4](y).')).toEqual([1, 2, 3])
    expect(citedSimulatedCount(inv({ report: 'See [1] and [2].' }), sources)).toBe(1)
    expect(citedSimulatedCount(inv({ report: 'See [2].', findings: [{ id: 'f', text: 'x', sourceIds: ['s3'], confidence: 'low' }] }), sources)).toBe(1)
  })

  it('fills meter cells from a 0..1 value', () => {
    expect(meterCells(0, 5)).toBe(0)
    expect(meterCells(0.05, 5)).toBe(1)
    expect(meterCells(0.72, 5)).toBe(4)
    expect(meterCells(1.3, 5)).toBe(5)
  })

  it('knows which sources the running browse step reads', () => {
    const run = { steps: [step({ kind: 'browse', tool: 'web.browse', status: 'running', input: 'https://s2.example/a\nhttps://s3.example/a' })] }
    expect([...readingSourceIds(run, [src('s1'), src('s2'), src('s3')])]).toEqual(['s2', 's3'])
    expect(readingSourceIds(undefined, [src('s1')]).size).toBe(0)
  })
})

describe('run phases', () => {
  const base = inv({ status: 'running' })
  const script = { factory: 'research.investigate' }

  it('maps steps of generated and scripted runs to phases', () => {
    expect(phaseOfStep({ kind: 'plan', title: 'Plan the investigation' })).toBe('plan')
    expect(phaseOfStep({ kind: 'read', tool: 'context', title: 'Read 2 items from your context' })).toBe('search')
    expect(phaseOfStep({ kind: 'browse', tool: 'web.browse', title: 'Read 3 sources' })).toBe('read')
    expect(phaseOfStep({ kind: 'think', title: 'Cross-check sources' })).toBe('check')
    expect(phaseOfStep({ kind: 'write', title: 'Wrote 5 findings with confidence ratings' })).toBe('synthesize')
    expect(phaseOfStep({ kind: 'write', title: 'Synthesize findings and draft the report' })).toBe('write')
    expect(phaseOfStep({ kind: 'write', title: 'Update the report' }, true)).toBe('update')
  })

  it('reads Searching 2/4 → Reading 3/7 → Synthesizing', () => {
    const run = {
      status: 'running' as const,
      script,
      steps: [
        step({ kind: 'plan', title: 'Plan' }),
        step({ kind: 'search', tool: 'knowledge.search', title: 'Search your knowledge base' }),
        step({ kind: 'search', tool: 'web.search', title: 'Search the web: A', status: 'running' }),
      ],
    }
    const phases = researchPhases({ inv: base, run, web: { found: 3, read: 0 } })
    expect(phases.map((p) => p.key)).toEqual(['plan', 'search', 'read', 'synthesize', 'draft'])
    expect(phases.map((p) => p.state)).toEqual(['done', 'current', 'pending', 'pending', 'pending'])
    expect(phases[1].count).toEqual({ done: 1, total: 4 })
    expect(phases[2]).toMatchObject({ label: 'Reading', count: { done: 0, total: 3 } })
  })

  it('has no reading phase without the web and marks everything done when the run succeeded', () => {
    const run = { status: 'succeeded' as const, script, steps: [step({ kind: 'plan' })] }
    const phases = researchPhases({ inv: inv({ sources: { knowledge: true, web: false } }), run, web: { found: 0, read: 0 } })
    expect(phases.map((p) => p.key)).toEqual(['plan', 'search', 'synthesize', 'draft'])
    expect(phases.every((p) => p.state === 'done')).toBe(true)
  })

  it('builds the plan checklist from the run', () => {
    const run = {
      status: 'running' as const,
      steps: [
        step({ kind: 'plan' }),
        step({ kind: 'search', tool: 'knowledge.search' }),
        step({ kind: 'search', tool: 'web.search', title: 'Search the web: Who', refs: [{ kind: 'source', id: 'a' }, { kind: 'source', id: 'b' }] }),
        step({ kind: 'search', tool: 'web.search', title: 'Search the web: Pricing', status: 'running' }),
      ],
    } satisfies Pick<Run, 'steps' | 'status'>
    const items = planChecklist(base, run, { knowledge: 2, webRead: 0, webFound: 2 })
    expect(items.map((i) => [i.key, i.state, i.count])).toEqual([
      ['knowledge', 'done', 2],
      ['angle-0', 'done', 2],
      ['angle-1', 'running', undefined],
      ['angle-2', 'pending', undefined],
      ['read', 'pending', undefined],
      ['synthesize', 'pending', undefined],
      ['draft', 'pending', undefined],
    ])
  })
})

describe('depth expectations', () => {
  it('reads the run plan back as steps, sources and a duration', () => {
    const quick = depthExpectation('quick')
    expect(quick.steps).toBe(5) // plan, knowledge, search, read, write
    expect(quick.sources).toEqual([3, 5])
    const deep = depthExpectation('deep', { web: true, knowledge: true, angles: 4 })
    expect(deep.steps).toBe(1 + 1 + 4 + 1 + 3 + 1 + 2)
    expect(deep.durationMs[0]).toBeGreaterThan(quick.durationMs[1])
    expect(depthExpectation('standard', { web: false }).sources).toEqual([0, 3])
    expect(formatDurationRange([20_000, 40_000])).toBe('~30 s')
    expect(formatDurationRange([20_000, 40_000], 8)).toBe('~4 s')
    expect(formatDurationRange([100_000, 140_000])).toBe('~2 min')
  })
})

describe('open questions', () => {
  const report = [
    '# Title',
    '## Key findings',
    '1. Not a task [1]',
    '## Open questions & next steps',
    '- “Who adopts it?” — still thinly covered.',
    '- Validate the top findings by **interviewing three customers** [2][3].',
    '## Method & sources',
    '- [1] A source',
    '## What this suggests',
    '- **Onboarding:** aim for 10 days to first value.',
  ].join('\n')

  it('collects list items under open-question, next-step and recommendation sections', () => {
    const items = openQuestions(report)
    expect(items.map((i) => i.text)).toEqual([
      '“Who adopts it?” — still thinly covered.',
      'Validate the top findings by interviewing three customers.',
      'Onboarding: aim for 10 days to first value.',
    ])
    expect(items[0].section).toBe('Open questions & next steps')
    expect(openQuestions(undefined)).toEqual([])
  })

  it('clips task titles to the first sentence at a word boundary', () => {
    expect(taskTitle('Fix the header. Then the footer.')).toBe('Fix the header')
    expect(taskTitle('Does time to first value correlate with churn?')).toBe('Does time to first value correlate with churn?')
    const long = taskTitle('word '.repeat(40), 40)
    expect(long.length).toBeLessThanOrEqual(40)
    expect(long.endsWith('…')).toBe(true)
  })

  it('offers open questions from reports as examples, then evergreen ones', () => {
    const ex = exampleQuestions([{ question: 'Q', report: '## Open questions\n- Does onboarding speed predict churn?\n- Not a question' }])
    expect(ex).toHaveLength(3)
    expect(ex[0]).toBe('Does onboarding speed predict churn?')
  })
})

describe('export and hand-off', () => {
  const sources = [src('s1', { status: 'cited' }), src('s2', { kind: 'knowledge', simulated: false, title: 'Our notes' }), src('s3', { status: 'discarded' })]

  it('starts simulated exports with the notice and appends the source list', () => {
    const md = reportMarkdown({ inv: inv({ report: '# Tidewell\n\nBody [1].' }), sources, generatedAt: Date.UTC(2026, 10, 1, 12), simulated: true, handle: 'INV-K3J9' })
    expect(md.split('\n')[0]).toBe("> **Simulated content.** Generated by Atrium's local simulator on Nov 1, 2026. No AI model, web search or external service was used.")
    expect(md).toContain('## Sources')
    expect(md).toContain('1. Source s1 — s1.example · simulated source, not fetched')
    expect(md).toContain('2. Our notes — your knowledge base')
    expect(md).toContain('(discarded)')
    expect(md).toContain('INV-K3J9')
  })

  it('does not repeat a source list the report already has, and skips the notice for live content', () => {
    const md = reportMarkdown({ inv: inv({ report: '# T\n\n## Method & sources\n\n- [1] Source s1 — s1.example' }), sources, generatedAt: 0, simulated: false, handle: 'INV-1' })
    expect(md.startsWith('# T')).toBe(true)
    expect(md).not.toContain('## Sources\n')
    expect(exportFileName('Tidewell positioning & pricing')).toBe('tidewell-positioning-pricing.md')
  })

  it('quotes findings with citations for a coding session', () => {
    const text = findingsBrief(inv(), [{ id: 'f1', text: 'Invoicing is weak.', sourceIds: ['s3', 's1'], confidence: 'medium' }], sources)
    expect(text).toContain('> 1. Invoicing is weak. [1][3] (medium confidence)')
    expect(text).toContain('Research question: Who does Tidewell sell to?')
    expect(text).toContain('2 of the cited sources are simulated')
  })
})
