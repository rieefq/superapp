import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { useContextStore } from '@/core/context'
import { retrieveKnowledge } from '@/core/search'
import { useSecretsStore } from '@/core/secrets'
import { DEFAULT_SETTINGS, useSettingsStore } from '@/core/settings'
import type { CreateRunInput } from '@/core/runs/service'
import type { KnowledgeItem, Run, RunStep, Usage } from '@/core/types'

// ---------------------------------------------------------------- module mocks

/** In-memory run service writing to the db, so tests can assert on run state. */
vi.mock('@/core/runs/service', async () => {
  const { db: store } = await import('@/core/db')
  const { newId } = await import('@/lib/id')
  return {
    createRun: vi.fn((input: CreateRunInput): Run => {
      const run: Run = {
        id: newId('run'),
        kind: input.kind,
        title: input.title,
        status: 'running',
        projectId: input.projectId ?? null,
        origin: input.origin,
        initiator: input.initiator ?? { type: 'user', id: 'usr_me' },
        steps: [],
        outputs: [],
        modelId: input.modelId,
        simulated: input.simulated,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        progress: 0,
        createdAt: Date.now(),
      }
      store.insert('runs', run)
      return run
    }),
    appendStep: vi.fn((runId: string, step: Omit<RunStep, 'id'> & { id?: string }): RunStep => {
      const s: RunStep = { ...step, id: step.id ?? newId('stp') }
      store.update('runs', runId, (r) => ({ ...r, steps: [...r.steps, s] }))
      return s
    }),
    updateStep: vi.fn((runId: string, stepId: string, patch: Partial<RunStep>) => {
      store.update('runs', runId, (r) => ({ ...r, steps: r.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) }))
    }),
    addUsage: vi.fn((runId: string, u: Usage) => {
      store.update('runs', runId, (r) => ({
        ...r,
        usage: { inputTokens: r.usage.inputTokens + u.inputTokens, outputTokens: r.usage.outputTokens + u.outputTokens, costUsd: r.usage.costUsd + u.costUsd },
      }))
    }),
    completeRun: vi.fn((runId: string, input?: { summary?: string }) => {
      store.update('runs', runId, { status: 'succeeded', summary: input?.summary, progress: 1 })
    }),
    failRun: vi.fn((runId: string, error: string) => {
      store.update('runs', runId, { status: 'failed', error })
    }),
    cancelRun: vi.fn((runId: string, reason?: string) => {
      store.update('runs', runId, { status: 'cancelled', error: reason })
    }),
  }
})

vi.mock('@/core/search', () => ({ retrieveKnowledge: vi.fn(() => []), search: vi.fn(() => []) }))

/** Fast simulator so end-to-end turns finish in well under a second. */
vi.mock('./providers/simulator', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./providers/simulator')>()
  return { ...mod, simulatorProvider: mod.createSimulatorProvider({ chunkDelayMs: () => 1, firstTokenDelayMs: () => 0 }) }
})

const chat = await import('./chat')
const { friendlyError } = await import('./chatRunner')

// ---------------------------------------------------------------- fixtures

function knowledge(id: string, title: string, content: string): KnowledgeItem {
  return {
    id, kind: 'doc', title, content, tags: [], collectionId: null, projectIds: [], source: { type: 'manual' },
    author: { type: 'user', id: 'usr_me' }, createdAt: 1, updatedAt: 1,
  }
}

const ADR = knowledge(
  'kno_adr',
  'ADR-012: Session tokens & refresh',
  'Access tokens expire after 15 minutes. Refresh tokens are rotated on every use. The current logout bug happens because the refresh call races the redirect after SSO login.',
)
const GLOSSARY = knowledge('kno_glossary', 'Atlas glossary', 'A lane is a recurring origin and destination pair. Margin is revenue minus carrier cost.')

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const setAi = (patch: Partial<typeof DEFAULT_SETTINGS.ai>) =>
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, ai: { ...s.settings.ai, ...patch } } }))

const message = (id: string) => db.get('messages', id)!
const run = (id: string | undefined) => db.get('runs', id)!

