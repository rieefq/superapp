import { db } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { evaluatePermission } from '@/core/permissions/evaluate'
import { retrieveKnowledge, type RetrievedPassage } from '@/core/search'
import { DEMO_REPO } from '@/core/seed/demoRepo'
import { AGENT_TASK_FACTORY, attachRunToTask, startAgentScheduler } from '@/core/services/agents'
import { resolveEntity } from '@/core/services/entities'
import { createKnowledge } from '@/core/services/knowledge'
import { clipLine, plainText } from '@/core/services/serviceHelpers'
import { createTask, updateTask } from '@/core/services/tasks'
import {
  ME,
  sameRef,
  type ActorRef,
  type Agent,
  type ApprovalPreview,
  type Capability,
  type CapabilityGrant,
  type EntityKind,
  type EntityRef,
  type ID,
  type Run,
  type RunStep,
  type StepStatus,
} from '@/core/types'
import type { Rng } from '@/lib/rng'
import { registerRunFactory } from '../registry'
import { updateStep } from '../service'
import type { RunPlan, StepContext, StepPlan } from '../types'
import {
  browseNotes,
  channelFor,
  extractTopic,
  fileExcerpt,
  formatTable,
  formatWebResults,
  pickConsiderations,
  pickRepoFiles,
  simulatedFileListing,
  simulatedFreeSlots,
  simulatedQuery,
  simulatedWebResults,
  type Topic,
} from './agentContent'

/**
 * 'agent.task' — simulates an agent working on an instruction. The plan is built from the
 * agent's capability grants (denied capabilities are never used) and the instruction:
 * plan → the context you attached (real) → knowledge search (real retrieval) → capability-specific
 * tool steps → synthesis → real side effects (knowledge note, follow-up task) → message → summary.
 *
 * Every step that uses a capability is gated by the live permission policy at the moment it runs
 * (grant, integration connection and scope, autonomy, Settings › always-ask): allowed steps run,
 * "ask" raises an ApprovalCard, and blocked or denied steps are skipped. The summary is written
 * from what actually happened, never from the plan.
 */

export interface AgentTaskParams {
  agentId: ID
  instruction: string
  taskId?: ID
  projectId?: ID | null
  /** Context from the composer's Context Line; read first and recorded in the Saw list. */
  context?: EntityRef[]
  /** Why the run started when nobody typed it (e.g. a schedule). */
  trigger?: string
}

const ENTITY_KINDS = new Set<EntityKind>([
  'project', 'task', 'thread', 'message', 'run', 'approval', 'agent', 'workflow', 'knowledge', 'collection',
  'investigation', 'source', 'repo', 'session', 'asset', 'board', 'integration',
])

function parseRefs(value: unknown): EntityRef[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: EntityRef[] = []
  for (const v of value) {
    if (!v || typeof v !== 'object') continue
    const { kind, id } = v as { kind?: unknown; id?: unknown }
    if (typeof kind === 'string' && typeof id === 'string' && ENTITY_KINDS.has(kind as EntityKind)) out.push({ kind: kind as EntityKind, id })
  }
  return out.length ? out : undefined
}

export function parseAgentTaskParams(params: Record<string, unknown>): AgentTaskParams | null {
  const { agentId, instruction, taskId, projectId, context, trigger } = params
  if (typeof agentId !== 'string' || typeof instruction !== 'string' || !instruction.trim()) return null
  const out: AgentTaskParams = {
    agentId,
    instruction,
    taskId: typeof taskId === 'string' ? taskId : undefined,
    projectId: typeof projectId === 'string' ? projectId : null,
  }
  const refs = parseRefs(context)
  if (refs) out.context = refs
  if (typeof trigger === 'string' && trigger.trim()) out.trigger = trigger.trim()
  return out
}

const TOOL_FAIL_CHANCE = 0.04
const timing = (rng: Rng) => ({ durationMs: rng.int(600, 4000), tokens: rng.int(300, 4000) })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const STEP_MARK: Record<StepStatus, string> = { done: '✓', failed: '✗', skipped: '–', running: '…', pending: '·', waiting: '⏸' }

function usableGrants(agent: Agent): Map<Capability, CapabilityGrant> {
  const grants = new Map<Capability, CapabilityGrant>()
  for (const g of agent.capabilities) if (g.mode !== 'deny' && !grants.has(g.capability)) grants.set(g.capability, g)
  return grants
}

