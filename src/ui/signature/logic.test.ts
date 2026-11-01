import { describe, expect, it } from 'vitest'
import type { Approval, Run, RunStep } from '@/core/types'
import { approvalHeadline, grantsWithAlwaysAllow, isPatch, stampText, truncatePatch } from './approvalLogic'
import { formatAge, formatClock, formatCost, formatSeconds, formatTok, formatTokenCount } from './format'
import { PRIORITY_META, RUN_STATUS_META, STEP_STATUS_META, TASK_STATUS_META, activityState, runSignal, stepGlyph, taskGlyph } from './glyphMeta'
import { SIGIL_MAX_RADIUS, sigilElements, sigilPaths } from './sigil'
import { computeTape, currentStepIndex, tapeProgress } from './tape'
import { lowerFirst, stepTitle, toBase, toParticiple, toPast } from './tense'
import { groupLabel, groupTimelineSteps, isStepSimulated, simulatedFrameHeader, toolLabel } from './timeline'

const step = (id: string, patch: Partial<RunStep> = {}): RunStep => ({ id, kind: 'think', title: `Step ${id}`, status: 'done', ...patch })

const run = (patch: Partial<Run> = {}): Run => ({
  id: 'run_test0001',
  kind: 'research',
  title: 'Test run',
  status: 'running',
  projectId: null,
  initiator: { type: 'user', id: 'usr_me' },
  steps: [],
  outputs: [],
  simulated: true,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  progress: 0,
  createdAt: 0,
  ...patch,
})

describe('formats', () => {
  it('formats tokens per §8.3', () => {
    expect(formatTokenCount(980)).toBe('980')
    expect(formatTokenCount(1204)).toBe('1,204')
    expect(formatTokenCount(12_400)).toBe('12.4k')
    expect(formatTokenCount(240_000)).toBe('240k')
    expect(formatTokenCount(1_250_000)).toBe('1.3M')
    expect(formatTok(1204)).toBe('1,204 tok')
    expect(formatTok(980, { est: true })).toBe('~980 tok est.')
  })
  it('formats costs with 3 decimals below a cent and est. prefixes', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(0.004)).toBe('$0.004')
    expect(formatCost(0.0004)).toBe('<$0.001')
    expect(formatCost(0.08)).toBe('$0.08')
    expect(formatCost(12.4)).toBe('$12.40')
    expect(formatCost(0.06, { est: true })).toBe('est. $0.06')
  })
  it('formats durations and clocks', () => {
    expect(formatSeconds(3100)).toBe('3.1 s')
    expect(formatSeconds(420)).toBe('0.4 s')
    expect(formatSeconds(42_000)).toBe('42 s')
    expect(formatSeconds(84_000)).toBe('01:24')
    expect(formatClock(7_000)).toBe('00:07')
    expect(formatClock(3_723_000)).toBe('1:02:03')
    expect(formatAge(4 * 60_000 + 5_000)).toBe('4m')
    expect(formatAge(10_000)).toBe('just now')
  })
})

describe('step tense', () => {
  it('turns titles into participles while running and past tense when done', () => {
    expect(stepTitle('Read 4 sources', 'running')).toBe('Reading 4 sources')
    expect(stepTitle('Read 4 sources', 'done')).toBe('Read 4 sources')
    expect(stepTitle('Run `npm test`', 'done')).toBe('Ran `npm test`')
    expect(stepTitle('Plan the change', 'running')).toBe('Planning the change')
    expect(stepTitle('Planned 4 angles', 'running')).toBe('Planning 4 angles')
    expect(stepTitle('Searched: Tidewell pricing', 'pending')).toBe('Search: Tidewell pricing')
    expect(stepTitle('Summarize the change', 'done')).toBe('Summarized the change')
    expect(stepTitle('Wrote 6 findings', 'running')).toBe('Writing 6 findings')
    expect(stepTitle('Cross-checked claims', 'running')).toBe('Cross-checking claims')
    expect(stepTitle('Retry the upload', 'done')).toBe('Retried the upload')
    expect(stepTitle('Open a pull request', 'running')).toBe('Opening a pull request')
  })
  it('converts coordinated verbs in the same form', () => {
    expect(toParticiple('Marked cited sources and moved the investigation to review')).toBe(
      'Marking cited sources and moving the investigation to review',
    )
    expect(toBase('Searched the web and read 8 sources')).toBe('Search the web and read 8 sources')
  })
  it('never mangles noun-led titles', () => {
    expect(toPast('Email from billing@coastalcargo.example')).toBe('Email from billing@coastalcargo.example')
    expect(toParticiple('Pull request ready for review')).toBe('Pull request ready for review')
    expect(toPast('Typecheck')).toBe('Typechecked')
    expect(toPast('Pricing tiers')).toBe('Pricing tiers')
  })
  it('lowercases verbs but keeps acronyms and brands', () => {
    expect(lowerFirst('Run checks')).toBe('run checks')
    expect(lowerFirst('SSO login')).toBe('SSO login')
    expect(lowerFirst('GitHub sync')).toBe('GitHub sync')
  })
})

