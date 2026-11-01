import { db } from '@/core/db'
import { getContext } from '@/core/context'
import {
  ME,
  type ActorRef,
  type AssetKind,
  type EntityRef,
  type ID,
  type KnowledgeKind,
  type Priority,
  type ResearchDepth,
} from '@/core/types'
import { logActivity } from './activity'
import { runAgent } from './agents'
import { createSession } from './code'
import { describeRef, entityRoute, resolveEntity } from './entities'
import { deriveSourceContent, sourceMarkdown } from './handoffContent'
import { createKnowledge } from './knowledge'
import { createInvestigation } from './research'
import { markDerived, plainText } from './serviceHelpers'
import { generateAsset } from './studio'
import { createTask } from './tasks'
import { runWorkflow } from './workflows'

/**
 * Cross-workspace handoffs: turn any entity into a task, note, investigation, agent run,
 * coding session, studio asset or workflow run. Every handoff records the origin, links
 * target —derived_from→ source, adds the target to `message.derived` for message sources,
 * logs activity and returns where to navigate.
 */
export interface HandoffResult {
  ref: EntityRef
  route: string
}

const done = (ref: EntityRef): HandoffResult => ({ ref, route: entityRoute(ref) })

/** Handoffs need a live source: never create work linked to something that was deleted. */
function requireSource(source: EntityRef): void {
  if (!resolveEntity(source).exists) throw new Error('The item you started from no longer exists.')
}

/** Explicit project › the source's project › the active scope › none. */
function projectFor(source: EntityRef, explicit: ID | null | undefined): ID | null {
  if (explicit !== undefined) return explicit
  if (source.kind === 'project') return db.get('projects', source.id) ? source.id : null
  return resolveEntity(source).projectId ?? getContext().scopeProjectId ?? null
}

function logHandoff(target: EntityRef, source: EntityRef, what: string, projectId: ID | null): void {
  logActivity({
    actor: ME,
    verb: 'handed_off',
    target,
    summary: `${what} from ${describeRef(source)}`,
    projectId,
    meta: { from: { kind: source.kind, id: source.id } },
  })
}

/** Plain text of any entity, used to prefill handoff dialogs. */
export function describeSource(source: EntityRef): { title: string; text: string } {
  const content = deriveSourceContent(source)
  return { title: content.title, text: plainText(content.body) }
}

export interface ToTaskInput {
  title: string
  description?: string
  projectId?: ID | null
  assignee?: ActorRef | null
  priority?: Priority
  dueAt?: number
}

export function toTask(source: EntityRef, input: ToTaskInput): HandoffResult {
  requireSource(source)
  // createTask links the origin, records message.derived and logs “Created task … from …”.
  const task = createTask({
    title: input.title,
    description: input.description,
    projectId: projectFor(source, input.projectId),
    assignee: input.assignee,
    priority: input.priority,
    dueAt: input.dueAt,
    origin: source,
  })
  return done({ kind: 'task', id: task.id })
}

export interface ToKnowledgeInput {
  title?: string
  /** Defaults to the source's own content (message text, report, asset copy, run summary + steps…). */
  content?: string
  kind?: KnowledgeKind
  collectionId?: ID | null
  projectId?: ID | null
  tags?: string[]
}

export function toKnowledge(source: EntityRef, input: ToKnowledgeInput = {}): HandoffResult {
  requireSource(source)
  const derived = deriveSourceContent(source)
  const projectId = projectFor(source, input.projectId)
  const item = createKnowledge(
    {
      title: input.title?.trim() || derived.title,
      content: input.content ?? sourceMarkdown(derived),
      kind: input.kind ?? derived.kind,
      collectionId: input.collectionId ?? null,
      projectIds: projectId ? [projectId] : [],
      tags: input.tags,
      source: { type: derived.sourceType, ref: source, url: derived.url, integrationId: derived.integrationId },
      // Anything derived from simulated output stays labeled, even when the text was edited.
      simulated: derived.simulated,
    },
    { verb: 'saved' },
  )
  if (source.kind === 'investigation') db.update('investigations', source.id, (i) => (i.knowledgeId ? i : { ...i, knowledgeId: item.id }))
  if (source.kind === 'source') db.update('sources', source.id, (s) => (s.knowledgeId ? s : { ...s, knowledgeId: item.id }))
  return done({ kind: 'knowledge', id: item.id })
}

