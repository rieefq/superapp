import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useDB, type Tables } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import {
  HUES,
  type AssetKind,
  type EntityKind,
  type EntityRef,
  type Hue,
  type ID,
  type KnowledgeKind,
  type Run,
  type RunKind,
  type SourceKind,
  type TaskStatus,
} from '@/core/types'
import { clipLine, memoOnTable, plainText } from './serviceHelpers'

export type WorkspaceKey =
  | 'home' | 'chat' | 'research' | 'code' | 'studio' | 'agents' | 'workflows'
  | 'projects' | 'knowledge' | 'insights' | 'integrations' | 'settings'

export interface EntityMeta {
  label: string
  plural: string
  /** lucide-react icon name */
  icon: string
  workspace: WorkspaceKey
}

export const KIND_META: Record<EntityKind, EntityMeta> = {
  project: { label: 'Project', plural: 'Projects', icon: 'FolderKanban', workspace: 'projects' },
  task: { label: 'Task', plural: 'Tasks', icon: 'SquareCheckBig', workspace: 'projects' },
  thread: { label: 'Conversation', plural: 'Conversations', icon: 'MessagesSquare', workspace: 'chat' },
  message: { label: 'Message', plural: 'Messages', icon: 'MessageSquareText', workspace: 'chat' },
  run: { label: 'Run', plural: 'Runs', icon: 'Activity', workspace: 'agents' },
  approval: { label: 'Approval', plural: 'Approvals', icon: 'ShieldCheck', workspace: 'agents' },
  agent: { label: 'Agent', plural: 'Agents', icon: 'Bot', workspace: 'agents' },
  workflow: { label: 'Workflow', plural: 'Workflows', icon: 'Workflow', workspace: 'workflows' },
  knowledge: { label: 'Knowledge', plural: 'Knowledge', icon: 'BookOpen', workspace: 'knowledge' },
  collection: { label: 'Collection', plural: 'Collections', icon: 'Library', workspace: 'knowledge' },
  investigation: { label: 'Investigation', plural: 'Investigations', icon: 'Telescope', workspace: 'research' },
  source: { label: 'Source', plural: 'Sources', icon: 'Globe', workspace: 'research' },
  repo: { label: 'Repository', plural: 'Repositories', icon: 'FolderGit2', workspace: 'code' },
  session: { label: 'Coding session', plural: 'Coding sessions', icon: 'SquareTerminal', workspace: 'code' },
  asset: { label: 'Asset', plural: 'Assets', icon: 'Palette', workspace: 'studio' },
  board: { label: 'Board', plural: 'Boards', icon: 'LayoutGrid', workspace: 'studio' },
  integration: { label: 'Integration', plural: 'Integrations', icon: 'Plug', workspace: 'integrations' },
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
}

export const RUN_KIND_LABEL: Record<RunKind, string> = {
  chat: 'Chat',
  code: 'Coding',
  agent: 'Agent',
  research: 'Research',
  workflow: 'Workflow',
  studio: 'Studio',
}

export const KNOWLEDGE_KIND_META: Record<KnowledgeKind, { label: string; icon: string }> = {
  note: { label: 'Note', icon: 'StickyNote' },
  doc: { label: 'Document', icon: 'FileText' },
  file: { label: 'File', icon: 'File' },
  link: { label: 'Link', icon: 'Link' },
  report: { label: 'Report', icon: 'FileChartColumn' },
  snippet: { label: 'Snippet', icon: 'CodeXml' },
  transcript: { label: 'Transcript', icon: 'AudioLines' },
  dataset: { label: 'Dataset', icon: 'Sheet' },
}

const RUN_KIND_ICON: Record<RunKind, string> = {
  chat: 'MessagesSquare',
  code: 'SquareTerminal',
  agent: 'Bot',
  research: 'Telescope',
  workflow: 'Workflow',
  studio: 'Sparkles',
}

