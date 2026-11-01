import { getModel } from '@/core/ai/models'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { KIND_META, RUN_KIND_LABEL } from '@/core/services/entities'
import type { Approval, Capability, EntityRef, Run } from '@/core/types'
import { refKey } from '@/core/types'
import { shortCode } from '@/lib/id'
import { formatClock, formatCost, formatHm, formatLongDate, formatSeconds, formatTok, formatTokenCount } from './format'
import { RUN_STATUS_META } from './glyphMeta'
import { isStepSimulated, toolLabel } from './timeline'

/**
 * The run Receipt (docs/DESIGN.md §5.4.6): the expanded Colophon. `buildReceipt` gathers what
 * the run used, decided, cost and saw; `receiptToMarkdown` renders it for "Copy receipt".
 */

export interface ReceiptModelInfo {
  label: string
  provider: string
  simulated: boolean
}

export interface ReceiptTool {
  label: string
  simulated: boolean
  uses: number
}

export interface ReceiptCapability {
  capability: Capability
  label: string
  /** "approved by you 10:42", "allowed by policy", "denied by you 10:43 · Not this week", "waiting for you". */
  decision: string
  outcome: 'allowed' | 'approved' | 'denied' | 'pending' | 'expired' | 'blocked'
}

export interface ReceiptSaw {
  ref: EntityRef
  tokens: number
  /** 0..1 share of the tokens spent reading. */
  share: number
}

export interface ReceiptModel {
  handle: string
  title: string
  kindLabel: string
  statusWord: string
  simulated: boolean
  model: ReceiptModelInfo | null
  tools: ReceiptTool[]
  capabilities: ReceiptCapability[]
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** True when the cost is an estimate at reference pricing (simulated runs). */
  costIsEstimate: boolean
  durationMs?: number
  saw: ReceiptSaw[]
  outputs: EntityRef[]
  stopped: boolean
  error?: string
  startedAt: number
}

const PROVIDER_LABEL: Record<string, string> = {
  simulator: "Atrium's local simulator",
  anthropic: 'Anthropic',
  'openai-compatible': 'OpenAI-compatible endpoint',
}

/** Model label and provider for a model id (OpenAI-compatible ids carry the model after `oai:`). */
export function modelInfoFor(modelId: string | undefined, simulated: boolean): ReceiptModelInfo | null {
  const known = getModel(modelId)
  if (known) return { label: known.label, provider: PROVIDER_LABEL[known.providerId] ?? known.providerId, simulated: known.simulated }
  if (modelId?.startsWith('oai:')) return { label: modelId.slice(4), provider: PROVIDER_LABEL['openai-compatible'], simulated: false }
  if (simulated) return { label: 'Simulator', provider: PROVIDER_LABEL.simulator, simulated: true }
  return modelId ? { label: modelId, provider: 'Unknown provider', simulated: false } : null
}

const READ_LIKE = new Set(['read', 'browse', 'search', 'tool'])

const GITHUB_VERB: Partial<Record<Capability, string>> = { 'repo.read': 'read', 'repo.write': 'write', 'repo.pull_request': 'pull request' }

/** Tool name as the Colophon and Receipt list it: "GitHub read", "Web search", "Terminal". */
export function toolUseLabel(step: Pick<Run['steps'][number], 'tool' | 'integrationId' | 'capability'>): string | undefined {
  const label = toolLabel(step)
  if (!label) return undefined
  const verb = label === 'GitHub' && step.capability ? GITHUB_VERB[step.capability] : undefined
  return verb ? `${label} ${verb}` : label
}

export interface BuildReceiptOptions {
  approvals?: readonly Approval[]
  now?: number
  /** Overrides the derived "Saw" list (e.g. a chat turn's recorded context with token estimates). */
  saw?: readonly { ref: EntityRef; tokens: number }[]
}

