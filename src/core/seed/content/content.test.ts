import { describe, expect, it } from 'vitest'
import type { Tables } from '@/core/db/schema'
import type { ActorRef, EntityKind, EntityRef } from '@/core/types'
import { shortCode } from '@/lib/id'
import { AGENT, BOARD, COLLECTION, INVESTIGATION, KNOWLEDGE, PROJECT, REPO, SESSION, TASK, THREAD, WORKFLOW } from '../ids'
import { buildSeed } from '../index'
import { buildContent } from './index'
import { MSG } from './keys'

const NOW = Date.UTC(2026, 10, 1, 15, 30) // fixed so the test itself is deterministic
const seed = buildContent(NOW) as Required<Pick<Tables,
  'projects' | 'tasks' | 'collections' | 'knowledge' | 'threads' | 'messages' | 'investigations' | 'sources' |
  'boards' | 'assets' | 'links' | 'activity' | 'notifications'>>

/** Ids owned by the operations part that the content part may reference. */
const EXTERNAL: Partial<Record<EntityKind, Set<string>>> = {
  agent: new Set(Object.values(AGENT)),
  repo: new Set(Object.values(REPO)),
  session: new Set(Object.values(SESSION)),
  workflow: new Set(Object.values(WORKFLOW)),
}

const TABLE_FOR: Partial<Record<EntityKind, keyof typeof seed>> = {
  project: 'projects', task: 'tasks', thread: 'threads', message: 'messages', knowledge: 'knowledge',
  collection: 'collections', investigation: 'investigations', source: 'sources', asset: 'assets', board: 'boards',
}

function exists(r: EntityRef): boolean {
  const table = TABLE_FOR[r.kind]
  if (table && r.id in seed[table]) return true
  return EXTERNAL[r.kind]?.has(r.id) ?? false
}

function actorExists(a: ActorRef): boolean {
  if (a.type === 'user') return a.id === 'usr_me'
  if (a.type === 'agent') return EXTERNAL.agent?.has(a.id) ?? false
  if (a.type === 'workflow') return EXTERNAL.workflow?.has(a.id) ?? false
  return a.id === 'system'
}

/** Every `{ kind, id }` object anywhere in the content (pinned refs, origins, citations, links…). */
function collectRefs(value: unknown, out: EntityRef[] = []): EntityRef[] {
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out)
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    if (keys.length === 2 && keys[0] === 'id' && keys[1] === 'kind') out.push(value as EntityRef)
    else for (const v of Object.values(value)) collectRefs(v, out)
  }
  return out
}

const TIMESTAMP_KEYS = new Set(['createdAt', 'updatedAt', 'completedAt', 'at', 'addedAt', 'publishedAt', 'readAt'])

