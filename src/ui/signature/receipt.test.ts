import { describe, expect, it } from 'vitest'
import type { Approval, Run } from '@/core/types'
import { buildReceipt, receiptJson, receiptToMarkdown } from './receipt'

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 1, h, m, s).getTime()

const codeRun: Run = {
  id: 'run_k3j9x0q2ab',
  kind: 'code',
  title: 'Migrate invoices to Stripe Billing (step 1)',
  status: 'succeeded',
  projectId: 'prj_atlas',
  agentId: 'agt_forge',
  initiator: { type: 'user', id: 'usr_me' },
  steps: [
    { id: 'stp_1', kind: 'plan', title: 'Planned the change', status: 'done', tokens: 2200 },
    {
      id: 'stp_2', kind: 'read', title: 'Read the Stripe Billing migration plan', status: 'done', tool: 'knowledge.search', capability: 'knowledge.read',
      refs: [{ kind: 'knowledge', id: 'kno_stripe_plan' }, { kind: 'knowledge', id: 'kno_adr_sessions' }], tokens: 6000,
    },
    { id: 'stp_3', kind: 'read', title: 'Read src/api/invoices.ts', status: 'done', tool: 'repo', capability: 'repo.read', integrationId: 'github', refs: [{ kind: 'repo', id: 'rep_atlas' }], tokens: 2000 },
    { id: 'stp_4', kind: 'command', title: 'Run npm install stripe', status: 'done', tool: 'terminal', capability: 'shell.execute', integrationId: 'sandbox', approvalId: 'apv_1', input: 'npm install stripe', tokens: 600 },
    { id: 'stp_5', kind: 'test', title: 'Run checks', status: 'done', tool: 'checks', integrationId: 'sandbox', tokens: 1100 },
  ],
  outputs: [{ kind: 'session', id: 'ses_stripe' }],
  modelId: 'sim-deep',
  simulated: true,
  usage: { inputTokens: 8890, outputTokens: 3010, costUsd: 0.0479 },
  progress: 1,
  plannedSteps: 5,
  createdAt: at(10, 30),
  startedAt: at(10, 30),
  endedAt: at(10, 31, 24),
}

const approvals: Approval[] = [
  {
    id: 'apv_1', runId: codeRun.id, stepId: 'stp_4', title: 'Run npm install stripe', capability: 'shell.execute', risk: 'medium',
    requestedBy: { type: 'agent', id: 'agt_forge' }, status: 'approved', createdAt: at(10, 30, 30), resolvedAt: at(10, 42),
    resolution: { by: { type: 'user', id: 'usr_me' } },
  },
]