const ASSET_KIND_META: Record<AssetKind, { label: string; icon: string }> = {
  image: { label: 'Image', icon: 'Image' },
  video: { label: 'Video', icon: 'Clapperboard' },
  presentation: { label: 'Presentation', icon: 'Presentation' },
  document: { label: 'Document', icon: 'FileText' },
  audio: { label: 'Audio', icon: 'AudioLines' },
}

const SOURCE_KIND_ICON: Record<SourceKind, string> = {
  web: 'Globe',
  paper: 'FileText',
  doc: 'FileText',
  dataset: 'Sheet',
  video: 'Clapperboard',
  knowledge: 'BookOpen',
}

export interface ResolvedEntity {
  ref: EntityRef
  title: string
  subtitle?: string
  icon: string
  hue?: Hue
  status?: string
  route: string
  updatedAt?: number
  projectId?: ID | null
  exists: boolean
  simulated?: boolean
}

const enc = encodeURIComponent

// ---------------------------------------------------------------- reverse indexes (memoized per table version)

function runIndex<T>(table: Record<ID, T>, collect: (row: T, add: (runId: ID) => void) => void): Map<ID, T> {
  return memoOnTable(table, 'runIndex', () => {
    const index = new Map<ID, T>()
    for (const row of Object.values(table)) collect(row, (runId) => index.set(runId, row))
    return index
  })
}

function sessionForRun(s: Tables, run: Run) {
  const hit = runIndex(s.sessions, (ses, add) => ses.turns.forEach((t) => t.runId && add(t.runId))).get(run.id)
  return hit ?? (run.origin?.kind === 'session' ? s.sessions[run.origin.id] : undefined)
}

function investigationForRun(s: Tables, run: Run) {
  const hit = runIndex(s.investigations, (inv, add) => inv.runIds.forEach(add)).get(run.id)
  return hit ?? (run.origin?.kind === 'investigation' ? s.investigations[run.origin.id] : undefined)
}

function assetForRun(s: Tables, run: Run) {
  const hit = runIndex(s.assets, (asset, add) => asset.runId && add(asset.runId)).get(run.id)
  return hit ?? (run.origin?.kind === 'asset' ? s.assets[run.origin.id] : undefined)
}

function chatRouteForRun(s: Tables, run: Run): string | undefined {
  const msg = runIndex(s.messages, (m, add) => m.runId && add(m.runId)).get(run.id)
  if (msg) return `/chat/${enc(msg.threadId)}?m=${enc(msg.id)}`
  const origin = run.origin
  if (origin?.kind === 'message') {
    const m = s.messages[origin.id]
    if (m) return `/chat/${enc(m.threadId)}?m=${enc(m.id)}`
  }
  if (origin?.kind === 'thread' && s.threads[origin.id]) return `/chat/${enc(origin.id)}`
  return undefined
}

function runRoute(s: Tables, run: Run): string {
  switch (run.kind) {
    case 'code': {
      const ses = sessionForRun(s, run)
      if (ses) return `/code/${enc(ses.id)}?run=${enc(run.id)}`
      break
    }
    case 'research': {
      const inv = investigationForRun(s, run)
      if (inv) return `/research/${enc(inv.id)}`
      break
    }
    case 'workflow': {
      const workflowId = run.workflowId ?? (run.origin?.kind === 'workflow' ? run.origin.id : undefined)
      if (workflowId && s.workflows[workflowId]) return `/workflows/${enc(workflowId)}?run=${enc(run.id)}`
      break
    }
    case 'studio': {
      const asset = assetForRun(s, run)
      if (asset) return `/studio/${enc(asset.id)}`
      break
    }
    case 'agent':
      if (run.agentId && s.agents[run.agentId]) return `/agents/${enc(run.agentId)}?run=${enc(run.id)}`
      break
    case 'chat': {
      const route = chatRouteForRun(s, run)
      if (route) return route
      break
    }
  }
  return `/agents/runs/${enc(run.id)}`
}

