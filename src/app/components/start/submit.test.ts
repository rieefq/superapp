import { beforeEach, describe, expect, it } from 'vitest'
import { useContextStore } from '@/core/context'
import { db, emptyTables } from '@/core/db'
import { fx } from '@/core/services/testFixtures'
import { dueFromInput, startWork, validateStart, type StartForm } from './submit'

function form(o: Partial<StartForm> = {}): StartForm {
  return {
    kind: 'task',
    title: '',
    brief: '',
    projectId: 'prj_1',
    depth: 'standard',
    angles: [],
    repoId: null,
    linkedTaskId: null,
    autonomy: 'balanced',
    agentId: null,
    workflowId: null,
    assignee: 'me',
    priority: 'none',
    due: '',
    milestoneId: null,
    collectionId: null,
    tags: [],
    studioKind: 'document',
    boardId: null,
    capUsd: null,
    ...o,
  }
}

beforeEach(() => {
  db.replaceAll(emptyTables())
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
  db.insert('projects', fx.project({ id: 'prj_1', milestones: [{ id: 'mil_1', title: 'Beta', status: 'upcoming' }] }))
  db.insert('threads', fx.thread({ id: 'thr_1', projectId: 'prj_1', messageIds: ['msg_1'] }))
  db.insert('messages', fx.message({ id: 'msg_1', threadId: 'thr_1', content: 'Webhook retries can double-charge customers.' }))
})

describe('validateStart', () => {
  it('asks for what each kind needs', () => {
    expect(validateStart(form({ kind: 'task' }), { run: true })).toBe('Give the task a title.')
    expect(validateStart(form({ kind: 'research' }), { run: true })).toBe('Ask a question to research.')
    expect(validateStart(form({ kind: 'session', brief: 'Fix it' }), { run: true })).toBe('Choose a repository.')
    expect(validateStart(form({ kind: 'agent', brief: 'Summarize' }), { run: true })).toBe('Choose an agent.')
    expect(validateStart(form({ kind: 'workflow' }), { run: true })).toBe('Choose a workflow to run.')
    expect(validateStart(form({ kind: 'studio' }), { run: true })).toBe('Describe what to make.')
    expect(validateStart(form({ kind: 'note', brief: 'Remember this' }), { run: true })).toBeNull()
  })
})

describe('dueFromInput', () => {
  it('turns a date input into the end of that working day, locally', () => {
    const due = dueFromInput('2026-11-14')!
    const d = new Date(due)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 14, 17])
    expect(dueFromInput('')).toBeUndefined()
  })
})

describe('startWork', () => {
  it('creates a task with priority, due date and milestone', () => {
    const r = startWork(form({ title: 'Add idempotency keys', brief: 'Use the event id', priority: 'high', due: '2026-11-14', milestoneId: 'mil_1' }), undefined)
    expect(r.ref.kind).toBe('task')
    const task = db.get('tasks', r.ref.id)!
    expect(task).toMatchObject({ title: 'Add idempotency keys', priority: 'high', milestoneId: 'mil_1', projectId: 'prj_1' })
    expect(task.assignee).toEqual({ type: 'user', id: 'usr_me' })
    expect(r.route).toContain('/projects/prj_1')
    expect(r.runId).toBeUndefined()
  })

  it('turns a message into a task through the handoff: origin, derived link and backlink', () => {
    const source = { kind: 'message' as const, id: 'msg_1' }
    const r = startWork(form({ title: 'Prevent double charges', brief: 'From the thread' }), source)
    const task = db.get('tasks', r.ref.id)!
    expect(task.origin).toEqual(source)
    expect(db.get('messages', 'msg_1')?.derived).toContainEqual({ kind: 'task', id: r.ref.id })
    expect(db.all('links').some((l) => l.rel === 'derived_from' && l.from.id === r.ref.id && l.to.id === 'msg_1')).toBe(true)
  })

  it('creates a note in a collection with tags', () => {
    db.insert('collections', { id: 'col_1', name: 'Engineering', hue: 'sky', icon: 'Code', createdAt: 0 })
    const r = startWork(form({ kind: 'note', title: 'Retry policy', brief: 'Retry with backoff.', collectionId: 'col_1', tags: ['billing'] }), undefined)
    const item = db.get('knowledge', r.ref.id)!
    expect(item).toMatchObject({ kind: 'note', title: 'Retry policy', collectionId: 'col_1', projectIds: ['prj_1'] })
    expect(item.tags).toContain('billing')
    expect(r.route).toBe(`/knowledge/${r.ref.id}`)
  })

  it('creates an investigation draft without running ("Create without running")', () => {
    const r = startWork(form({ kind: 'research', brief: 'What breaks when webhooks retry?', depth: 'quick' }), { kind: 'message', id: 'msg_1' }, { run: false })
    const inv = db.get('investigations', r.ref.id)!
    expect(inv).toMatchObject({ status: 'draft', depth: 'quick', projectId: 'prj_1' })
    expect(inv.origin).toEqual({ kind: 'message', id: 'msg_1' })
    expect(r.runId).toBeUndefined()
    expect(db.all('runs')).toHaveLength(0)
  })

  it('files a task unassigned when an agent’s work is created without running', () => {
    db.insert('agents', fx.agent({ id: 'agt_forge', name: 'Forge' }))
    const r = startWork(form({ title: 'Fix session refresh', assignee: 'agt_forge' }), undefined, { run: false })
    expect(db.get('tasks', r.ref.id)?.assignee).toBeNull()
    expect(db.all('runs')).toHaveLength(0)
  })
})