/** Real retrieval within the agent's knowledge scope; project-first, then workspace-wide. */
function retrieveScoped(agent: Agent, query: string, projectId: ID | null | undefined): RetrievedPassage[] {
  const scope = agent.knowledgeScope
  let ids: ID[] | undefined
  if (!scope.all) {
    ids = db
      .filter('knowledge', (k) => (!!k.collectionId && scope.collectionIds.includes(k.collectionId)) || k.projectIds.some((p) => scope.projectIds.includes(p)))
      .map((k) => k.id)
    if (!ids.length) return []
  }
  try {
    const inProject = projectId ? retrieveKnowledge(query, { ids, projectId, limit: 4 }) : []
    return inProject.length ? inProject : retrieveKnowledge(query, { ids, limit: 4 })
  } catch {
    return []
  }
}

/** A one-line excerpt of an entity the user attached, read from the local database (real, not simulated). */
function contextLine(ref: EntityRef): string {
  let text = ''
  switch (ref.kind) {
    case 'knowledge': {
      const k = db.get('knowledge', ref.id)
      text = k?.summary || plainText(k?.content ?? '')
      break
    }
    case 'task':
      text = db.get('tasks', ref.id)?.description ?? ''
      break
    case 'message':
      text = plainText(db.get('messages', ref.id)?.content ?? '')
      break
    case 'project': {
      const p = db.get('projects', ref.id)
      text = [p?.goal, p?.instructions].filter(Boolean).join(' · ')
      break
    }
    case 'investigation':
      text = db.get('investigations', ref.id)?.question ?? ''
      break
    case 'run':
      text = db.get('runs', ref.id)?.summary ?? ''
      break
    default:
      break
  }
  const resolved = resolveEntity(ref)
  const title = resolved.exists ? resolved.title : 'Deleted item'
  const excerpt = clipLine(text.replace(/\s+/g, ' ').trim(), 140)
  return excerpt ? `• ${title} — “${excerpt}”` : `• ${title}`
}

function addOutputOnce(ctx: Pick<StepContext, 'run' | 'addOutput'>, ref: EntityRef): void {
  if (!ctx.run.outputs.some((o) => sameRef(o, ref))) ctx.addOutput(ref)
}

/** Only the newest run working on a task may move it (older runs must not override newer ones). */
function isLatestRunOfTask(taskId: ID, run: Run): boolean {
  const task = db.get('tasks', taskId)
  if (!task) return false
  let latest: Run | undefined
  for (const r of db.all('runs')) {
    if (!task.runIds.includes(r.id) && r.script?.params.taskId !== taskId) continue
    if (!latest || r.createdAt > latest.createdAt) latest = r
  }
  return !latest || latest.id === run.id || latest.createdAt === run.createdAt
}

interface NoteInput {
  agent: Agent
  instruction: string
  retrieved: RetrievedPassage[]
  considerations: string[]
  topic: Topic
}

/** A structured, non-fabricating record of what the run actually did (from its step log). */
export function buildRunNote(run: Run, upToStepId: ID | undefined, input: NoteInput): string {
  const steps: string[] = []
  for (const step of run.steps) {
    if (step.id === upToStepId) break
    steps.push(`${steps.length + 1}. ${STEP_MARK[step.status]} ${step.title}`)
  }
  const knowledge = input.retrieved.length
    ? input.retrieved.map((r) => `- **${r.item.title}** — “${clipLine(r.passage, 200)}”`).join('\n')
    : '- No knowledge items matched this request.'
  const simulatedTools = run.steps.some(
    (s) => s.status === 'done' && (s.capability === 'web.search' || s.capability === 'web.browse' || s.capability === 'data.query'),
  )
  return [
    run.simulated
      ? `> Written by ${input.agent.name} at the end of a simulated run. Tool results came from the local simulator; nothing here was verified against real systems.`
      : `> Written by ${input.agent.name} at the end of a run.`,
    '## Request',
    input.instruction.trim(),
    '## What the run did',
    steps.join('\n') || '- (no steps recorded)',
    '## Knowledge used',
    knowledge,
    '## Considerations',
    input.considerations.map((c, i) => `${i + 1}. ${c}`).join('\n'),
    '## Not verified',
    [
      simulatedTools ? '- Web results and query outputs are simulated placeholders; confirm with real sources before relying on them.' : undefined,
      '- The considerations above are general prompts for review, not conclusions.',
    ]
      .filter(Boolean)
      .join('\n'),
  ].join('\n\n')
}

