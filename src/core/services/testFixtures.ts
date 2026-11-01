/**
 * Minimal, valid rows for unit tests (not used by the app). Every builder accepts overrides.
 */
import { db } from '@/core/db'
import type { StartRunInput } from '@/core/runs'
import {
  ME,
  ZERO_USAGE,
  type Agent,
  type Approval,
  type Asset,
  type Board,
  type CodeSession,
  type Collection,
  type Investigation,
  type KnowledgeItem,
  type Message,
  type Project,
  type Repo,
  type Run,
  type Source,
  type Task,
  type Thread,
  type Workflow,
} from '@/core/types'

const T0 = 1_700_000_000_000

export const fx = {
  project: (o: Partial<Project> = {}): Project => ({
    id: 'prj_1', name: 'Atlas Portal v2', description: 'Rebuild', hue: 'sky', icon: 'Boxes', status: 'active',
    milestones: [], pinnedRefs: [], repoIds: [], createdAt: T0, updatedAt: T0, ...o,
  }),
  task: (o: Partial<Task> = {}): Task => ({
    id: 'tsk_1', projectId: 'prj_1', title: 'Fix login redirect', status: 'todo', priority: 'none', assignee: null,
    labels: [], subtasks: [], runIds: [], order: 0, createdAt: T0, updatedAt: T0, ...o,
  }),
  thread: (o: Partial<Thread> = {}): Thread => ({
    id: 'thr_1', title: 'Session expiry after SSO login', projectId: 'prj_1', modelId: 'sim-swift', messageIds: [],
    contextRefs: [], createdAt: T0, updatedAt: T0, ...o,
  }),
  message: (o: Partial<Message> = {}): Message => ({
    id: 'msg_1', threadId: 'thr_1', role: 'assistant', content: 'Hello', status: 'complete', createdAt: T0, ...o,
  }),
  run: (o: Partial<Run> = {}): Run => ({
    id: 'run_1', kind: 'agent', title: 'Agent run', status: 'succeeded', projectId: null, initiator: ME, steps: [],
    outputs: [], simulated: true, usage: { ...ZERO_USAGE }, progress: 1, createdAt: T0, ...o,
  }),
  agent: (o: Partial<Agent> = {}): Agent => ({
    id: 'agt_1', name: 'Scout', role: 'Research analyst', description: '', hue: 'violet', sigil: 7, modelId: 'sim-swift',
    instructions: '', capabilities: [], knowledgeScope: { all: true, collectionIds: [], projectIds: [] },
    autonomy: 'balanced', status: 'active', createdAt: T0, updatedAt: T0, ...o,
  }),
  workflow: (o: Partial<Workflow> = {}): Workflow => ({
    id: 'wfl_1', name: 'Support triage', description: 'Route urgent mail', projectId: null, hue: 'mint',
    trigger: { type: 'manual', label: 'Manual' }, nodes: [], edges: [], enabled: true, version: 1, createdAt: T0, updatedAt: T0, ...o,
  }),
  knowledge: (o: Partial<KnowledgeItem> = {}): KnowledgeItem => ({
    id: 'kno_1', kind: 'note', title: 'Atlas glossary', content: 'Terms we use.', tags: [], collectionId: null, projectIds: [],
    source: { type: 'manual' }, author: ME, createdAt: T0, updatedAt: T0, ...o,
  }),
  collection: (o: Partial<Collection> = {}): Collection => ({
    id: 'col_1', name: 'Product', hue: 'sky', icon: 'Library', createdAt: T0, ...o,
  }),
  investigation: (o: Partial<Investigation> = {}): Investigation => ({
    id: 'inv_1', title: 'Tidewell positioning', question: 'How does Tidewell position?', projectId: null, status: 'complete',
    depth: 'standard', angles: [], sourceIds: [], findings: [], runIds: [], createdAt: T0, updatedAt: T0, ...o,
  }),
  source: (o: Partial<Source> = {}): Source => ({
    id: 'src_1', investigationId: 'inv_1', kind: 'web', title: 'Pricing teardown', domain: 'freightsystems-review.example',
    snippet: 'A framework.', credibility: 0.6, status: 'read', simulated: true, addedAt: T0, ...o,
  }),
  repo: (o: Partial<Repo> = {}): Repo => ({
    id: 'rep_1', provider: 'demo', owner: 'northwind', name: 'atlas-portal', fullName: 'northwind/atlas-portal',
    defaultBranch: 'main', mode: 'simulated', projectId: null, connectedAt: T0, ...o,
  }),
  session: (o: Partial<CodeSession> = {}): CodeSession => ({
    id: 'ses_1', repoId: 'rep_1', title: 'Fix session expiry', projectId: null, branch: 'fix/session', baseBranch: 'main',
    status: 'working', turns: [], changes: [], checks: [], createdAt: T0, updatedAt: T0, ...o,
  }),
  asset: (o: Partial<Asset> = {}): Asset => ({
    id: 'ast_1', kind: 'image', title: 'Hero visual', prompt: 'A calm harbor', projectId: null, boardId: null, status: 'ready',
    generator: { id: 'sim', label: 'Simulator', simulated: true }, params: {}, versions: [], currentVersion: 0, tags: [],
    createdAt: T0, updatedAt: T0, ...o,
  }),
  board: (o: Partial<Board> = {}): Board => ({ id: 'brd_1', name: 'Launch visuals', projectId: null, createdAt: T0, ...o }),
  approval: (o: Partial<Approval> = {}): Approval => ({
    id: 'apv_1', runId: 'run_1', stepId: 'stp_1', title: 'Post update to #launch', capability: 'messages.send', risk: 'high',
    requestedBy: { type: 'agent', id: 'agt_1' }, status: 'pending', createdAt: T0, ...o,
  }),
}

/** A runEngine.start stand-in: records a queued, simulated run in the database. */
export function fakeStart(input: StartRunInput): Run {
  const run = fx.run({
    id: `run_${Math.random().toString(36).slice(2, 10)}`,
    kind: input.kind,
    title: input.title,
    status: 'running',
    projectId: input.projectId ?? null,
    agentId: input.agentId,
    workflowId: input.workflowId,
    origin: input.origin,
    initiator: input.initiator ?? ME,
    modelId: input.modelId,
    progress: 0,
    script: { factory: input.factory, params: input.params ?? {}, seed: 1, cursor: 0 },
    createdAt: Date.now(),
    startedAt: Date.now(),
  })
  db.insert('runs', run)
  return run
}
