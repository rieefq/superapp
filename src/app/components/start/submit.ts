import type { StartKind } from '@/app/shell/store'
import { db, useDB } from '@/core/db'
import { runEngine } from '@/core/runs'
import {
  createInvestigation,
  createKnowledge,
  createSession,
  createTask,
  entityRoute,
  generateAsset,
  runAgent,
  runWorkflow,
  toAgent,
  toCodeSession,
  toInvestigation,
  toKnowledge,
  toStudio,
  toTask,
  toWorkflowRun,
  updateTask,
} from '@/core/services'
import type { ActorRef, Autonomy, EntityRef, ID, Priority, ResearchDepth } from '@/core/types'
import { isRunActive } from '@/core/types'
import { createEmitter } from '@/lib/emitter'
import type { StudioKind } from './kinds'

/** Fired after the Start sheet starts or creates something (hosts that handed it a draft can clear theirs). */
export const startEvents = createEmitter<{ started: StartResult & { background: boolean } }>()

/**
 * What the Start sheet submits, and the one function that starts it through the core services —
 * through the handoff functions when there is a source, so origins, derived_from links, message
 * backlinks and activity are recorded (§7.1).
 */
export interface StartForm {
  kind: StartKind
  title: string
  brief: string
  projectId: ID | null
  // research
  depth: ResearchDepth
  angles: string[]
  // coding session
  repoId: ID | null
  linkedTaskId: ID | null
  autonomy: Autonomy
  // agent (also the coding agent)
  agentId: ID | null
  // workflow
  workflowId: ID | null
  // task
  assignee: 'me' | ID
  priority: Priority
  /** yyyy-mm-dd (local) or '' */
  due: string
  milestoneId: ID | null
  // note
  collectionId: ID | null
  tags: string[]
  // studio
  studioKind: StudioKind
  boardId: ID | null
  /** Optional per-run cap (USD); the run is stopped when its estimated cost reaches it. */
  capUsd: number | null
}

export interface StartResult {
  ref: EntityRef
  route: string
  /** The run that was started, when the work runs. */
  runId?: ID
}

/** Local end-of-day for a yyyy-mm-dd date input. */
export function dueFromInput(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 17, 0, 0).getTime()
}

const assigneeOf = (a: StartForm['assignee']): ActorRef | null => (a === 'me' ? { type: 'user', id: 'usr_me' } : { type: 'agent', id: a })

/** Validation message for the form, or null when it can be submitted. */
export function validateStart(form: StartForm, opts: { run: boolean }): string | null {
  const brief = form.brief.trim()
  switch (form.kind) {
    case 'task':
      return form.title.trim() ? null : 'Give the task a title.'
    case 'research':
      return brief ? null : 'Ask a question to research.'
    case 'session':
      if (!form.repoId) return 'Choose a repository.'
      return brief ? null : 'Describe the change you want.'
    case 'agent':
      if (!form.agentId) return 'Choose an agent.'
      return brief ? null : 'Tell the agent what to do.'
    case 'workflow':
      return form.workflowId ? null : 'Choose a workflow to run.'
    case 'note':
      return form.title.trim() || brief ? null : 'Write something to save.'
    case 'studio':
      return brief ? null : 'Describe what to make.'
  }
  void opts
  return null
}

/**
 * Start (or create) the work. `run: false` = "Create without running" (an investigation draft, or a
 * task that is not yet handed to its agent). Throws the services' friendly errors.
 */
