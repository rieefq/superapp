import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import { FileText, ListPlus, MessageSquareText, Telescope } from 'lucide-react'
import { useRun } from '@/core/runs/hooks'
import { useSettings } from '@/core/settings'
import type { Approval, ApprovalStatus, EntityRef, Hue, Priority, Run, RunStatus, RunStep, StepKind, StepStatus, TaskStatus } from '@/core/types'
import { HUES } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, Kicker, VisuallyHidden } from '@/ui/primitives'
import {
  AgentMark, ApprovalCard, ApprovalCardConnected, AtriumMark, EntityChip, EntityHoverCard, EntityIcon, FAVICON_SVGS, IdCode, LiveBadge,
  LiveIndicator, MetaLabel, MonogramMark, OutcomeTape, PriorityGlyph, ProvenanceLine, Receipt, RunMeta, RunPeek, RunPill, RunRow, RunStatusBadge,
  RunStatusGlyph, RunTimeline, SelectionToolbar, SimBadge, StatusDot, StepIcon, StepStatusGlyph, StepTape, TaskGlyph, TickMeter,
  type ApprovalRequester, type AtriumMarkState, type RunOwner, type RunProjectInfo,
} from '@/ui/signature'

// ------------------------------------------------------------------------------------------------ scaffolding

const TOC = [
  ['mark', 'Mark'],
  ['glyphs', 'Status glyphs'],
  ['tape', 'Step Tape'],
  ['runs', 'Pills & rows'],
  ['timeline', 'RunTimeline'],
  ['approvals', 'ApprovalCard'],
  ['provenance', 'Colophon & Receipt'],
  ['identity', 'Identity marks'],
  ['entities', 'Entity chips'],
  ['small', 'Small parts'],
  ['connected', 'Connected'],
] as const

function Block({ id, kicker, title, description, children }: { id: string; kicker: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={`sig-${id}`} aria-labelledby={`sig-${id}-title`} className="flex scroll-mt-20 flex-col gap-6">
      <div className="flex flex-col gap-1.5 border-b border-line pb-4">
        <Kicker>{kicker}</Kicker>
        <h3 id={`sig-${id}-title`} className="font-serif text-2xl leading-8 text-ink">
          {title}
        </h3>
        {description && <p className="max-w-2xl text-sm text-ink-3 text-pretty">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Specimen({ label, note, children, className, wide }: { label: string; note?: ReactNode; children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', wide && 'md:col-span-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="type-label text-ink-3">{label}</span>
        {note && <span className="type-caption text-ink-3">{note}</span>}
      </div>
      {children}
    </div>
  )
}

function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) {
  return <div className={cn('grid gap-x-10 gap-y-10', cols === 2 && 'md:grid-cols-2')}>{children}</div>
}

/** A labelled cell in a glyph table. */
function Cell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <div className="flex h-6 items-center">{children}</div>
      <span className="type-meta text-ink-3">{label}</span>
    </div>
  )
}

const panel = 'rounded-md border border-line bg-canvas'

// ------------------------------------------------------------------------------------------------ fixtures

const NOW = Date.now()
const SEC = 1000
const MIN = 60 * SEC
const ago = (ms: number) => NOW - ms
const ME = { type: 'user' as const, id: 'usr_me' }

const AGENTS = {
  forge: { name: 'Forge', hue: 'sky', sigil: 40_127 },
  scout: { name: 'Scout', hue: 'violet', sigil: 77_311 },
  herald: { name: 'Herald', hue: 'amber', sigil: 9_043 },
  sentinel: { name: 'Sentinel', hue: 'mint', sigil: 52_610 },
  muse: { name: 'Muse', hue: 'rose', sigil: 13_377 },
  archivist: { name: 'Archivist', hue: 'coral', sigil: 88_002 },
} satisfies Record<string, RunOwner>

const PROJECTS = {
  atlas: { name: 'Atlas Portal v2', hue: 'sky' },
  landscape: { name: 'Q4 Competitive Landscape', hue: 'violet' },
  lumen: { name: 'Lumen Launch', hue: 'amber' },
  ops: { name: 'Support Ops Automation', hue: 'mint' },
} satisfies Record<string, RunProjectInfo>

const requesterOf = (a: RunOwner): ApprovalRequester => ({ name: a.name, mark: <AgentMark seed={a.sigil} hue={a.hue} size={16} /> })

function run(p: Partial<Run> & Pick<Run, 'id' | 'kind' | 'title' | 'status' | 'steps'>): Run {
  return {
    projectId: null,
    initiator: ME,
    outputs: [],
    simulated: true,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    progress: 0,
    createdAt: ago(2 * MIN),
    ...p,
  }
}

/** Steps laid out back to back, ending `endAgo` ms ago. */
function timed(steps: (Omit<RunStep, 'startedAt' | 'endedAt'> & { ms?: number })[], endAgo: number): RunStep[] {
  const total = steps.reduce((n, s) => n + (s.status === 'pending' ? 0 : (s.ms ?? 2000)), 0)
  let cursor = NOW - endAgo - total
  return steps.map(({ ms = 2000, ...s }) => {
    if (s.status === 'pending') return s
    const startedAt = cursor
    cursor += ms
    return s.status === 'running' || s.status === 'waiting' ? { ...s, startedAt } : { ...s, startedAt, endedAt: cursor }
  })
}

const fc = (path: string, additions: number, deletions: number, changeType: 'added' | 'modified' = 'modified') => ({ path, additions, deletions, changeType })

const CHECKS_CMD = 'npm run typecheck && npm run lint && npx vitest run && npx playwright test'
const CHECKS_OUTPUT = [
  '> atlas-portal@2.4.0 typecheck',
  '> tsc --noEmit',
  '✓ No type errors (412 files)',
  '> atlas-portal@2.4.0 lint',
  '✓ 0 problems',
  ' RUN  v3.2.4 /workspace/atlas-portal',
  ' ✓ src/billing/stripe.test.ts (5 tests) 41ms',
  ' ✓ src/api/invoices.test.ts (12 tests) 88ms',
  ' ✓ src/auth/session.test.ts (9 tests) 37ms',
  ' ✓ src/checkout/Checkout.test.tsx (14 tests) 212ms',
  ' Test Files  4 passed (4)',
  '      Tests  40 passed (40)',
  'Running 6 tests using 3 workers',
  '  ✓  checkout › pays an invoice with a saved card (2.1s)',
  '  ✓  invoices › lists invoices from Stripe when flagged (1.4s)',
  '  6 passed (9.8s)',
]

const CODE_RUN = run({
  id: 'run_4f2a9kq1xd',
  kind: 'code',
  title: 'Migrate invoices to Stripe Billing (step 1)',
  status: 'running',
  projectId: 'prj_atlas',
  agentId: 'agt_forge',
  modelId: 'sim-deep',
  plannedSteps: 9,
  usage: { inputTokens: 29_610, outputTokens: 12_690, costUsd: 0.186 },
  createdAt: ago(84 * SEC),
  startedAt: ago(84 * SEC),
  steps: timed(
    [
      {
        id: 'stp_g_s1', kind: 'plan', title: 'Planned step 1 of the migration', status: 'done', tokens: 2200, ms: 2600,
        output: '1. Add the official stripe package (types only, no keys in the browser)\n2. Implement list, get and send in src/billing/stripe.ts\n3. Route src/api/invoices.ts through Stripe when VITE_FLAG_STRIPE_BILLING is on\n4. Add mapping and pagination tests\n5. Run checks',
      },
      { id: 'stp_g_s2', kind: 'read', title: 'Read src/api/invoices.ts and src/billing/stripe.ts', status: 'done', tool: 'repo', capability: 'repo.read', integrationId: 'github', tokens: 7400, ms: 2200 },
      { id: 'stp_g_s3', kind: 'read', title: 'Read the Stripe Billing migration plan', status: 'done', tool: 'knowledge.search', capability: 'knowledge.read', refs: [{ kind: 'knowledge', id: 'kno_stripe_plan' }], tokens: 5600, ms: 1800 },
      {
        id: 'stp_g_s4', kind: 'command', title: 'Run npm install stripe@^18 --save', status: 'done', tool: 'terminal', capability: 'shell.execute', integrationId: 'sandbox',
        input: 'npm install stripe@^18 --save', output: 'added 1 package, and audited 412 packages in 3s\n\n87 packages are looking for funding\n  run `npm fund` for details\n\nfound 0 vulnerabilities',
        fileChanges: [fc('package.json', 1, 0), fc('package-lock.json', 18, 2)], approvalId: 'apv_g_npm_done', tokens: 600, ms: 4800,
      },
      { id: 'stp_g_s5', kind: 'edit', title: 'Implement Stripe invoice calls in src/billing/stripe.ts', status: 'done', tool: 'editor', capability: 'repo.write', integrationId: 'github', fileChanges: [fc('src/billing/stripe.ts', 84, 3)], tokens: 9800, ms: 5200 },
      { id: 'stp_g_s6', kind: 'edit', title: 'Route src/api/invoices.ts through Stripe behind the flag', status: 'done', tool: 'editor', capability: 'repo.write', integrationId: 'github', fileChanges: [fc('src/api/invoices.ts', 22, 9)], tokens: 6200, ms: 3600 },
      { id: 'stp_g_s7', kind: 'write', title: 'Add src/billing/stripe.test.ts', status: 'done', tool: 'editor', capability: 'repo.write', integrationId: 'github', fileChanges: [fc('src/billing/stripe.test.ts', 96, 0, 'added')], tokens: 7300, ms: 4100 },
      { id: 'stp_g_s8', kind: 'test', title: 'Run checks: typecheck, lint, unit, e2e', status: 'running', tool: 'checks', integrationId: 'sandbox', input: CHECKS_CMD, output: '', ms: 0 },
    ],
    0,
  ),
})

