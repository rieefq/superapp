import { estimateTokens } from '@/core/ai/models'
import { useDB, type TableName, type Tables } from '@/core/db'
import { describeSource } from '@/core/services/handoff'
import { refKey, type Attachment, type EntityKind, type EntityRef, type Project } from '@/core/types'

/**
 * Token estimates for the Context Line and the ContextMeter. Estimates are deliberately simple
 * (~4 characters per token, the same rule the AI layer uses when a provider reports nothing) and
 * err on the high side: an attached item counts with its full text.
 */

const TABLE_FOR_KIND: Record<EntityKind, TableName> = {
  project: 'projects',
  task: 'tasks',
  thread: 'threads',
  message: 'messages',
  run: 'runs',
  approval: 'approvals',
  agent: 'agents',
  workflow: 'workflows',
  knowledge: 'knowledge',
  collection: 'collections',
  investigation: 'investigations',
  source: 'sources',
  repo: 'repos',
  session: 'sessions',
  asset: 'assets',
  board: 'boards',
  integration: 'connections',
}

/** The stored row behind a ref in a database snapshot (undefined when it no longer exists). */
export function rowFor(s: Tables, ref: EntityRef): unknown {
  const table = TABLE_FOR_KIND[ref.kind]
  return table ? (s[table] as Record<string, unknown>)[ref.id] : undefined
}

const cache = new Map<string, { row: unknown; tokens: number }>()

function textOf(ref: EntityRef, row: unknown): string {
  if (!row) return ''
  switch (ref.kind) {
    case 'knowledge': {
      const k = row as Tables['knowledge'][string]
      return `${k.title}\n${k.content}`
    }
    case 'message':
      return (row as Tables['messages'][string]).content
    default:
      try {
        const d = describeSource(ref)
        return `${d.title}\n${d.text}`
      } catch {
        return ''
      }
  }
}

/** Estimated tokens an entity contributes when it rides along as context. Memoized per stored row. */
export function estimateRefTokens(ref: EntityRef, s: Tables = useDB.getState()): number {
  const row = rowFor(s, ref)
  if (!row) return 0
  const key = refKey(ref)
  const hit = cache.get(key)
  if (hit && hit.row === row) return hit.tokens
  const tokens = estimateTokens(textOf(ref, row))
  if (cache.size > 500) cache.clear()
  cache.set(key, { row, tokens })
  return tokens
}

/** Project memory: goal + instructions (+ the pinned items, counted separately by the caller). */
export function estimateMemoryTokens(project: Pick<Project, 'goal' | 'instructions' | 'name'> | undefined): number {
  if (!project) return 0
  const text = [project.name, project.goal, project.instructions].filter(Boolean).join('\n')
  return text ? estimateTokens(text) : 0
}

/** Tokens of a file attachment: its extracted text, a flat image cost, or just its name. */
export function estimateAttachmentTokens(a: Attachment): number {
  if (a.text) return estimateTokens(a.text)
  if (a.kind === 'image' && a.previewUrl) return 1600
  return estimateTokens(a.name)
}

/** "~840", "~3.2k", "~1.2M" — the ContextMeter's reading. */
export function formatTokenCount(n: number, approx = true): string {
  const prefix = approx ? '~' : ''
  if (n < 1000) return `${prefix}${Math.max(0, Math.round(n))}`
  if (n < 1_000_000) {
    const k = n / 1000
    return `${prefix}${k < 10 ? trim(k.toFixed(1)) : Math.round(k)}k`
  }
  const m = n / 1_000_000
  return `${prefix}${m < 10 ? trim(m.toFixed(1)) : Math.round(m)}M`
}

/** A model's context window: "200k", "1M". */
export function formatWindow(n: number): string {
  return formatTokenCount(n, false)
}

function trim(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s
}