export function startWork(form: StartForm, source: EntityRef | undefined, opts: { run: boolean } = { run: true }): StartResult {
  const title = form.title.trim() || undefined
  const brief = form.brief.trim()
  const projectId = form.projectId

  switch (form.kind) {
    case 'research': {
      const depth = form.depth
      const angles = form.angles.length ? form.angles : undefined
      if (source && opts.run) {
        const r = toInvestigation(source, { question: brief, title, projectId, depth, angles })
        return { ...r, runId: latestRun(db.get('investigations', r.ref.id)?.runIds) }
      }
      const inv = createInvestigation({ question: brief, title, projectId, depth, angles, origin: source, start: opts.run })
      const ref: EntityRef = { kind: 'investigation', id: inv.id }
      return { ref, route: entityRoute(ref), runId: opts.run ? latestRun(inv.runIds) : undefined }
    }
    case 'session': {
      const repoId = form.repoId as ID
      let ref: EntityRef
      if (source) {
        ref = toCodeSession(source, { repoId, prompt: brief, projectId, title }).ref
      } else {
        const session = createSession({
          repoId,
          prompt: brief,
          title,
          projectId,
          taskId: form.linkedTaskId ?? undefined,
          agentId: form.agentId ?? undefined,
        })
        ref = { kind: 'session', id: session.id }
      }
      applySessionPolicy(ref.id, form.autonomy)
      const session = db.get('sessions', ref.id)
      return { ref, route: entityRoute(ref), runId: session?.turns[session.turns.length - 1]?.runId }
    }
    case 'agent': {
      const agentId = form.agentId as ID
      if (source) {
        const r = toAgent(source, { agentId, instruction: brief, projectId })
        return { ...r, runId: r.ref.id }
      }
      const run = runAgent(agentId, { instruction: brief, projectId })
      const ref: EntityRef = { kind: 'run', id: run.id }
      return { ref, route: entityRoute(ref), runId: run.id }
    }
    case 'workflow': {
      const workflowId = form.workflowId as ID
      if (source) {
        const r = toWorkflowRun(source, { workflowId })
        return { ...r, runId: r.ref.id }
      }
      const run = runWorkflow(workflowId, { trigger: 'Started by you' })
      const ref: EntityRef = { kind: 'run', id: run.id }
      return { ref, route: entityRoute(ref), runId: run.id }
    }
    case 'studio': {
      const input = { kind: form.studioKind, prompt: brief, title, projectId, boardId: form.boardId }
      if (source) {
        const r = toStudio(source, input)
        return { ...r, runId: db.get('assets', r.ref.id)?.runId }
      }
      const asset = generateAsset(input)
      const ref: EntityRef = { kind: 'asset', id: asset.id }
      return { ref, route: entityRoute(ref), runId: asset.runId }
    }
    case 'task': {
      // "Create without running" keeps the agent's work for later: the task is filed unassigned.
      const assignee = opts.run ? assigneeOf(form.assignee) : form.assignee === 'me' ? assigneeOf('me') : null
      const dueAt = dueFromInput(form.due)
      const taskTitle = title ?? brief.split('\n')[0]?.slice(0, 80) ?? 'Untitled task'
      let id: ID
      if (source) {
        id = toTask(source, { title: taskTitle, description: brief || undefined, projectId, assignee, priority: form.priority, dueAt }).ref.id
        if (form.milestoneId) updateTask(id, { milestoneId: form.milestoneId })
      } else {
        id = createTask({ title: taskTitle, description: brief || undefined, projectId, assignee, priority: form.priority, dueAt, milestoneId: form.milestoneId ?? undefined }).id
      }
      const ref: EntityRef = { kind: 'task', id }
      const task = db.get('tasks', id)
      const runId = assignee?.type === 'agent' ? latestRun(task?.runIds) : undefined
      return { ref, route: entityRoute(ref), runId }
    }
    case 'note': {
      if (source) {
        const r = toKnowledge(source, {
          title,
          content: brief || undefined,
          kind: 'note',
          collectionId: form.collectionId,
          projectId,
          tags: form.tags,
        })
        return r
      }
      const item = createKnowledge({
        kind: 'note',
        title: title ?? brief.split('\n')[0]?.slice(0, 80) ?? 'Untitled note',
        content: brief,
        collectionId: form.collectionId,
        projectIds: projectId ? [projectId] : [],
        tags: form.tags,
        source: { type: 'manual' },
      })
      const ref: EntityRef = { kind: 'knowledge', id: item.id }
      return { ref, route: entityRoute(ref) }
    }
  }
}

function latestRun(ids: readonly ID[] | undefined): ID | undefined {
  return ids?.length ? ids[ids.length - 1] : undefined
}

/**
 * The session's approval policy (CodeSession.autonomy). createSession has no autonomy input yet, so the
 * policy is written right after creation — before the first gated step evaluates permissions.
 */
function applySessionPolicy(sessionId: ID, autonomy: Autonomy): void {
  db.update('sessions', sessionId, (s) => (s.autonomy === autonomy ? s : { ...s, autonomy }))
}

// ------------------------------------------------------------------------------------------------ per-run cap

const caps = new Map<ID, () => void>()

/**
 * Stop a run when its estimated cost reaches `capUsd` (the Start sheet's optional budget cap). Watches
 * the run while Atrium is open; the subscription ends with the run.
 */
export function capRun(runId: ID, capUsd: number): void {
  if (!(capUsd > 0)) return
  caps.get(runId)?.()
  const check = () => {
    const run = db.get('runs', runId)
    if (!run || !isRunActive(run.status)) {
      stop()
      return
    }
    if (run.usage.costUsd >= capUsd) {
      stop()
      runEngine.cancel(runId, `Stopped: reached the $${capUsd.toFixed(2)} budget cap for this run (est.)`)
    }
  }
  const unsubscribe = useDB.subscribe((s, prev) => {
    if (s.runs[runId] !== prev.runs[runId]) check()
  })
  const stop = () => {
    unsubscribe()
    caps.delete(runId)
  }
  caps.set(runId, stop)
  check()
}