function missingAgentPlan(): RunPlan {
  return {
    steps: [
      {
        kind: 'think',
        title: 'Load agent configuration',
        durationMs: 600,
        failChance: 1,
        failMessage: 'This agent no longer exists, so the run could not start.',
      },
    ],
  }
}

/** What a finished step contributed, for the summary written at the end (index = plan step index). */
interface Outcome {
  /** Sentence when the step ran, e.g. "Collected 5 web results from simulated sources". */
  did: string
  /** Short highlight for the run summary, e.g. "saved notes". */
  highlight?: string
}

/** An approval gate that lets the live permission policy decide when the step runs; skipped if denied. */
function gate(capability: Capability, title: string, preview?: ApprovalPreview, description?: string): NonNullable<StepPlan['approval']> {
  return { title, description, risk: CAPABILITIES[capability].risk, preview, onReject: 'skip' }
}

export function buildAgentTaskPlan(params: AgentTaskParams | null, rng: Rng): RunPlan {
  const agent = params ? db.get('agents', params.agentId) : undefined
  if (!params || !agent) return missingAgentPlan()

  const grants = usableGrants(agent)
  const has = (c: Capability) => grants.has(c)
  const via = (c: Capability, fallback: string) => grants.get(c)?.integrationId ?? fallback
  const nameOf = (integrationId: string) => getIntegration(integrationId)?.name ?? integrationId
  const topic = extractTopic(params.instruction)
  const task = params.taskId ? db.get('tasks', params.taskId) : undefined
  const agentActor: ActorRef = { type: 'agent', id: agent.id }
  const shortRequest = clipLine(task?.title ?? params.instruction.split('\n')[0] ?? '', 70)

  const work: StepPlan[] = []
  /** Outcome per entry of `work` (same index). */
  const outcomes: (Outcome | undefined)[] = []
  const push = (step: StepPlan, outcome?: Outcome) => {
    work.push(step)
    outcomes.push(outcome)
  }

  // The context you attached in the composer (real local reads; recorded in the Saw list)
  const context = (params.context ?? []).filter((ref) => resolveEntity(ref).exists)
  if (context.length) {
    push(
      {
        kind: 'read',
        title: `Read ${plural(context.length, 'item')} from your context`,
        detail: 'From the Context Line: project memory, held and attached items',
        output: context.map(contextLine).join('\n'),
        refs: context,
        ...timing(rng),
      },
      { did: `Read ${plural(context.length, 'item')} from your context`, highlight: `read ${plural(context.length, 'item')} you attached` },
    )
  }

  // Knowledge (real retrieval)
  let retrieved: RetrievedPassage[] = []
  if (has('knowledge.read')) {
    retrieved = retrieveScoped(agent, topic.request, params.projectId)
    push(
      {
        kind: 'search',
        title: 'Search Knowledge',
        detail: `Looking for context on “${clipLine(topic.request, 60)}”`,
        tool: 'knowledge.search',
        capability: 'knowledge.read',
        input: topic.request,
        output: retrieved.length
          ? `Found ${plural(retrieved.length, 'relevant item')}:\n${retrieved.map((r, i) => `${i + 1}. ${r.item.title} — “${clipLine(r.passage, 160)}”`).join('\n')}`
          : 'No matching knowledge found — continuing with the instruction alone.',
        refs: retrieved.map((r) => ({ kind: 'knowledge' as const, id: r.item.id })),
        approval: gate('knowledge.read', `Search Knowledge for “${clipLine(topic.request, 60)}”`, { kind: 'text', label: 'Knowledge search', content: topic.request }),
        ...timing(rng),
      },
      {
        did: retrieved.length
          ? `Reviewed ${plural(retrieved.length, 'knowledge item')}: ${retrieved.map((r) => r.item.title).join('; ')}`
          : 'Searched Knowledge (no matching items)',
        highlight: retrieved.length ? `reviewed ${plural(retrieved.length, 'knowledge item')}` : undefined,
      },
    )
  }

  // Repository (bundled demo repo, simulated)
  const repoFiles = has('repo.read') ? pickRepoFiles(DEMO_REPO.files, topic, rng) : []
  if (has('repo.read')) {
    const repo = db.find('repos', (r) => r.provider === 'demo')
    const repoName = repo?.fullName ?? `${DEMO_REPO.owner}/${DEMO_REPO.name}`
    push(
      {
        kind: 'read',
        title: repoFiles.length ? `Read ${plural(repoFiles.length, 'file')} in ${repoName}` : `Look for relevant code in ${repoName}`,
        detail: 'Bundled demo repository (simulated)',
        tool: 'repo',
        capability: 'repo.read',
        input: repoFiles.map((f) => f.path).join('\n') || undefined,
        output: repoFiles.length
          ? repoFiles.map((f) => `── ${f.path}\n${fileExcerpt(f)}`).join('\n\n')
          : 'No repository files are loaded in this workspace — skipped.',
        refs: repo ? [{ kind: 'repo', id: repo.id }] : [],
        approval: gate('repo.read', `Read files in ${repoName}`, { kind: 'text', label: `${repoName} (demo, simulated)`, content: repoFiles.map((f) => f.path).join('\n') || 'Look for relevant files' }),
        failChance: TOOL_FAIL_CHANCE,
        failMessage: 'Reading the repository timed out (simulated).',
        ...timing(rng),
      },
      repoFiles.length ? { did: `Read ${plural(repoFiles.length, 'file')} in the demo repository` } : undefined,
    )
  }

  // Web (simulated sources only)
  const web = has('web.search') ? simulatedWebResults(topic, rng, 5) : []
  if (has('web.search')) {
    const integrationId = via('web.search', 'web-search')
    push(
      {
        kind: 'search',
        title: `Search the web for “${topic.query}”`,
        detail: 'Simulated web search — results are fictional publications',
        tool: 'web.search',
        capability: 'web.search',
        integrationId,
        input: topic.query,
        output: formatWebResults(web),
        approval: gate('web.search', `Search the web for “${topic.query}”`, { kind: 'text', label: `${nameOf(integrationId)} (simulated)`, content: topic.query }),
        failChance: TOOL_FAIL_CHANCE,
        failMessage: 'The web search provider timed out (simulated).',
        ...timing(rng),
      },
      {
        did: `Collected ${web.length} web results from simulated sources (fictional publications — verify before use)`,
        highlight: `collected ${web.length} simulated web sources`,
      },
    )
    if (has('web.browse')) {
      const top = web.slice(0, 2)
      const browseVia = via('web.browse', 'web-search')
      push(
        {
          kind: 'browse',
          title: 'Read the top results',
          tool: 'web.browse',
          capability: 'web.browse',
          integrationId: browseVia,
          input: top.map((r) => r.url).join('\n'),
          output: browseNotes(top, topic, rng),
          approval: gate('web.browse', `Open ${plural(top.length, 'page')} from the results`, { kind: 'text', label: `${nameOf(browseVia)} (simulated)`, content: top.map((r) => r.url).join('\n') }),
          failChance: TOOL_FAIL_CHANCE,
          failMessage: 'A page failed to load (simulated).',
          ...timing(rng),
        },
        { did: `Read ${plural(top.length, 'simulated page')}` },
      )
    }
  }

  // Files
  if (has('files.read')) {
    const integrationId = via('files.read', 'google-drive')
    const files = simulatedFileListing(topic, rng)
    push(
      {
        kind: 'read',
        title: `Check files in ${nameOf(integrationId)}`,
        tool: integrationId,
        capability: 'files.read',
        integrationId,
        output: `Relevant files (simulated listing):\n${files.map((f) => `• ${f}`).join('\n')}`,
        approval: gate('files.read', `Look through files in ${nameOf(integrationId)}`, { kind: 'text', label: `${nameOf(integrationId)} (simulated)`, content: `Files about “${clipLine(topic.request, 80)}”` }),
        failChance: TOOL_FAIL_CHANCE,
        failMessage: `${nameOf(integrationId)} did not respond (simulated).`,
        ...timing(rng),
      },
      { did: `Looked through files in ${nameOf(integrationId)} (simulated)` },
    )
  }

  // Data
  if (has('data.query')) {
    const integrationId = via('data.query', 'postgres')
    const query = simulatedQuery(topic, rng)
    push(
      {
        kind: 'tool',
        title: `Query ${nameOf(integrationId)}`,
        detail: 'Read-only query · simulated result',
        tool: integrationId,
        capability: 'data.query',
        integrationId,
        input: query.sql,
        output: `${formatTable(query.columns, query.rows)}\n(${plural(query.rows.length, 'row')} · simulated result, not real data)`,
        approval: gate('data.query', `Run a read-only query on ${nameOf(integrationId)}`, { kind: 'command', label: `${nameOf(integrationId)} · read-only (simulated)`, content: query.sql }),
        failChance: TOOL_FAIL_CHANCE,
        failMessage: 'The query timed out (simulated).',
        ...timing(rng),
      },
      { did: `Ran a read-only query on ${nameOf(integrationId)} (simulated data)` },
    )
  }

  // Calendar (read-only)
  if (has('calendar.manage')) {
    const integrationId = via('calendar.manage', 'google-calendar')
    const slots = simulatedFreeSlots(rng)
    push(
      {
        kind: 'tool',
        title: 'Check calendar availability',
        tool: 'calendar',
        capability: 'calendar.manage',
        integrationId,
        output: `Open slots in the next working days (simulated calendar):\n${slots.map((s) => `• ${s}`).join('\n')}\nNo events were created or changed.`,
        approval: gate('calendar.manage', `Read availability in ${nameOf(integrationId)}`, {
          kind: 'text',
          label: `${nameOf(integrationId)} (simulated)`,
          content: 'Read free and busy times for the next three working days. No events are created or changed.',
        }),
        failChance: TOOL_FAIL_CHANCE,
        failMessage: 'The calendar provider did not respond (simulated).',
        ...timing(rng),
      },
      { did: 'Checked calendar availability (simulated; nothing was booked)' },
    )
  }

  // Code changes happen in coding sessions; agent runs only outline them.
  if (has('repo.write')) {
    const targets = repoFiles.map((f) => `\`${f.path}\``).join(', ') || 'the affected module'
    push(
      {
        kind: 'think',
        title: 'Outline the code change',
        output: [
          'Proposed approach (not applied):',
          `1. Reproduce “${clipLine(topic.request, 60)}” with a failing test.`,
          `2. Make the smallest change in ${targets}.`,
          '3. Run the test suite and check for regressions.',
          '4. Open a pull request for review.',
          'No files were modified in this run — start a coding session to make and review the change.',
        ].join('\n'),
        ...timing(rng),
      },
      { did: 'Outlined a code change (no files modified)' },
    )
  }

  if (has('media.generate')) {
    push(
      {
        kind: 'write',
        title: 'Draft a creative brief',
        output: [
          'Creative brief (draft):',
          `• Goal: ${topic.request}`,
          '• Audience: to confirm with the messaging docs',
          '• Formats: hero image, social cutdowns, short video storyboard',
          'Assets can be generated from this brief in Studio.',
        ].join('\n'),
        ...timing(rng),
      },
      { did: 'Drafted a creative brief for Studio' },
    )
  }

  const considerations = pickConsiderations(topic, rng)
  push({
    kind: 'think',
    title: 'Synthesize findings',
    output: [
      'Working notes (simulated reasoning):',
      `• Focus: ${topic.request} (${topic.subject})`,
      `• Context: ${retrieved.length ? retrieved.map((r) => r.item.title).join('; ') : 'no matching knowledge items'}`,
      web.length ? '• Web results are simulated leads to verify, not facts.' : undefined,
      'Considerations:',
      ...considerations.map((c, i) => `${i + 1}. ${c}`),
    ]
      .filter(Boolean)
      .join('\n'),
    ...timing(rng),
  })

  // Real side effects
  const noteTitle = `${agent.name} notes: ${clipLine(shortRequest, 60)}`
  if (has('knowledge.write')) {
    push(
      {
        kind: 'write',
        title: 'Save notes to Knowledge',
        tool: 'knowledge.write',
        capability: 'knowledge.write',
        output: `Saved “${noteTitle}” to Knowledge.`,
        approval: gate('knowledge.write', 'Save notes to Knowledge', { kind: 'text', label: 'New knowledge note', content: noteTitle }),
        ...timing(rng),
        onComplete: (ctx) => {
          const runRef: EntityRef = { kind: 'run', id: ctx.run.id }
          const existing = db.find('knowledge', (k) => k.source.type === 'agent' && sameRef(k.source.ref, runRef))
          const item =
            existing ??
            createKnowledge(
              {
                title: noteTitle,
                content: buildRunNote(ctx.run, ctx.step.id, { agent, instruction: params.instruction, retrieved, considerations, topic }),
                kind: 'note',
                source: { type: 'agent', ref: runRef },
                author: agentActor,
                projectIds: ctx.run.projectId ? [ctx.run.projectId] : [],
                tags: ['agent-notes', ...(topic.domain === 'general' ? [] : [topic.domain])],
                summary: `What ${agent.name} did for “${shortRequest}” and the knowledge it used.`,
                simulated: ctx.run.simulated,
              },
              { verb: 'saved' },
            )
          addOutputOnce(ctx, { kind: 'knowledge', id: item.id })
        },
      },
      { did: 'Saved notes to Knowledge', highlight: 'saved notes' },
    )
  }

  if (has('tasks.manage')) {
    const followTitle = task ? `Follow-ups from “${clipLine(task.title, 60)}”` : `Review ${agent.name}’s findings: ${clipLine(shortRequest, 50)}`
    push(
      {
        kind: 'tool',
        title: 'Create a follow-up task',
        tool: 'tasks',
        capability: 'tasks.manage',
        output: `Created “${followTitle}” and assigned it to you.`,
        approval: gate('tasks.manage', 'Create a follow-up task', { kind: 'text', label: 'New task, assigned to you', content: followTitle }),
        ...timing(rng),
        onComplete: (ctx) => {
          const runRef: EntityRef = { kind: 'run', id: ctx.run.id }
          const existing = db.find('tasks', (t) => sameRef(t.origin, runRef))
          const created =
            existing ??
            createTask({
              title: followTitle,
              description: [
                `${agent.name} finished a run for “${shortRequest}”.`,
                'Review the run’s steps and outputs, and treat anything marked simulated as unverified.',
              ].join('\n\n'),
              projectId: ctx.run.projectId,
              priority: 'medium',
              assignee: ME,
              origin: runRef,
              labels: ['follow-up'],
              subtasks: considerations.map((c) => `Check: ${c}`),
              actor: agentActor,
            })
          addOutputOnce(ctx, { kind: 'task', id: created.id })
        },
      },
      { did: 'Created a follow-up task for you', highlight: 'created a follow-up task' },
    )
  }

  // Message (approval-gated: messages are high risk)
  if (has('messages.send')) {
    const integrationId = via('messages.send', 'slack')
    const email = integrationId === 'gmail'
    const destination = email ? 'team@workspace.example' : channelFor(topic.domain)
    const draft = [
      `Update from ${agent.name}: finished “${shortRequest}”.`,
      'What was done, and what was simulated, is in the run log.',
      '(Drafted by an agent in a simulated run.)',
    ].join('\n')
    push(
      {
        kind: 'message',
        title: email ? `Email an update to ${destination}` : `Post update to ${destination}`,
        tool: email ? 'gmail' : 'slack',
        capability: 'messages.send',
        integrationId,
        input: draft,
        output: email
          ? `Sent to ${destination} (simulated — no email was sent).`
          : `Posted to ${destination} (simulated — no message was sent to a real workspace).`,
        approval: {
          title: email ? `Send email to ${destination}` : `Post update to ${destination}`,
          description: `${agent.name} wants to share a short update about this run.`,
          risk: 'high',
          preview: { kind: 'message', label: destination, content: draft },
          onReject: 'skip',
        },
        failChance: TOOL_FAIL_CHANCE,
        failMessage: email ? 'The mail provider rejected the request (simulated).' : 'Slack returned an error (simulated).',
        ...timing(rng),
      },
      {
        did: email ? `Emailed an update to ${destination} (simulated)` : `Posted an update to ${destination} (simulated)`,
        highlight: email ? 'emailed an update (simulated)' : `posted to ${destination} (simulated)`,
      },
    )
  }

  const PLAN_OFFSET = 1
  const nextStep = has('tasks.manage') ? 'review the follow-up task' : has('knowledge.write') ? 'review the notes in Knowledge' : 'review the steps above'

  /** What actually happened, read from the run's step log (plan step = index 0). */
  const report = (run: Run): { did: string[]; missed: string[]; highlights: string[] } => {
    const did: string[] = []
    const missed: string[] = []
    const highlights: string[] = []
    outcomes.forEach((outcome, i) => {
      const step: RunStep | undefined = run.steps[PLAN_OFFSET + i]
      const planned = work[i]
      if (!step) return
      if (step.status === 'done') {
        if (outcome) did.push(outcome.did)
        if (outcome?.highlight) highlights.push(outcome.highlight)
      } else if (step.status === 'skipped') {
        if (planned.capability) missed.push(`Skipped “${planned.title}” — you denied it`)
      } else if (step.status === 'failed') {
        missed.push(`Couldn’t ${planned.title.charAt(0).toLowerCase()}${planned.title.slice(1)}${step.error ? ` — ${step.error.replace(/\.$/, '')}` : ''}`)
      }
    })
    return { did, missed, highlights }
  }

  push({
    kind: 'message',
    title: 'Write summary',
    ...timing(rng),
    // Written from the step log when the step completes, so it never claims what didn’t happen.
    onComplete: (ctx) => {
      const { did, missed } = report(ctx.run)
      const output = [
        `${agent.name} — ${shortRequest}`,
        '',
        'What I did',
        ...(did.length ? did : ['Worked from the instruction alone (no tools were used)']).map((d) => `• ${d}`),
        ...(missed.length ? ['', 'Not done', ...missed.map((m) => `• ${m}`)] : []),
        '',
        'Considerations',
        ...considerations.map((c, i) => `${i + 1}. ${c}`),
        '',
        `Next: ${nextStep}.`,
      ].join('\n')
      updateStep(ctx.run.id, ctx.step.id, { output })
    },
  })

  /** Whether the live policy would ask or block right now (shown in the plan; the engine decides at run time). */
  const decisionNote = (s: StepPlan): string => {
    if (!s.approval || !s.capability) return ''
    try {
      const d = evaluatePermission({ capability: s.capability, risk: s.approval.risk, agentId: agent.id, integrationId: s.integrationId })
      return d.outcome === 'ask' ? ' (asks you first)' : d.outcome === 'deny' ? ` (blocked: ${d.reason})` : ''
    } catch {
      return ''
    }
  }

  const planStep: StepPlan = {
    kind: 'plan',
    title: 'Plan the approach',
    detail: `${plural(work.length, 'step')} for “${clipLine(topic.request, 60)}”${params.trigger ? ` · ${params.trigger}` : ''}`,
    output: work.map((s, i) => `${i + 1}. ${s.title}${decisionNote(s)}`).join('\n'),
    ...timing(rng),
    // Runs started by runAgent are already attached; retries started by the engine are not.
    onComplete: (ctx) => {
      if (params.taskId) attachRunToTask(params.taskId, ctx.run.id, agent.id)
    },
  }

  return {
    steps: [planStep, ...work],
    // Conservative until the end; the exact summary is written from the step log on success.
    summary: `${agent.name} finished “${shortRequest}”.`,
    onSuccess: (ctx) => {
      const { highlights, missed } = report(ctx.run)
      const summary = `${agent.name} finished “${shortRequest}”${highlights.length ? `: ${highlights.join(', ')}` : ''}.${
        missed.length ? ` ${plural(missed.length, 'step')} didn’t run.` : ''
      }`
      ctx.patchRun({ summary })
      if (!params.taskId || !isLatestRunOfTask(params.taskId, ctx.run)) return
      const current = db.get('tasks', params.taskId)
      if (!current || current.status === 'review' || current.status === 'done' || current.status === 'cancelled') return
      updateTask(current.id, { status: 'review' }, {
        actor: agentActor,
        verb: 'completed',
        summary: `${agent.name} finished “${current.title}” — ready for review`,
      })
    },
    onFailure: (ctx) => {
      if (!params.taskId || !isLatestRunOfTask(params.taskId, ctx.run)) return
      const current = db.get('tasks', params.taskId)
      if (!current || current.status !== 'in_progress') return
      updateTask(current.id, { status: 'todo' }, {
        actor: agentActor,
        verb: 'stopped',
        summary: `${agent.name} stopped working on “${current.title}” — moved back to To do`,
      })
    },
  }
}

export function registerAgentFactories(): void {
  registerRunFactory(AGENT_TASK_FACTORY, (params, rng) => buildAgentTaskPlan(parseAgentTaskParams(params), rng))
  // Agent schedules fire while Atrium is open (never in unit tests, never on the server).
  if (import.meta.env.MODE !== 'test' && typeof window !== 'undefined') startAgentScheduler()
}
