import { diffLines } from 'diff'
import { describe, expect, it } from 'vitest'
import type { Tables } from '@/core/db/schema'
import { INTEGRATION_BY_ID } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import type { StepPlan } from '@/core/runs/types'
import type { EntityKind, EntityRef, FileChange, Run } from '@/core/types'
import { DEMO_REPO } from '../demoRepo'
import { AGENT, BOARD, COLLECTION, INVESTIGATION, KNOWLEDGE, PROJECT, REPO, SESSION, TASK, THREAD, WORKFLOW } from '../ids'
import { buildSeed } from '../index'
import { buildOps } from './index'
import type { ScriptedRunParams } from './types'
import { lineDiffCounts } from './util'

/** A Sunday mid-morning, plus edge cases: early weekday, just after midnight, DST weekend. */
const NOW = Date.UTC(2026, 10, 1, 10, 30)
const OTHER_NOWS = [Date.UTC(2026, 10, 4, 7, 5), Date.UTC(2027, 0, 1, 0, 20), Date.UTC(2026, 2, 29, 1, 30)]
const DAY = 86_400_000

type Ops = Required<Pick<Tables, 'agents' | 'workflows' | 'repos' | 'runs' | 'approvals' | 'sessions' | 'connections' | 'notifications' | 'activity' | 'links'>>

function build(now = NOW): Ops {
  const ops = buildOps(now)
  const { agents, workflows, repos, runs, approvals, sessions, connections, notifications, activity, links } = ops
  if (!agents || !workflows || !repos || !runs || !approvals || !sessions || !connections || !notifications || !activity || !links) {
    throw new Error('buildOps must return every operations table')
  }
  return { agents, workflows, repos, runs, approvals, sessions, connections, notifications, activity, links }
}

const CONTENT_IDS: Partial<Record<EntityKind, Set<string>>> = {
  project: new Set(Object.values(PROJECT)),
  task: new Set(Object.values(TASK)),
  thread: new Set(Object.values(THREAD)),
  knowledge: new Set(Object.values(KNOWLEDGE)),
  investigation: new Set(Object.values(INVESTIGATION)),
  board: new Set(Object.values(BOARD)),
  collection: new Set(Object.values(COLLECTION)),
  source: new Set(Array.from({ length: 8 }, (_, i) => `src_pricing_${i + 1}`)),
}

function refExists(ops: Ops, ref: EntityRef): boolean {
  switch (ref.kind) {
    case 'run': return !!ops.runs[ref.id]
    case 'approval': return !!ops.approvals[ref.id]
    case 'agent': return !!ops.agents[ref.id]
    case 'workflow': return !!ops.workflows[ref.id]
    case 'session': return !!ops.sessions[ref.id]
    case 'repo': return !!ops.repos[ref.id]
    case 'integration': return !!INTEGRATION_BY_ID[ref.id]
    default: return CONTENT_IDS[ref.kind]?.has(ref.id) ?? false
  }
}

const planOf = (run: Run): ScriptedRunParams => run.script?.params as ScriptedRunParams

function allRefs(ops: Ops): { where: string; ref: EntityRef }[] {
  const out: { where: string; ref: EntityRef }[] = []
  for (const run of Object.values(ops.runs)) {
    if (run.origin) out.push({ where: `${run.id}.origin`, ref: run.origin })
    run.outputs.forEach((ref) => out.push({ where: `${run.id}.outputs`, ref }))
    run.steps.forEach((s) => s.refs?.forEach((ref) => out.push({ where: s.id, ref })))
    if (run.script) planOf(run).steps.forEach((p, i) => p.refs?.forEach((ref) => out.push({ where: `${run.id}.plan[${i}]`, ref })))
  }
  for (const l of Object.values(ops.links)) out.push({ where: l.id, ref: l.from }, { where: l.id, ref: l.to })
  for (const a of Object.values(ops.activity)) out.push({ where: a.id, ref: a.target })
  for (const n of Object.values(ops.notifications)) if (n.ref) out.push({ where: n.id, ref: n.ref })
  return out
}

