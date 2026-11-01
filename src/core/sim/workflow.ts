import type { WorkflowEdge, WorkflowNode, WorkflowTrigger } from '@/core/types'
import type { Rng } from '@/lib/rng'
import { configNumber, configString } from './params'
import { capitalize, keyTerms, shorten, topicPhrase } from './text'
import { searchSimulatedWeb } from './web'

/**
 * Workflow simulation helpers: graph utilities (topological order, cycles, reachability)
 * and simulated content (trigger payloads, condition evaluation, agent output). Pure.
 * All payloads reference fictional senders on `.example` domains.
 */

type NodeLike = Pick<WorkflowNode, 'id'>
type EdgeLike = Pick<WorkflowEdge, 'source' | 'target'>

/** Kahn's algorithm. Nodes on (or only reachable through) a cycle end up in `blocked`. */
export function topologicalOrder(nodes: readonly NodeLike[], edges: readonly EdgeLike[]): { order: string[]; blocked: string[] } {
  const ids = new Set(nodes.map((n) => n.id))
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  const out = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    out.get(e.source)!.push(e.target)
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
  }
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const next of out.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1
      indegree.set(next, d)
      if (d === 0) queue.push(next)
    }
  }
  return { order, blocked: nodes.map((n) => n.id).filter((id) => !order.includes(id)) }
}

/** One cycle as a node path (first node repeated at the end), or null. */
export function findCycle(nodes: readonly NodeLike[], edges: readonly EdgeLike[]): string[] | null {
  const ids = new Set(nodes.map((n) => n.id))
  const out = new Map<string, string[]>()
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    out.set(e.source, [...(out.get(e.source) ?? []), e.target])
  }
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const visit = (id: string): string[] | null => {
    state.set(id, 'visiting')
    stack.push(id)
    for (const next of out.get(id) ?? []) {
      if (state.get(next) === 'visiting') return [...stack.slice(stack.indexOf(next)), next]
      if (!state.has(next)) {
        const found = visit(next)
        if (found) return found
      }
    }
    stack.pop()
    state.set(id, 'done')
    return null
  }
  for (const n of nodes) {
    if (state.has(n.id)) continue
    const found = visit(n.id)
    if (found) return found
  }
  return null
}

export function reachableFrom(startId: string, edges: readonly EdgeLike[]): Set<string> {
  const seen = new Set<string>([startId])
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift()!
    for (const e of edges) {
      if (e.source === id && !seen.has(e.target)) {
        seen.add(e.target)
        queue.push(e.target)
      }
    }
  }
  return seen
}

// ---------------------------------------------------------------- layout

/** Canvas grid (docs/DESIGN.md §6.6): 240×72 nodes, flow top to bottom. Rows 128px, columns 288px. */
export const FLOW_GRID = { nodeWidth: 240, nodeHeight: 72, column: 288, row: 128 } as const

type LayoutNode = Pick<WorkflowNode, 'id' | 'type' | 'position'>
type LayoutEdge = Pick<WorkflowEdge, 'source' | 'target' | 'sourceHandle'>

/**
 * Layered top-to-bottom layout: each step sits one row below its deepest predecessor; within a row,
 * steps sit under the average of their predecessors (a condition's "Yes" branch left of its "No"
 * branch) and are pushed apart to one column. Steps on a loop are placed after the rest.
 * Returns positions keyed by node id; the first trigger stays in the center column (x = 0).
 */