const NPM_DONE: Approval = {
  id: 'apv_g_npm_done', runId: CODE_RUN.id, stepId: 'stp_g_s4', title: 'Run npm install stripe@^18 --save', capability: 'shell.execute', risk: 'medium',
  requestedBy: { type: 'agent', id: 'agt_forge' }, status: 'approved', reason: 'Forge needs your approval to run commands',
  preview: { kind: 'command', content: 'npm install stripe@^18 --save', label: 'Session sandbox · forge/stripe-billing-invoices' },
  createdAt: ago(80 * SEC), resolvedAt: ago(62 * SEC), resolution: { by: ME },
}

/** The checks step streams its output (loops so the gallery stays alive). */
function useStreamingCodeRun(): Run {
  const [n, setN] = useState(4)
  const [startedAt] = useState(() => Date.now() - 9 * SEC)
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v >= CHECKS_OUTPUT.length + 8 ? 2 : v + 1)), 650)
    return () => clearInterval(id)
  }, [])
  return useMemo(() => {
    const shown = Math.min(n, CHECKS_OUTPUT.length)
    return {
      ...CODE_RUN,
      steps: CODE_RUN.steps.map((s) => (s.id === 'stp_g_s8' ? { ...s, startedAt, output: CHECKS_OUTPUT.slice(0, shown).join('\n') } : s)),
    }
  }, [n, startedAt])
}

const FLAKY_APPROVAL: Approval = {
  id: 'apv_g_flaky', runId: 'run_7hd2m0wq3p', stepId: 'stp_g_f5', title: 'Run `npx playwright test e2e/checkout.spec.ts --repeat-each=20`', capability: 'shell.execute',
  risk: 'medium', requestedBy: { type: 'agent', id: 'agt_forge' }, status: 'pending',
  description: 'Forge wants to repeat the checkout test 20 times to confirm the polling fix removes the flake. It runs only in the session sandbox.',
  reason: 'Forge works in balanced mode and asks before medium-risk actions',
  preview: { kind: 'command', content: 'npx playwright test e2e/checkout.spec.ts --repeat-each=20', label: 'Session sandbox · forge/fix-flaky-checkout' },
  createdAt: ago(4 * MIN),
}

const FLAKY_RUN = run({
  id: 'run_7hd2m0wq3p',
  kind: 'code',
  title: 'Fix flaky checkout e2e test',
  status: 'waiting',
  projectId: 'prj_atlas',
  agentId: 'agt_forge',
  modelId: 'sim-deep',
  plannedSteps: 7,
  usage: { inputTokens: 14_200, outputTokens: 6_100, costUsd: 0.089 },
  createdAt: ago(6 * MIN),
  startedAt: ago(6 * MIN),
  steps: timed(
    [
      { id: 'stp_g_f1', kind: 'plan', title: 'Plan the fix', status: 'done', tokens: 1600, ms: 2100, output: 'Checkout.tsx polls the payment intent every 250ms and never clears the timer on unmount. Clear it, wait on the network idle instead, then repeat the test to prove it.' },
      { id: 'stp_g_f2', kind: 'search', title: 'Search the codebase', status: 'done', tool: 'repo', capability: 'repo.read', integrationId: 'github', input: 'setInterval(pollIntent', output: '3 matches in 2 files', tokens: 900, ms: 1400 },
      { id: 'stp_g_f3', kind: 'read', title: 'Read e2e/checkout.spec.ts and src/checkout/Checkout.tsx', status: 'done', tool: 'repo', capability: 'repo.read', integrationId: 'github', tokens: 5200, ms: 2300 },
      { id: 'stp_g_f4', kind: 'edit', title: 'Edit src/checkout/Checkout.tsx', status: 'done', tool: 'editor', capability: 'repo.write', integrationId: 'github', fileChanges: [fc('src/checkout/Checkout.tsx', 14, 6)], tokens: 4100, ms: 3900 },
      { id: 'stp_g_f5', kind: 'command', title: 'Run `npx playwright test e2e/checkout.spec.ts --repeat-each=20`', status: 'waiting', tool: 'terminal', capability: 'shell.execute', integrationId: 'sandbox', input: 'npx playwright test e2e/checkout.spec.ts --repeat-each=20', approvalId: FLAKY_APPROVAL.id, ms: 0 },
    ],
    0,
  ),
})

const RESEARCH_FAILED = run({
  id: 'run_q3t8w1d0pe',
  kind: 'research',
  title: 'Tidewell: Q4 release notes',
  status: 'failed',
  projectId: 'prj_landscape',
  agentId: 'agt_scout',
  modelId: 'sim-deep',
  plannedSteps: 7,
  usage: { inputTokens: 18_700, outputTokens: 4_900, costUsd: 0.111 },
  error: 'Couldn’t read tidewell.example/changelog: the page returned no readable text.',
  createdAt: ago(42 * MIN),
  startedAt: ago(42 * MIN),
  endedAt: ago(40 * MIN),
  steps: timed(
    [
      { id: 'stp_g_r1', kind: 'plan', title: 'Planned 3 angles', status: 'done', tokens: 1500, ms: 2800, output: '1. What shipped in Q4\n2. What changed in pricing and packaging\n3. Where it overlaps Atlas Lumen' },
      { id: 'stp_g_r2', kind: 'search', title: 'Searched: Tidewell Q4 release notes', status: 'done', tool: 'web.search', capability: 'web.search', integrationId: 'web-search', input: 'Tidewell Q4 2026 release notes changelog analytics', output: '14 results · kept 5 (simulated web corpus)', tokens: 3100, ms: 4300 },
      { id: 'stp_g_r3', kind: 'browse', title: 'Read 2 sources', status: 'done', tool: 'web.browse', capability: 'web.browse', integrationId: 'web-search', refs: [{ kind: 'source', id: 'src_tidewell_1' }, { kind: 'source', id: 'src_tidewell_2' }], tokens: 9800, ms: 12_400 },
      { id: 'stp_g_r4', kind: 'browse', title: 'Read the changelog', status: 'failed', tool: 'web.browse', capability: 'web.browse', integrationId: 'web-search', input: 'https://tidewell.example/changelog', error: 'Couldn’t read tidewell.example/changelog: the page returned no readable text.', tokens: 400, ms: 6100 },
    ],
    40 * MIN,
  ),
})

const LIVE_MIXED = run({
  id: 'run_l1v3h00k9r',
  kind: 'research',
  title: 'Why do webhook retries double-charge?',
  status: 'succeeded',
  projectId: 'prj_atlas',
  modelId: 'claude-sonnet-5-5',
  simulated: false,
  plannedSteps: 5,
  usage: { inputTokens: 9_870, outputTokens: 2_416, costUsd: 0.0439 },
  outputs: [{ kind: 'knowledge', id: 'kno_stripe_plan' }],
  createdAt: ago(3 * 60 * MIN),
  startedAt: ago(3 * 60 * MIN),
  endedAt: ago(3 * 60 * MIN - 31 * SEC),
  steps: timed(
    [
      { id: 'stp_g_l1', kind: 'plan', title: 'Planned 2 angles', status: 'done', tokens: 900, ms: 2100 },
      { id: 'stp_g_l2', kind: 'read', title: 'Read src/billing/webhooks.ts', status: 'done', tool: 'github', capability: 'repo.read', integrationId: 'github', refs: [{ kind: 'repo', id: 'rep_atlas' }], tokens: 3800, ms: 3200 },
      { id: 'stp_g_l3', kind: 'search', title: 'Searched: Stripe webhook idempotency retries', status: 'done', tool: 'web.search', capability: 'web.search', integrationId: 'web-search', input: 'stripe webhook retries idempotency key double charge', output: '9 results · kept 3 (simulated web corpus)', tokens: 2200, ms: 4100 },
      { id: 'stp_g_l4', kind: 'think', title: 'Compared the handler with the retry rules', status: 'done', tokens: 2100, ms: 9800, output: 'The handler records the event **after** charging, so a retry that lands before the write charges again. Store the event id first, then charge.' },
      { id: 'stp_g_l5', kind: 'write', title: 'Wrote the answer with a fix', status: 'done', tokens: 1500, ms: 11_600 },
    ],
    3 * 60 * MIN - 31 * SEC,
  ),
})

const CHAT_LIVE = run({
  id: 'run_c8a2t5s1me',
  kind: 'chat',
  title: 'Explain the session-expiry bug',
  status: 'succeeded',
  projectId: 'prj_atlas',
  modelId: 'claude-sonnet-5-5',
  simulated: false,
  usage: { inputTokens: 900, outputTokens: 304, costUsd: 0.004 },
  createdAt: ago(9 * MIN),
  startedAt: ago(9 * MIN),
  endedAt: ago(9 * MIN - 3100),
  steps: timed([{ id: 'stp_g_c1', kind: 'write', title: 'Wrote the answer', status: 'done', tokens: 1204, ms: 3100 }], 9 * MIN - 3100),
})

const CHAT_SIM = run({
  ...CHAT_LIVE,
  id: 'run_c8a2t6s2md',
  title: 'Summarize the launch checklist',
  modelId: 'sim-deep',
  simulated: true,
  usage: { inputTokens: 686, outputTokens: 294, costUsd: 0.0028 },
  endedAt: ago(9 * MIN - 1800),
})