beforeEach(() => {
  db.replaceAll(emptyTables())
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
  useContextStore.setState({ pinned: [], scopeProjectId: null })
  useSecretsStore.setState({ secrets: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------- tests

describe('threads', () => {
  it('creates a thread with defaults and logs the activity', () => {
    const thread = chat.createThread({ projectId: 'prj_atlas' })
    expect(thread).toMatchObject({ title: 'New conversation', modelId: 'sim-swift', projectId: 'prj_atlas', messageIds: [], contextRefs: [] })
    expect(db.all('activity')).toEqual([expect.objectContaining({ summary: 'Started a conversation', target: { kind: 'thread', id: thread.id }, projectId: 'prj_atlas' })])
  })

  it('renames, pins, archives, moves and manages context', () => {
    const { id } = chat.createThread()
    chat.renameThread(id, '  Q1   planning ')
    chat.setThreadPinned(id, true)
    chat.setThreadArchived(id, true)
    chat.setThreadModel(id, 'sim-deep')
    chat.addThreadContext(id, { kind: 'knowledge', id: 'kno_adr' })
    chat.addThreadContext(id, { kind: 'knowledge', id: 'kno_adr' })
    chat.setThreadProject(id, 'prj_lumen')
    expect(db.get('threads', id)).toMatchObject({ title: 'Q1 planning', pinned: true, archived: true, modelId: 'sim-deep', projectId: 'prj_lumen', contextRefs: [{ kind: 'knowledge', id: 'kno_adr' }] })
    chat.setThreadPinned(id, false)
    chat.removeThreadContext(id, { kind: 'knowledge', id: 'kno_adr' })
    expect(db.get('threads', id)).not.toHaveProperty('pinned')
    expect(db.get('threads', id)?.contextRefs).toEqual([])
  })

  it('derives titles from the first message', () => {
    expect(chat.titleFromText('Can you explain how session refresh works in our portal?')).toBe('Explain how session refresh works')
    expect(chat.titleFromText('hey, help me draft the Q1 OKRs for the platform team!')).toBe('Draft the Q1 OKRs for the platform')
    expect(chat.titleFromText('WHY IS CHECKOUT SO SLOW')).toBe('Why is checkout so slow')
    expect(chat.titleFromText('```ts\nconst x = 1\n```\nWhat does this do?')).toBe('What does this do')
  })
})

describe('sendMessage with the simulator', () => {
  it('creates the thread, retitles it, streams into a placeholder and completes the run', async () => {
    const result = await chat.sendMessage({ text: 'Can you explain how session refresh works in our portal?' })
    const thread = db.get('threads', result.threadId)!
    expect(thread.title).toBe('Explain how session refresh works')
    expect(thread.messageIds).toEqual([result.userMessageId, result.assistantMessageId])
    expect(message(result.userMessageId)).toMatchObject({ role: 'user', status: 'complete', content: 'Can you explain how session refresh works in our portal?' })

    const placeholder = message(result.assistantMessageId)
    expect(placeholder).toMatchObject({ role: 'assistant', status: 'streaming', modelId: 'sim-swift', providerId: 'simulator', simulated: true })
    expect(placeholder.runId).toBeDefined()
    expect(run(placeholder.runId)).toMatchObject({ kind: 'chat', title: thread.title, simulated: true, origin: { kind: 'message', id: result.assistantMessageId }, modelId: 'sim-swift' })
    expect(chat.isGenerating(result.assistantMessageId)).toBe(true)

    await chat.awaitGeneration(result.assistantMessageId)
    const done = message(result.assistantMessageId)
    expect(done.status).toBe('complete')
    expect(done.content.length).toBeGreaterThan(200)
    expect(done.usage).toMatchObject({ costUsd: 0 })
    expect(done.usage!.outputTokens).toBeGreaterThan(0)
    const r = run(done.runId)
    expect(r.status).toBe('succeeded')
    expect(r.steps.find((s) => s.kind === 'message')).toMatchObject({ title: 'Generated response', status: 'done' })
    expect(r.usage.outputTokens).toBe(done.usage!.outputTokens)
    expect(chat.isGenerating(result.assistantMessageId)).toBe(false)
  })

  it('cites retrieved knowledge, records a tool trace and a search step, and links cited docs', async () => {
    db.insertMany('knowledge', [ADR, GLOSSARY])
    vi.mocked(retrieveKnowledge).mockImplementation((_q, opts) =>
      opts?.ids ? [] : [{ item: ADR, passage: ADR.content, score: 3 }, { item: GLOSSARY, passage: GLOSSARY.content, score: 1 }],
    )
    const { assistantMessageId } = await chat.sendMessage({ text: 'Why do users get logged out after SSO login?', projectId: 'prj_atlas' })
    await chat.awaitGeneration(assistantMessageId)
    const m = message(assistantMessageId)

    expect(vi.mocked(retrieveKnowledge)).toHaveBeenCalledWith('Why do users get logged out after SSO login?', expect.objectContaining({ projectId: 'prj_atlas' }))
    expect(m.citations).toEqual([
      expect.objectContaining({ ref: { kind: 'knowledge', id: 'kno_adr' }, title: ADR.title, snippet: expect.stringContaining('Access tokens expire') }),
      expect.objectContaining({ ref: { kind: 'knowledge', id: 'kno_glossary' }, title: GLOSSARY.title }),
    ])
    expect(m.tools).toEqual([
      expect.objectContaining({ name: 'knowledge.search', label: 'Searched knowledge', detail: '2 results', status: 'done', results: [{ kind: 'knowledge', id: 'kno_adr' }, { kind: 'knowledge', id: 'kno_glossary' }] }),
    ])
    expect(m.content).toContain('[1]')
    expect(m.content).toMatch(/refresh call races the redirect/)
    const searchStep = run(m.runId).steps.find((s) => s.kind === 'search')
    expect(searchStep).toMatchObject({ title: 'Searched knowledge', status: 'done', output: expect.stringContaining('[1] ADR-012') })
    expect(db.all('links')).toContainEqual(expect.objectContaining({ from: { kind: 'message', id: assistantMessageId }, to: { kind: 'knowledge', id: 'kno_adr' }, rel: 'cites' }))
  })

  it('always includes explicitly attached knowledge, even with auto-retrieval off', async () => {
    db.insertMany('knowledge', [ADR, GLOSSARY])
    setAi({ autoRetrieve: false })
    useContextStore.getState().pin({ kind: 'knowledge', id: 'kno_glossary' })
    const { assistantMessageId } = await chat.sendMessage({ text: 'What is a lane?', contextRefs: [{ kind: 'knowledge', id: 'kno_adr' }] })
    await chat.awaitGeneration(assistantMessageId)
    const m = message(assistantMessageId)
    expect(vi.mocked(retrieveKnowledge)).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 6 }))
    expect(m.citations?.map((c) => c.ref.id)).toEqual(['kno_adr', 'kno_glossary'])
    expect(m.tools?.[0]).toMatchObject({ label: 'Read pinned context', detail: '2 results' })
    expect(m.content).toMatch(/recurring origin and destination pair/)
  })

  it('stores the reasoning trace only when reasoning is shown', async () => {
    const shown = await chat.sendMessage({ text: 'Compare Postgres vs MongoDB', modelId: 'sim-deep' })
    await chat.awaitGeneration(shown.assistantMessageId)
    expect(message(shown.assistantMessageId).reasoning?.length).toBeGreaterThan(40)

    setAi({ showReasoning: false })
    const hidden = await chat.sendMessage({ text: 'Compare Postgres vs MongoDB', modelId: 'sim-deep' })
    await chat.awaitGeneration(hidden.assistantMessageId)
    expect(message(hidden.assistantMessageId).reasoning).toBeUndefined()
  })

  it('stops generation and keeps the partial content', async () => {
    const { assistantMessageId } = await chat.sendMessage({ text: 'Plan a 6-week migration to Stripe Billing', modelId: 'sim-deep' })
    await waitFor(() => message(assistantMessageId).content.length > 0)
    chat.stopGeneration(assistantMessageId)
    await chat.awaitGeneration(assistantMessageId)
    const m = message(assistantMessageId)
    expect(m.status).toBe('stopped')
    expect(m.content.length).toBeGreaterThan(0)
    expect(run(m.runId).status).toBe('cancelled')
  })

  it('regenerates an answer in place with a fresh run', async () => {
    const { assistantMessageId } = await chat.sendMessage({ text: 'Brainstorm ideas for our onboarding' })
    await chat.awaitGeneration(assistantMessageId)
    const first = message(assistantMessageId)
    chat.setFeedback(assistantMessageId, 'up')

    await chat.regenerate(assistantMessageId, { modelId: 'sim-deep' })
    const reset = message(assistantMessageId)
    expect(reset).toMatchObject({ status: 'streaming', content: '', modelId: 'sim-deep' })
    expect(reset).not.toHaveProperty('feedback')
    expect(reset).not.toHaveProperty('usage')
    expect(reset.runId).not.toBe(first.runId)
    await chat.awaitGeneration(assistantMessageId)
    const second = message(assistantMessageId)
    expect(second.status).toBe('complete')
    expect(second.content).not.toBe(first.content)
    expect(run(first.runId).status).toBe('succeeded')
    expect(run(second.runId).status).toBe('succeeded')
    expect(db.get('threads', second.threadId)?.messageIds).toHaveLength(2)
  })

  it('edits a user message, drops what followed and answers again', async () => {
    const one = await chat.sendMessage({ text: 'What is a vector database?' })
    await chat.awaitGeneration(one.assistantMessageId)
    const two = await chat.sendMessage({ threadId: one.threadId, text: 'And how do I pick one?' })
    await chat.awaitGeneration(two.assistantMessageId)

    const { assistantMessageId } = await chat.editAndResend(one.userMessageId, 'What is an event store?')
    const thread = db.get('threads', one.threadId)!
    expect(thread.messageIds).toEqual([one.userMessageId, assistantMessageId])
    expect(db.get('messages', two.userMessageId)).toBeUndefined()
    expect(db.get('messages', one.assistantMessageId)).toBeUndefined()
    expect(message(one.userMessageId).content).toBe('What is an event store?')
    await chat.awaitGeneration(assistantMessageId)
    expect(message(assistantMessageId).status).toBe('complete')
  })

  it('forks a thread up to a message', async () => {
    const one = await chat.sendMessage({ text: 'Draft a launch email for Lumen' })
    await chat.awaitGeneration(one.assistantMessageId)
    const two = await chat.sendMessage({ threadId: one.threadId, text: 'Make it shorter' })
    await chat.awaitGeneration(two.assistantMessageId)

    const fork = chat.forkThread(one.threadId, one.assistantMessageId)
    expect(fork.title).toBe(`${db.get('threads', one.threadId)!.title} (fork)`)
    expect(fork.forkedFrom).toEqual({ threadId: one.threadId, messageId: one.assistantMessageId })
    expect(fork.messageIds).toHaveLength(2)
    const copies = fork.messageIds.map(message)
    expect(copies.map((m) => m.content)).toEqual([message(one.userMessageId).content, message(one.assistantMessageId).content])
    expect(copies.every((m) => m.threadId === fork.id && !m.runId)).toBe(true)
    expect(db.get('threads', one.threadId)!.messageIds).toHaveLength(4)
    expect(db.all('links')).toContainEqual(expect.objectContaining({ from: { kind: 'thread', id: fork.id }, to: { kind: 'thread', id: one.threadId }, rel: 'derived_from' }))
    expect(() => chat.forkThread(one.threadId, 'msg_missing')).toThrow()
  })

  it('deletes a thread with its messages and links', async () => {
    const { threadId, assistantMessageId } = await chat.sendMessage({ text: 'hello there' })
    await chat.awaitGeneration(assistantMessageId)
    chat.deleteThread(threadId)
    expect(db.get('threads', threadId)).toBeUndefined()
    expect(db.filter('messages', (m) => m.threadId === threadId)).toEqual([])
    expect(db.all('activity').some((a) => a.verb === 'deleted')).toBe(true)
  })
})

describe('errors', () => {
  it('fails with an actionable error when a live model is unavailable (no silent fallback)', async () => {
    const { assistantMessageId } = await chat.sendMessage({ text: 'Explain adaptive thinking', modelId: 'claude-opus-5-5' })
    expect(message(assistantMessageId)).toMatchObject({ simulated: false, providerId: 'anthropic' })
    await chat.awaitGeneration(assistantMessageId)
    const m = message(assistantMessageId)
    expect(m.status).toBe('error')
    expect(m.error).toBe('Add your Anthropic API key in Integrations to use Claude Opus 5.5.')
    expect(m.content).toBe('')
    expect(run(m.runId)).toMatchObject({ status: 'failed', error: m.error, simulated: false })
  })

  it('surfaces provider errors with friendly, actionable text', async () => {
    db.insert('connections', { id: 'openai-compatible', status: 'connected', mode: 'live', scopes: [], config: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' }, usageCount: 0 })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { assistantMessageId } = await chat.sendMessage({ text: 'hi there friend', modelId: 'oai:llama3.2' })
    await chat.awaitGeneration(assistantMessageId)
    const m = message(assistantMessageId)
    expect(m.status).toBe('error')
    expect(m.error).toBe('Could not reach http://localhost:11434/v1. Is the server running and allowing CORS from this origin?')
    expect(run(m.runId).status).toBe('failed')
  })

  it('appends a note and completes when the model declines', async () => {
    db.insert('connections', { id: 'openai-compatible', status: 'connected', mode: 'live', scopes: [], config: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' }, usageCount: 0 })
    const body = 'data: {"choices":[{"delta":{"content":"I can’t help with that."},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } })))
    const { assistantMessageId } = await chat.sendMessage({ text: 'something disallowed', modelId: 'oai:llama3.2' })
    await chat.awaitGeneration(assistantMessageId)
    const m = message(assistantMessageId)
    expect(m).toMatchObject({ status: 'complete', error: 'refusal' })
    expect(m.content).toBe('I can’t help with that.\n\n*The model declined this request.*')
    expect(m.simulated).toBe(false)
  })

  it('maps error codes to friendly text', () => {
    expect(friendlyError('rate_limit', 'x', undefined)).toMatch(/rate limiting/)
    expect(friendlyError('overloaded', undefined, undefined)).toMatch(/overloaded/)
    expect(friendlyError('bad_request', 'max_tokens too large', undefined)).toBe("The model provider couldn't process this request: max_tokens too large")
    expect(friendlyError('auth', undefined, undefined)).toMatch(/Integrations/)
    expect(friendlyError(undefined, 'boom', undefined)).toBe('Something went wrong while generating: boom')
  })

  it('recovers messages left streaming by a reload', () => {
    const thread = chat.createThread()
    db.insert('runs', {
      id: 'run_x', kind: 'chat', title: 't', status: 'running', projectId: null, initiator: { type: 'user', id: 'usr_me' }, steps: [], outputs: [],
      simulated: true, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, progress: 0, createdAt: 1,
    })
    db.insert('messages', { id: 'msg_x', threadId: thread.id, role: 'assistant', content: 'Half an ans', status: 'streaming', createdAt: 1, runId: 'run_x' })
    expect(chat.recoverInterruptedMessages()).toBe(1)
    expect(message('msg_x')).toMatchObject({ status: 'stopped', content: 'Half an ans' })
    expect(run('run_x').status).toBe('cancelled')
    expect(chat.recoverInterruptedMessages()).toBe(0)
  })

  it('rejects empty messages', async () => {
    await expect(chat.sendMessage({ text: '   ' })).rejects.toThrow(/empty/)
  })
})

describe('hooks', () => {
  it('returns thread messages in order and tracks generation', async () => {
    const { threadId, assistantMessageId, userMessageId } = await chat.sendMessage({ text: 'What is a lane?' })
    const messages = renderHook(() => chat.useThreadMessages(threadId))
    const generating = renderHook(() => chat.useIsGenerating(threadId))
    expect(messages.result.current.map((m) => m.id)).toEqual([userMessageId, assistantMessageId])
    expect(generating.result.current).toBe(true)
    await act(async () => {
      await chat.awaitGeneration(assistantMessageId)
    })
    expect(generating.result.current).toBe(false)
    expect(messages.result.current[1].status).toBe('complete')
  })
})