export function layoutGraph(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], grid: { column: number; row: number } = FLOW_GRID): Record<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((n) => n.id))
  const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
  const { order, blocked } = topologicalOrder(nodes, valid)
  const preds = new Map<string, LayoutEdge[]>(nodes.map((n) => [n.id, []]))
  for (const e of valid) preds.get(e.target)!.push(e)

  // Rank = longest path from a source (triggers first). Blocked (looping) steps follow the rest.
  const rank = new Map<string, number>()
  for (const id of order) {
    const ps = preds.get(id)!.filter((e) => rank.has(e.source))
    rank.set(id, ps.length ? Math.max(...ps.map((e) => rank.get(e.source)! + 1)) : 0)
  }
  let next = Math.max(-1, ...rank.values()) + 1
  for (const id of blocked) rank.set(id, next++)

  const byRank = new Map<number, string[]>()
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0
    byRank.set(r, [...(byRank.get(r) ?? []), n.id])
  }
  const x = new Map<string, number>()
  const original = new Map(nodes.map((n) => [n.id, n.position]))
  const branchBias = (e: LayoutEdge) => (e.sourceHandle === 'false' ? 0.5 : e.sourceHandle === 'true' ? -0.5 : 0)

  for (const r of [...byRank.keys()].sort((a, b) => a - b)) {
    const row = byRank.get(r)!
    // Triggers lead row 0; then each step's preferred x is the mean of its placed predecessors.
    const desired = row.map((id) => {
      const ps = preds.get(id)!.filter((e) => x.has(e.source))
      const node = nodes[index.get(id)!]
      const want = ps.length ? ps.reduce((sum, e) => sum + x.get(e.source)! + branchBias(e) * grid.column, 0) / ps.length : null
      return { id, want, trigger: node.type === 'trigger', ox: original.get(id)?.x ?? 0, i: index.get(id)! }
    })
    desired.sort(
      (a, b) =>
        Number(b.trigger) - Number(a.trigger) ||
        (a.want ?? Number.POSITIVE_INFINITY) - (b.want ?? Number.POSITIVE_INFINITY) ||
        a.ox - b.ox ||
        a.i - b.i,
    )
    // Unanchored steps (no placed predecessor) line up after the anchored ones.
    const anchored = desired.filter((d) => d.want !== null)
    const want = desired.map((d, k) => d.want ?? (anchored.length ? Math.max(...anchored.map((a) => a.want!)) + (k - anchored.length + 1) * grid.column : (k - (desired.length - 1) / 2) * grid.column))
    // Push apart left to right, then re-center the block on the mean of the wishes.
    const placed: number[] = []
    want.forEach((w, k) => placed.push(k === 0 ? w : Math.max(w, placed[k - 1] + grid.column)))
    const shift = want.reduce((s, w) => s + w, 0) / want.length - placed.reduce((s, p) => s + p, 0) / placed.length
    desired.forEach((d, k) => x.set(d.id, Math.round(placed[k] + shift)))
  }

  // Keep the first trigger in the center column.
  const anchor = nodes.find((n) => n.type === 'trigger') ?? nodes[0]
  const dx = anchor ? -(x.get(anchor.id) ?? 0) : 0
  const out: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) out[n.id] = { x: (x.get(n.id) ?? 0) + dx, y: (rank.get(n.id) ?? 0) * grid.row }
  return out
}

/**
 * True when a graph was laid out left to right (older drafts and the demo data): connections mostly
 * run sideways. The editor re-lays such graphs top to bottom once.
 */
export function isSidewaysLayout(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): boolean {
  const pos = new Map(nodes.map((n) => [n.id, n.position]))
  let dx = 0
  let dy = 0
  for (const e of edges) {
    const a = pos.get(e.source)
    const b = pos.get(e.target)
    if (!a || !b) continue
    dx += Math.abs(b.x - a.x)
    dy += Math.abs(b.y - a.y)
  }
  return dx > dy
}

// ---------------------------------------------------------------- templates

/**
 * Fill `{{key}}` placeholders from the run context. Known keys: subject, sender, priority, category,
 * summary (the last output's first line), output (the last output). Unknown keys stay as written.
 */