const STOPPED = run({
  ...CHAT_LIVE,
  id: 'run_c8a2t7s3mc',
  title: 'Draft the Q1 OKRs',
  status: 'cancelled',
  usage: { inputTokens: 1210, outputTokens: 188, costUsd: 0.0052 },
  error: 'Cancelled',
  endedAt: ago(9 * MIN - 2400),
})

const DIGEST = run({
  id: 'run_d1g3stw33k',
  kind: 'agent',
  title: 'Send weekly project digest',
  status: 'waiting',
  projectId: 'prj_ops',
  agentId: 'agt_herald',
  modelId: 'sim-swift',
  plannedSteps: 5,
  usage: { inputTokens: 13_860, outputTokens: 5_940, costUsd: 0.072 },
  createdAt: ago(7 * MIN),
  startedAt: ago(7 * MIN),
  steps: timed(
    [
      { id: 'stp_g_d1', kind: 'plan', title: 'Planned this week’s digest', status: 'done', ms: 1900, tokens: 1500 },
      { id: 'stp_g_d2', kind: 'read', title: 'Collected activity from 4 projects', status: 'done', ms: 3200, tokens: 4800, refs: [{ kind: 'session', id: 'ses_sso' }, { kind: 'session', id: 'ses_stripe' }, { kind: 'investigation', id: 'inv_churn' }] },
      { id: 'stp_g_d3', kind: 'read', title: 'Read meeting notes and recent decisions', status: 'done', ms: 2400, tokens: 5200, refs: [{ kind: 'knowledge', id: 'kno_sync_oct28' }] },
      { id: 'stp_g_d4', kind: 'write', title: 'Drafted the digest', status: 'done', ms: 5600, tokens: 8400 },
      { id: 'stp_g_d5', kind: 'message', title: 'Post digest to #product', status: 'waiting', tool: 'slack', capability: 'messages.send', integrationId: 'slack', input: '#product', approvalId: 'apv_g_digest', ms: 0 },
    ],
    0,
  ),
})

const SUCCEEDED = run({
  id: 'run_t1d3w9ll0x',
  kind: 'research',
  title: 'Tidewell positioning & pricing',
  status: 'succeeded',
  projectId: 'prj_landscape',
  agentId: 'agt_scout',
  modelId: 'sim-deep',
  plannedSteps: 8,
  summary: 'Tidewell sells annual, per-site contracts. Strongest on customs; weakest on invoicing and self-serve onboarding. 6 findings with sources.',
  usage: { inputTokens: 43_000, outputTokens: 18_500, costUsd: 0.271 },
  outputs: [{ kind: 'knowledge', id: 'kno_tidewell_teardown' }],
  createdAt: ago(26 * 60 * MIN),
  startedAt: ago(26 * 60 * MIN),
  endedAt: ago(26 * 60 * MIN - 92 * SEC),
  steps: timed(
    [
      { id: 'stp_g_t1', kind: 'plan', title: 'Planned 4 angles', status: 'done', ms: 3400, tokens: 2100 },
      { id: 'stp_g_t2', kind: 'search', title: 'Searched: Tidewell pricing tiers', status: 'done', tool: 'web.search', integrationId: 'web-search', ms: 5200, tokens: 3400 },
      { id: 'stp_g_t3', kind: 'search', title: 'Searched: Tidewell customer reviews', status: 'done', tool: 'web.search', integrationId: 'web-search', ms: 4900, tokens: 3100 },
      { id: 'stp_g_t4', kind: 'browse', title: 'Read 9 pages', status: 'done', tool: 'web.browse', integrationId: 'web-search', refs: [{ kind: 'source', id: 'src_tidewell_1' }, { kind: 'source', id: 'src_tidewell_3' }], ms: 41_000, tokens: 23_800 },
      { id: 'stp_g_t5', kind: 'read', title: 'Compared with our own notes', status: 'done', tool: 'knowledge.search', refs: [{ kind: 'knowledge', id: 'kno_freightly_notes' }], ms: 2400, tokens: 5300 },
      { id: 'stp_g_t6', kind: 'think', title: 'Cross-checked claims', status: 'done', ms: 8200, tokens: 6400 },
      { id: 'stp_g_t7', kind: 'write', title: 'Wrote 6 findings with sources', status: 'done', ms: 7100, tokens: 7300 },
      { id: 'stp_g_t8', kind: 'write', title: 'Drafted the report', status: 'done', ms: 10_400, tokens: 9900, refs: [{ kind: 'knowledge', id: 'kno_tidewell_teardown' }] },
    ],
    26 * 60 * MIN - 92 * SEC,
  ),
})

const PAUSED = run({
  id: 'run_a7c4v3n1tl',
  kind: 'agent',
  title: 'Nightly knowledge tidy-up',
  status: 'paused',
  agentId: 'agt_archivist',
  modelId: 'sim-swift',
  plannedSteps: 6,
  usage: { inputTokens: 6_100, outputTokens: 1_400, costUsd: 0.023 },
  createdAt: ago(31 * MIN),
  startedAt: ago(31 * MIN),
  steps: timed(
    [
      { id: 'stp_g_a1', kind: 'plan', title: 'Planned tonight’s pass', status: 'done', ms: 1500, tokens: 900 },
      { id: 'stp_g_a2', kind: 'search', title: 'Found 14 near-duplicate notes', status: 'done', ms: 3800, tokens: 3600 },
      { id: 'stp_g_a3', kind: 'tool', title: 'Tag notes from the Notion sync', status: 'pending', tool: 'notion', integrationId: 'notion', ms: 0 },
    ],
    29 * MIN,
  ),
})

const QUEUED = run({
  id: 'run_tr1a9e4271',
  kind: 'workflow',
  title: 'Support triage · SUP-427',
  status: 'queued',
  projectId: 'prj_ops',
  workflowId: 'wfl_triage',
  plannedSteps: 4,
  createdAt: ago(5 * SEC),
  steps: [],
})

const UNKNOWN_TOTAL = run({
  id: 'run_c8a2t8s4mb',
  kind: 'chat',
  title: 'Compare hybrid and per-seat pricing',
  status: 'running',
  modelId: 'claude-sonnet-5-5',
  simulated: false,
  usage: { inputTokens: 2_300, outputTokens: 410, costUsd: 0.0087 },
  createdAt: ago(14 * SEC),
  startedAt: ago(14 * SEC),
  steps: timed([
    { id: 'stp_g_u1', kind: 'read', title: 'Read the pricing memo', status: 'done', tool: 'knowledge.search', refs: [{ kind: 'knowledge', id: 'kno_pricing_memo' }], ms: 1800, tokens: 1900 },
    { id: 'stp_g_u2', kind: 'write', title: 'Write the comparison', status: 'running', ms: 0 },
  ], 0),
})

const OVERFLOW = run({
  id: 'run_r4d4rsw33p',
  kind: 'workflow',
  title: 'Competitor radar · weekly sweep',
  status: 'running',
  projectId: 'prj_landscape',
  workflowId: 'wfl_radar',
  plannedSteps: 26,
  createdAt: ago(3 * MIN),
  startedAt: ago(3 * MIN),
  steps: Array.from({ length: 19 }, (_, i): RunStep => ({
    id: `stp_g_o${i}`,
    kind: i % 3 === 0 ? 'search' : 'browse',
    title: `Checked source ${i + 1}`,
    status: i === 18 ? 'running' : i === 7 ? 'skipped' : 'done',
    refs: i % 5 === 2 ? [{ kind: 'source', id: 'src_pricing_2' }] : undefined,
  })),
})

const STOPPED_CODE = run({
  ...FLAKY_RUN,
  id: 'run_7hd2k1zz8a',
  title: 'Fix flaky checkout e2e test (first try)',
  status: 'cancelled',
  error: 'Rejected by you',
  createdAt: FLAKY_RUN.createdAt - 4 * MIN,
  startedAt: FLAKY_RUN.createdAt - 4 * MIN,
  endedAt: FLAKY_RUN.createdAt - 4 * MIN + 2 * MIN + 12 * SEC,
  steps: FLAKY_RUN.steps.map((s) => (s.status === 'waiting' ? { ...s, status: 'skipped' as const, approvalId: undefined } : s)),
})

// ------------------------------------------------------------------------------------------------ approvals

const PATCH = `--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -18,14 +18,20 @@ export async function refreshSession(token: SessionToken) {
   const issuedAt = token.issuedAt ?? Date.now()
-  const expiresAt = issuedAt + SESSION_TTL_MS
+  // SSO tokens carry their own expiry; trust it over our default TTL.
+  const expiresAt = token.expiresAt ?? issuedAt + SESSION_TTL_MS
   if (Date.now() > expiresAt - REFRESH_MARGIN_MS) {
-    return signOut('expired')
+    const next = await renewWithIdp(token)
+    if (!next) return signOut('expired')
+    return persist(next)
   }
   return token
 }

 export function scheduleRefresh(token: SessionToken) {
-  setTimeout(() => refreshSession(token), SESSION_TTL_MS)
+  const delay = Math.max(0, (token.expiresAt ?? Date.now() + SESSION_TTL_MS) - Date.now() - REFRESH_MARGIN_MS)
+  setTimeout(() => refreshSession(token), delay)
 }
`

const DIGEST_TEXT = `Weekly digest · Northwind Labs

Decisions needed
• Approve the stripe dependency so Forge can finish the invoice migration.
• Review Forge’s SSO session fix — it closes the “signed out after an hour” reports.

Shipped
• Dashboard bundle −38% (Forge) · Tidewell teardown saved to Knowledge (Scout).`

const PR_TEXT = `Fix session expiry after SSO login

SSO tokens now keep their own expiry and refresh through the IdP before they lapse. Adds 9 tests for refresh timing. Closes SUP-412.`