/** Route for an entity, resolved against a given database snapshot. Missing entities route to '/'. */
export function routeIn(s: Tables, ref: EntityRef): string {
  const { id } = ref
  switch (ref.kind) {
    case 'project':
      return s.projects[id] ? `/projects/${enc(id)}` : '/'
    case 'task': {
      const task = s.tasks[id]
      if (!task) return '/'
      return task.projectId && s.projects[task.projectId]
        ? `/projects/${enc(task.projectId)}?task=${enc(id)}`
        : `/projects/my-tasks?task=${enc(id)}`
    }
    case 'thread':
      return s.threads[id] ? `/chat/${enc(id)}` : '/'
    case 'message': {
      const msg = s.messages[id]
      return msg ? `/chat/${enc(msg.threadId)}?m=${enc(id)}` : '/'
    }
    case 'run': {
      const run = s.runs[id]
      return run ? runRoute(s, run) : '/'
    }
    case 'approval': {
      const approval = s.approvals[id]
      const run = approval ? s.runs[approval.runId] : undefined
      return run ? runRoute(s, run) : '/'
    }
    case 'agent':
      return s.agents[id] ? `/agents/${enc(id)}` : '/'
    case 'workflow':
      return s.workflows[id] ? `/workflows/${enc(id)}` : '/'
    case 'knowledge':
      return s.knowledge[id] ? `/knowledge/${enc(id)}` : '/'
    case 'collection':
      return s.collections[id] ? `/knowledge?collection=${enc(id)}` : '/'
    case 'investigation':
      return s.investigations[id] ? `/research/${enc(id)}` : '/'
    case 'source': {
      const src = s.sources[id]
      if (!src) return '/'
      if (src.investigationId && s.investigations[src.investigationId]) {
        return `/research/${enc(src.investigationId)}?source=${enc(id)}`
      }
      if (src.knowledgeId && s.knowledge[src.knowledgeId]) return `/knowledge/${enc(src.knowledgeId)}`
      return '/research'
    }
    case 'repo':
      return s.repos[id] ? `/code/repos/${enc(id)}` : '/'
    case 'session':
      return s.sessions[id] ? `/code/${enc(id)}` : '/'
    case 'asset':
      return s.assets[id] ? `/studio/${enc(id)}` : '/'
    case 'board':
      return s.boards[id] ? `/studio?board=${enc(id)}` : '/'
    case 'integration':
      return getIntegration(id) ? `/integrations/${enc(id)}` : '/'
  }
}

// ---------------------------------------------------------------- resolution

type Resolved = Omit<ResolvedEntity, 'ref' | 'route' | 'exists'>

const asHue = (value: string | undefined): Hue | undefined =>
  value && (HUES as readonly string[]).includes(value) ? (value as Hue) : undefined