describe('glyph mapping', () => {
  it('maps every run status to its shape, signal and word (§5.3)', () => {
    expect(Object.fromEntries(Object.entries(RUN_STATUS_META).map(([k, v]) => [k, `${v.shape}/${v.tone}/${v.word}`]))).toEqual({
      queued: 'ring/ink-3/Queued',
      running: 'dot/live/Running',
      waiting: 'diamond/attn/Needs you',
      paused: 'bars/ink-2/Paused',
      succeeded: 'check/done/Done',
      failed: 'cross/fail/Failed',
      cancelled: 'slash/ink-3/Stopped',
    })
    expect(RUN_STATUS_META.running.live).toBe(true)
  })
  it('maps step statuses; done recedes to ink-3 inside timelines', () => {
    expect(STEP_STATUS_META.skipped).toMatchObject({ shape: 'dash', tone: 'ink-4' })
    expect(stepGlyph('done').tone).toBe('done')
    expect(stepGlyph('done', 'timeline').tone).toBe('ink-3')
    expect(stepGlyph('failed', 'timeline').tone).toBe('fail')
  })
  it('maps task squares with live and attention modifiers', () => {
    expect(TASK_STATUS_META.in_progress.fill).toBe('lower')
    expect(taskGlyph('in_progress', { live: true }).tone).toBe('live')
    expect(taskGlyph('review').tone).toBe('ink-2')
    expect(taskGlyph('review', { attention: true }).tone).toBe('attn')
    expect(TASK_STATUS_META.cancelled.slash).toBe(true)
    expect(TASK_STATUS_META.done).toMatchObject({ fill: 'full', tone: 'done' })
  })
  it('maps priority to bars, never to color', () => {
    expect([PRIORITY_META.none.bars, PRIORITY_META.low.bars, PRIORITY_META.medium.bars, PRIORITY_META.high.bars]).toEqual([0, 1, 2, 3])
    expect(PRIORITY_META.urgent).toMatchObject({ bars: 3, urgent: true })
  })
  it('derives the run signal and the mark state', () => {
    expect(runSignal('waiting')).toBe('attn')
    expect(runSignal('paused')).toBe('neutral')
    expect(activityState([{ status: 'running' }], [])).toBe('working')
    expect(activityState([{ status: 'running' }], [{ status: 'pending' }])).toBe('waiting')
    expect(activityState([{ status: 'succeeded' }], [{ status: 'approved' }])).toBe('idle')
  })
})

