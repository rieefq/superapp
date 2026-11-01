/**
 * Row builders for the assist tests (self-contained so other fixture files can change freely).
 */
import { emptyTables, type Tables } from '@/core/db'
import {
  ME, ZERO_USAGE,
  type Agent, type Approval, type CodeSession, type IntegrationConnection, type Investigation, type Message, type Project,
  type Repo, type Run, type Task, type Thread, type Workflow,
} from '@/core/types'

/** Tuesday 2026-11-03 12:00 local time: "+2h" is still today and "-1h" is overdue in any time zone. */
export const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime()
export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

export const fx = {
  project: (id: string, o: Partial<Project> = {}): Project => ({
    id, name: `Project ${id}`, description: '', hue: 'sky', icon: 'Boxes', status: 'active', milestones: [], pinnedRefs: [],
    repoIds: [], createdAt: NOW - 30 * DAY, updatedAt: NOW - DAY, ...o,
  }),
  task: (id: string, o: Partial<Task> = {}): Task => ({
    id, projectId: null, title: `Task ${id}`, status: 'todo', priority: 'none', assignee: null, labels: [], subtasks: [],
    runIds: [], order: 0, createdAt: NOW - 5 * DAY, updatedAt: NOW - DAY, ...o,
  }),
  thread: (id: string, o: Partial<Thread> = {}): Thread => ({
    id, title: `Thread ${id}`, projectId: null, modelId: 'sim-swift', messageIds: [], contextRefs: [], createdAt: NOW - DAY,
    updatedAt: NOW - HOUR, ...o,
  }),
  message: (id: string, threadId: string, o: Partial<Message> = {}): Message => ({
    id, threadId, role: 'assistant', content: 'Hello', status: 'complete', createdAt: NOW - HOUR, ...o,
  }),
  run: (id: string, o: Partial<Run> = {}): Run => ({
    id, kind: 'agent', title: `Run ${id}`, status: 'succeeded', projectId: null, initiator: ME, steps: [], outputs: [],
    simulated: true, usage: { ...ZERO_USAGE }, progress: 1, createdAt: NOW - 2 * HOUR, startedAt: NOW - 2 * HOUR,
    endedAt: NOW - HOUR, ...o,
  }),
  agent: (id: string, o: Partial<Agent> = {}): Agent => ({
    id, name: id, role: 'Assistant', description: '', hue: 'violet', sigil: 1, modelId: 'sim-swift', instructions: '',
    capabilities: [], knowledgeScope: { all: true, collectionIds: [], projectIds: [] }, autonomy: 'balanced', status: 'active',
    createdAt: NOW - 60 * DAY, updatedAt: NOW - 60 * DAY, ...o,
  }),
  approval: (id: string, runId: string, o: Partial<Approval> = {}): Approval => ({
    id, runId, stepId: `${runId}_s1`, title: `Approval ${id}`, capability: 'messages.send', risk: 'medium',
    requestedBy: { type: 'agent', id: 'agt_herald' }, status: 'pending', createdAt: NOW - 30 * MIN, ...o,
  }),
  session: (id: string, o: Partial<CodeSession> = {}): CodeSession => ({
    id, repoId: 'rep_1', title: `Session ${id}`, projectId: null, branch: 'fix/x', baseBranch: 'main', status: 'working',
    turns: [], changes: [], checks: [], createdAt: NOW - DAY, updatedAt: NOW - 3 * HOUR, ...o,
  }),
  investigation: (id: string, o: Partial<Investigation> = {}): Investigation => ({
    id, title: `Investigation ${id}`, question: 'Why?', projectId: null, status: 'complete', depth: 'standard', angles: [],
    sourceIds: [], findings: [], runIds: [], createdAt: NOW - DAY, updatedAt: NOW - 2 * HOUR, ...o,
  }),
  connection: (id: string, o: Partial<IntegrationConnection> = {}): IntegrationConnection => ({
    id, status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 0, connectedAt: NOW - 30 * DAY, ...o,
  }),
  workflow: (id: string, o: Partial<Workflow> = {}): Workflow => ({
    id, name: `Workflow ${id}`, description: '', projectId: null, hue: 'mint', trigger: { type: 'manual', label: 'Manual' },
    nodes: [], edges: [], enabled: true, version: 1, createdAt: NOW - 10 * DAY, updatedAt: NOW - 10 * DAY, ...o,
  }),
  repo: (id: string, o: Partial<Repo> = {}): Repo => ({
    id, provider: 'github', owner: 'northwind', name: id, fullName: `northwind/${id}`, defaultBranch: 'main', mode: 'live',
    projectId: null, connectedAt: NOW - 10 * DAY, ...o,
  }),
}