function approvalFixtures(): Record<string, Approval> {
  const base = { requestedBy: { type: 'agent' as const, id: 'agt_forge' }, status: 'pending' as ApprovalStatus }
  const list: Approval[] = [
    {
      ...base, id: 'apv_g_low', runId: 'run_t1d3w9ll0x', stepId: 's', title: 'Save the report to Knowledge', capability: 'knowledge.write', risk: 'low',
      requestedBy: { type: 'agent', id: 'agt_scout' }, reason: 'Scout is supervised and asks before it can write knowledge',
      preview: { kind: 'text', label: 'Knowledge › Research', content: 'Competitor teardown: Tidewell — 6 findings, 9 sources, 1,840 words.' },
      createdAt: ago(2 * MIN),
    },
    { ...FLAKY_APPROVAL, id: 'apv_g_med' },
    {
      ...base, id: 'apv_g_high', runId: DIGEST.id, stepId: 'stp_g_d5', title: 'Post weekly digest to #product', capability: 'messages.send', risk: 'high',
      requestedBy: { type: 'agent', id: 'agt_herald' }, reason: 'Your safety settings require approval to send messages',
      preview: { kind: 'message', label: '#product', content: DIGEST_TEXT }, createdAt: ago(4 * MIN),
    },
    {
      ...base, id: 'apv_g_diff', runId: 'run_ss0f1x2b7c', stepId: 's', title: 'Apply the session-expiry fix to src/auth/session.ts', capability: 'repo.write', risk: 'medium',
      reason: 'Forge works in balanced mode and asks before medium-risk actions',
      preview: { kind: 'diff', label: 'src/auth/session.ts', content: PATCH }, createdAt: ago(11 * MIN),
    },
    {
      ...base, id: 'apv_g_pr', runId: 'run_ss0f1x2b7c', stepId: 's', title: 'Open pull request “Fix session expiry after SSO login”', capability: 'repo.pull_request', risk: 'high',
      reason: 'Your safety settings require approval to open pull requests',
      preview: { kind: 'text', label: 'northwind/atlas-portal · forge/sso-session-expiry → main', content: PR_TEXT }, createdAt: ago(38 * MIN),
    },
  ]
  return Object.fromEntries(list.map((a) => [a.id, a]))
}

const RESOLVED: Approval[] = [
  { ...FLAKY_APPROVAL, id: 'apv_g_ok', status: 'approved', resolvedAt: ago(52 * MIN), resolution: { by: ME } },
  {
    ...FLAKY_APPROVAL, id: 'apv_g_no', title: 'Post weekly digest to #product', capability: 'messages.send', risk: 'high', requestedBy: { type: 'agent', id: 'agt_herald' },
    preview: { kind: 'message', label: '#product', content: 'Weekly digest · Northwind Labs …' }, status: 'rejected', resolvedAt: ago(3 * 60 * MIN),
    resolution: { by: ME, note: 'Hold until Monday’s sync' },
  },
  { ...FLAKY_APPROVAL, id: 'apv_g_exp', status: 'expired', resolvedAt: ago(26 * 60 * MIN) },
]

const RUN_TITLES: Record<string, string> = {
  run_d1g3stw33k: 'Send weekly project digest',
  run_t1d3w9ll0x: 'Tidewell positioning & pricing',
  run_7hd2m0wq3p: 'Fix flaky checkout e2e test',
  run_ss0f1x2b7c: 'Fix session expiry after SSO login',
}

const REQUESTERS: Record<string, ApprovalRequester> = {
  agt_forge: requesterOf(AGENTS.forge),
  agt_scout: requesterOf(AGENTS.scout),
  agt_herald: requesterOf(AGENTS.herald),
}

const resolveIn = (status: 'approved' | 'rejected', note?: string) => (a: Approval): Approval => ({
  ...a,
  status,
  resolvedAt: Date.now(),
  resolution: note ? { by: ME, note } : { by: ME },
})

// ------------------------------------------------------------------------------------------------ blocks

function MarkBlock() {
  const states: AtriumMarkState[] = ['idle', 'working', 'waiting']
  return (
    <Block
      id="mark"
      kicker="5.4.1"
      title="AtriumMark"
      description="Circle (actors), capsule (runs), square (things that last). The capsule is the activity LED: idle ink-3, working live and breathing, waiting attn and steady — waiting wins over working. The favicon swaps between three static SVGs."
    >
      <Grid>
        <Specimen label="Top bar · 42×16">
          <div className="flex flex-wrap items-center gap-8">
            {states.map((s) => (
              <Cell key={s} label={s}>
                <AtriumMark state={s} />
              </Cell>
            ))}
          </div>
        </Specimen>
        <Specimen label="Boot and About · 63×24 with wordmark">
          <div className="flex flex-col gap-4">
            <AtriumMark state="idle" size="lg" wordmark />
            <AtriumMark state="working" size="lg" wordmark />
          </div>
        </Specimen>
        <Specimen label="Favicons · 32 and 16" note="FAVICON_SVGS + setFavicon(state)">
          <div className="flex flex-wrap items-end gap-6">
            {states.map((s) => (
              <Cell key={s} label={s}>
                <span className="flex items-end gap-2">
                  <img src={FAVICON_SVGS[s]} alt={`Favicon, ${s}`} width={32} height={32} />
                  <img src={FAVICON_SVGS[s]} alt="" width={16} height={16} />
                </span>
              </Cell>
            ))}
          </div>
        </Specimen>
      </Grid>
    </Block>
  )
}

const RUN_STATUSES: RunStatus[] = ['queued', 'running', 'waiting', 'paused', 'succeeded', 'failed', 'cancelled']
const STEP_STATUSES: StepStatus[] = ['pending', 'running', 'waiting', 'done', 'failed', 'skipped']
const TASK_STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled']
const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high', 'urgent']
const STEP_KINDS: StepKind[] = [
  'plan', 'think', 'search', 'read', 'browse', 'write', 'edit', 'command', 'test', 'tool', 'message', 'approval', 'artifact', 'handoff', 'wait', 'generate',
]

