import type {
  ActivityEvent, Agent, Approval, Asset, Board, CodeSession, Collection, ID, IntegrationConnection,
  Investigation, KnowledgeItem, Link, Message, Notification, Project, Repo, Run, Source, Task, Thread, Workflow,
} from '@/core/types'

/** The whole persisted application database: normalized tables keyed by id. */
export interface Tables {
  projects: Record<ID, Project>
  tasks: Record<ID, Task>
  threads: Record<ID, Thread>
  messages: Record<ID, Message>
  runs: Record<ID, Run>
  approvals: Record<ID, Approval>
  agents: Record<ID, Agent>
  workflows: Record<ID, Workflow>
  knowledge: Record<ID, KnowledgeItem>
  collections: Record<ID, Collection>
  investigations: Record<ID, Investigation>
  sources: Record<ID, Source>
  repos: Record<ID, Repo>
  sessions: Record<ID, CodeSession>
  assets: Record<ID, Asset>
  boards: Record<ID, Board>
  connections: Record<ID, IntegrationConnection>
  notifications: Record<ID, Notification>
  activity: Record<ID, ActivityEvent>
  links: Record<ID, Link>
}

export type TableName = keyof Tables
export type RowOf<T extends TableName> = Tables[T][string]

export const TABLE_NAMES: TableName[] = [
  'projects', 'tasks', 'threads', 'messages', 'runs', 'approvals', 'agents', 'workflows', 'knowledge',
  'collections', 'investigations', 'sources', 'repos', 'sessions', 'assets', 'boards', 'connections',
  'notifications', 'activity', 'links',
]

/** Id prefixes per table, used with `newId(ID_PREFIX.tasks)`. */
export const ID_PREFIX: Record<TableName, string> = {
  projects: 'prj', tasks: 'tsk', threads: 'thr', messages: 'msg', runs: 'run', approvals: 'apv',
  agents: 'agt', workflows: 'wfl', knowledge: 'kno', collections: 'col', investigations: 'inv',
  sources: 'src', repos: 'rep', sessions: 'ses', assets: 'ast', boards: 'brd', connections: 'con',
  notifications: 'ntf', activity: 'act', links: 'lnk',
}

export function emptyTables(): Tables {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, {}])) as unknown as Tables
}