describe('step tape', () => {
  it('adds planned cells, a double cell for refs/file changes and labels the current step', () => {
    const r = run({
      plannedSteps: 7,
      steps: [
        step('a'),
        step('b', { refs: [{ kind: 'source', id: 'src_1' }] }),
        step('c'),
        step('d', { kind: 'read', title: 'Read sources', status: 'running' }),
      ],
    })
    const t = computeTape(r)
    expect(t.cells.map((c) => c.state)).toEqual(['done', 'done', 'done', 'running', 'pending', 'pending', 'pending'])
    expect(t.cells[1].wide).toBe(true)
    expect(t.cells[4].planned).toBe(true)
    expect(t.total).toBe(7)
    expect(t.label).toBe('Step 4 of 7: Reading sources, running')
    expect(t.endCap).toBeUndefined()
    expect(t.simulated).toBe(true)
  })
  it('adds one pending "next" cell while the total is unknown', () => {
    const t = computeTape(run({ simulated: false, steps: [step('a'), step('b', { status: 'running', title: 'Write the answer' })] }))
    expect(t.cells.map((c) => c.state)).toEqual(['done', 'running', 'pending'])
    expect(t.cells[2].next).toBe(true)
    expect(t.totalKnown).toBe(false)
    expect(t.label).toBe('Step 2: Writing the answer, running')
  })
  it('caps terminal runs and labels failures', () => {
    const failed = computeTape(run({ status: 'failed', plannedSteps: 4, steps: [step('a'), step('b', { status: 'failed', title: 'Run checks' })] }))
    expect(failed.endCap).toBe('failed')
    expect(failed.label).toBe('Failed at step 2 of 4: Run checks')
    expect(failed.cells.map((c) => c.state)).toEqual(['done', 'failed', 'pending', 'pending'])
    const done = computeTape(run({ status: 'succeeded', plannedSteps: 2, steps: [step('a'), step('b')] }))
    expect(done.endCap).toBe('succeeded')
    expect(done.label).toBe('Done, 2 steps')
  })
  it('makes waiting a cell of its own and uses the approval word', () => {
    const t = computeTape(run({ status: 'waiting', plannedSteps: 3, steps: [step('a'), step('b', { status: 'waiting', title: 'Run npm install' })] }))
    expect(t.cells[1].state).toBe('waiting')
    expect(t.label).toBe('Step 2 of 3: Run npm install, needs you')
  })
  it('folds finished cells into a leading +n and never folds the current step', () => {
    const steps = Array.from({ length: 20 }, (_, i) => step(`s${i}`, { status: i === 19 ? 'running' : 'done' }))
    const t = computeTape(run({ plannedSteps: 22, steps }), { max: 12 })
    expect(t.leading).toBe(10)
    expect(t.cells).toHaveLength(12)
    expect(t.cells.some((c) => c.state === 'running')).toBe(true)
    expect(t.trailing).toBe(0)
  })
  it('folds not-yet-started cells into a trailing +n when even pending cells overflow', () => {
    const t = computeTape(run({ plannedSteps: 30, steps: [step('a', { status: 'running' })] }), { max: 10 })
    expect(t.leading).toBe(0)
    expect(t.cells).toHaveLength(10)
    expect(t.trailing).toBe(20)
  })
  it('counts double cells as two units when folding', () => {
    const steps = Array.from({ length: 8 }, (_, i) => step(`s${i}`, { fileChanges: [{ path: 'a.ts', changeType: 'modified', additions: 1, deletions: 0 }] }))
    const t = computeTape(run({ status: 'succeeded', plannedSteps: 8, steps }), { max: 6 })
    expect(t.cells).toHaveLength(3)
    expect(t.leading).toBe(5)
  })
  it('reports progress and the current index', () => {
    expect(tapeProgress(run({ plannedSteps: 7, steps: [step('a'), step('b'), step('c', { status: 'running' })] }))).toBe('2/7')
    expect(tapeProgress(run({ steps: [step('a')] }))).toBe('1')
    expect(currentStepIndex([step('a'), step('b', { status: 'waiting' }), step('c', { status: 'pending' })])).toBe(1)
    expect(currentStepIndex([])).toBe(-1)
  })
})