function decisionFor(approval: Approval): Pick<ReceiptCapability, 'decision' | 'outcome'> {
  const at = approval.resolvedAt ? ` ${formatHm(approval.resolvedAt)}` : ''
  const by = approval.resolution?.by.type === 'user' || !approval.resolution ? 'you' : approval.resolution.by.type
  const note = approval.resolution?.note ? ` · ${approval.resolution.note}` : ''
  switch (approval.status) {
    case 'approved':
      return { decision: `approved by ${by}${at}${note}`, outcome: 'approved' }
    case 'rejected':
      return { decision: `denied by ${by}${at}${note}`, outcome: 'denied' }
    case 'expired':
      return { decision: `expired${at}`, outcome: 'expired' }
    default:
      return { decision: 'waiting for you', outcome: 'pending' }
  }
}

export function buildReceipt(run: Run, opts: BuildReceiptOptions = {}): ReceiptModel {
  const now = opts.now ?? Date.now()
  const approvals = (opts.approvals ?? []).filter((a) => a.runId === run.id)

  // Tools, in first-use order.
  const tools = new Map<string, ReceiptTool>()
  for (const step of run.steps) {
    const label = toolUseLabel(step)
    if (!label || step.status === 'pending') continue
    const simulated = isStepSimulated(run, step)
    const key = `${label}|${simulated}`
    const hit = tools.get(key)
    if (hit) hit.uses++
    else tools.set(key, { label, simulated, uses: 1 })
  }

  // Capabilities with their decisions: the approval decides when there was one, else policy allowed it.
  const capabilities = new Map<Capability, ReceiptCapability>()
  for (const step of run.steps) {
    if (!step.capability || capabilities.has(step.capability)) continue
    const approval = approvals.find((a) => a.stepId === step.id) ?? approvals.find((a) => a.capability === step.capability)
    const label = CAPABILITIES[step.capability]?.label ?? step.capability
    if (approval) capabilities.set(step.capability, { capability: step.capability, label, ...decisionFor(approval) })
    else if (step.approvalId) {
      // The approval row is not at hand: the step's status still tells the decision.
      const outcome = step.status === 'waiting' ? 'pending' : step.status === 'skipped' ? 'denied' : 'approved'
      const decision = outcome === 'pending' ? 'waiting for you' : outcome === 'denied' ? 'denied by you' : 'approved by you'
      capabilities.set(step.capability, { capability: step.capability, label, decision, outcome })
    } else if (step.status === 'failed' && step.error && !step.startedAt)
      capabilities.set(step.capability, { capability: step.capability, label, decision: 'blocked by policy', outcome: 'blocked' })
    else if (step.status !== 'pending') capabilities.set(step.capability, { capability: step.capability, label, decision: 'allowed by policy', outcome: 'allowed' })
  }
  for (const approval of approvals) {
    if (capabilities.has(approval.capability)) continue
    const label = CAPABILITIES[approval.capability]?.label ?? approval.capability
    capabilities.set(approval.capability, { capability: approval.capability, label, ...decisionFor(approval) })
  }

  // Saw: entities read by read-like steps, each step's tokens shared evenly across its refs.
  let saw: ReceiptSaw[]
  if (opts.saw) {
    const total = opts.saw.reduce((n, s) => n + s.tokens, 0)
    saw = opts.saw.map((s) => ({ ref: s.ref, tokens: s.tokens, share: total ? s.tokens / total : 0 }))
  } else {
    const byRef = new Map<string, { ref: EntityRef; tokens: number }>()
    for (const step of run.steps) {
      if (!READ_LIKE.has(step.kind) || !step.refs?.length) continue
      const each = (step.tokens ?? 0) / step.refs.length
      for (const ref of step.refs) {
        const key = refKey(ref)
        const hit = byRef.get(key)
        if (hit) hit.tokens += each
        else byRef.set(key, { ref, tokens: each })
      }
    }
    const list = [...byRef.values()]
    const total = list.reduce((n, s) => n + s.tokens, 0)
    saw = list.map((s) => ({ ref: s.ref, tokens: Math.round(s.tokens), share: total ? s.tokens / total : 0 }))
  }

  const startedAt = run.startedAt ?? run.createdAt
  const durationMs = run.endedAt !== undefined ? run.endedAt - startedAt : run.status === 'running' || run.status === 'waiting' ? now - startedAt : undefined

  return {
    handle: shortCode(run.id),
    title: run.title,
    kindLabel: RUN_KIND_LABEL[run.kind] ?? run.kind,
    statusWord: RUN_STATUS_META[run.status].word,
    simulated: run.simulated,
    model: modelInfoFor(run.modelId, run.simulated),
    tools: [...tools.values()],
    capabilities: [...capabilities.values()],
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    costUsd: run.usage.costUsd,
    costIsEstimate: run.simulated,
    durationMs: durationMs !== undefined ? Math.max(0, durationMs) : undefined,
    saw,
    outputs: run.outputs,
    stopped: run.status === 'cancelled',
    error: run.error,
    startedAt,
  }
}

