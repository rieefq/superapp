import type {
  Agent, Asset, Board, CodeSession, Collection, Investigation, KnowledgeItem, Message, Project, Repo, Source, Task, Thread, Workflow,
} from '@/core/types'

/** Minimal valid rows for search tests. */
export const fx = {
  project: (id: string, name: string, patch: Partial<Project> = {}): Project => ({
    id, name, description: '', hue: 'sky', icon: 'Boxes', status: 'active', milestones: [], pinnedRefs: [], repoIds: [],
    createdAt: 0, updatedAt: 0, ...patch,
  }),
  task: (id: string, title: string, patch: Partial<Task> = {}): Task => ({
    id, projectId: null, title, status: 'todo', priority: 'none', assignee: null, labels: [], subtasks: [], runIds: [], order: 0,
    createdAt: 0, updatedAt: 0, ...patch,
  }),
  knowledge: (id: string, title: string, content: string, patch: Partial<KnowledgeItem> = {}): KnowledgeItem => ({
    id, kind: 'doc', title, content, tags: [], collectionId: null, projectIds: [], source: { type: 'manual' },
    author: { type: 'user', id: 'usr_me' }, createdAt: 0, updatedAt: 0, ...patch,
  }),
  thread: (id: string, title: string, messageIds: string[], patch: Partial<Thread> = {}): Thread => ({
    id, title, projectId: null, modelId: 'sim-swift', messageIds, contextRefs: [], createdAt: 0, updatedAt: 0, ...patch,
  }),
  message: (id: string, threadId: string, content: string): Message => ({
    id, threadId, role: 'user', content, status: 'complete', createdAt: 0,
  }),
  collection: (id: string, name: string, description = ''): Collection => ({ id, name, description, hue: 'mint', icon: 'Folder', createdAt: 0 }),
  investigation: (id: string, title: string, projectId: string | null, patch: Partial<Investigation> = {}): Investigation => ({
    id, title, question: '', projectId, status: 'draft', depth: 'standard', angles: [], sourceIds: [], findings: [], runIds: [],
    createdAt: 0, updatedAt: 0, ...patch,
  }),
  source: (id: string, investigationId: string | null, title: string, snippet: string, patch: Partial<Source> = {}): Source => ({
    id, investigationId, kind: 'web', title, snippet, credibility: 0.8, status: 'read', simulated: true, addedAt: 0, ...patch,
  }),
  agent: (id: string, name: string, role: string, description = ''): Agent => ({
    id, name, role, description, hue: 'violet', sigil: 1, modelId: 'sim-deep', instructions: '', capabilities: [],
    knowledgeScope: { all: true, collectionIds: [], projectIds: [] }, autonomy: 'balanced', status: 'active', createdAt: 0, updatedAt: 0,
  }),
  workflow: (id: string, name: string, description: string, projectId: string | null = null): Workflow => ({
    id, name, description, projectId, hue: 'amber', trigger: { type: 'manual', label: 'Manual' }, nodes: [], edges: [], enabled: true,
    version: 1, createdAt: 0, updatedAt: 0,
  }),
  session: (id: string, title: string, prompts: string[], projectId: string | null = null): CodeSession => ({
    id, repoId: 'rep_1', title, projectId, branch: 'fix', baseBranch: 'main', status: 'idle',
    turns: prompts.map((prompt, i) => ({ id: `turn_${i}`, prompt, createdAt: 0 })), changes: [], checks: [], createdAt: 0, updatedAt: 0,
  }),
  repo: (id: string, fullName: string, description: string): Repo => ({
    id, provider: 'demo', owner: fullName.split('/')[0], name: fullName.split('/')[1], fullName, description, defaultBranch: 'main',
    mode: 'simulated', projectId: null, connectedAt: 0,
  }),
  asset: (id: string, title: string, prompt: string, tags: string[] = []): Asset => ({
    id, kind: 'image', title, prompt, projectId: null, boardId: null, status: 'ready',
    generator: { id: 'image-gen', label: 'Simulated', simulated: true }, params: {}, versions: [], currentVersion: 0, tags,
    createdAt: 0, updatedAt: 0,
  }),
  board: (id: string, name: string): Board => ({ id, name, projectId: null, createdAt: 0 }),
}

/** Deterministic synthetic corpus for performance tests. */
export function syntheticWords(rng: () => number, count: number): string[] {
  const syllables = ['ka', 'lo', 'mi', 'ren', 'tor', 'vel', 'sa', 'qui', 'dor', 'fen', 'ga', 'pri', 'zu', 'nex', 'bra', 'ol', 'tri', 'mon']
  const words = new Set<string>()
  while (words.size < count) {
    const n = 2 + Math.floor(rng() * 3)
    let w = ''
    for (let i = 0; i < n; i++) w += syllables[Math.floor(rng() * syllables.length)]
    words.add(w)
  }
  return [...words]
}