function GlyphsBlock() {
  return (
    <Block
      id="glyphs"
      kicker="5.3"
      title="Status glyph alphabet"
      description="8px glyphs in a 12px box. Shape carries the meaning without color; running breathes a --live-glow halo (a static 1px ring with reduced motion). Words: Queued · Running · Needs you · Paused · Done · Failed · Stopped."
    >
      <Grid>
        <Specimen label="Runs · RunStatusGlyph + RunStatusBadge" wide>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-7">
            {RUN_STATUSES.map((s) => (
              <div key={s} className="flex flex-col items-start gap-2">
                <span className="flex items-center gap-2">
                  <RunStatusGlyph status={s} />
                  <RunStatusGlyph status={s} size={16} />
                </span>
                <RunStatusBadge status={s} />
                <RunStatusBadge status={s} size="md" />
                <span className="type-meta text-ink-3">{s}</span>
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen label="Steps · StepStatusGlyph" note="bottom row: inside timelines (done recedes)">
          <div className="grid grid-cols-6 gap-3">
            {STEP_STATUSES.map((s) => (
              <Cell key={s} label={s}>
                <span className="flex flex-col gap-2">
                  <StepStatusGlyph status={s} />
                  <StepStatusGlyph status={s} context="timeline" />
                </span>
              </Cell>
            ))}
          </div>
        </Specimen>
        <Specimen label="Tasks · TaskGlyph (10px squares)" note="live: a run for the task is running · attention: agent work awaits you">
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            {TASK_STATUSES.map((s) => (
              <Cell key={s} label={s.replace('_', ' ')}>
                <TaskGlyph status={s} />
              </Cell>
            ))}
            <Cell label="in progress · live">
              <TaskGlyph status="in_progress" live />
            </Cell>
            <Cell label="review · needs you">
              <TaskGlyph status="review" attention />
            </Cell>
          </div>
        </Specimen>
        <Specimen label="Priority · PriorityGlyph" note="never colored; urgent is ink + !">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {PRIORITIES.map((p) => (
              <Cell key={p} label={p}>
                <PriorityGlyph priority={p} />
              </Cell>
            ))}
          </div>
        </Specimen>
        <Specimen label="StatusDot · LiveIndicator">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {(['live', 'attn', 'done', 'fail', 'neutral', 'sim'] as const).map((t) => (
              <Cell key={t} label={t}>
                <StatusDot tone={t} />
              </Cell>
            ))}
            {(['xs', 'sm', 'md'] as const).map((s) => (
              <Cell key={s} label={`live ${s}`}>
                <LiveIndicator size={s} label={s === 'md' ? 'Live' : undefined} />
              </Cell>
            ))}
            <Cell label="attn, still">
              <LiveIndicator tone="attn" />
            </Cell>
          </div>
        </Specimen>
        <Specimen label="Step kinds · StepIcon markers" wide note="border follows status: pending · running · waiting · done · failed · skipped">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-4 gap-x-4 gap-y-3 sm:grid-cols-8">
              {STEP_KINDS.map((k) => (
                <Cell key={k} label={k}>
                  <StepIcon kind={k} status="done" marker />
                </Cell>
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              {STEP_STATUSES.map((s) => (
                <Cell key={s} label={s}>
                  <StepIcon kind="command" status={s} marker />
                </Cell>
              ))}
            </div>
          </div>
        </Specimen>
      </Grid>
    </Block>
  )
}

function TapeRow({ label, run: r, size = 'sm', max, note }: { label: string; run: Run; size?: 'xs' | 'sm' | 'md'; max?: number; note?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] items-center gap-3 border-b border-line py-2 last:border-0 sm:grid-cols-[180px_minmax(0,1fr)_minmax(0,220px)]">
      <span className="type-caption truncate text-ink-2">{label}</span>
      <span className="min-w-0">
        <StepTape run={r} size={size} max={max} />
      </span>
      <span className="type-meta col-span-2 truncate text-ink-3 sm:col-span-1">{note}</span>
    </div>
  )
}

function TapeBlock() {
  const streaming = useStreamingCodeRun()
  const [selected, setSelected] = useState<string | undefined>('stp_g_s4')
  return (
    <Block
      id="tape"
      kicker="5.4.2"
      title="Step Tape"
      description="One cell per step, everywhere a run is referenced: pending outline, running live (breathing), done ink-3, waiting attn and 4px taller, failed, skipped slashed. Steps with file changes or references take a double cell. Terminal runs get an end cap; simulated runs a dashed baseline; finished cells fold into a leading +n."
    >
      <Grid>
        <Specimen label="Sizes" wide note="xs 4×10 inside run pills · sm 6×12 inline · md 8×16 Inspector scrubber">
          <div className="flex flex-wrap items-end gap-8">
            {(['xs', 'sm', 'md'] as const).map((s) => (
              <Cell key={s} label={s}>
                <StepTape run={streaming} size={s} />
              </Cell>
            ))}
          </div>
        </Specimen>
        <Specimen label="States" wide>
          <div className={cn(panel, 'px-4 py-1')}>
            <TapeRow label="Running (simulated)" run={streaming} note="Step 8 of 9 · double cells: file changes" />
            <TapeRow label="Needs you" run={FLAKY_RUN} note="waiting cell stands 4px taller" />
            <TapeRow label="Failed" run={RESEARCH_FAILED} note="✕ cap; unrun steps stay outlined" />
            <TapeRow label="Done" run={SUCCEEDED} note="✓ cap after the last cell" />
            <TapeRow label="Stopped" run={STOPPED_CODE} note="⊘ cap; the rejected step is skipped" />
            <TapeRow label="Paused" run={PAUSED} />
            <TapeRow label="Queued" run={QUEUED} note="4 planned steps, none started" />
            <TapeRow label="Live, total unknown" run={UNKNOWN_TOTAL} note="one pending “next” cell · no baseline" />
            <TapeRow label="Overflow (max 14)" run={OVERFLOW} max={14} note="+n folds finished cells" />
            <TapeRow label="Overflow (max 8)" run={OVERFLOW} max={8} note="pending cells fold at the end too" />
          </div>
        </Specimen>
        <Specimen label="Outcome strip · OutcomeTape" note="workflow list strips: one cell per run">
          <div className="flex flex-wrap items-end gap-8">
            <Cell label="support triage · last 12">
              <OutcomeTape outcomes={['succeeded', 'succeeded', 'failed', 'succeeded', 'succeeded', 'succeeded', 'cancelled', 'succeeded', 'succeeded', 'succeeded', 'succeeded', 'running']} />
            </Cell>
            <Cell label="weekly digest">
              <OutcomeTape outcomes={['succeeded', 'succeeded', 'succeeded', 'waiting']} />
            </Cell>
            <Cell label="never ran">
              <OutcomeTape outcomes={[]} />
            </Cell>
          </div>
        </Specimen>
        <Specimen label="Interactive scrubber · role=slider" wide note="Click a cell or use ←/→, Home/End — the timeline below follows">
          <div className={cn(panel, 'flex flex-col gap-4 p-4 [--sig-surface:var(--surface-canvas)]')}>
            <StepTape run={streaming} size="md" interactive selectedStepId={selected} onSelectStep={(id) => setSelected(id)} label="Steps of Migrate invoices" />
            <div className="max-h-72 overflow-y-auto pr-2">
              <RunTimeline run={streaming} variant="compact" selectedStepId={selected} approvals={{ [NPM_DONE.id]: NPM_DONE }} />
            </div>
          </div>
        </Specimen>
      </Grid>
    </Block>
  )
}

function RunLineMock({ children }: { children: ReactNode }) {
  return (
    <div role="region" aria-label="Runs (gallery)" className="flex h-7 items-center gap-2 overflow-x-auto overflow-y-hidden rounded-sm border border-line bg-chrome px-2 no-scrollbar">
      {children}
    </div>
  )
}

function RunsBlock() {
  const streaming = useStreamingCodeRun()
  const [shown, setShown] = useState(true)
  const [log, setLog] = useState<string>('Click a pill or a row; ⌘/Ctrl-click a pill to open its workspace.')
  const say = (s: string) => () => setLog(s)
  const pillDone = useMemo(() => ({ ...CHAT_LIVE, title: 'Explain the session-expiry bug' }), [])
  return (
    <Block
      id="runs"
      kicker="5.4.3"
      title="RunPill and RunRow"
      description="Pills live in the Run Line: a 20px capsule with glyph, agent, title, mini tape and “3/7 · 01:24”. Waiting pills take an attn outline and “wants approval”; failed pills stay red; other projects dim to 60% with a project mark. Rows show the same run in lists; columns hide right to left as the row narrows, the SIM/LIVE tag never does."
    >
      <Specimen label="Run Line" note={<Button size="xs" variant="ghost" onClick={() => setShown((v) => !v)}>{shown ? 'Collapse pills' : 'Bring pills back'}</Button>}>
        <RunLineMock>
          <AnimatePresence initial={false}>
            {shown && <RunPill key="w" run={DIGEST} agent={AGENTS.herald} project={PROJECTS.ops} onClick={say('Attached “Send weekly project digest”')} onOpen={say('Opened Agents › Herald')} />}
            {shown && <RunPill key="f" run={RESEARCH_FAILED} agent={AGENTS.scout} project={PROJECTS.landscape} onClick={say('Attached the failed research run')} />}
            {shown && (
              <RunPill
                key="r"
                run={streaming}
                agent={AGENTS.forge}
                project={PROJECTS.atlas}
                onClick={say('Attached “Migrate invoices…”')}
                onOpen={say('Opened Code › Stripe session')}
                peek={<RunPeek run={streaming} agent={AGENTS.forge} project={PROJECTS.atlas} onAttach={say('Attached from the peek')} onOpen={say('Opened from the peek')} onPause={say('Paused from the peek')} onStop={say('Stopped from the peek')} />}
              />
            )}
            {shown && <RunPill key="o" run={UNKNOWN_TOTAL} project={PROJECTS.lumen} otherProject onClick={say('Attached the chat run in Lumen Launch')} />}
            {shown && <RunPill key="q" run={QUEUED} project={PROJECTS.ops} onClick={say('Attached the queued workflow run')} />}
            {shown && <RunPill key="p" run={PAUSED} agent={AGENTS.archivist} onClick={say('Attached the paused run')} />}
            {shown && <RunPill key="d" run={pillDone} onClick={say('Attached the finished chat run')} />}
          </AnimatePresence>
        </RunLineMock>
        <p className="type-caption text-ink-3" aria-live="polite">
          {log}
        </p>
      </Specimen>
      <Grid>
        <Specimen label="Peek card · 300ms hover on a pill" note="current step, last 3 steps, tape, actions">
          <div className="w-fit rounded-md border border-line bg-overlay shadow-e1 [--sig-surface:var(--surface-overlay)]">
            <RunPeek run={streaming} agent={AGENTS.forge} project={PROJECTS.atlas} onAttach={say('Attached from the peek')} onOpen={say('Opened from the peek')} onPause={say('Paused from the peek')} onStop={say('Stopped from the peek')} />
          </div>
        </Specimen>
        <Specimen label="Peek card · needs you">
          <div className="w-fit rounded-md border border-line bg-overlay shadow-e1">
            <RunPeek run={DIGEST} agent={AGENTS.herald} project={PROJECTS.ops} onAttach={say('Attached from the peek')} onOpen={say('Opened from the peek')} onStop={say('Stopped from the peek')} />
          </div>
        </Specimen>
      </Grid>
      <Specimen label="Rows · full width" note="hover a row for Attach · Pause/Resume · Stop · Retry · Open">
        <div className={cn(panel, 'p-1')}>
          <RunRow run={streaming} agent={AGENTS.forge} project={PROJECTS.atlas} onSelect={say('Selected the coding run')} onAttach={say('Attached')} onPause={say('Paused')} onStop={say('Stopped')} onOpen={say('Opened')} />
          <RunRow run={DIGEST} agent={AGENTS.herald} project={PROJECTS.ops} onSelect={say('Selected the digest run')} onAttach={say('Attached')} onStop={say('Stopped')} onOpen={say('Opened')} />
          <RunRow run={RESEARCH_FAILED} agent={AGENTS.scout} project={PROJECTS.landscape} selected onSelect={say('Selected the failed run')} onAttach={say('Attached')} onRetry={say('Retried')} onOpen={say('Opened')} />
          <RunRow run={PAUSED} agent={AGENTS.archivist} onSelect={say('Selected the paused run')} onResume={say('Resumed')} onStop={say('Stopped')} />
          <RunRow run={QUEUED} project={PROJECTS.ops} onSelect={say('Selected the queued run')} onStop={say('Stopped')} />
          <RunRow run={LIVE_MIXED} project={PROJECTS.atlas} onSelect={say('Selected the live run')} onAttach={say('Attached')} onOpen={say('Opened')} />
          <RunRow run={SUCCEEDED} agent={AGENTS.scout} project={PROJECTS.landscape} onSelect={say('Selected')} onOpen={say('Opened')} />
          <RunRow run={STOPPED_CODE} agent={AGENTS.forge} project={PROJECTS.atlas} onSelect={say('Selected')} onRetry={say('Retried')} />
        </div>
      </Specimen>
      <Grid>
        <Specimen label="Rows · 560px" note="owner, project, tokens and cost hide first">
          <div className={cn(panel, 'max-w-[560px] p-1')}>
            <RunRow run={streaming} agent={AGENTS.forge} project={PROJECTS.atlas} onSelect={say('Selected')} onPause={say('Paused')} />
            <RunRow run={DIGEST} agent={AGENTS.herald} onSelect={say('Selected')} />
            <RunRow run={LIVE_MIXED} onSelect={say('Selected')} />
          </div>
        </Specimen>
        <Specimen label="Rows · 340px" note="glyph, title and the SIM/LIVE tag always stay">
          <div className={cn(panel, 'max-w-[340px] p-1')}>
            <RunRow run={streaming} agent={AGENTS.forge} onSelect={say('Selected')} />
            <RunRow run={RESEARCH_FAILED} agent={AGENTS.scout} onSelect={say('Selected')} onRetry={say('Retried')} />
            <RunRow run={LIVE_MIXED} onSelect={say('Selected')} />
          </div>
        </Specimen>
      </Grid>
    </Block>
  )
}

function useWaitingRunDemo() {
  const [run, setRun] = useState<Run>(FLAKY_RUN)
  const [approvals, setApprovals] = useState<Record<string, Approval>>({ [FLAKY_APPROVAL.id]: FLAKY_APPROVAL })
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms))

  const resolve = (id: string, status: 'approved' | 'rejected', note?: string, input?: string) => {
    setApprovals((prev) => ({ ...prev, [id]: resolveIn(status, note)(prev[id]) }))
    const now = Date.now()
    if (status === 'rejected') {
      setRun((r) => ({
        ...r, status: 'cancelled', endedAt: now, error: 'Rejected by you',
        steps: r.steps.map((s) => (s.approvalId === id ? { ...s, status: 'skipped', endedAt: now } : s)),
      }))
      return
    }
    setRun((r) => ({ ...r, status: 'running', steps: r.steps.map((s) => (s.approvalId === id ? { ...s, status: 'running', startedAt: now, input: input ?? s.input } : s)) }))
    const lines = ['Running 20 tests using 4 workers', '  ✓  checkout › pays an invoice with a saved card ×20', '  20 passed (31.4s)']
    lines.forEach((_, i) =>
      later(700 * (i + 1), () =>
        setRun((r) => ({ ...r, steps: r.steps.map((s) => (s.approvalId === id ? { ...s, output: lines.slice(0, i + 1).join('\n') } : s)) })),
      ),
    )
    later(2600, () =>
      setRun((r) => ({
        ...r,
        steps: [
          ...r.steps.map((s) => (s.approvalId === id ? { ...s, status: 'done' as const, endedAt: Date.now(), tokens: 700 } : s)),
          { id: 'stp_g_f6', kind: 'write', title: 'Summarize the change', status: 'running', startedAt: Date.now() },
        ],
      })),
    )
    later(4600, () =>
      setRun((r) => ({
        ...r, status: 'succeeded', endedAt: Date.now(), summary: 'Cleared the polling timer on unmount; 20 of 20 repeats pass.',
        steps: r.steps.map((s) => (s.id === 'stp_g_f6' ? { ...s, status: 'done' as const, endedAt: Date.now(), tokens: 900 } : s)),
      })),
    )
  }
  const reset = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setRun(FLAKY_RUN)
    setApprovals({ [FLAKY_APPROVAL.id]: FLAKY_APPROVAL })
  }
  return { run, approvals, resolve, reset }
}

function TimelineBlock() {
  const streaming = useStreamingCodeRun()
  const waiting = useWaitingRunDemo()
  const blockedCaps = useSettings((s) => s.safety.alwaysAsk)
  return (
    <Block
      id="timeline"
      kicker="5.4.4"
      title="RunTimeline"
      description="The thread: a 1px spine (a 4px hatch band when simulated) with a live bead on the active segment; 20px kind markers; running titles in the present participle, done titles in the past tense; LIVE/SIM tool chips; expandable input and output, simulated tools framed in a hatch with the exact header; references as chips, file changes as DiffStats, approvals inline. Finished read/search runs collapse into one group."
    >
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Specimen label="Full · running simulated code run" note="the checks step streams">
          <div className={cn(panel, 'p-5')}>
            <RunTimeline run={streaming} approvals={{ [NPM_DONE.id]: NPM_DONE }} requesterFor={() => REQUESTERS.agt_forge} />
            <ProvenanceLine run={streaming} onViewRun={() => undefined} className="mt-1 border-t border-line pt-3" />
          </div>
        </Specimen>
        <Specimen label="Compact · Inspector 360px" note="outputs collapsed, tighter">
          <div className="rounded-md border border-line bg-chrome p-4 [--sig-surface:var(--surface-chrome)]">
            <div className="mb-3 flex flex-col gap-2 border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <RunStatusGlyph status={streaming.status} />
                <span className="type-body-sm min-w-0 truncate font-medium text-ink">{streaming.title}</span>
              </div>
              <RunMeta run={streaming} />
              <StepTape run={streaming} size="md" />
            </div>
            <RunTimeline run={streaming} variant="compact" approvals={{ [NPM_DONE.id]: NPM_DONE }} requesterFor={() => REQUESTERS.agt_forge} />
          </div>
        </Specimen>
      </div>
      <Grid>
        <Specimen label="Waiting · command approval inline" note={<Button size="xs" variant="ghost" onClick={waiting.reset}>Reset</Button>}>
          <div className={cn(panel, 'p-5')}>
            <RunTimeline
              run={waiting.run}
              approvals={waiting.approvals}
              requesterFor={(a) => REQUESTERS[a.requestedBy.id]}
              alwaysAskBlocked={(a) => blockedCaps.includes(a.capability)}
              onApprove={(id, note) => waiting.resolve(id, 'approved', note)}
              onReject={(id, note) => waiting.resolve(id, 'rejected', note)}
              onAlwaysAllow={(id) => waiting.resolve(id, 'approved', 'Always allow Forge to run commands')}
              onEditApproval={(id, payload) => waiting.resolve(id, 'approved', 'Edited before approving', payload)}
            />
            <ProvenanceLine run={waiting.run} onViewRun={() => undefined} className="mt-1 border-t border-line pt-3" />
          </div>
        </Specimen>
        <Specimen label="Failed research run" note="simulated web results in a hatched frame">
          <div className={cn(panel, 'p-5')}>
            <RunTimeline run={RESEARCH_FAILED} defaultExpanded="all" />
            <ProvenanceLine run={RESEARCH_FAILED} onViewRun={() => undefined} className="mt-1 border-t border-line pt-3" />
          </div>
        </Specimen>
        <Specimen label="Live run with a simulated tool" note="per-step LIVE / SIM; the spine is a hairline">
          <div className={cn(panel, 'p-5')}>
            <RunTimeline run={LIVE_MIXED} defaultExpanded="none" />
            <ProvenanceLine run={LIVE_MIXED} onViewRun={() => undefined} className="mt-1 border-t border-line pt-3" />
          </div>
        </Specimen>
        <Specimen label="Groups · finished reads collapse" note="“Searched and read …” expands to its steps">
          <div className={cn(panel, 'p-5')}>
            <RunTimeline run={SUCCEEDED} defaultExpanded="none" />
          </div>
        </Specimen>
        <Specimen label="Queued · paused · stopped">
          <div className={cn(panel, 'flex flex-col gap-5 p-5')}>
            <RunTimeline run={QUEUED} />
            <RunTimeline run={PAUSED} />
            <RunTimeline run={STOPPED} />
          </div>
        </Specimen>
      </Grid>
    </Block>
  )
}

function ApprovalsBlock() {
  const [items, setItems] = useState(approvalFixtures)
  const blockedCaps = useSettings((s) => s.safety.alwaysAsk)
  const [log, setLog] = useState('Focus a card and press Y, D or E.')
  const act = (id: string) => ({
    onApprove: () => {
      setItems((p) => ({ ...p, [id]: resolveIn('approved')(p[id]) }))
      setLog(`Approved “${items[id].title}”`)
    },
    onReject: (note?: string) => {
      setItems((p) => ({ ...p, [id]: resolveIn('rejected', note)(p[id]) }))
      setLog(`Denied “${items[id].title}”${note ? ` · ${note}` : ''}`)
    },
    onEdit: (payload: string) => {
      setItems((p) => ({ ...p, [id]: { ...resolveIn('approved', 'Edited before approving')(p[id]), preview: p[id].preview && { ...p[id].preview!, content: payload } } }))
      setLog(`Approved with your edit: ${payload.split('\n')[0]}`)
    },
    onAlwaysAllow: () => {
      setItems((p) => ({ ...p, [id]: resolveIn('approved', 'Always allow')(p[id]) }))
      setLog(`Saved “always allow” and approved “${items[id].title}”`)
    },
    onLater: () => setLog('Left pending — it stays in Needs you.'),
    alwaysAskBlocked: blockedCaps.includes(items[id].capability),
    requester: REQUESTERS[items[id].requestedBy.id],
    simulated: true,
    integrationLabel: items[id].preview?.kind === 'message' ? 'Slack' : undefined,
    run: { id: items[id].runId, title: RUN_TITLES[items[id].runId] ?? 'Fix session expiry after SSO login' },
    onOpenRun: () => setLog('Opened the run in Inspector'),
  })
  return (
    <Block
      id="approvals"
      kicker="5.4.9"
      title="ApprovalCard"
      description="One card everywhere: risk · capability · LIVE/SIM · age; the headline in the product voice; why it was asked; the exact preview; the requester; Approve ▾ · Deny · Edit · Later. HIGH risk approves on a second press within 3 seconds. Resolution wipes the tint left to right, then stamps the decision."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-caption text-ink-3" aria-live="polite">
          {log}
        </p>
        <Button size="xs" variant="ghost" onClick={() => setItems(approvalFixtures())}>
          Reset cards
        </Button>
      </div>
      <Grid>
        <Specimen label="LOW · text preview · full">
          <ApprovalCard approval={items.apv_g_low} {...act('apv_g_low')} />
        </Specimen>
        <Specimen label="MED · command preview · full" note="Approve ▾ → Always allow">
          <ApprovalCard approval={items.apv_g_med} {...act('apv_g_med')} />
        </Specimen>
        <Specimen label="HIGH · message · always-ask capability" note="confirm on second press">
          <ApprovalCard approval={items.apv_g_high} {...act('apv_g_high')} />
        </Specimen>
        <Specimen label="MED · diff preview" note="first 12 lines, Show all">
          <ApprovalCard approval={items.apv_g_diff} {...act('apv_g_diff')} onEdit={undefined} />
        </Specimen>
        <Specimen label="Compact · Home, popovers, Run Line peek" wide>
          <div className="grid gap-4 md:grid-cols-2">
            <ApprovalCard approval={items.apv_g_pr} variant="compact" {...act('apv_g_pr')} />
            <ApprovalCard approval={items.apv_g_high} variant="compact" {...act('apv_g_high')} />
          </div>
        </Specimen>
        <Specimen label="Resolved" wide note="stamps: approved · denied with a reason · expired">
          <div className="grid gap-4 md:grid-cols-3">
            {RESOLVED.map((a) => (
              <ApprovalCard key={a.id} approval={a} variant="compact" requester={REQUESTERS[a.requestedBy.id]} simulated />
            ))}
          </div>
        </Specimen>
      </Grid>
    </Block>
  )
}

function ProvenanceBlock() {
  return (
    <Block
      id="provenance"
      kicker="5.4.6"
      title="Colophon and Receipt"
      description="One line in type-meta under every AI output. Simulated output leads with SIM and says “No model was called”; mixed tools are listed with LIVE/SIM; a stopped run ends with “Stopped by you”. The Receipt is the expanded Colophon in Inspector › Run."
    >
      <Grid>
        <Specimen label="Colophon variants" wide>
          <div className={cn(panel, 'flex flex-col divide-y divide-line px-4')}>
            {[
              ['Live', <ProvenanceLine key="l" run={CHAT_LIVE} onViewRun={() => undefined} />],
              ['Simulated', <ProvenanceLine key="s" run={CHAT_SIM} onViewRun={() => undefined} />],
              ['Mixed tools', <ProvenanceLine key="m" run={LIVE_MIXED} onViewRun={() => undefined} />],
              ['Stopped', <ProvenanceLine key="x" run={STOPPED} onViewRun={() => undefined} />],
              [
                'Live, usage not reported',
                <ProvenanceLine key="e" modelLabel="llama3.2 · OpenAI-compatible" usage={{ inputTokens: 1100, outputTokens: 420, costUsd: 0.0021 }} durationMs={5400} costIsEstimate />,
              ],
            ].map(([label, node]) => (
              <div key={label as string} className="grid gap-1 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center sm:gap-4">
                <span className="type-caption text-ink-3">{label}</span>
                {node}
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen label="RunMeta · Inspector meta row">
          <div className={cn(panel, 'flex flex-col gap-3 p-4')}>
            <RunMeta run={CODE_RUN} />
            <RunMeta run={LIVE_MIXED} showModel />
            <RunMeta run={RESEARCH_FAILED} />
          </div>
        </Specimen>
        <Specimen label="Receipt" note="Copy receipt (Markdown) · Raw JSON">
          <div className={cn(panel, 'p-4')}>
            <Receipt run={SUCCEEDED} approvals={[]} />
          </div>
        </Specimen>
        <Specimen label="Receipt · run with an approval decision" wide>
          <div className={cn(panel, 'p-4')}>
            <Receipt
              run={{ ...CODE_RUN, status: 'succeeded', endedAt: ago(4 * SEC), steps: CODE_RUN.steps.map((s) => ({ ...s, status: 'done' as const, endedAt: s.endedAt ?? ago(4 * SEC) })) }}
              approvals={[NPM_DONE]}
            />
          </div>
        </Specimen>
      </Grid>
    </Block>
  )
}

const SEEDS = Array.from({ length: 24 }, (_, i) => 1 + i * 2_654_435 + (i % 7) * 97)
const MARK_SIZES = [16, 20, 24, 32, 48, 64]

function IdentityBlock() {
  return (
    <Block
      id="identity"
      kicker="5.4.7"
      title="Identity marks"
      description="Agents are circles: a 15% hue disc, a 1px ring at 45% and a deterministic sigil of 3–5 radial strokes, arcs and dots. Projects, collections and workflows are rounded squares; integrations are rings, dashed when simulated. Identity hues appear only inside marks."
    >
      <Specimen label="AgentMark · 24 seeds × 8 hues · 24px">
        <div className="overflow-x-auto">
          <div className="grid w-max grid-cols-[repeat(24,24px)] gap-2">
            {HUES.map((hue) => SEEDS.map((seed) => <AgentMark key={`${hue}-${seed}`} seed={seed} hue={hue} size={24} />))}
          </div>
        </div>
      </Specimen>
      <Grid>
        <Specimen label="Sizes 16 → 64">
          <div className="flex flex-col gap-4">
            {[AGENTS.forge, AGENTS.scout, AGENTS.herald].map((a) => (
              <div key={a.name} className="flex items-end gap-4">
                {MARK_SIZES.map((s) => (
                  <AgentMark key={s} seed={a.sigil} hue={a.hue as Hue} size={s} label={a.name} />
                ))}
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen label="Live and paused badges">
          <div className="flex flex-wrap items-end gap-6">
            {[16, 24, 32, 48].map((s) => (
              <Cell key={s} label={`${s} live`}>
                <AgentMark seed={AGENTS.forge.sigil} hue="sky" size={s} live label="Forge" />
              </Cell>
            ))}
            <Cell label="24 paused">
              <AgentMark seed={AGENTS.archivist.sigil} hue="coral" size={24} paused label="Archivist" />
            </Cell>
            <Cell label="32 paused">
              <AgentMark seed={AGENTS.archivist.sigil} hue="coral" size={32} paused label="Archivist" />
            </Cell>
          </div>
        </Specimen>
        <Specimen label="MonogramMark · square (projects, collections, workflows)">
          <div className="flex flex-col gap-3">
            {Object.values(PROJECTS).map((p) => (
              <div key={p.name} className="flex items-end gap-3">
                {[16, 20, 24, 32, 48].map((s) => (
                  <MonogramMark key={s} text={p.name} hue={p.hue as Hue} size={s} />
                ))}
                <span className="type-caption text-ink-2">{p.name}</span>
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen label="MonogramMark · ring (integrations)" note="dashed = simulated">
          <div className="flex flex-col gap-3">
            {(
              [
                ['GH', 'violet', false, 'GitHub · live reads'],
                ['A', 'amber', false, 'Anthropic · live'],
                ['SL', 'rose', true, 'Slack · simulated'],
                ['GM', 'coral', true, 'Gmail · simulated'],
                ['SB', 'cyan', true, 'Code sandbox · simulated'],
              ] as const
            ).map(([m, hue, sim, label]) => (
              <div key={m} className="flex items-end gap-3">
                {[16, 24, 32, 48].map((s) => (
                  <MonogramMark key={s} variant="ring" text={m} hue={hue} size={s} simulated={sim} />
                ))}
                <span className="type-caption text-ink-2">{label}</span>
              </div>
            ))}
          </div>
        </Specimen>
      </Grid>
    </Block>
  )
}

const KIND_SAMPLES: EntityRef[] = [
  { kind: 'project', id: 'prj_atlas' },
  { kind: 'task', id: 'tsk_sso_fix' },
  { kind: 'thread', id: 'thr_sso_bug' },
  { kind: 'message', id: 'msg_sso_06' },
  { kind: 'run', id: 'run_seed_ses_stripe' },
  { kind: 'approval', id: 'apv_seed_npm' },
  { kind: 'agent', id: 'agt_forge' },
  { kind: 'workflow', id: 'wfl_triage' },
  { kind: 'knowledge', id: 'kno_stripe_plan' },
  { kind: 'collection', id: 'col_engineering' },
  { kind: 'investigation', id: 'inv_pricing_trends' },
  { kind: 'source', id: 'src_pricing_1' },
  { kind: 'repo', id: 'rep_atlas' },
  { kind: 'session', id: 'ses_sso' },
  { kind: 'asset', id: 'ast_key_art' },
  { kind: 'board', id: 'brd_launch' },
  { kind: 'integration', id: 'github' },
  { kind: 'integration', id: 'slack' },
]

function EntitiesBlock() {
  const [attached, setAttached] = useState<EntityRef[]>([
    { kind: 'knowledge', id: 'kno_adr_sessions' },
    { kind: 'task', id: 'tsk_stripe_migration' },
    { kind: 'source', id: 'src_pricing_3' },
  ])
  const [dropped, setDropped] = useState<string>('Drag a chip here (desktop)')
  return (
    <Block
      id="entities"
      kicker="5.4.8"
      title="EntityChip"
      description="Chips resolve live from the seeded world. Click, Enter or Space opens Inspector › Item (?inspect=kind:id); ⌘/Ctrl-click navigates; a 400ms hover previews; × removes; simulated items carry SIM and a dashed edge; chips drag on desktop as application/x-atrium-entity."
    >
      <Grid>
        <Specimen label="Every kind · md 22px" wide>
          <div className="flex flex-wrap gap-1.5">
            {KIND_SAMPLES.map((r) => (
              <EntityChip key={`${r.kind}:${r.id}`} entity={r} />
            ))}
          </div>
        </Specimen>
        <Specimen label="sm 18px · with kind">
          <div className="flex flex-wrap gap-1">
            {KIND_SAMPLES.slice(0, 9).map((r) => (
              <EntityChip key={`${r.kind}:${r.id}`} entity={r} size="sm" showKind />
            ))}
          </div>
        </Specimen>
        <Specimen label="Variants · removable · deleted">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              <EntityChip entity={{ kind: 'knowledge', id: 'kno_lumen_prd' }} />
              <EntityChip entity={{ kind: 'knowledge', id: 'kno_lumen_prd' }} variant="subtle" />
              <EntityChip entity={{ kind: 'knowledge', id: 'kno_lumen_prd' }} variant="outline" />
              <EntityChip entity={{ kind: 'knowledge', id: 'kno_lumen_prd' }} noLink />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {attached.map((r) => (
                <EntityChip key={r.id} entity={r} onRemove={() => setAttached((list) => list.filter((x) => x.id !== r.id))} />
              ))}
              {attached.length === 0 && (
                <Button size="xs" variant="ghost" onClick={() => setAttached([{ kind: 'knowledge', id: 'kno_adr_sessions' }, { kind: 'task', id: 'tsk_stripe_migration' }])}>
                  Restore chips
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <EntityChip entity={{ kind: 'task', id: 'tsk_deleted_example' }} />
              <EntityChip entity={{ kind: 'task', id: 'tsk_deleted_example' }} size="sm" />
            </div>
          </div>
        </Specimen>
        <Specimen label="Drop target">
          <div
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/x-atrium-entity')) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              const raw = e.dataTransfer.getData('application/x-atrium-entity')
              if (raw) setDropped(`Dropped ${raw}`)
            }}
            className="type-caption grid h-16 place-items-center rounded-md border border-line px-3 text-center text-ink-3"
          >
            {dropped}
          </div>
        </Specimen>
        <Specimen label="Hover card · 320px" note="mark, kind, handle, title, project, status, updated, excerpt">
          <div className="flex flex-wrap gap-4">
            <div className="rounded-md border border-line bg-overlay shadow-e1">
              <EntityHoverCard entity={{ kind: 'task', id: 'tsk_sso_fix' }} />
            </div>
            <div className="rounded-md border border-line bg-overlay shadow-e1">
              <EntityHoverCard entity={{ kind: 'source', id: 'src_pricing_2' }} />
            </div>
          </div>
        </Specimen>
        <Specimen label="EntityIcon">
          <div className="flex flex-wrap gap-x-4 gap-y-3 text-ink-2">
            {Array.from(new Set(KIND_SAMPLES.map((r) => r.kind))).map((k) => (
              <Cell key={k} label={k}>
                <EntityIcon kind={k} size={16} />
              </Cell>
            ))}
          </div>
        </Specimen>
      </Grid>
    </Block>
  )
}

function SmallBlock() {
  const textRef = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState('Select a phrase in the paragraph.')
  return (
    <Block id="small" kicker="5.4.5 · 5.4.13 · 5.4.15" title="Honesty kit and small parts">
      <Grid>
        <Specimen label="SimBadge · LiveBadge" note="hover for the full explanation">
          <div className="flex flex-wrap items-center gap-3">
            <SimBadge />
            <SimBadge size="sm" />
            <LiveBadge />
            <LiveBadge size="sm" />
            <span className="type-caption inline-flex items-center gap-1.5 text-ink-2">
              Web search <SimBadge />
            </span>
            <span className="type-caption inline-flex items-center gap-1.5 text-ink-2">
              GitHub read <LiveBadge />
            </span>
          </div>
        </Specimen>
        <Specimen label="MetaLabel · IdCode" note="click a handle to copy it">
          <div className="flex flex-wrap items-center gap-4">
            <MetaLabel>Will run</MetaLabel>
            <MetaLabel>In flight</MetaLabel>
            <IdCode id="run_seed_ses_stripe" />
            <IdCode id="tsk_sso_fix" />
            <IdCode id="ses_stripe" label="pr" />
          </div>
        </Specimen>
        <Specimen label="TickMeter · thresholds" note="ink-2 · attn ≥ 80% · fail ≥ 100%">
          <div className="flex flex-col gap-3">
            {(
              [
                [0.42, 'Context ~84k / 200k'],
                [0.83, 'Budget $41.60 of $50'],
                [1.06, 'Budget $53.10 of $50'],
              ] as const
            ).map(([v, label]) => (
              <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <TickMeter value={v} label={label} valueText={label} />
                <span className="type-meta text-ink-3">{label}</span>
              </div>
            ))}
            <div className="grid grid-cols-[72px_auto] items-center gap-3">
              <TickMeter value={0.31} width={72} label="Milestone" markers={[0.8]} />
              <span className="type-meta text-ink-3">72px · marker at 80%</span>
            </div>
          </div>
        </Specimen>
        <Specimen label="SelectionToolbar" note="select text: Ask about this · Research · Make task · Save snippet · Copy">
          <div ref={textRef} className="type-doc rounded-md border border-line bg-canvas p-4 text-ink">
            Usage-based pricing has become the default for <em>add-ons</em> in B2B SaaS, but very few companies price their core product on usage alone. The pattern that holds up is hybrid: a platform fee for predictability plus a metered component tied to a value metric customers already track.
          </div>
          <p className="type-caption text-ink-3" aria-live="polite">
            {picked}
          </p>
          <SelectionToolbar
            containerRef={textRef}
            actions={[
              { id: 'ask', label: 'Ask about this', icon: MessageSquareText, onSelect: (t) => setPicked(`Ask about: “${t}”`) },
              { id: 'research', label: 'Research', icon: Telescope, onSelect: (t) => setPicked(`Research: “${t}”`) },
              { id: 'task', label: 'Make task', icon: ListPlus, onSelect: (t) => setPicked(`Task from: “${t}”`) },
              { id: 'snippet', label: 'Save snippet', icon: FileText, onSelect: (t) => setPicked(`Saved snippet: “${t}”`) },
            ]}
          />
        </Specimen>
      </Grid>
    </Block>
  )
}

/** Connected components against the seeded world (this changes real data). */
function ConnectedBlock() {
  const seeded = useRun('run_seed_ses_stripe')
  return (
    <Block
      id="connected"
      kicker="Live data"
      title="Connected to the seeded world"
      description="ApprovalCardConnected and a RunTimeline reading the database. Approving here continues Forge’s simulated run; settings › safety › always ask decides whether “Always allow” is offered."
    >
      <Grid>
        <Specimen label="ApprovalCardConnected · apv_seed_npm">
          <ApprovalCardConnected approvalId="apv_seed_npm" />
        </Specimen>
        <Specimen label="ApprovalCardConnected · apv_seed_slack · compact">
          <ApprovalCardConnected approvalId="apv_seed_slack" variant="compact" />
        </Specimen>
        <Specimen label="RunTimeline · run_seed_ses_stripe" wide note="approval steps use ApprovalCardConnected when no approvals are passed">
          <div className={cn(panel, 'p-5')}>
            {seeded ? (
              <>
                {/* No `approvals` prop: approval steps wire themselves to the approvals service. */}
                <RunTimeline run={seeded} />
                <ProvenanceLine run={seeded} className="mt-1 border-t border-line pt-3" />
              </>
            ) : (
              <p className="type-caption text-ink-3">This run isn’t in the database (reset demo data to bring it back).</p>
            )}
          </div>
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ section

export default function Section() {
  return (
    <section aria-labelledby="sig-title" className="flex flex-col gap-16" style={{ '--sig-surface': 'var(--surface-canvas)' } as CSSProperties}>
      <header className="flex flex-col gap-4">
        <Kicker>Signature</Kicker>
        <div className="flex flex-col gap-2">
          <h2 id="sig-title" className="font-serif text-4xl leading-[44px] tracking-[-0.015em] text-ink">
            Signature components
          </h2>
          <p className="max-w-2xl text-base text-ink-2 text-pretty">
            The motifs that make Atrium recognizable: the mark’s capsule, the glyph alphabet, the thread, the Step Tape, hatch and dash for
            simulated work, tick scales and mono metadata. Every AI execution is drawn with these, nothing else.
          </p>
        </div>
        <nav aria-label="Signature contents" className="flex flex-wrap gap-1.5 pt-2">
          {TOC.map(([id, label]) => (
            <a
              key={id}
              href={`#sig-${id}`}
              className="rounded-xs border border-line px-2 py-1 text-xs text-ink-3 transition-colors duration-(--dur-1) hover:border-line-strong hover:text-ink"
            >
              {label}
            </a>
          ))}
        </nav>
        <VisuallyHidden>Gallery fixtures use the seeded Northwind Labs world.</VisuallyHidden>
      </header>
      <MarkBlock />
      <GlyphsBlock />
      <TapeBlock />
      <RunsBlock />
      <TimelineBlock />
      <ApprovalsBlock />
      <ProvenanceBlock />
      <IdentityBlock />
      <EntitiesBlock />
      <SmallBlock />
      <ConnectedBlock />
    </section>
  )
}