type Rows = { [K in keyof Tables]?: Array<Tables[K][string]> }

/** Build a full `Tables` value from row arrays. */
export function tables(rows: Rows = {}): Tables {
  const t = emptyTables()
  for (const [name, list] of Object.entries(rows) as Array<[keyof Tables, Array<{ id: string }>]>) {
    const table = t[name] as unknown as Record<string, { id: string }>
    for (const row of list) table[row.id] = row
  }
  return t
}

/** The demo cast (mirrors the seed agents' roles and grants). */
export function cast(): Agent[] {
  return [
    fx.agent('agt_scout', {
      name: 'Scout', role: 'Research analyst',
      description: 'Researches competitors, pricing and markets. Cites every claim.',
      capabilities: [
        { capability: 'web.search', mode: 'allow', integrationId: 'web-search' },
        { capability: 'web.browse', mode: 'allow', integrationId: 'web-search' },
        { capability: 'knowledge.read', mode: 'allow' },
        { capability: 'knowledge.write', mode: 'allow' },
      ],
    }),
    fx.agent('agt_forge', {
      name: 'Forge', role: 'Coding agent',
      description: 'Senior TypeScript engineer. Fixes bugs with regression tests.',
      capabilities: [
        { capability: 'repo.read', mode: 'allow', integrationId: 'github' },
        { capability: 'repo.write', mode: 'allow', integrationId: 'github' },
        { capability: 'repo.pull_request', mode: 'ask', integrationId: 'github' },
        { capability: 'shell.execute', mode: 'ask', integrationId: 'sandbox' },
        { capability: 'knowledge.read', mode: 'allow' },
      ],
    }),
    fx.agent('agt_herald', {
      name: 'Herald', role: 'Communications',
      description: 'Writes the weekly project digest, release notes and team updates.',
      capabilities: [
        { capability: 'knowledge.read', mode: 'allow' },
        { capability: 'tasks.manage', mode: 'allow' },
        { capability: 'messages.send', mode: 'ask', integrationId: 'slack' },
      ],
    }),
    fx.agent('agt_sentinel', {
      name: 'Sentinel', role: 'Support triage',
      description: 'Triages every email to support@: classifies priority, files Linear issues and alerts #support-urgent.',
      capabilities: [
        { capability: 'files.read', mode: 'allow', integrationId: 'gmail' },
        { capability: 'tasks.manage', mode: 'allow', integrationId: 'linear' },
        { capability: 'messages.send', mode: 'ask', integrationId: 'slack' },
        { capability: 'knowledge.read', mode: 'allow' },
      ],
    }),
    fx.agent('agt_muse', {
      name: 'Muse', role: 'Creative director',
      description: 'Key art, social cutdowns and storyboards that follow the brand voice.',
      capabilities: [
        { capability: 'media.generate', mode: 'allow', integrationId: 'image-gen' },
        { capability: 'knowledge.read', mode: 'allow' },
      ],
    }),
    fx.agent('agt_ledger', {
      name: 'Ledger', role: 'Metrics & finance analyst',
      description: 'Answers revenue, retention and usage questions from the read-only analytics replica.',
      capabilities: [
        { capability: 'data.query', mode: 'allow', integrationId: 'postgres' },
        { capability: 'payments.spend', mode: 'deny', integrationId: 'stripe' },
        { capability: 'knowledge.read', mode: 'allow' },
      ],
    }),
    fx.agent('agt_archivist', {
      name: 'Archivist', role: 'Knowledge curator', status: 'paused',
      description: 'Keeps Knowledge tidy: Notion sync, tags, duplicate detection.',
      capabilities: [
        { capability: 'knowledge.read', mode: 'allow' },
        { capability: 'knowledge.write', mode: 'allow' },
        { capability: 'files.read', mode: 'allow', integrationId: 'notion' },
      ],
    }),
  ]
}

/** Connections like the demo world: everything connected except Jira (error). */
export function demoConnections(): IntegrationConnection[] {
  return [
    fx.connection('github', { mode: 'live' }),
    fx.connection('slack', { config: { defaultChannel: '#product' } }),
    fx.connection('gmail'),
    fx.connection('linear', { config: { team: 'SUP' } }),
    fx.connection('google-drive'),
    fx.connection('notion'),
    fx.connection('web-search'),
    fx.connection('postgres'),
    fx.connection('jira', { status: 'error', error: 'Token expired — reconnect to resume syncing' }),
  ]
}