function resolveFields(s: Tables, ref: EntityRef): Resolved | undefined {
  const { id } = ref
  const projectName = (projectId: ID | null | undefined) => (projectId ? s.projects[projectId]?.name : undefined)
  switch (ref.kind) {
    case 'project': {
      const p = s.projects[id]
      if (!p) return undefined
      return {
        title: p.name,
        subtitle: p.goal || p.description || undefined,
        icon: p.icon || KIND_META.project.icon,
        hue: p.hue,
        status: p.status,
        updatedAt: p.updatedAt,
        projectId: p.id,
      }
    }
    case 'task': {
      const t = s.tasks[id]
      if (!t) return undefined
      return {
        title: t.title,
        subtitle: projectName(t.projectId) ?? 'No project',
        icon: KIND_META.task.icon,
        hue: t.projectId ? s.projects[t.projectId]?.hue : undefined,
        status: t.status,
        updatedAt: t.updatedAt,
        projectId: t.projectId,
      }
    }
    case 'thread': {
      const t = s.threads[id]
      if (!t) return undefined
      const count = t.messageIds.length
      return {
        title: t.title || 'Untitled conversation',
        subtitle: projectName(t.projectId) ?? `${count} message${count === 1 ? '' : 's'}`,
        icon: KIND_META.thread.icon,
        status: t.archived ? 'archived' : undefined,
        updatedAt: t.updatedAt,
        projectId: t.projectId,
      }
    }
    case 'message': {
      const m = s.messages[id]
      if (!m) return undefined
      const thread = s.threads[m.threadId]
      return {
        title: clipLine(plainText(m.content), 60) || 'Empty message',
        subtitle: `${m.role === 'user' ? 'You' : 'Assistant'} · ${thread?.title || 'Conversation'}`,
        icon: KIND_META.message.icon,
        status: m.status,
        updatedAt: m.createdAt,
        projectId: thread?.projectId ?? null,
        simulated: m.simulated,
      }
    }
    case 'run': {
      const r = s.runs[id]
      if (!r) return undefined
      const agent = r.agentId ? s.agents[r.agentId] : undefined
      return {
        title: r.title,
        subtitle: `${RUN_KIND_LABEL[r.kind]} run${agent ? ` · ${agent.name}` : ''}`,
        icon: RUN_KIND_ICON[r.kind],
        hue: agent?.hue,
        status: r.status,
        updatedAt: r.endedAt ?? r.startedAt ?? r.createdAt,
        projectId: r.projectId,
        simulated: r.simulated,
      }
    }
    case 'approval': {
      const a = s.approvals[id]
      if (!a) return undefined
      const run = s.runs[a.runId]
      return {
        title: a.title,
        subtitle: `${CAPABILITIES[a.capability]?.label ?? a.capability} · ${a.risk} risk`,
        icon: KIND_META.approval.icon,
        status: a.status,
        updatedAt: a.resolvedAt ?? a.createdAt,
        projectId: run?.projectId ?? null,
        simulated: run?.simulated,
      }
    }
    case 'agent': {
      const a = s.agents[id]
      if (!a) return undefined
      return { title: a.name, subtitle: a.role, icon: KIND_META.agent.icon, hue: a.hue, status: a.status, updatedAt: a.updatedAt }
    }
    case 'workflow': {
      const w = s.workflows[id]
      if (!w) return undefined
      return {
        title: w.name,
        subtitle: w.description ? clipLine(w.description, 90) : w.trigger.label,
        icon: KIND_META.workflow.icon,
        hue: w.hue,
        status: w.enabled ? 'enabled' : 'disabled',
        updatedAt: w.updatedAt,
        projectId: w.projectId,
      }
    }
    case 'knowledge': {
      const k = s.knowledge[id]
      if (!k) return undefined
      const meta = KNOWLEDGE_KIND_META[k.kind] ?? KNOWLEDGE_KIND_META.note
      const collection = k.collectionId ? s.collections[k.collectionId] : undefined
      return {
        title: k.title || 'Untitled',
        subtitle: collection ? `${meta.label} · ${collection.name}` : meta.label,
        icon: k.file?.mime.startsWith('image/') ? 'Image' : meta.icon,
        hue: collection?.hue,
        updatedAt: k.updatedAt,
        projectId: k.projectIds[0] ?? null,
        simulated: k.simulated,
      }
    }
    case 'collection': {
      const c = s.collections[id]
      if (!c) return undefined
      return { title: c.name, subtitle: c.description, icon: c.icon || KIND_META.collection.icon, hue: c.hue, updatedAt: c.createdAt }
    }
    case 'investigation': {
      const inv = s.investigations[id]
      if (!inv) return undefined
      return {
        title: inv.title,
        subtitle: clipLine(inv.question, 90),
        icon: KIND_META.investigation.icon,
        status: inv.status,
        updatedAt: inv.updatedAt,
        projectId: inv.projectId,
      }
    }
    case 'source': {
      const src = s.sources[id]
      if (!src) return undefined
      const inv = src.investigationId ? s.investigations[src.investigationId] : undefined
      const where = src.domain ?? src.kind
      return {
        title: src.title,
        subtitle: src.simulated ? `${where} · simulated source` : where,
        icon: SOURCE_KIND_ICON[src.kind] ?? KIND_META.source.icon,
        status: src.status,
        updatedAt: src.addedAt,
        projectId: inv?.projectId ?? null,
        simulated: src.simulated,
      }
    }
    case 'repo': {
      const r = s.repos[id]
      if (!r) return undefined
      return {
        title: r.fullName,
        subtitle: r.description ?? r.language,
        icon: KIND_META.repo.icon,
        status: r.mode,
        updatedAt: r.lastSyncedAt ?? r.connectedAt,
        projectId: r.projectId,
        simulated: r.mode === 'simulated',
      }
    }
    case 'session': {
      const ses = s.sessions[id]
      if (!ses) return undefined
      return {
        title: ses.title,
        subtitle: `${s.repos[ses.repoId]?.fullName ?? 'Repository'} · ${ses.branch}`,
        icon: KIND_META.session.icon,
        status: ses.status,
        updatedAt: ses.updatedAt,
        projectId: ses.projectId,
      }
    }
    case 'asset': {
      const a = s.assets[id]
      if (!a) return undefined
      const meta = ASSET_KIND_META[a.kind] ?? { label: 'Asset', icon: KIND_META.asset.icon }
      return {
        title: a.title,
        subtitle: `${meta.label} · ${a.generator.label}`,
        icon: meta.icon,
        status: a.status,
        updatedAt: a.updatedAt,
        projectId: a.projectId,
        simulated: a.generator.simulated,
      }
    }
    case 'board': {
      const b = s.boards[id]
      if (!b) return undefined
      return { title: b.name, subtitle: b.description, icon: KIND_META.board.icon, updatedAt: b.createdAt, projectId: b.projectId }
    }
    case 'integration': {
      const def = getIntegration(id)
      if (!def) return undefined
      const conn = s.connections[id]
      return {
        title: def.name,
        subtitle: conn?.status === 'connected' && conn.account ? conn.account : def.description,
        icon: KIND_META.integration.icon,
        hue: asHue(def.hue),
        status: conn?.status ?? 'available',
        updatedAt: conn?.lastUsedAt ?? conn?.connectedAt,
        simulated: def.support === 'simulated',
      }
    }
  }
}