describe('timeline', () => {
  it('collapses ≥2 consecutive finished read/search steps into a group', () => {
    const steps = [
      step('p', { kind: 'plan' }),
      step('s', { kind: 'search', tool: 'web.search' }),
      step('b1', { kind: 'browse', refs: [{ kind: 'source', id: '1' }, { kind: 'source', id: '2' }] }),
      step('b2', { kind: 'browse', refs: [{ kind: 'source', id: '3' }] }),
      step('r', { kind: 'read', status: 'running' }),
      step('w', { kind: 'write', status: 'pending' }),
    ]
    const entries = groupTimelineSteps(steps)
    expect(entries.map((e) => (e.type === 'group' ? `group:${e.steps.length}` : e.step.id))).toEqual(['p', 'group:3', 'r', 'w'])
    const group = entries[1]
    expect(group.type === 'group' && group.label).toBe('Searched and read 3 sources')
  })
  it('labels groups by what was read', () => {
    expect(groupLabel([step('a', { kind: 'read' }), step('b', { kind: 'read' })], 'code')).toBe('Read 2 files')
    expect(groupLabel([step('a', { kind: 'search' }), step('b', { kind: 'search' })])).toBe('Ran 2 searches')
    expect(groupLabel([step('a', { kind: 'read', refs: [{ kind: 'knowledge', id: 'k1' }] }), step('b', { kind: 'read', refs: [{ kind: 'knowledge', id: 'k2' }] })])).toBe(
      'Read 2 documents',
    )
  })
  it('counts files from paths, nouns from titles, then refs', () => {
    expect(
      groupLabel([
        step('a', { kind: 'read', title: 'Read src/api/invoices.ts and src/billing/stripe.ts' }),
        step('b', { kind: 'read', title: 'Read the Stripe Billing migration plan', refs: [{ kind: 'knowledge', id: 'kno_stripe_plan' }] }),
      ], 'code'),
    ).toBe('Read 2 files and 1 document')
    expect(
      groupLabel([
        step('a', { kind: 'search', title: 'Searched: Tidewell pricing tiers' }),
        step('b', { kind: 'browse', title: 'Read 9 pages', refs: [{ kind: 'source', id: 's1' }] }),
        step('c', { kind: 'read', title: 'Compared with our own notes', refs: [{ kind: 'knowledge', id: 'k1' }] }),
      ]),
    ).toBe('Searched and read 9 pages and 1 document')
    expect(
      groupLabel([
        step('a', { kind: 'browse', title: 'Read 3 sources' }),
        step('b', { kind: 'browse', title: 'Read 3 more sources' }),
        step('c', { kind: 'browse', title: 'Read the last 2 sources' }),
      ]),
    ).toBe('Read 8 sources')
    expect(
      groupLabel([
        step('a', { kind: 'read', title: 'Read a.ts' }),
        step('b', { kind: 'browse', title: 'Read 2 pages' }),
        step('c', { kind: 'read', title: 'Read notes', refs: [{ kind: 'knowledge', id: 'k' }] }),
      ]),
    ).toBe('Read 4 items')
  })
  it('keeps single read steps and failed reads ungrouped', () => {
    const entries = groupTimelineSteps([step('a', { kind: 'read' }), step('b', { kind: 'read', status: 'failed' }), step('c', { kind: 'read' })])
    expect(entries.every((e) => e.type === 'step')).toBe(true)
  })
  it('decides LIVE/SIM per step', () => {
    const live = { simulated: false }
    expect(isStepSimulated({ simulated: true }, step('a'))).toBe(true)
    expect(isStepSimulated(live, step('a', { kind: 'command', tool: 'terminal' }))).toBe(true)
    expect(isStepSimulated(live, step('a', { kind: 'search', tool: 'web.search' }))).toBe(true)
    expect(isStepSimulated(live, step('a', { kind: 'read', tool: 'repo', integrationId: 'github', capability: 'repo.read' }))).toBe(false)
    expect(isStepSimulated(live, step('a', { kind: 'tool', integrationId: 'github', capability: 'repo.pull_request' }))).toBe(true)
    expect(isStepSimulated(live, step('a', { kind: 'read', tool: 'knowledge.search', capability: 'knowledge.read' }))).toBe(false)
    expect(isStepSimulated(live, step('a', { kind: 'message', tool: 'slack', integrationId: 'slack' }))).toBe(true)
  })
  it('names tools and simulated frames with the exact strings', () => {
    expect(toolLabel({ tool: 'web.search' })).toBe('Web search')
    expect(toolLabel({ tool: 'github' })).toBe('GitHub')
    expect(toolLabel({ integrationId: 'slack' })).toBe('Slack')
    expect(simulatedFrameHeader({ kind: 'command', tool: 'terminal' })).toBe('Simulated terminal — nothing was executed')
    expect(simulatedFrameHeader({ kind: 'test', tool: 'checks' })).toBe('Simulated terminal — nothing was executed')
    expect(simulatedFrameHeader({ kind: 'search', tool: 'web.search' })).toBe('Simulated web result')
    expect(simulatedFrameHeader({ kind: 'message', tool: 'slack', integrationId: 'slack' })).toBe('Simulated Slack — nothing left your browser')
    expect(simulatedFrameHeader({ kind: 'think' })).toBeUndefined()
  })
})

