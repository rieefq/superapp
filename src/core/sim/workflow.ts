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

const PR_TITLES = ['Add retry to label printing', 'Cache weekly volume chart data', 'Validate seat counts on checkout', 'Handle expired refresh tokens', 'Paginate the invoice list']
const AUTHORS = ['jkim', 'mtorres', 'asingh', 'lchen', 'rbauer']

export interface TriggerPayload {
  detail: string
  output: string
  context: FlowContext
}

/** Simulated payload for a run's trigger. `override` is the free-text trigger passed to runWorkflow. */
export function triggerPayload(trigger: WorkflowTrigger, node: WorkflowNode | undefined, rng: Rng, opts: { override?: string; userName?: string } = {}): TriggerPayload {
  const event = trigger.event ?? configString(node?.config, 'event') ?? ''
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
    return { detail: 'Webhook received', output: `POST /hooks/${trigger.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\n\n{ "event": "${event || 'custom'}" }\n\n(simulated payload)`, context: {} }
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