/** Resolve an entity against a given database snapshot (pure; used by hooks and services). */
export function resolveIn(s: Tables, ref: EntityRef): ResolvedEntity {
  const fields = resolveFields(s, ref)
  if (!fields) return { ref, title: 'Deleted item', icon: KIND_META[ref.kind]?.icon ?? 'Circle', route: '/', exists: false }
  return { ref, ...fields, route: routeIn(s, ref), exists: true }
}

/** Title, icon, status and route for any entity ref (missing rows resolve to “Deleted item”). */
export function resolveEntity(ref: EntityRef): ResolvedEntity {
  return resolveIn(useDB.getState(), ref)
}

/** Where an entity lives in the app (see the route map in CLAUDE.md / the brief). */
export function entityRoute(ref: EntityRef): string {
  return routeIn(useDB.getState(), ref)
}

/** Short “Kind “Title”” phrase for activity summaries. */
export function describeRef(ref: EntityRef): string {
  const resolved = resolveEntity(ref)
  return `${KIND_META[ref.kind].label.toLowerCase()} “${resolved.title}”`
}

/**
 * Subscribe to a resolved entity. Re-renders only when the resolved fields change
 * (reverse lookups for run routes are memoized per table version).
 */
export function useEntity(ref: EntityRef): ResolvedEntity {
  const { kind, id } = ref
  const stable = useMemo<EntityRef>(() => ({ kind, id }), [kind, id])
  return useDB(useShallow((s: Tables) => resolveIn(s, stable)))
}