describe('sigils', () => {
  it('are deterministic and have 3–5 elements inside the safe radius', () => {
    for (let seed = 0; seed < 200; seed++) {
      const a = sigilElements(seed * 7919 + 13)
      expect(a).toEqual(sigilElements(seed * 7919 + 13))
      expect(a.length).toBeGreaterThanOrEqual(3)
      expect(a.length).toBeLessThanOrEqual(5)
      for (const e of a) {
        if (e.type === 'stroke') expect(e.to).toBeLessThanOrEqual(SIGIL_MAX_RADIUS)
        else expect(e.r).toBeLessThanOrEqual(SIGIL_MAX_RADIUS)
      }
    }
  })
  it('differ across seeds', () => {
    const shapes = new Set(Array.from({ length: 24 }, (_, i) => JSON.stringify(sigilElements(i + 1))))
    expect(shapes.size).toBeGreaterThanOrEqual(22)
  })
  it('produces path data and dots', () => {
    const p = sigilPaths([{ type: 'stroke', angle: 0, from: 0, to: 0.5 }, { type: 'dot', angle: 90, r: 0.5 }], 12, 12)
    expect(p.stroke).toBe('M12 12L12 6')
    expect(p.dots).toEqual([[18, 12]])
  })
})

describe('approval logic', () => {
  const approval = (patch: Partial<Approval> = {}): Approval => ({
    id: 'apv_1', runId: 'run_1', stepId: 'stp_1', title: 'Run npm test', capability: 'shell.execute', risk: 'medium',
    requestedBy: { type: 'agent', id: 'agt_forge' }, status: 'pending', createdAt: 0, ...patch,
  })
  it('writes headlines in the product voice', () => {
    expect(approvalHeadline('Run npm install stripe@^18 --save', 'Forge')).toBe('Forge wants to run npm install stripe@^18 --save')
    expect(approvalHeadline('Post weekly digest to #product', 'Herald')).toBe('Herald wants to post weekly digest to #product')
    expect(approvalHeadline('Forge wants to run the test suite in atlas-portal', 'Forge')).toBe('Forge wants to run the test suite in atlas-portal')
    expect(approvalHeadline('Approval needed: deploy', 'Forge')).toBe('Approval needed: deploy')
    expect(approvalHeadline('Run npm test')).toBe('Run npm test')
  })
  it('stamps resolutions', () => {
    const at = new Date(2026, 10, 1, 10, 42).getTime()
    expect(stampText(approval({ status: 'approved', resolvedAt: at }))).toBe('Approved by you · 10:42')
    expect(stampText(approval({ status: 'rejected', resolvedAt: at, resolution: { by: { type: 'user', id: 'usr_me' }, note: 'Not this week' } }))).toBe('Denied · Not this week')
    expect(stampText(approval({ status: 'rejected', resolvedAt: at }))).toBe('Denied by you · 10:42')
    expect(stampText(approval({ status: 'expired', resolvedAt: at }))).toBe('Expired · 10:42')
  })
  it('truncates unified diffs to the first body lines', () => {
    const patch = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,20 +1,20 @@', ...Array.from({ length: 20 }, (_, i) => (i % 2 ? `+line ${i}` : ` line ${i}`))].join('\n')
    expect(isPatch(patch)).toBe(true)
    expect(isPatch('npm test')).toBe(false)
    const t = truncatePatch(patch, 12)
    expect(t.hidden).toBe(8)
    expect(t.patch.trim().split('\n')).toHaveLength(15)
  })
  it('turns every grant for the capability into allow, or adds one', () => {
    const agent = { capabilities: [{ capability: 'shell.execute' as const, mode: 'ask' as const, integrationId: 'sandbox' }, { capability: 'repo.read' as const, mode: 'allow' as const }] }
    expect(grantsWithAlwaysAllow(agent, 'shell.execute')).toEqual([
      { capability: 'shell.execute', mode: 'allow', integrationId: 'sandbox', always: true },
      { capability: 'repo.read', mode: 'allow' },
    ])
    expect(grantsWithAlwaysAllow(agent, 'messages.send').at(-1)).toEqual({ capability: 'messages.send', mode: 'allow', always: true })
  })
})