function collectTimestamps(value: unknown, path: string, out: Array<[string, number]> = []): Array<[string, number]> {
  if (Array.isArray(value)) value.forEach((v, i) => collectTimestamps(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (TIMESTAMP_KEYS.has(k) && typeof v === 'number') out.push([`${path}.${k}`, v])
      else collectTimestamps(v, `${path}.${k}`, out)
    }
  }
  return out
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length

describe('seed content', () => {
  it('creates every story-bible id owned by the content part', () => {
    for (const id of Object.values(PROJECT)) expect(seed.projects[id], id).toBeDefined()
    for (const id of Object.values(COLLECTION)) expect(seed.collections[id], id).toBeDefined()
    for (const id of Object.values(THREAD)) expect(seed.threads[id], id).toBeDefined()
    for (const id of Object.values(KNOWLEDGE)) expect(seed.knowledge[id], id).toBeDefined()
    for (const id of Object.values(INVESTIGATION)) expect(seed.investigations[id], id).toBeDefined()
    for (const id of Object.values(BOARD)) expect(seed.boards[id], id).toBeDefined()
    for (const id of Object.values(TASK)) expect(seed.tasks[id], id).toBeDefined()
  })

  it('gives every task and asset a distinct short code', () => {
    for (const table of ['tasks', 'assets'] as const) {
      const codes = Object.keys(seed[table]).map((id) => shortCode(id))
      expect(new Set(codes).size, table).toBe(codes.length)
    }
  })

  it('keys every row by its own id', () => {
    for (const [table, rows] of Object.entries(seed)) {
      for (const [key, row] of Object.entries(rows as Record<string, { id: string }>)) expect(row.id, `${table}:${key}`).toBe(key)
    }
  })

  it('only references entities that exist (here or in the operations part)', () => {
    const missing = collectRefs(seed).filter((r) => !exists(r)).map((r) => `${r.kind}:${r.id}`)
    expect(missing).toEqual([])

    const projectIds = new Set(Object.keys(seed.projects))
    const scoped = [
      ...Object.values(seed.tasks), ...Object.values(seed.threads), ...Object.values(seed.investigations),
      ...Object.values(seed.assets), ...Object.values(seed.boards), ...Object.values(seed.activity),
    ]
    for (const row of scoped) if (row.projectId !== null) expect(projectIds.has(row.projectId), row.id).toBe(true)
    for (const k of Object.values(seed.knowledge)) {
      for (const p of k.projectIds) expect(projectIds.has(p), k.id).toBe(true)
      if (k.collectionId) expect(seed.collections[k.collectionId], k.id).toBeDefined()
      expect(actorExists(k.author), k.id).toBe(true)
    }
    for (const a of Object.values(seed.assets)) if (a.boardId) expect(seed.boards[a.boardId], a.id).toBeDefined()
    for (const p of Object.values(seed.projects)) for (const r of p.repoIds) expect(EXTERNAL.repo?.has(r), p.id).toBe(true)
    for (const e of Object.values(seed.activity)) expect(actorExists(e.actor), e.id).toBe(true)
  })

  it('keeps threads and messages in sync', () => {
    const seen = new Set<string>()
    for (const t of Object.values(seed.threads)) {
      expect(t.messageIds.length, t.id).toBeGreaterThanOrEqual(4)
      let prev = -Infinity
      t.messageIds.forEach((id, i) => {
        const m = seed.messages[id]
        expect(m, `${t.id} → ${id}`).toBeDefined()
        expect(m.threadId).toBe(t.id)
        expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant')
        expect(m.createdAt).toBeGreaterThan(prev)
        prev = m.createdAt
        seen.add(id)
      })
      expect(t.createdAt).toBe(seed.messages[t.messageIds[0]].createdAt)
      expect(t.updatedAt).toBe(seed.messages[t.messageIds[t.messageIds.length - 1]].createdAt)
    }
    expect(seen.size).toBe(Object.keys(seed.messages).length)
    expect(Object.values(seed.threads).filter((t) => t.pinned)).toHaveLength(2)
  })

  it('labels every AI-produced message as simulated', () => {
    for (const m of Object.values(seed.messages)) {
      expect(m.status).toBe('complete')
      if (m.role !== 'assistant') continue
      expect(m.simulated, m.id).toBe(true)
      expect(m.providerId).toBe('simulator')
      expect(['sim-deep', 'sim-swift']).toContain(m.modelId)
      expect(m.usage?.costUsd).toBe(0)
      expect(m.usage?.inputTokens).toBeGreaterThan(0)
      expect(m.runId).toBeUndefined()
    }
  })

  it('quotes citation snippets verbatim from the cited knowledge', () => {
    let count = 0
    for (const m of Object.values(seed.messages)) {
      for (const c of m.citations ?? []) {
        const k = seed.knowledge[c.ref.id]
        expect(k, c.id).toBeDefined()
        expect(c.title).toBe(k.title)
        expect(k.content.includes(c.snippet ?? ''), `${c.id}: "${c.snippet}"`).toBe(true)
        count++
      }
    }
    expect(count).toBeGreaterThan(20)
  })

  it('only cites knowledge the turn retrieved or the conversation attached', () => {
    for (const t of Object.values(seed.threads)) {
      const attached = new Set(t.messageIds.flatMap((id) => (seed.messages[id].attachments ?? []).map((a) => a.knowledgeId ?? '')))
      for (const id of t.messageIds) {
        const m = seed.messages[id]
        const retrieved = new Set((m.tools ?? []).flatMap((tool) => (tool.results ?? []).map((r) => r.id)))
        for (const c of m.citations ?? []) expect(retrieved.has(c.ref.id) || attached.has(c.ref.id), `${m.id} cites ${c.ref.id}`).toBe(true)
      }
    }
  })

  it('links every derived entity both ways (origin, link and message.derived)', () => {
    const linkKey = (from: EntityRef, to: EntityRef) => `${from.kind}:${from.id}->${to.kind}:${to.id}`
    const derivedLinks = new Set(Object.values(seed.links).filter((l) => l.rel === 'derived_from').map((l) => linkKey(l.from, l.to)))
    const origins: Array<[EntityRef, EntityRef]> = [
      ...Object.values(seed.tasks).filter((t) => t.origin).map((t): [EntityRef, EntityRef] => [{ kind: 'task', id: t.id }, t.origin!]),
      ...Object.values(seed.investigations).filter((i) => i.origin).map((i): [EntityRef, EntityRef] => [{ kind: 'investigation', id: i.id }, i.origin!]),
    ]
    expect(origins.length).toBeGreaterThan(15)
    for (const [from, to] of origins) {
      expect(derivedLinks.has(linkKey(from, to)), linkKey(from, to)).toBe(true)
      if (to.kind === 'message') {
        expect(seed.messages[to.id].derived?.some((d) => d.kind === from.kind && d.id === from.id), linkKey(from, to)).toBe(true)
      }
    }
    for (const id of Object.values(MSG)) expect(seed.messages[id]?.derived?.length, id).toBeGreaterThan(0)
    for (const m of Object.values(seed.messages)) {
      for (const d of m.derived ?? []) expect(derivedLinks.has(linkKey(d, { kind: 'message', id: m.id })), `${m.id} → ${d.id}`).toBe(true)
    }
    const pricing = seed.investigations[INVESTIGATION.pricingTrends]
    expect(pricing.origin?.kind).toBe('message')
    expect(seed.messages[pricing.origin!.id].threadId).toBe(THREAD.pricing)
    expect(derivedLinks.has(linkKey({ kind: 'knowledge', id: KNOWLEDGE.tidewellTeardown }, { kind: 'investigation', id: INVESTIGATION.tidewell }))).toBe(true)
  })

  it('never puts a creation or event time in the future', () => {
    const future = collectTimestamps(seed, 'seed').filter(([, ts]) => ts > NOW).map(([p]) => p)
    expect(future).toEqual([])
    for (const t of Object.values(seed.tasks)) {
      expect(t.updatedAt, t.id).toBeGreaterThanOrEqual(t.createdAt)
      if (t.status === 'done') expect(t.completedAt, t.id).toBeDefined()
      else expect(t.completedAt, t.id).toBeUndefined()
      if (t.milestoneId) expect(seed.projects[t.projectId ?? '']?.milestones.some((ms) => ms.id === t.milestoneId), t.id).toBe(true)
      expect(t.runIds).toEqual([])
    }
    for (const k of Object.values(seed.knowledge)) {
      expect(k.updatedAt).toBeGreaterThanOrEqual(k.createdAt)
      expect(NOW - k.createdAt).toBeLessThanOrEqual(60 * 86_400_000)
    }
  })

  it('keeps milestone statuses consistent with their dates', () => {
    for (const p of Object.values(seed.projects)) {
      expect(p.milestones.length).toBeGreaterThanOrEqual(2)
      for (const ms of p.milestones) {
        if (ms.status === 'done') expect(ms.dueAt ?? 0, ms.id).toBeLessThanOrEqual(NOW)
        else expect(ms.dueAt ?? Infinity, ms.id).toBeGreaterThan(NOW)
      }
    }
  })

  it('shapes research honestly', () => {
    for (const s of Object.values(seed.sources)) {
      expect(s.investigationId && seed.investigations[s.investigationId]?.sourceIds.includes(s.id), s.id).toBe(true)
      if (s.kind === 'knowledge') {
        expect(s.simulated, s.id).toBe(false)
        expect(seed.knowledge[s.knowledgeId ?? ''], s.id).toBeDefined()
      } else {
        expect(s.simulated, s.id).toBe(true)
        expect(s.domain?.endsWith('.example'), s.id).toBe(true)
        expect(new URL(s.url ?? '').hostname, s.id).toBe(s.domain)
        expect(s.credibility).toBeGreaterThanOrEqual(0.45)
        expect(s.credibility).toBeLessThanOrEqual(0.9)
      }
    }
    for (const inv of Object.values(seed.investigations)) {
      for (const sid of inv.sourceIds) expect(seed.sources[sid]?.investigationId, sid).toBe(inv.id)
      for (const f of inv.findings) for (const sid of f.sourceIds) expect(inv.sourceIds, f.id).toContain(sid)
      expect(inv.runIds).toEqual([])
    }
    const tidewell = seed.investigations[INVESTIGATION.tidewell]
    expect(tidewell.status).toBe('complete')
    expect(tidewell.findings).toHaveLength(6)
    expect(tidewell.sourceIds).toEqual(Array.from({ length: 10 }, (_, i) => `src_tidewell_${i + 1}`))
    expect(tidewell.sourceIds.filter((id) => seed.sources[id].kind === 'knowledge')).toHaveLength(2)
    expect(tidewell.knowledgeId).toBe(KNOWLEDGE.tidewellTeardown)

    const pricing = seed.investigations[INVESTIGATION.pricingTrends]
    expect(pricing.status).toBe('running')
    expect(pricing.depth).toBe('deep')
    expect(pricing.findings).toEqual([])
    expect(pricing.report).toBeUndefined()
    expect(pricing.sourceIds.map((id) => seed.sources[id].status)).toEqual(['read', 'read', 'read', 'queued', 'queued', 'queued', 'queued', 'queued'])

    const churn = seed.investigations[INVESTIGATION.churn]
    expect(churn.status).toBe('review')
    expect(churn.sourceIds).toHaveLength(7)
    expect(churn.sourceIds.some((id) => seed.sources[id].knowledgeId === KNOWLEDGE.meridianCall)).toBe(true)

    const einvoicing = seed.investigations[INVESTIGATION.einvoicing]
    expect(einvoicing.status).toBe('draft')
    expect(einvoicing.sourceIds).toEqual([])
  })

  it('writes substantive knowledge', () => {
    for (const k of Object.values(seed.knowledge)) {
      expect(k.tags.length, k.id).toBeGreaterThanOrEqual(3)
      expect(k.tags.length, k.id).toBeLessThanOrEqual(6)
      expect(k.summary, k.id).toBeTruthy()
      if (k.kind === 'dataset' || k.kind === 'file') {
        expect(k.file?.size, k.id).toBe(k.content.length)
        expect(k.content.split('\n').length, k.id).toBeGreaterThan(15)
      } else {
        expect(words(k.content), k.id).toBeGreaterThanOrEqual(250)
        expect(words(k.content), k.id).toBeLessThanOrEqual(900)
      }
    }
    expect(Object.values(seed.knowledge).filter((k) => k.pinned).length).toBeGreaterThanOrEqual(3)
  })

  it('builds studio assets that render', () => {
    const assets = Object.values(seed.assets)
    expect(assets.filter((a) => a.status === 'failed')).toHaveLength(1)
    for (const a of assets) {
      expect(a.generator.simulated, a.id).toBe(true)
      if (a.status === 'failed') {
        expect(a.versions).toEqual([])
        continue
      }
      expect(a.status).toBe('ready')
      expect(a.versions.length, a.id).toBeGreaterThanOrEqual(1)
      expect(a.versions[a.currentVersion], a.id).toBeDefined()
      for (const v of a.versions) {
        expect(v.preview.type).toBe('procedural')
        if (v.preview.type === 'procedural') for (const c of v.preview.palette) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/)
      }
    }
    const keynote = assets.find((a) => a.kind === 'presentation')
    expect(keynote?.slides).toHaveLength(8)
    expect(assets.find((a) => a.kind === 'video')?.slides?.length).toBeGreaterThan(0)
  })

  it('assigns the anchor tasks as the story bible says', () => {
    const expectations: Array<[string, string | null, string]> = [
      [TASK.ssoFix, AGENT.forge, 'review'],
      [TASK.stripeMigration, AGENT.forge, 'in_progress'],
      [TASK.bundleSize, AGENT.forge, 'done'],
      [TASK.flakyTest, AGENT.forge, 'todo'],
      [TASK.weeklyDigest, AGENT.herald, 'in_progress'],
      // 'review' rather than 'todo': the operations part already has Scout's draft and revision runs for it.
      [TASK.competitorBrief, AGENT.scout, 'review'],
      [TASK.heroVideo, AGENT.muse, 'in_progress'],
      [TASK.triageRubric, null, 'review'],
    ]
    for (const [id, agentId, status] of expectations) {
      const t = seed.tasks[id]
      expect(t.status, id).toBe(status)
      if (agentId) expect(t.assignee, id).toEqual({ type: 'agent', id: agentId })
      else expect(t.assignee?.type, id).toBe('user')
    }
  })

  it('is deterministic and fast', () => {
    expect(JSON.stringify(buildContent(NOW))).toBe(JSON.stringify(seed))
    let best = Infinity
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      buildContent(NOW + i)
      best = Math.min(best, performance.now() - t0)
    }
    expect(best).toBeLessThan(50)
  })

  it('never uses clocks, randomness or random ids in the seed source', () => {
    const files = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(files).length).toBeGreaterThan(5)
    for (const [file, text] of Object.entries(files)) {
      expect(/Date\.now\(|Math\.random\(|newId\(/.test(text), file).toBe(false)
    }
  })

  it('fits together with the operations part', () => {
    const merged = buildSeed(NOW)
    const tables = merged as unknown as Record<string, Record<string, { createdAt?: number }>>
    const own: Partial<Record<EntityKind, string>> = TABLE_FOR as Partial<Record<EntityKind, string>>
    // Every reference anywhere in the merged world that points into a content-owned table resolves.
    const dangling = collectRefs(merged).filter((r) => own[r.kind] && !(r.id in tables[own[r.kind] as string])).map((r) => `${r.kind}:${r.id}`)
    expect(dangling).toEqual([])
    for (const run of Object.values(merged.runs)) {
      const o = run.origin
      const table = o ? own[o.kind] : undefined
      if (!o || !table) continue
      // The thing a run was started from existed before the run started.
      expect(tables[table][o.id]?.createdAt ?? 0, `${run.id} ← ${o.kind}:${o.id}`).toBeLessThanOrEqual((run.startedAt ?? run.createdAt) + 1_000)
      // Chat runs line up with an assistant message in their thread.
      if (run.kind === 'chat' && o.kind === 'thread') {
        const t0 = run.startedAt ?? run.createdAt
        const near = merged.threads[o.id].messageIds.some((id) => merged.messages[id].role === 'assistant' && Math.abs(merged.messages[id].createdAt - t0) < 5 * 60_000)
        expect(near, run.id).toBe(true)
      }
    }
    for (const session of Object.values(merged.sessions)) {
      if (session.taskId) expect(merged.tasks[session.taskId]?.createdAt ?? Infinity, session.id).toBeLessThanOrEqual(session.createdAt)
    }
  })
})
