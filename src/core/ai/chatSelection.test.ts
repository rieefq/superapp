import { beforeEach, describe, expect, it } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { useContextStore } from '@/core/context'
import type { KnowledgeItem, Project, Thread } from '@/core/types'
import { ME } from '@/core/types'
import { explicitContextRefs, gatherKnowledge, systemPromptFor } from './chatContext'

const now = 1_700_000_000_000

function knowledge(id: string, title: string, content: string, projectIds: string[] = []): KnowledgeItem {
  return {
    id, kind: 'note', title, content, tags: [], collectionId: null, projectIds,
    source: { type: 'manual' }, author: ME, createdAt: now, updatedAt: now,
  }
}

const project: Project = {
  id: 'prj_t', name: 'Test Project', description: '', goal: 'Ship the thing', instructions: 'Be terse.',
  hue: 'sky', icon: 'Boxes', status: 'active', milestones: [], pinnedRefs: [{ kind: 'knowledge', id: 'kno_mem' }],
  repoIds: [], createdAt: now, updatedAt: now,
}

const thread: Thread = {
  id: 'thr_t', title: 'T', projectId: 'prj_t', modelId: 'sim-swift', messageIds: [],
  contextRefs: [{ kind: 'knowledge', id: 'kno_attached' }], createdAt: now, updatedAt: now,
}

beforeEach(() => {
  db.replaceAll(emptyTables())
  db.insert('projects', project)
  db.insert('threads', thread)
  db.insertMany('knowledge', [
    knowledge('kno_mem', 'Project memory doc', 'Webhook retries use exponential backoff.', ['prj_t']),
    knowledge('kno_attached', 'Attached doc', 'Webhook signatures are verified with a shared secret.'),
    knowledge('kno_held', 'Held doc', 'Webhook endpoints must respond within ten seconds.'),
    knowledge('kno_other', 'Unseen doc', 'Webhook delivery logs are kept for thirty days.', ['prj_t']),
  ])
  useContextStore.setState({ pinned: [{ ref: { kind: 'knowledge', id: 'kno_held' }, addedAt: now, source: 'user' }] })
})

describe('Context Line selection', () => {
  it('includes project memory, held and attached items by default', () => {
    const keys = explicitContextRefs(thread).map((r) => r.id).sort()
    expect(keys).toEqual(['kno_attached', 'kno_held', 'kno_mem'])
  })

  it('never sends refs switched off in the Context Line', () => {
    const sel = { exclude: [{ kind: 'knowledge' as const, id: 'kno_held' }, { kind: 'knowledge' as const, id: 'kno_attached' }] }
    const { docs } = gatherKnowledge(thread, 'webhook', true, sel)
    const ids = docs.map((d) => d.item.id)
    expect(ids).not.toContain('kno_held')
    expect(ids).not.toContain('kno_attached')
  })

  it('excluding the project drops project memory and project instructions', () => {
    const sel = { exclude: [{ kind: 'project' as const, id: 'prj_t' }] }
    expect(explicitContextRefs(thread, sel).map((r) => r.id)).not.toContain('kno_mem')
    const prompt = systemPromptFor(thread, [], 'Morgan', now, sel)
    expect(prompt).not.toContain('Be terse.')
    expect(prompt).not.toContain('Test Project')
  })

  it('restricts automatic retrieval to the "Likely" set the composer displayed', () => {
    const shown = gatherKnowledge(thread, 'webhook delivery logs', true, { retrieved: [] })
    expect(shown.docs.map((d) => d.item.id)).not.toContain('kno_other')
    expect(shown.searched).toBe(false)
    const allowed = gatherKnowledge(thread, 'webhook delivery logs', true, { retrieved: [{ kind: 'knowledge', id: 'kno_other' }] })
    expect(allowed.docs.map((d) => d.item.id)).toContain('kno_other')
  })
})
