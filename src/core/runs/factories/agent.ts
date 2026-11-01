import { db } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { retrieveKnowledge, type RetrievedPassage } from '@/core/search'
import { DEMO_REPO } from '@/core/seed/demoRepo'
import { AGENT_TASK_FACTORY, attachRunToTask } from '@/core/services/agents'
import { createKnowledge } from '@/core/services/knowledge'
import { clipLine } from '@/core/services/serviceHelpers'
import { createTask, updateTask } from '@/core/services/tasks'
import {
  ME,
  sameRef,
  type ActorRef,
  type Agent,
  type Capability,
  type CapabilityGrant,
  type EntityRef,
  type ID,
  type Run,
  type StepStatus,
} from '@/core/types'
import type { Rng } from '@/lib/rng'
import { registerRunFactory } from '../registry'
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
 * plan → knowledge search (real retrieval) → capability-specific tool steps → synthesis →
 * real side effects (knowledge note, follow-up task) → approval-gated message → summary.
 */

export interface AgentTaskParams {
  agentId: ID
  instruction: string
  taskId?: ID
  projectId?: ID | null
}

export function parseAgentTaskParams(params: Record<string, unknown>): AgentTaskParams | null {
  const { agentId, instruction, taskId, projectId } = params
  if (typeof agentId !== 'string' || typeof instruction !== 'string' || !instruction.trim()) return null
  return {
    agentId,
    instruction,
    taskId: typeof taskId === 'string' ? taskId : undefined,
    projectId: typeof projectId === 'string' ? projectId : null,
  }
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
  const simulatedTools = run.steps.some((s) => s.capability === 'web.search' || s.capability === 'web.browse' || s.capability === 'data.query')
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
  const did: string[] = []

  // Knowledge (real retrieval)
  let retrieved: RetrievedPassage[] = []
  if (has('knowledge.read')) {
    retrieved = retrieveScoped(agent, topic.request, params.projectId)
    work.push({
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
      ...timing(rng),
    })
    did.push(
      retrieved.length
        ? `Reviewed ${plural(retrieved.length, 'knowledge item')}: ${retrieved.map((r) => r.item.title).join('; ')}`
        : 'Searched Knowledge (no matching items)',
    )
  }

  // Repository (bundled demo repo, simulated)
  const repoFiles = has('repo.read') ? pickRepoFiles(DEMO_REPO.files, topic, rng) : []
  if (has('repo.read')) {
    const repo = db.find('repos', (r) => r.provider === 'demo')
    const repoName = repo?.fullName ?? `${DEMO_REPO.owner}/${DEMO_REPO.name}`
    work.push({
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
      failChance: TOOL_FAIL_CHANCE,
      failMessage: 'Reading the repository timed out (simulated).',
      ...timing(rng),
    })
    if (repoFiles.length) did.push(`Read ${plural(repoFiles.length, 'file')} in the demo repository`)
  }

  // Web (simulated sources only)
  const web = has('web.search') ? simulatedWebResults(topic, rng, 5) : []
  if (has('web.search')) {
    work.push({
      kind: 'search',
      title: `Search the web for “${topic.query}”`,
      detail: 'Simulated web search — results are fictional publications',
      tool: 'web.search',
      capability: 'web.search',
      integrationId: via('web.search', 'web-search'),
      input: topic.query,
      output: formatWebResults(web),
      failChance: TOOL_FAIL_CHANCE,
      failMessage: 'The web search provider timed out (simulated).',
      ...timing(rng),
    })
    if (has('web.browse')) {
      const top = web.slice(0, 2)
      work.push({
        kind: 'browse',
        title: 'Read the top results',
        tool: 'web.browse',
        capability: 'web.browse',
        integrationId: via('web.browse', 'web-search'),
        input: top.map((r) => r.url).join('\n'),
        output: browseNotes(top, topic, rng),
        failChance: TOOL_FAIL_CHANCE,
        failMessage: 'A page failed to load (simulated).',
        ...timing(rng),
      })
    }
    did.push(`Collected ${web.length} web results from simulated sources (fictional publications — verify before use)`)
  }

  // Files
  if (has('files.read')) {
    const integrationId = via('files.read', 'google-drive')
    const files = simulatedFileListing(topic, rng)
    work.push({
      kind: 'read',
      title: `Check files in ${nameOf(integrationId)}`,
      tool: integrationId,
      capability: 'files.read',
      integrationId,
      output: `Relevant files (simulated listing):\n${files.map((f) => `• ${f}`).join('\n')}`,
      failChance: TOOL_FAIL_CHANCE,
      failMessage: `${nameOf(integrationId)} did not respond (simulated).`,
      ...timing(rng),
    })
    did.push(`Looked through files in ${nameOf(integrationId)} (simulated)`)
  }

  // Data
  if (has('data.query')) {
    const integrationId = via('data.query', 'postgres')
    const query = simulatedQuery(topic, rng)
    work.push({
      kind: 'tool',
      title: `Query ${nameOf(integrationId)}`,
      detail: 'Read-only query · simulated result',
      tool: integrationId,
      capability: 'data.query',
      integrationId,
      input: query.sql,
      output: `${formatTable(query.columns, query.rows)}\n(${plural(query.rows.length, 'row')} · simulated result, not real data)`,
      failChance: TOOL_FAIL_CHANCE,
      failMessage: 'The query timed out (simulated).',
      ...timing(rng),
    })
    did.push(`Ran a read-only query on ${nameOf(integrationId)} (simulated data)`)
  }

  // Calendar (read-only)
  if (has('calendar.manage')) {
    const integrationId = via('calendar.manage', 'google-calendar')
    const slots = simulatedFreeSlots(rng)
    work.push({
      kind: 'tool',
      title: 'Check calendar availability',
      tool: 'calendar',
      capability: 'calendar.manage',
      integrationId,
      output: `Open slots in the next working days (simulated calendar):\n${slots.map((s) => `• ${s}`).join('\n')}\nNo events were created or changed.`,
      failChance: TOOL_FAIL_CHANCE,
      failMessage: 'The calendar provider did not respond (simulated).',
      ...timing(rng),
    })
    did.push('Checked calendar availability (simulated; nothing was booked)')
  }

  // Code changes happen in coding sessions; agent runs only outline them.
  if (has('repo.write')) {
    const targets = repoFiles.map((f) => `\`${f.path}\``).join(', ') || 'the affected module'
    work.push({
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
    })
    did.push('Outlined a code change (no files modified)')
  }

  if (has('media.generate')) {
    work.push({
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
    })
    did.push('Drafted a creative brief for Studio')
  }

  const considerations = pickConsiderations(topic, rng)
  work.push({
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
    work.push({
      kind: 'write',
      title: 'Save notes to Knowledge',
      tool: 'knowledge.write',
      capability: 'knowledge.write',
      output: `Saved “${noteTitle}” to Knowledge.`,
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
    })
    did.push('Saved notes to Knowledge')
  }

  if (has('tasks.manage')) {
    const followTitle = task ? `Follow-ups from “${clipLine(task.title, 60)}”` : `Review ${agent.name}’s findings: ${clipLine(shortRequest, 50)}`
    work.push({
      kind: 'tool',
      title: 'Create a follow-up task',
      tool: 'tasks',
      capability: 'tasks.manage',
      output: `Created “${followTitle}” and assigned it to you.`,
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
    })
    did.push('Created a follow-up task for you')
  }

  // Approval-gated message
  if (has('messages.send')) {
    const integrationId = via('messages.send', 'slack')
    const email = integrationId === 'gmail'
    const destination = email ? 'team@workspace.example' : channelFor(topic.domain)
    const draft = [
      `Update from ${agent.name}: finished “${shortRequest}”.`,
      ...did.slice(0, 3).map((d) => `• ${d}`),
      'Details are in the run log. (Drafted by an agent — simulated.)',
    ].join('\n')
    work.push({
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
    })
    did.push(`Drafted an update for ${destination} (sent only if approved)`)
  }

  const nextStep = has('tasks.manage') ? 'review the follow-up task' : has('knowledge.write') ? 'review the notes in Knowledge' : 'review the steps above'
  work.push({
    kind: 'message',
    title: 'Write summary',
    output: [
      `${agent.name} — ${shortRequest}`,
      '',
      'What I did',
      ...(did.length ? did : ['Worked from the instruction alone (no tools granted)']).map((d) => `• ${d}`),
      '',
      'Considerations',
      ...considerations.map((c, i) => `${i + 1}. ${c}`),
      '',
      `Next: ${nextStep}.`,
    ].join('\n'),
    ...timing(rng),
  })

  const planStep: StepPlan = {
    kind: 'plan',
    title: 'Plan the approach',
    detail: `${plural(work.length, 'step')} for “${clipLine(topic.request, 60)}”`,
    output: work.map((s, i) => `${i + 1}. ${s.title}${s.approval ? ' (needs approval)' : ''}`).join('\n'),
    ...timing(rng),
    // Runs started by runAgent are already attached; retries started by the engine are not.
    onComplete: (ctx) => {
      if (params.taskId) attachRunToTask(params.taskId, ctx.run.id, agent.id)
    },
  }

  const highlights = [
    retrieved.length ? `reviewed ${plural(retrieved.length, 'knowledge item')}` : undefined,
    web.length ? `collected ${web.length} simulated web sources` : undefined,
    has('knowledge.write') ? 'saved notes' : undefined,
    has('tasks.manage') ? 'created a follow-up task' : undefined,
  ].filter(Boolean)

  return {
    steps: [planStep, ...work],
    summary: `${agent.name} finished “${shortRequest}”${highlights.length ? `: ${highlights.join(', ')}` : ''}.`,
    onSuccess: (ctx) => {
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
}