export function renderTemplate(text: string, ctx: FlowContext): string {
  const firstLine = ctx.lastOutput?.split('\n').find((l) => l.trim())?.trim()
  const values: Record<string, string | undefined> = {
    subject: ctx.subject,
    sender: ctx.sender,
    priority: ctx.priority,
    category: ctx.category,
    summary: firstLine ? shorten(firstLine.replace(/[*_`]+/g, ''), 160) : undefined,
    output: ctx.lastOutput,
  }
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, key: string) => values[key.toLowerCase()] ?? all)
}

// ---------------------------------------------------------------- cron

const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** One cron field → the allowed values, or null when it cannot be parsed. Supports *, n, a-b, lists and /step. */
function cronField(field: string, min: number, max: number, names?: readonly string[]): Set<number> | null {
  const out = new Set<number>()
  const value = (t: string): number | null => {
    const lower = t.toLowerCase()
    if (/^\d+$/.test(lower)) return Number(lower)
    const idx = names ? names.indexOf(lower.slice(0, 3)) : -1
    return idx >= 0 ? idx : null
  }
  for (const part of field.split(',')) {
    const m = /^(\*|[\w]+(?:-[\w]+)?)(?:\/(\d+))?$/.exec(part.trim())
    if (!m) return null
    const step = m[2] ? Number(m[2]) : 1
    if (step < 1) return null
    let lo = min
    let hi = max
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-')
      const va = value(a)
      const vb = b !== undefined ? value(b) : m[2] ? max : va
      if (va === null || vb === null) return null
      lo = va
      hi = vb
    }
    if (lo < min || hi > (names ? 7 : max) || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(names ? v % 7 : v)
  }
  return out
}

export interface ParsedCron {
  minutes: Set<number>
  hours: Set<number>
  days: Set<number>
  months: Set<number>
  weekdays: Set<number>
  /** Day-of-month and day-of-week are both restricted: either may match (standard cron). */
  eitherDay: boolean
}

/** Parse a 5-field cron expression (minute hour day-of-month month day-of-week), or null when invalid. */
export function parseCron(cron: string): ParsedCron | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [mi, h, dom, mon, dow] = parts
  const minutes = cronField(mi, 0, 59)
  const hours = cronField(h, 0, 23)
  const days = cronField(dom, 1, 31)
  const months = cronField(mon, 1, 12)
  const weekdays = cronField(dow, 0, 6, DOW_NAMES)
  if (!minutes || !hours || !days || !months || !weekdays) return null
  return { minutes, hours, days, months, weekdays, eitherDay: dom !== '*' && dow !== '*' }
}

function dayMatches(c: ParsedCron, d: Date): boolean {
  if (!c.months.has(d.getMonth() + 1)) return false
  const dom = c.days.has(d.getDate())
  const dow = c.weekdays.has(d.getDay())
  return c.eitherDay ? dom || dow : dom && dow
}

/** True when the cron expression fires at the minute of `ts` (local time). */
export function cronMatches(cron: string | ParsedCron, ts: number): boolean {
  const c = typeof cron === 'string' ? parseCron(cron) : cron
  if (!c) return false
  const d = new Date(ts)
  return dayMatches(c, d) && c.hours.has(d.getHours()) && c.minutes.has(d.getMinutes())
}

/** The first minute strictly after `from` at which the cron fires (local time), within `horizonDays`. */
export function nextCronTime(cron: string | ParsedCron, from: number, horizonDays = 400): number | undefined {
  const c = typeof cron === 'string' ? parseCron(cron) : cron
  if (!c) return undefined
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const limit = from + horizonDays * 86_400_000
  while (d.getTime() <= limit) {
    if (!dayMatches(c, d)) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!c.hours.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!c.minutes.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0)
      continue
    }
    return d.getTime()
  }
  return undefined
}

// ---------------------------------------------------------------- run context

export type Priority = 'urgent' | 'high' | 'normal' | 'low'

/** What the simulated run "knows" as it walks the graph (drives conditions and outputs). */
export interface FlowContext {
  subject?: string
  sender?: string
  priority?: Priority
  category?: string
  sentiment?: 'negative' | 'neutral' | 'positive'
  score?: number
  /** Most recent text produced by a step (agent output, transform). */
  lastOutput?: string
}

interface SampleEmail {
  from: string
  subject: string
  body: string
  category: string
  priority: Priority
  sentiment: FlowContext['sentiment']
  why: string
  next: string
}

/** Fictional inbound messages (customers from the demo story, `.example` addresses). */
const EMAILS: readonly SampleEmail[] = [
  {
    from: 'dispatch@meridianfreight.example',
    subject: 'Whole dispatch team locked out after SSO change',
    body: 'Since this morning nobody on our dispatch team can sign in to the portal. We changed nothing on our side.',
    category: 'Access issue',
    priority: 'urgent',
    sentiment: 'negative',
    why: 'a whole team is blocked from signing in, which stops their daily work',
    next: 'page the on-call engineer and send the customer a status update',
  },
  {
    from: 'ops@coastalcargo.example',
    subject: 'Tracking page shows stale ETAs',
    body: 'ETAs on the tracking page have not refreshed for several hours. Can you check?',
    category: 'Bug report',
    priority: 'high',
    sentiment: 'neutral',
    why: 'stale tracking data affects their customers, but there is a workaround (the API)',
    next: 'open an engineering ticket and confirm the scope with the customer',
  },
  {
    from: 'finance@haldenlogistics.example',
    subject: 'Invoice shows the wrong currency',
    body: 'Our latest invoice is in USD but our contract is in EUR. Please correct it.',
    category: 'Billing question',
    priority: 'normal',
    sentiment: 'neutral',
    why: 'a billing correction is needed but nothing is blocked',
    next: 'route to billing and acknowledge within the SLA',
  },
  {
    from: 'it@meridianfreight.example',
    subject: 'Label printing API returning 502 errors',
    body: 'Our warehouse integration gets 502s from the label printing endpoint intermittently.',
    category: 'Bug report',
    priority: 'urgent',
    sentiment: 'negative',
    why: 'failed label printing can stop outbound shipments at the warehouse',
    next: 'escalate to the platform team and share the incident status page',
  },
  {
    from: 'lead@coastalcargo.example',
    subject: 'Feature request: export shipments to CSV',
    body: 'It would help our planners to export the shipments table to CSV.',
    category: 'Feature request',
    priority: 'low',
    sentiment: 'positive',
    why: 'a useful request with no impact on current operations',
    next: 'log it for product review and thank the customer',
  },
  {
    from: 'admin@haldenlogistics.example',
    subject: 'Adding five more seats',
    body: 'We are onboarding a new team next month. How do we add more seats?',
    category: 'Account change',
    priority: 'low',
    sentiment: 'positive',
    why: 'a routine account change with a clear answer in the help center',
    next: 'reply with the seat management steps and loop in the account manager',
  },
]

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'

const PR_TITLES = ['Add retry to label printing', 'Cache weekly volume chart data', 'Validate seat counts on checkout', 'Handle expired refresh tokens', 'Paginate the invoice list']
const AUTHORS = ['jkim', 'mtorres', 'asingh', 'lchen', 'rbauer']

export interface TriggerPayload {
  /** Step title for the trigger step (noun-led, e.g. "Email from …"); falls back to "Triggered by …". */
  title?: string
  detail: string
  output: string
  context: FlowContext
}

/** A real Atrium event that started (or samples) a run: a knowledge item, task, run or approval. */
export interface TriggerEventSample {
  /** e.g. "knowledge.created". */
  event: string
  /** What happened, e.g. “Webhook retry risks” was added to Knowledge. */
  title: string
  /** Extra lines (project, author, status). */
  lines?: string[]
  /** True when the run was started by hand with the latest matching item as a sample. */
  sample?: boolean
}

export interface TriggerPayloadOptions {
  /** Free-text trigger passed to runWorkflow ('manual' = started by hand). */
  override?: string
  userName?: string
  /** The real internal event behind an event trigger. */
  event?: TriggerEventSample
  /** "Send test event" on a webhook trigger. */
  webhookTest?: boolean
}

/** Simulated payload for a run's trigger. `override` is the free-text trigger passed to runWorkflow. */
export function triggerPayload(trigger: WorkflowTrigger, node: WorkflowNode | undefined, rng: Rng, opts: TriggerPayloadOptions = {}): TriggerPayload {
  const event = trigger.event ?? configString(node?.config, 'event') ?? ''
  if (opts.event) {
    const e = opts.event
    return {
      title: e.title,
      detail: e.sample ? `Sample event: the latest ${e.event} (started by hand)` : `Event: ${e.event}`,
      output: [e.title, ...(e.lines ?? [])].join('\n'),
      context: { subject: e.title },
    }
  }
  if (opts.webhookTest || (trigger.type === 'webhook' && opts.override === 'webhook.test')) {
    const id = `evt_${rng.int(100_000, 999_999)}`
    return {
      title: 'Test event received',
      detail: 'Simulated webhook test event — nothing called this URL',
      output: [`POST /hooks/${slugOf(trigger.label || 'workflow')}`, '', '{', `  "id": "${id}",`, `  "event": "${event || 'test'}",`, '  "test": true', '}', '', '(simulated payload)'].join('\n'),
      context: { subject: 'Test event' },
    }
  }
  if (opts.override && opts.override !== 'manual') {
    return { detail: opts.override, output: `Triggered with: ${opts.override}`, context: { subject: opts.override } }
  }
  if (/mail|message|email|support|ticket/i.test(event) || trigger.integrationId === 'gmail') {
    const e = rng.pick(EMAILS)
    return {
      detail: `New email from ${e.from}`,
      output: [`From: ${e.from}`, `Subject: ${e.subject}`, '', e.body, '', '(simulated event payload)'].join('\n'),
      context: { subject: e.subject, sender: e.from },
    }
  }
  if (/pull_request|pr\.|github/i.test(event) || trigger.integrationId === 'github') {
    const n = rng.int(180, 420)
    const title = rng.pick(PR_TITLES)
    return {
      detail: `Pull request #${n} opened`,
      output: [`Pull request #${n}: ${title}`, `Author: @${rng.pick(AUTHORS)}`, `Changed files: ${rng.int(2, 9)}`, '', '(simulated event payload)'].join('\n'),
      context: { subject: title },
    }
  }
  if (trigger.type === 'schedule') {
    return { detail: trigger.label || 'Scheduled', output: `Scheduled run (${trigger.label || trigger.cron || 'schedule'}). Started manually for this simulation.`, context: {} }
  }
  if (trigger.type === 'webhook') {
    return { detail: 'Webhook received', output: `POST /hooks/${slugOf(trigger.label)}\n\n{ "event": "${event || 'custom'}" }\n\n(simulated payload)`, context: {} }
  }
  if (trigger.type === 'event') {
    return { detail: event || trigger.label, output: `Event: ${event || trigger.label} (simulated payload)`, context: {} }
  }
  return { detail: `Started manually by ${opts.userName ?? 'you'}`, output: `Manual run started by ${opts.userName ?? 'you'}.`, context: {} }
}

// ---------------------------------------------------------------- conditions

/**
 * Evaluate a condition node. `config.branch` ('true'|'false') forces a branch (useful for demos);
 * otherwise `config.expression` is matched against the run context with simple heuristics,
 * falling back to a seeded coin flip.
 */
export function evaluateCondition(node: WorkflowNode, ctx: FlowContext, rng: Rng): { branch: 'true' | 'false'; reason: string } {
  const forced = configString(node.config, 'branch')
  if (forced === 'true' || forced === 'false') return { branch: forced, reason: 'branch fixed in the step settings' }
  const expr = (configString(node.config, 'expression', 'condition', 'rule') ?? node.label).toLowerCase()
  const yes = (cond: boolean, why: string) => ({ branch: cond ? ('true' as const) : ('false' as const), reason: why })
  if (/urgent|critical|p0|sev ?1|escalat/.test(expr)) {
    if (ctx.priority) return yes(ctx.priority === 'urgent' || (/high/.test(expr) && ctx.priority === 'high'), `priority is ${ctx.priority}`)
    return yes(rng.chance(0.35), 'no priority in the input; simulated evaluation')
  }
  if (/high/.test(expr) && ctx.priority) return yes(ctx.priority === 'urgent' || ctx.priority === 'high', `priority is ${ctx.priority}`)
  if (/negative|angry|unhappy|sentiment/.test(expr)) {
    if (ctx.sentiment) return yes(ctx.sentiment === 'negative', `sentiment is ${ctx.sentiment}`)
    return yes(rng.chance(0.3), 'no sentiment in the input; simulated evaluation')
  }
  const threshold = /score\s*(>=|>|<=|<)\s*([\d.]+)/.exec(expr)
  if (threshold) {
    const score = ctx.score ?? Math.round(rng.float(0.2, 0.95) * 100) / 100
    const t = Number(threshold[2])
    const op = threshold[1]
    const ok = op === '>' ? score > t : op === '>=' ? score >= t : op === '<' ? score < t : score <= t
    return yes(ok, `score ${score} ${op} ${t}`)
  }
  const contains = /(?:contains|includes|mentions|has)\s*\(?\s*['"]?([\w-]+)/.exec(expr)
  if (contains && ctx.subject) return yes(ctx.subject.toLowerCase().includes(contains[1]), `subject ${ctx.subject.toLowerCase().includes(contains[1]) ? 'mentions' : 'does not mention'} “${contains[1]}”`)
  const category = /category\s*(?:==|=|is)\s*['"]?([\w -]+?)['"]?$/.exec(expr)
  if (category && ctx.category) return yes(ctx.category.toLowerCase().includes(category[1].trim()), `category is ${ctx.category}`)
  if (/approved|success|ok|passed|complete/.test(expr)) return yes(rng.chance(0.8), 'simulated evaluation')
  return yes(rng.chance(0.5), 'simulated evaluation')
}

// ---------------------------------------------------------------- agent output

export interface AgentVoice {
  name: string
  role: string
}

export interface DigestLine {
  project: string
  done: number
  inProgress: number
  nextDue?: string
}

export interface AgentOutputInput {
  agent: AgentVoice
  node: WorkflowNode
  ctx: FlowContext
  rng: Rng
  /** Real workspace data for digest-style prompts. */
  digest?: { lines: DigestLine[]; pendingApprovals: number; dateLabel: string }
}

export interface AgentOutput {
  thinking: string
  message: string
  /** Context updates (classification results). */
  context: Partial<FlowContext>
}

function emailFor(ctx: FlowContext): SampleEmail | undefined {
  return EMAILS.find((e) => e.subject === ctx.subject)
}

/** What an agent node produces, written in the agent's voice (first person, cautious). */
export function agentOutput(input: AgentOutputInput): AgentOutput {
  const { agent, node, ctx, rng } = input
  const instruction = configString(node.config, 'prompt', 'instructions', 'task') ?? node.label
  const p = `${instruction} ${node.label}`.toLowerCase()

  if (/triage|classif|categor|route|prioriti|label/.test(p)) {
    const email = emailFor(ctx)
    const pick = email ?? rng.pick(EMAILS)
    return {
      thinking: `Reading “${ctx.subject ?? pick.subject}” and checking it against the triage rubric: who is affected, what is blocked, and how the sender sounds.`,
      message: [
        `I classified this as **${pick.category}** with **${pick.priority}** priority.`,
        `Why: ${pick.why}.`,
        `Suggested next step: ${pick.next}.`,
      ].join('\n'),
      context: { category: pick.category, priority: pick.priority, sentiment: pick.sentiment, subject: ctx.subject ?? pick.subject },
    }
  }

  if (/digest|summar|report|weekly|recap|status/.test(p) && input.digest) {
    const d = input.digest
    const lines = d.lines.length
      ? d.lines.map((l) => `• ${l.project}: ${l.done} task${l.done === 1 ? '' : 's'} done this week, ${l.inProgress} in progress${l.nextDue ? `; next due: “${l.nextDue}”` : ''}`)
      : ['• No project activity this week.']
    return {
      thinking: 'Collecting completed and in-progress tasks per project from the workspace, plus open approvals.',
      message: [`Here is the digest for ${d.dateLabel}:`, '', ...lines, '', `Open approvals: ${d.pendingApprovals}.`, '', 'Counts come from your workspace; the wording is simulated.'].join('\n'),
      context: {},
    }
  }

  if (/review|pull request|\bpr\b|diff|code/.test(p)) {
    const subject = ctx.subject ?? 'the pull request'
    return {
      thinking: `Going through “${subject}”: tests, error handling, naming, and anything that changes behavior for customers.`,
      message: [
        `I reviewed “${subject}” (simulated — no code was fetched). Suggestions:`,
        `1. Add a test for the failure path so the change stays covered.`,
        `2. Keep the retry/backoff values in named constants.`,
        `3. Note the user-visible change in the PR description.`,
        '',
        rng.chance(0.5) ? 'Overall: looks reasonable once the test is added.' : 'Overall: small, focused change — fine to merge after a second look.',
      ].join('\n'),
      context: {},
    }
  }

  if (/research|competitor|radar|monitor|scan|search|news|market/.test(p)) {
    const topic = topicPhrase(instruction, 6)
    const results = searchSimulatedWeb({ question: instruction, angle: instruction, angleIndex: 0, count: 3, rng, keyPrefix: 'wf' })
    return {
      thinking: `Scanning simulated sources for ${topic}.`,
      message: [
        `I scanned 3 simulated sources about ${topic} (fictional publications, not real search results). Worth a look:`,
        ...results.map((r) => `• ${r.title} — ${r.publication} (${r.domain})`),
        '',
        'Nothing here is verified; treat it as a reading list.',
      ].join('\n'),
      context: { subject: topic },
    }
  }

  if (/generat|draft|write|create|design|copy|image|visual/.test(p)) {
    const terms = keyTerms(instruction, 3)
    return {
      thinking: `Drafting options for ${terms.join(', ') || 'the request'}.`,
      message: [
        `I drafted three options for ${terms.join(', ') || 'this'}:`,
        `1. ${capitalize(terms[0] ?? 'Option')} — clear and direct.`,
        `2. ${capitalize(terms[1] ?? terms[0] ?? 'Option')} — warmer, story-led.`,
        `3. ${capitalize(terms[2] ?? terms[0] ?? 'Option')} — short, for small formats.`,
        '',
        'All three are simulated drafts for review.',
      ].join('\n'),
      context: {},
    }
  }

  const summary = ctx.lastOutput ? shorten(ctx.lastOutput.replace(/\s+/g, ' '), 160) : ctx.subject ?? 'the input'
  return {
    thinking: `${agent.name} (${agent.role}) is working on: ${shorten(instruction, 120)}.`,
    message: `I handled “${shorten(instruction, 100)}” based on ${summary}. (Simulated output.)`,
    context: {},
  }
}

// ---------------------------------------------------------------- delays

/** Human duration and simulated (shortened) duration for a delay node. */
export function delayDuration(node: WorkflowNode): { label: string; simulatedMs: number } {
  const minutes = configNumber(node.config, 'minutes')
  const hours = configNumber(node.config, 'hours')
  const seconds = configNumber(node.config, 'seconds')
  const raw = configString(node.config, 'duration', 'delay')
  let ms = (hours ?? 0) * 3_600_000 + (minutes ?? 0) * 60_000 + (seconds ?? 0) * 1000
  if (!ms && raw) {
    const m = /^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d|day)s?$/i.exec(raw.trim())
    if (m) ms = Number(m[1]) * ({ s: 1000, sec: 1000, m: 60_000, min: 60_000, h: 3_600_000, hr: 3_600_000, d: 86_400_000, day: 86_400_000 } as Record<string, number>)[m[2].toLowerCase()]
  }
  if (!ms) ms = 60_000
  const label = ms >= 86_400_000 ? `${Math.round(ms / 86_400_000)} day(s)` : ms >= 3_600_000 ? `${Math.round(ms / 360_000) / 10} hour(s)` : ms >= 60_000 ? `${Math.round(ms / 60_000)} minute(s)` : `${Math.round(ms / 1000)} second(s)`
  return { label, simulatedMs: Math.min(2500, Math.max(800, ms / 1000)) }
}