export interface ReceiptMarkdownOptions extends BuildReceiptOptions {
  /** Title for an entity in Saw/Outputs (defaults to "kind id"). */
  resolveTitle?: (ref: EntityRef) => string
}

const tag = (simulated: boolean) => (simulated ? 'SIM' : 'LIVE')

/** The receipt as Markdown ("Copy receipt (Markdown)"). Simulated runs start with the §8.4 notice. */
export function receiptToMarkdown(run: Run, opts: ReceiptMarkdownOptions = {}): string {
  const r = buildReceipt(run, opts)
  const name = (ref: EntityRef) => opts.resolveTitle?.(ref) ?? `${KIND_META[ref.kind]?.label ?? ref.kind} ${ref.id}`
  const kindOf = (ref: EntityRef) => (KIND_META[ref.kind]?.label ?? ref.kind).toLowerCase()
  const lines: string[] = []
  if (r.simulated) {
    lines.push(
      `> **Simulated content.** Generated by Atrium's local simulator on ${formatLongDate(r.startedAt)}. No AI model, web search or external service was used.`,
      '',
    )
  }
  lines.push(`## Receipt · ${r.title}`, '')
  lines.push(`- **Run:** ${r.handle} · ${r.kindLabel} · ${r.statusWord}${r.stopped ? ' · Stopped by you' : ''}`)
  if (r.model) {
    const called = r.model.simulated ? ' · No model was called' : ''
    lines.push(`- **Model:** ${r.model.label} (${r.model.provider}, ${tag(r.model.simulated)})${called}`)
  }
  if (r.tools.length) lines.push(`- **Tools:** ${r.tools.map((t) => `${t.label} ${tag(t.simulated)}`).join(', ')}`)
  if (r.capabilities.length) {
    lines.push('- **Capabilities:**')
    for (const c of r.capabilities) lines.push(`  - ${c.label} · ${c.decision}`)
  }
  lines.push(`- **Tokens:** ${formatTokenCount(r.inputTokens)} in · ${formatTokenCount(r.outputTokens)} out${r.simulated ? ' (est.)' : ''}`)
  lines.push(
    r.costIsEstimate
      ? `- **Cost:** ${formatCost(r.costUsd, { est: true })} at reference pricing (no money was spent)`
      : `- **Cost:** ${formatCost(r.costUsd)}`,
  )
  if (r.durationMs !== undefined) lines.push(`- **Duration:** ${r.durationMs >= 60_000 ? formatClock(r.durationMs) : formatSeconds(r.durationMs)}`)
  if (r.saw.length) {
    lines.push('- **Saw:**')
    for (const s of r.saw) lines.push(`  - ${name(s.ref)} (${kindOf(s.ref)}) · ${formatTok(s.tokens)} · ${Math.round(s.share * 100)}%`)
  }
  if (r.outputs.length) {
    lines.push('- **Outputs:**')
    for (const o of r.outputs) lines.push(`  - ${name(o)} (${kindOf(o)})`)
  }
  if (r.error) lines.push(`- **Error:** ${r.error}`)
  return `${lines.join('\n')}\n`
}

/** Raw JSON for the "Raw JSON" disclosure (the run row, plus the approvals it raised). */
export function receiptJson(run: Run, approvals: readonly Approval[] = []): string {
  const own = approvals.filter((a) => a.runId === run.id)
  return JSON.stringify(own.length ? { run, approvals: own } : { run }, null, 2)
}