export interface ToInvestigationInput {
  question: string
  projectId?: ID | null
  depth?: ResearchDepth
  title?: string
  angles?: string[]
}

export function toInvestigation(source: EntityRef, input: ToInvestigationInput): HandoffResult {
  requireSource(source)
  const projectId = projectFor(source, input.projectId)
  const inv = createInvestigation({
    question: input.question,
    title: input.title,
    projectId,
    depth: input.depth,
    angles: input.angles,
    origin: source,
  })
  const ref: EntityRef = { kind: 'investigation', id: inv.id }
  markDerived(ref, source)
  logHandoff(ref, source, `Started research “${inv.title}”`, projectId)
  return done(ref)
}

export interface ToAgentInput {
  agentId: ID
  instruction: string
  projectId?: ID | null
}

export function toAgent(source: EntityRef, input: ToAgentInput): HandoffResult {
  requireSource(source)
  const projectId = projectFor(source, input.projectId)
  // runAgent links the run to its origin (and attaches it when the source is a task).
  const run = runAgent(input.agentId, {
    instruction: input.instruction,
    projectId,
    taskId: source.kind === 'task' ? source.id : undefined,
    origin: source,
  })
  const ref: EntityRef = { kind: 'run', id: run.id }
  markDerived(ref, source)
  const agentName = db.get('agents', input.agentId)?.name ?? 'an agent'
  logHandoff(ref, source, `Asked ${agentName} to “${run.title}”`, projectId)
  return done(ref)
}

export interface ToCodeSessionInput {
  repoId: ID
  prompt: string
  projectId?: ID | null
  title?: string
}

export function toCodeSession(source: EntityRef, input: ToCodeSessionInput): HandoffResult {
  requireSource(source)
  const projectId = projectFor(source, input.projectId)
  const session = createSession({
    repoId: input.repoId,
    prompt: input.prompt,
    title: input.title,
    projectId,
    taskId: source.kind === 'task' ? source.id : undefined,
    origin: source,
  })
  const ref: EntityRef = { kind: 'session', id: session.id }
  markDerived(ref, source)
  logHandoff(ref, source, `Started coding session “${session.title}”`, projectId)
  return done(ref)
}

export interface ToStudioInput {
  kind: AssetKind
  prompt: string
  projectId?: ID | null
  title?: string
  boardId?: ID | null
}

export function toStudio(source: EntityRef, input: ToStudioInput): HandoffResult {
  requireSource(source)
  const projectId = projectFor(source, input.projectId)
  const asset = generateAsset({
    kind: input.kind,
    prompt: input.prompt,
    title: input.title,
    projectId,
    boardId: input.boardId,
    origin: source,
  })
  const ref: EntityRef = { kind: 'asset', id: asset.id }
  markDerived(ref, source)
  logHandoff(ref, source, `Started generating “${asset.title}”`, projectId)
  return done(ref)
}

export interface ToWorkflowRunInput {
  workflowId: ID
}

export function toWorkflowRun(source: EntityRef, input: ToWorkflowRunInput): HandoffResult {
  requireSource(source)
  const run = runWorkflow(input.workflowId, { trigger: 'manual', origin: source })
  const ref: EntityRef = { kind: 'run', id: run.id }
  markDerived(ref, source)
  const name = db.get('workflows', input.workflowId)?.name ?? run.title
  logHandoff(ref, source, `Ran workflow “${name}”`, run.projectId)
  return done(ref)
}