function allFileChanges(ops: Ops): { where: string; change: FileChange }[] {
  const out: { where: string; change: FileChange }[] = []
  for (const s of Object.values(ops.sessions)) s.changes.forEach((change) => out.push({ where: s.id, change }))
  for (const run of Object.values(ops.runs)) {
    run.steps.forEach((s) => s.fileChanges?.forEach((change) => out.push({ where: s.id, change })))
    if (!run.script) continue
    const params = planOf(run)
    params.steps.forEach((p: StepPlan, i) => p.fileChanges?.forEach((change) => out.push({ where: `${run.id}.plan[${i}]`, change })))
    for (const patch of params.onSuccessPatches ?? []) {
      const changes = patch.patch.changes
      if (Array.isArray(changes)) (changes as FileChange[]).forEach((change) => out.push({ where: `${run.id}.patch`, change }))
    }
  }
  return out
}

const demo = (path: string) => DEMO_REPO.files.find((f) => f.path === path)?.content

describe('seed operations', () => {
  it('builds in well under 50 ms', () => {
    const cold = performance.now()
    buildOps(NOW)
    const coldMs = performance.now() - cold
    const warm = Array.from({ length: 5 }, () => {
      const t = performance.now()
      buildOps(NOW)
      return performance.now() - t
    })
    expect(Math.min(...warm)).toBeLessThan(50)
    expect(coldMs).toBeLessThan(150) // generous for slow CI; typically ~30 ms
  })

  it('is deterministic and keeps every timestamp in the past 70 days', () => {
    for (const now of [NOW, ...OTHER_NOWS]) {
      const a = JSON.stringify(buildOps(now))
      expect(JSON.stringify(buildOps(now))).toBe(a)
      const bad: string[] = []
      JSON.parse(a, (key, value: unknown) => {
        if (/(At|^at)$/.test(key) && typeof value === 'number' && (value > now || value < now - 70 * DAY)) bad.push(`${key}=${value}`)
        return value
      })
      expect(bad, `now=${new Date(now).toISOString()}`).toEqual([])
    }
  })

  it('only references entities that exist (ops rows, ids.ts, the integration catalog)', () => {
    const ops = build()
    const missing = allRefs(ops).filter(({ ref }) => !refExists(ops, ref)).map(({ where, ref }) => `${where} → ${ref.kind}:${ref.id}`)
    expect(missing).toEqual([])
    for (const run of Object.values(ops.runs)) {
      if (run.agentId) expect(ops.agents[run.agentId], run.id).toBeDefined()
      if (run.workflowId) expect(ops.workflows[run.workflowId], run.id).toBeDefined()
      if (run.projectId) expect(CONTENT_IDS.project?.has(run.projectId), run.id).toBe(true)
      for (const actor of [run.initiator]) {
        if (actor.type === 'agent') expect(ops.agents[actor.id]).toBeDefined()
        if (actor.type === 'workflow') expect(ops.workflows[actor.id]).toBeDefined()
      }
    }
    const linkKeys = Object.values(ops.links).map((l) => `${l.from.kind}:${l.from.id}-${l.rel}-${l.to.kind}:${l.to.id}`)
    expect(new Set(linkKeys).size).toBe(linkKeys.length)
  })

  it('ties every approval to an existing run step, and pending ones to waiting runs', () => {
    const ops = build()
    const approvals = Object.values(ops.approvals)
    expect(approvals.filter((a) => a.status !== 'pending').length).toBeGreaterThanOrEqual(12)
    for (const a of approvals) {
      const run = ops.runs[a.runId]
      expect(run, a.id).toBeDefined()
      const step = run?.steps.find((s) => s.id === a.stepId)
      expect(step?.approvalId, a.id).toBe(a.id)
      expect(CAPABILITIES[a.capability]).toBeDefined()
      if (a.status === 'pending') {
        expect(run?.status).toBe('waiting')
        expect(step?.status).toBe('waiting')
      } else {
        expect(a.resolvedAt).toBeGreaterThanOrEqual(a.createdAt)
        expect(a.resolution?.by).toEqual({ type: 'user', id: 'usr_me' })
      }
    }
    expect(ops.approvals['apv_seed_npm']).toMatchObject({
      runId: 'run_seed_ses_stripe', title: 'Run npm install stripe@^18 --save', capability: 'shell.execute', risk: 'medium',
      requestedBy: { type: 'agent', id: AGENT.forge }, status: 'pending', preview: { kind: 'command', content: 'npm install stripe@^18 --save' },
    })
    expect(ops.approvals['apv_seed_slack']).toMatchObject({
      runId: 'run_seed_herald_digest', capability: 'messages.send', risk: 'high', status: 'pending', preview: { kind: 'message', label: '#product' },
    })
    const slackStep = ops.runs['run_seed_herald_digest']?.steps.find((s) => s.approvalId === 'apv_seed_slack')
    expect(slackStep?.integrationId).toBe('slack')
  })

  it('gives in-flight runs a resumable script consistent with their steps', () => {
    const ops = build()
    const expected: Record<string, { status: Run['status']; done: number; total: number }> = {
      run_seed_inv_pricing: { status: 'running', done: 3, total: 9 },
      run_seed_ses_stripe: { status: 'waiting', done: 3, total: 9 },
      run_seed_herald_digest: { status: 'waiting', done: 4, total: 5 },
      run_seed_sentinel_triage: { status: 'running', done: 2, total: 6 },
      run_seed_muse_storyboard: { status: 'running', done: 1, total: 5 },
    }
    const active = Object.values(ops.runs).filter((r) => r.status === 'running' || r.status === 'waiting')
    expect(active.map((r) => r.id).sort()).toEqual(Object.keys(expected).sort())
    for (const run of active) {
      const want = expected[run.id]
      const script = run.script
      expect(script?.factory).toBe('scripted')
      const params = planOf(run)
      expect(JSON.parse(JSON.stringify(params))).toEqual(params)
      expect(run.status).toBe(want?.status)
      expect(params.steps.length).toBe(want?.total)
      expect(script?.cursor).toBe(want?.done)
      const done = run.steps.filter((s) => s.status === 'done')
      expect(done.length).toBe(script?.cursor)
      if (run.status === 'running') expect(run.steps.length).toBe(script?.cursor)
      else {
        expect(run.steps.length).toBe((script?.cursor ?? 0) + 1)
        const waiting = run.steps[script?.cursor ?? 0]
        expect(waiting?.status).toBe('waiting')
        expect(ops.approvals[waiting?.approvalId ?? '']?.status).toBe('pending')
        expect(params.steps[script?.cursor ?? 0]?.approval).toBeDefined()
      }
      run.steps.forEach((s, i) => expect(s.title).toBe(params.steps[i]?.title))
      for (const p of params.steps) {
        expect(p.durationMs).toBeGreaterThanOrEqual(1_500)
        expect(p.durationMs).toBeLessThanOrEqual(6_000)
      }
      expect(params.summary.length).toBeGreaterThan(20)
    }
    expect(ops.runs['run_seed_inv_pricing']).toMatchObject({ kind: 'research', agentId: AGENT.scout, origin: { kind: 'investigation', id: INVESTIGATION.pricingTrends } })
    expect(ops.runs['run_seed_ses_stripe']).toMatchObject({ kind: 'code', agentId: AGENT.forge, origin: { kind: 'session', id: SESSION.stripe } })
    expect(ops.runs['run_seed_herald_digest']).toMatchObject({ kind: 'agent', agentId: AGENT.herald, origin: { kind: 'task', id: TASK.weeklyDigest } })
    expect(ops.runs['run_seed_sentinel_triage']).toMatchObject({ kind: 'workflow', agentId: AGENT.sentinel, workflowId: WORKFLOW.triage })
    expect(ops.runs['run_seed_muse_storyboard']).toMatchObject({ kind: 'studio', agentId: AGENT.muse, origin: { kind: 'task', id: TASK.heroVideo } })
  })

  it('patches the investigation, its sources and the Stripe session on success', () => {
    const ops = build()
    const pricing = planOf(ops.runs['run_seed_inv_pricing'] as Run).onSuccessPatches ?? []
    const inv = pricing.find((p) => p.table === 'investigations')
    expect(inv?.id).toBe(INVESTIGATION.pricingTrends)
    expect(inv?.patch.status).toBe('review')
    const report = String(inv?.patch.report)
    for (let n = 1; n <= 8; n++) expect(report).toContain(`[${n}]`)
    const findings = inv?.patch.findings as { sourceIds: string[] }[]
    expect(findings.length).toBeGreaterThanOrEqual(4)
    for (const f of findings) for (const id of f.sourceIds) expect(CONTENT_IDS.source?.has(id)).toBe(true)
    const sourcePatches = pricing.filter((p) => p.table === 'sources')
    expect(sourcePatches.map((p) => p.id)).toEqual(expect.arrayContaining(['src_pricing_4', 'src_pricing_8']))
    for (const p of sourcePatches) expect(['read', 'cited']).toContain(p.patch.status)

    const stripe = planOf(ops.runs['run_seed_ses_stripe'] as Run).onSuccessPatches?.[0]
    expect(stripe).toMatchObject({ table: 'sessions', id: SESSION.stripe, patch: { status: 'needs_review' } })
    const paths = (stripe?.patch.changes as FileChange[]).map((c) => c.path)
    expect(paths).toEqual(expect.arrayContaining(['src/billing/stripe.ts', 'src/api/invoices.ts']))
  })

  it('links sessions to existing code runs, tasks and the demo repo', () => {
    const ops = build()
    const expected: Record<string, { status: string; task: string }> = {
      [SESSION.sso]: { status: 'needs_review', task: TASK.ssoFix },
      [SESSION.stripe]: { status: 'working', task: TASK.stripeMigration },
      [SESSION.bundle]: { status: 'merged', task: TASK.bundleSize },
      [SESSION.flaky]: { status: 'failed', task: TASK.flakyTest },
    }
    for (const s of Object.values(ops.sessions)) {
      expect(s.repoId).toBe(REPO.atlas)
      expect(s.agentId).toBe(AGENT.forge)
      expect(s.status).toBe(expected[s.id]?.status)
      expect(s.taskId).toBe(expected[s.id]?.task)
      for (const turn of s.turns) {
        const run = ops.runs[turn.runId ?? '']
        expect(run?.kind, turn.id).toBe('code')
        expect(run?.origin).toEqual({ kind: 'session', id: s.id })
        expect(turn.createdAt).toBeLessThanOrEqual(run?.createdAt ?? 0)
      }
      const codeRuns = Object.values(ops.runs).filter((r) => r.origin?.kind === 'session' && r.origin.id === s.id)
      expect(codeRuns.map((r) => r.id).sort()).toEqual(s.turns.map((t) => t.runId).sort())
    }
    expect(ops.sessions[SESSION.bundle]?.pr).toMatchObject({ number: 214, status: 'merged', simulated: true })
    const flakyE2e = ops.sessions[SESSION.flaky]?.checks.at(-1)
    expect(flakyE2e).toMatchObject({ name: 'e2e', status: 'failed' })
    expect(ops.sessions[SESSION.sso]?.checks.every((c) => c.status === 'passed')).toBe(true)
  })

  it('runs workflow steps on real nodes along real edges', () => {
    const ops = build()
    for (const wf of Object.values(ops.workflows)) {
      const ids = new Set(wf.nodes.map((n) => n.id))
      for (const e of wf.edges) {
        expect(ids.has(e.source) && ids.has(e.target), `${wf.id}:${e.id}`).toBe(true)
      }
      for (const n of wf.nodes.filter((x) => x.type === 'condition')) {
        const handles = wf.edges.filter((e) => e.source === n.id).map((e) => e.sourceHandle).sort()
        expect(handles, n.id).toEqual(['false', 'true'])
      }
      const runs = Object.values(ops.runs).filter((r) => r.workflowId === wf.id)
      if (wf.enabled) expect(runs.length, wf.id).toBeGreaterThanOrEqual(3)
      for (const run of runs) {
        const steps = [...run.steps.map((s) => s.nodeId), ...(run.script ? planOf(run).steps.slice(run.steps.length).map((p) => p.nodeId) : [])]
        steps.forEach((nodeId, i) => {
          expect(nodeId && ids.has(nodeId), `${run.id} step ${i}`).toBe(true)
          if (i === 0) return
          const earlier = new Set(steps.slice(0, i))
          expect(wf.edges.some((e) => e.target === nodeId && earlier.has(e.source)), `${run.id} → ${nodeId}`).toBe(true)
        })
        run.steps.forEach((s, i) => {
          const branch = /→ (true|false)$/.exec(s.title)?.[1]
          const next = run.steps[i + 1]
          if (!branch || !next) return
          expect(wf.edges.some((e) => e.source === s.nodeId && e.target === next.nodeId && e.sourceHandle === branch), `${run.id} ${s.title}`).toBe(true)
        })
      }
    }
  })

  it('counts FileChange additions/deletions exactly, from real demo repo content', () => {
    const ops = build()
    const changes = allFileChanges(ops)
    expect(changes.length).toBeGreaterThanOrEqual(10)
    for (const { where, change } of changes) {
      let added = 0
      let removed = 0
      for (const part of diffLines(change.before ?? '', change.after ?? '')) {
        if (part.added) added += part.count ?? 0
        if (part.removed) removed += part.count ?? 0
      }
      expect({ where, additions: change.additions, deletions: change.deletions }).toEqual({ where, additions: added, deletions: removed })
      expect(lineDiffCounts(change.before, change.after)).toEqual({ additions: added, deletions: removed })
      if (change.changeType === 'modified') expect(change.before !== undefined && change.after !== undefined).toBe(true)
    }
    for (const s of Object.values(ops.sessions)) {
      for (const c of s.changes) {
        if (s.status === 'merged') expect(c.after, `${s.id} ${c.path}`).toBe(demo(c.path))
        else expect(c.before, `${s.id} ${c.path}`).toBe(demo(c.path))
      }
    }
    expect(demo('src/auth/session.ts')).toContain('tokenLifetimeMs - REFRESH_LEAD_MS')
    expect(demo('e2e/checkout.spec.ts')).toContain('waitForTimeout(3000)')
  })

  it('ships a coherent 30–40 file demo repo with a complete tree', () => {
    const ops = build()
    const files = DEMO_REPO.files
    expect(files.length).toBeGreaterThanOrEqual(30)
    expect(files.length).toBeLessThanOrEqual(40)
    expect(new Set(files.map((f) => f.path)).size).toBe(files.length)
    for (const f of files) expect(f.content.split('\n').length, f.path).toBeLessThanOrEqual(151)
    const repo = ops.repos[REPO.atlas]
    expect(repo).toMatchObject({ provider: 'demo', mode: 'simulated', fullName: 'northwind/atlas-portal', projectId: PROJECT.atlas, defaultBranch: 'main' })
    const tree = new Map((repo?.tree ?? []).map((e) => [e.path, e.type]))
    for (const f of files) {
      expect(tree.get(f.path)).toBe('file')
      const parts = f.path.split('/')
      for (let i = 1; i < parts.length; i++) expect(tree.get(parts.slice(0, i).join('/')), f.path).toBe('dir')
    }
  })

  it('grants only catalog capabilities through integrations that provide them', () => {
    const ops = build()
    const expectations: Record<string, { autonomy: string; model: string; status: string }> = {
      [AGENT.scout]: { autonomy: 'balanced', model: 'sim-deep', status: 'active' },
      [AGENT.forge]: { autonomy: 'balanced', model: 'sim-deep', status: 'active' },
      [AGENT.herald]: { autonomy: 'balanced', model: 'sim-swift', status: 'active' },
      [AGENT.sentinel]: { autonomy: 'autonomous', model: 'sim-swift', status: 'active' },
      [AGENT.muse]: { autonomy: 'autonomous', model: 'sim-swift', status: 'active' },
      [AGENT.ledger]: { autonomy: 'supervised', model: 'sim-swift', status: 'active' },
      [AGENT.archivist]: { autonomy: 'balanced', model: 'sim-swift', status: 'paused' },
    }
    expect(Object.keys(ops.agents).sort()).toEqual(Object.values(AGENT).sort())
    for (const agent of Object.values(ops.agents)) {
      expect({ autonomy: agent.autonomy, model: agent.modelId, status: agent.status }).toEqual(expectations[agent.id])
      expect(agent.instructions.split('\n').length).toBeGreaterThanOrEqual(6)
      for (const g of agent.capabilities) {
        expect(CAPABILITIES[g.capability], `${agent.id} ${g.capability}`).toBeDefined()
        if (g.integrationId) {
          const integration = INTEGRATION_BY_ID[g.integrationId]
          expect(integration, `${agent.id} ${g.integrationId}`).toBeDefined()
          expect(integration?.capabilities, `${agent.id} ${g.capability} via ${g.integrationId}`).toContain(g.capability)
        }
      }
    }
    const forge = ops.agents[AGENT.forge]?.capabilities ?? []
    expect(forge).toEqual(expect.arrayContaining([
      { capability: 'repo.pull_request', mode: 'ask', integrationId: 'github' },
      { capability: 'shell.execute', mode: 'ask', integrationId: 'sandbox' },
    ]))
    expect(ops.agents[AGENT.ledger]?.capabilities).toContainEqual({ capability: 'payments.spend', mode: 'deny', integrationId: 'stripe' })
    expect(ops.agents[AGENT.herald]?.schedule).toMatchObject({ cron: '0 9 * * 1', label: 'Mondays at 09:00' })
  })

  it('keeps connections honest and their usage consistent with the runs', () => {
    const ops = build()
    const conns = Object.values(ops.connections)
    expect(conns.some((c) => c.id === 'anthropic' || c.id === 'openai-compatible')).toBe(false)
    for (const c of conns) {
      const def = INTEGRATION_BY_ID[c.id]
      expect(def, c.id).toBeDefined()
      expect(c.mode).toBe(c.id === 'github' ? 'live' : 'simulated')
      for (const s of c.scopes) expect(def?.capabilities, `${c.id} ${s.capability}`).toContain(s.capability)
      const used = Object.values(ops.runs).flatMap((r) => r.steps).filter((s) => s.integrationId === c.id && (s.status === 'done' || s.status === 'failed'))
      expect(c.usageCount, c.id).toBe(used.length)
    }
    expect(ops.connections['jira']).toMatchObject({ status: 'error', error: 'Token expired — reconnect to resume syncing' })
    expect(ops.connections['github']).toMatchObject({ status: 'connected', account: 'public access' })
  })

  it('has simulated, correctly costed runs with a realistic status mix', () => {
    const ops = build()
    const runs = Object.values(ops.runs)
    const finished = runs.filter((r) => !r.script)
    expect(finished.length).toBeGreaterThanOrEqual(65)
    for (const run of runs) {
      expect(run.simulated).toBe(true)
      const { inputTokens: i, outputTokens: o, costUsd } = run.usage
      expect(costUsd).toBeCloseTo((i * 2 + o * 10) / 1e6, 6)
      expect(run.createdAt).toBeLessThanOrEqual(run.startedAt ?? run.createdAt)
      for (const s of run.steps) {
        expect(s.startedAt ?? 0).toBeGreaterThanOrEqual(run.startedAt ?? 0)
        if (run.endedAt && s.endedAt) expect(s.endedAt).toBeLessThanOrEqual(run.endedAt)
      }
      if (run.status === 'failed') expect(run.steps.some((s) => s.status === 'failed' && !!s.error), run.id).toBe(true)
    }
    for (const run of finished) {
      const tokens = run.usage.inputTokens + run.usage.outputTokens
      expect(tokens, run.id).toBeGreaterThanOrEqual(2_000)
      expect(tokens, run.id).toBeLessThanOrEqual(120_000)
      expect(run.steps.length, run.id).toBeGreaterThanOrEqual(run.kind === 'chat' ? 1 : 3)
      expect(run.steps.length, run.id).toBeLessThanOrEqual(run.kind === 'chat' ? 2 : 9)
    }
    const count = (s: Run['status']) => finished.filter((r) => r.status === s).length
    expect(count('succeeded') / finished.length).toBeGreaterThanOrEqual(0.85)
    expect(count('failed')).toBeGreaterThanOrEqual(3)
    expect(count('cancelled')).toBeGreaterThanOrEqual(2)
    for (const kind of ['chat', 'code', 'agent', 'research', 'workflow', 'studio'] as const) {
      expect(runs.filter((r) => r.kind === kind).length, kind).toBeGreaterThan(0)
    }
    for (const chat of runs.filter((r) => r.kind === 'chat')) {
      expect(chat.origin?.kind).toBe('thread')
      expect(['sim-deep', 'sim-swift']).toContain(chat.modelId)
    }
  })

  it('merges with the content part without id collisions', () => {
    const seed = buildSeed(NOW)
    const ops = build()
    for (const [table, rows] of Object.entries(ops) as [keyof Ops, Record<string, unknown>][]) {
      for (const id of Object.keys(rows)) expect(seed[table][id], `${table}/${id}`).toEqual(rows[id])
    }
    // Once the content part is filled in, every ops reference to it must resolve.
    const tables: Partial<Record<EntityKind, keyof Tables>> = {
      task: 'tasks', thread: 'threads', knowledge: 'knowledge', investigation: 'investigations', board: 'boards', project: 'projects', source: 'sources',
    }
    for (const { where, ref } of allRefs(ops)) {
      const table = tables[ref.kind]
      if (table && Object.keys(seed[table]).length > 0) expect(seed[table][ref.id], `${where} → ${ref.kind}:${ref.id}`).toBeDefined()
    }
  })

  it('never uses wall-clock time, Math.random or random ids', () => {
    // repoEdits.ts is excluded: it holds demo-repo source code (which legitimately calls Date.now) as data.
    const sources = import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./repoEdits.ts'], { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(sources).length).toBeGreaterThan(10)
    for (const [path, text] of Object.entries(sources)) {
      expect(String(text), path).not.toMatch(/Date\.now\(|Math\.random|newId\(/)
    }
  })
})