describe('buildReceipt', () => {
  it('collects model, tools, capability decisions, tokens, cost, duration, saw and outputs', () => {
    const r = buildReceipt(codeRun, { approvals })
    expect(r.model).toEqual({ label: 'Simulator · Deep', provider: "Atrium's local simulator", simulated: true })
    expect(r.tools).toEqual([
      { label: 'Knowledge', simulated: true, uses: 1 },
      { label: 'Repository', simulated: true, uses: 1 },
      { label: 'Terminal', simulated: true, uses: 1 },
      { label: 'Checks', simulated: true, uses: 1 },
    ])
    expect(r.capabilities).toEqual([
      { capability: 'knowledge.read', label: 'Read knowledge', decision: 'allowed by policy', outcome: 'allowed' },
      { capability: 'repo.read', label: 'Read repositories', decision: 'allowed by policy', outcome: 'allowed' },
      { capability: 'shell.execute', label: 'Run commands', decision: 'approved by you 10:42', outcome: 'approved' },
    ])
    expect(r.durationMs).toBe(84_000)
    expect(r.costIsEstimate).toBe(true)
    expect(r.saw.map((s) => [s.ref.id, s.tokens, Math.round(s.share * 100)])).toEqual([
      ['kno_stripe_plan', 3000, 38],
      ['kno_adr_sessions', 3000, 38],
      ['rep_atlas', 2000, 25],
    ])
    expect(r.outputs).toEqual([{ kind: 'session', id: 'ses_stripe' }])
  })

  it('marks live tools and GitHub verbs in a live run', () => {
    const live: Run = { ...codeRun, simulated: false, modelId: 'claude-sonnet-5-5' }
    const r = buildReceipt(live)
    expect(r.model).toMatchObject({ label: 'Claude Sonnet 5.5', provider: 'Anthropic', simulated: false })
    expect(r.tools.find((t) => t.label === 'Repository')?.simulated).toBe(false)
    expect(r.tools.find((t) => t.label === 'Terminal')?.simulated).toBe(true)
    expect(r.capabilities.find((c) => c.capability === 'shell.execute')?.decision).toBe('approved by you')
    const gh = buildReceipt({ ...live, steps: [{ id: 'x', kind: 'read', title: 'Read', status: 'done', tool: 'github', integrationId: 'github', capability: 'repo.read' }] })
    expect(gh.tools).toEqual([{ label: 'GitHub read', simulated: false, uses: 1 }])
  })

  it('records denials with their reason and pending decisions', () => {
    const denied: Approval = { ...approvals[0], status: 'rejected', resolution: { by: { type: 'user', id: 'usr_me' }, note: 'Not this week' } }
    expect(buildReceipt(codeRun, { approvals: [denied] }).capabilities[2]).toMatchObject({ decision: 'denied by you 10:42 · Not this week', outcome: 'denied' })
    const pending: Approval = { ...approvals[0], status: 'pending', resolvedAt: undefined, resolution: undefined }
    expect(buildReceipt(codeRun, { approvals: [pending] }).capabilities[2]).toMatchObject({ decision: 'waiting for you', outcome: 'pending' })
  })

  it('accepts an explicit Saw list', () => {
    const r = buildReceipt(codeRun, { saw: [{ ref: { kind: 'message', id: 'msg_1' }, tokens: 300 }, { ref: { kind: 'knowledge', id: 'k' }, tokens: 100 }] })
    expect(r.saw.map((s) => s.share)).toEqual([0.75, 0.25])
  })
})

describe('receiptToMarkdown', () => {
  it('renders a simulated receipt with the exact §8.4 notice first', () => {
    const md = receiptToMarkdown(codeRun, {
      approvals,
      resolveTitle: (ref) => ({ kno_stripe_plan: 'Stripe Billing migration plan', kno_adr_sessions: 'ADR-012', rep_atlas: 'northwind/atlas-portal', ses_stripe: 'Migrate invoices' })[ref.id] ?? ref.id,
    })
    expect(md.split('\n')[0]).toBe(
      "> **Simulated content.** Generated by Atrium's local simulator on Nov 1, 2026. No AI model, web search or external service was used.",
    )
    expect(md).toContain('## Receipt · Migrate invoices to Stripe Billing (step 1)')
    expect(md).toContain('- **Run:** RUN-K3J9 · Coding · Done')
    expect(md).toContain("- **Model:** Simulator · Deep (Atrium's local simulator, SIM) · No model was called")
    expect(md).toContain('- **Tools:** Knowledge SIM, Repository SIM, Terminal SIM, Checks SIM')
    expect(md).toContain('  - Run commands · approved by you 10:42')
    expect(md).toContain('- **Tokens:** 8,890 in · 3,010 out (est.)')
    expect(md).toContain('- **Cost:** est. $0.05 at reference pricing (no money was spent)')
    expect(md).toContain('- **Duration:** 01:24')
    expect(md).toContain('  - Stripe Billing migration plan (knowledge) · 3,000 tok · 38%')
    expect(md).toContain('  - Migrate invoices (coding session)')
  })

  it('renders a live, stopped receipt without the notice', () => {
    const md = receiptToMarkdown({ ...codeRun, simulated: false, modelId: 'claude-sonnet-5-5', status: 'cancelled', usage: { inputTokens: 900, outputTokens: 304, costUsd: 0.004 }, endedAt: at(10, 30, 3) })
    expect(md.startsWith('## Receipt')).toBe(true)
    expect(md).toContain('· Stopped by you')
    expect(md).toContain('- **Cost:** $0.004')
    expect(md).toContain('- **Duration:** 3.0 s')
    expect(md).toContain('(Anthropic, LIVE)')
  })

  it('serializes raw JSON with the run’s approvals', () => {
    const json = JSON.parse(receiptJson(codeRun, [...approvals, { ...approvals[0], id: 'apv_other', runId: 'run_other' }]))
    expect(json.run.id).toBe(codeRun.id)
    expect(json.approvals.map((a: Approval) => a.id)).toEqual(['apv_1'])
  })
})
