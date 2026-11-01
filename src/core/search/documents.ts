import type { TableName, Tables } from '@/core/db'
import type { EntityKind, EntityRef, ID } from '@/core/types'
import { indexableText, toPlainText } from './text'

/** Title tokens count three times (BM25 title boost); tags/labels twice. */
export const TITLE_WEIGHT = 3
export const TAG_WEIGHT = 2
/** Very long content is indexed up to this many characters. */
const MAX_FIELD_CHARS = 100_000

/** Tables that are searchable, and the entity kind of their rows. */
export const TABLE_KIND = {
  projects: 'project',
  tasks: 'task',
  threads: 'thread',
  knowledge: 'knowledge',
  collections: 'collection',
  investigations: 'investigation',
  sources: 'source',
  agents: 'agent',
  workflows: 'workflow',
  sessions: 'session',
  repos: 'repo',
  assets: 'asset',
  boards: 'board',
} as const satisfies Partial<Record<TableName, EntityKind>>

export type IndexedTable = keyof typeof TABLE_KIND
export const INDEXED_TABLES = Object.keys(TABLE_KIND) as IndexedTable[]

/**
 * 'display' strips markdown fully (snippets shown to people); 'index' only drops link targets —
 * the tokenizer ignores markdown punctuation anyway, and building stays fast.
 */
export type DocMode = 'index' | 'display'

export interface DocField {
  /** Field text: plain text in 'display' mode, lightly cleaned markdown in 'index' mode. */
  text: string
  weight: number
  /** A more specific entity the text belongs to (the message within a thread). */
  anchor?: EntityRef
}

export interface SearchDoc {
  ref: EntityRef
  title: string
  body: DocField[]
  /** Projects the entity belongs to ([] = none). */
  projectIds: ID[]
  /** Sources belong to the project of their investigation, resolved at query time. */
  investigationId?: ID
  updatedAt: number
}

type FieldFn = (text: string | undefined, weight?: number, anchor?: EntityRef) => DocField[]

function fieldMaker(clean: (text: string) => string): FieldFn {
  return (text, weight = 1, anchor) => {
    if (!text) return []
    const t = clean(text.length > MAX_FIELD_CHARS ? text.slice(0, MAX_FIELD_CHARS) : text).trim()
    return t ? [anchor ? { text: t, weight, anchor } : { text: t, weight }] : []
  }
}

const FIELD: Record<DocMode, FieldFn> = { index: fieldMaker(indexableText), display: fieldMaker(toPlainText) }

function tags(list: readonly string[] | undefined): DocField[] {
  return list?.length ? [{ text: list.join(' · '), weight: TAG_WEIGHT }] : []
}

const projectOf = (id: ID | null | undefined): ID[] => (id ? [id] : [])

/** The searchable document for one row, read from `t` (null when the row does not exist). */
export function buildDoc(table: IndexedTable, id: ID, t: Tables, mode: DocMode = 'display'): SearchDoc | null {
  const ref: EntityRef = { kind: TABLE_KIND[table], id }
  const field = FIELD[mode]
  switch (table) {
    case 'projects': {
      const r = t.projects[id]
      if (!r) return null
      return { ref, title: r.name, body: [...field(r.description), ...field(r.goal)], projectIds: [r.id], updatedAt: r.updatedAt }
    }
    case 'tasks': {
      const r = t.tasks[id]
      if (!r) return null
      return { ref, title: r.title, body: [...field(r.description), ...tags(r.labels)], projectIds: projectOf(r.projectId), updatedAt: r.updatedAt }
    }
    case 'threads': {
      const r = t.threads[id]
      if (!r) return null
      const body = r.messageIds.flatMap((mid) => {
        const m = t.messages[mid]
        return m ? field(m.content, 1, { kind: 'message', id: m.id }) : []
      })
      return { ref, title: r.title, body, projectIds: projectOf(r.projectId), updatedAt: r.updatedAt }
    }
    case 'knowledge': {
      const r = t.knowledge[id]
      if (!r) return null
      return {
        ref,
        title: r.title,
        body: [...field(r.summary), ...field(r.content), ...tags(r.tags)],
        projectIds: r.projectIds,
        updatedAt: r.updatedAt,
      }
    }
    case 'collections': {
      const r = t.collections[id]
      if (!r) return null
      return { ref, title: r.name, body: field(r.description), projectIds: [], updatedAt: r.createdAt }
    }
    case 'investigations': {
      const r = t.investigations[id]
      if (!r) return null
      return { ref, title: r.title, body: [...field(r.question), ...field(r.report)], projectIds: projectOf(r.projectId), updatedAt: r.updatedAt }
    }
    case 'sources': {
      const r = t.sources[id]
      if (!r) return null
      const doc: SearchDoc = { ref, title: r.title, body: [...field(r.snippet), ...field(r.domain)], projectIds: [], updatedAt: r.addedAt }
      if (r.investigationId) doc.investigationId = r.investigationId
      return doc
    }
    case 'agents': {
      const r = t.agents[id]
      if (!r) return null
      return { ref, title: r.name, body: [...field(r.role), ...field(r.description)], projectIds: [], updatedAt: r.updatedAt }
    }
    case 'workflows': {
      const r = t.workflows[id]
      if (!r) return null
      return { ref, title: r.name, body: field(r.description), projectIds: projectOf(r.projectId), updatedAt: r.updatedAt }
    }
    case 'sessions': {
      const r = t.sessions[id]
      if (!r) return null
      return { ref, title: r.title, body: r.turns.flatMap((turn) => field(turn.prompt)), projectIds: projectOf(r.projectId), updatedAt: r.updatedAt }
    }
    case 'repos': {
      const r = t.repos[id]
      if (!r) return null
      return { ref, title: r.fullName, body: field(r.description), projectIds: projectOf(r.projectId), updatedAt: r.lastSyncedAt ?? r.connectedAt }
    }
    case 'assets': {
      const r = t.assets[id]
      if (!r) return null
      return { ref, title: r.title, body: [...field(r.prompt), ...tags(r.tags)], projectIds: projectOf(r.projectId), updatedAt: r.updatedAt }
    }
    case 'boards': {
      const r = t.boards[id]
      if (!r) return null
      return { ref, title: r.name, body: [], projectIds: projectOf(r.projectId), updatedAt: r.createdAt }
    }
  }
}

/** Projects of a document, resolving sources through their investigation. */
export function docProjectIds(doc: Pick<SearchDoc, 'projectIds' | 'investigationId'>, t: Tables): ID[] {
  if (doc.investigationId) return projectOf(t.investigations[doc.investigationId]?.projectId)
  return doc.projectIds
}
