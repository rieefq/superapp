import { db, ID_PREFIX, useRow, useRows } from '@/core/db'
import { runEngine } from '@/core/runs/engine'
import { deriveAngles, investigationTitle } from '@/core/sim/research'
import { stableId } from '@/core/sim/ids'
import { excerpt, keyTerms } from '@/core/sim/text'
import {
  ME, isRunActive,
  type EntityRef, type Finding, type ID, type Investigation, type InvestigationStatus, type KnowledgeItem, type ResearchDepth, type Run, type Source,
} from '@/core/types'
import { newId } from '@/lib/id'
import { logActivity } from './activity'
import { createKnowledge, updateKnowledge } from './knowledge'
import { link } from './links'
import { forgetRef, markDerived } from './serviceHelpers'

/**
 * Research service: investigations, their sources and findings. Research runs are driven
 * by the 'research.investigate' / 'research.follow_up' simulation scripts
 * (src/core/runs/factories/research.ts); everything here is the user-facing side.
 */

export const RESEARCH_FACTORY = 'research.investigate'
export const RESEARCH_FOLLOW_UP_FACTORY = 'research.follow_up'
export const RESEARCH_AGENT_ID = 'agt_scout'
export const RESEARCH_COLLECTION_ID = 'col_research'

const invRef = (id: ID): EntityRef => ({ kind: 'investigation', id })
const quoted = (s: string) => `“${s.length > 80 ? `${s.slice(0, 79)}…` : s}”`

/** The research agent, when it exists and is active (otherwise runs have no agent). */
function researchAgentId(): ID | undefined {
  const agent = db.get('agents', RESEARCH_AGENT_ID)
  return agent && agent.status === 'active' ? agent.id : undefined
}

function touch(id: ID, patch: Partial<Investigation> | ((inv: Investigation) => Investigation)): Investigation | undefined {
  const now = Date.now()
  return db.update('investigations', id, (inv) => {
    const next = typeof patch === 'function' ? patch(inv) : { ...inv, ...patch }
    return next === inv ? inv : { ...next, updatedAt: now }
  })
}

// ---------------------------------------------------------------- investigations

export interface CreateInvestigationInput {
  question: string
  title?: string
  projectId?: ID | null
  depth?: ResearchDepth
  angles?: string[]
  origin?: EntityRef
  /** Source types the run may use (defaults: knowledge true, web true). */
  sources?: { knowledge?: boolean; web?: boolean }
  /** Start the research run immediately (default true). */
  start?: boolean
}

export function createInvestigation(input: CreateInvestigationInput): Investigation {
  const question = input.question.trim()
  if (!question) throw new Error('Ask a question to start an investigation.')
  const now = Date.now()
  const depth = input.depth ?? 'standard'
  const start = input.start !== false
  const projectName = input.projectId ? db.get('projects', input.projectId)?.name : undefined
  const angles = (input.angles ?? []).map((a) => a.trim()).filter(Boolean)
  const inv: Investigation = {
    id: newId(ID_PREFIX.investigations),
    title: input.title?.trim() || investigationTitle(question),
    question,
    projectId: input.projectId ?? null,
    status: start ? 'running' : 'draft',
    depth,
    angles: angles.length ? angles : deriveAngles(question, depth === 'quick' ? 3 : 4, { projectName }),
    sourceIds: [],
    findings: [],
    runIds: [],
    createdAt: now,
    updatedAt: now,
  }
  if (input.sources) {
    const knowledge = input.sources.knowledge ?? true
    const web = input.sources.web ?? true
    if (!knowledge && !web) throw new Error('Choose at least one source for the investigation.')
    inv.sources = { knowledge, web }
  }
  if (input.origin) inv.origin = { kind: input.origin.kind, id: input.origin.id }
  db.insert('investigations', inv)
  if (input.origin) markDerived(invRef(inv.id), input.origin)
  logActivity({ actor: ME, verb: 'created', target: invRef(inv.id), summary: `Created investigation ${quoted(inv.title)}`, projectId: inv.projectId })
  if (start) {
    try {
      startInvestigation(inv.id)
    } catch (error) {
      touch(inv.id, { status: 'draft' })
      throw error
    }
  }
  return db.get('investigations', inv.id) ?? inv
}

export type InvestigationPatch = Partial<Pick<Investigation, 'title' | 'question' | 'depth' | 'angles' | 'projectId'>>

/** Edit a (usually draft) investigation's brief. */
export function updateInvestigation(id: ID, patch: InvestigationPatch): Investigation | undefined {
  const clean: InvestigationPatch = {}
  if (patch.title?.trim()) clean.title = patch.title.trim()
  if (patch.question?.trim()) clean.question = patch.question.trim()
  if (patch.depth !== undefined) clean.depth = patch.depth
  if (patch.angles !== undefined) clean.angles = patch.angles.map((a) => a.trim()).filter(Boolean)
  if (patch.projectId !== undefined) clean.projectId = patch.projectId
  return touch(id, (inv) => ({ ...inv, ...clean }))
}

/** The investigation's run that is still in progress, if any. */
export function activeResearchRun(inv: Investigation): Run | undefined {
  for (const runId of [...inv.runIds].reverse()) {
    const run = db.get('runs', runId)
    if (run && isRunActive(run.status)) return run
  }
  return undefined
}

/** Start (or return the already running) research run for an investigation. */
export function startInvestigation(id: ID): Run | undefined {
  const inv = db.get('investigations', id)
  if (!inv) return undefined
  const active = activeResearchRun(inv)
  if (active) return active
  const run = runEngine.start({
    kind: 'research',
    title: inv.title,
    factory: RESEARCH_FACTORY,
    params: { investigationId: id },
    projectId: inv.projectId,
    origin: invRef(id),
    agentId: researchAgentId(),
  })
  touch(id, (cur) => ({ ...cur, status: 'running', runIds: cur.runIds.includes(run.id) ? cur.runIds : [...cur.runIds, run.id] }))
  return run
}

/** Ask a follow-up question: a new run that appends a "Follow-up" section and findings. */
export function askFollowUp(id: ID, question: string): Run | undefined {
  const inv = db.get('investigations', id)
  const q = question.trim()
  if (!inv || !q) return undefined
  const run = runEngine.start({
    kind: 'research',
    title: `Follow-up: ${q.length > 70 ? `${q.slice(0, 69)}…` : q}`,
    factory: RESEARCH_FOLLOW_UP_FACTORY,
    params: { investigationId: id, question: q },
    projectId: inv.projectId,
    origin: invRef(id),
    agentId: researchAgentId(),
  })
  touch(id, (cur) => ({ ...cur, status: 'running', runIds: cur.runIds.includes(run.id) ? cur.runIds : [...cur.runIds, run.id] }))
  logActivity({ actor: ME, verb: 'asked', target: invRef(id), summary: `Asked a follow-up on ${quoted(inv.title)}: ${quoted(q)}`, projectId: inv.projectId })
  return run
}

/** Mark the investigation as complete (the report has been reviewed). */
export function completeInvestigation(id: ID): Investigation | undefined {
  const inv = db.get('investigations', id)
  if (!inv || inv.status === 'complete') return inv
  const next = touch(id, { status: 'complete' })
  logActivity({ actor: ME, verb: 'completed', target: invRef(id), summary: `Completed investigation ${quoted(inv.title)}`, projectId: inv.projectId })
  return next
}

export function updateReport(id: ID, markdown: string): Investigation | undefined {
  const inv = db.get('investigations', id)
  if (!inv || inv.report === markdown) return inv
  const next = touch(id, { report: markdown })
  logActivity({ actor: ME, verb: 'edited', target: invRef(id), summary: `Edited the report of ${quoted(inv.title)}`, projectId: inv.projectId })
  return next
}

/**
 * Save (or update) the report as a Knowledge item of kind 'report'. Idempotent: a second
 * call updates the item that was saved before instead of creating another one.
 */
export function saveReportToKnowledge(id: ID): KnowledgeItem | undefined {
  const inv = db.get('investigations', id)
  if (!inv?.report?.trim()) return undefined
  const existing = inv.knowledgeId ? db.get('knowledge', inv.knowledgeId) : undefined
  if (existing) {
    const updated = updateKnowledge(existing.id, { title: inv.title, content: inv.report, summary: reportSummary(inv.report) })
    return updated
  }
  const item = createKnowledge(
    {
      kind: 'report',
      title: inv.title,
      content: inv.report,
      summary: reportSummary(inv.report),
      collectionId: db.get('collections', RESEARCH_COLLECTION_ID) ? RESEARCH_COLLECTION_ID : null,
      projectIds: inv.projectId ? [inv.projectId] : [],
      tags: ['research', ...keyTerms(inv.question, 2).map((t) => t.toLowerCase())],
      source: { type: 'research', ref: invRef(id) },
      simulated: inv.runIds.length > 0 || undefined,
    },
    { verb: 'saved', summary: `Saved the report of ${quoted(inv.title)} to Knowledge` },
  )
  link(invRef(id), { kind: 'knowledge', id: item.id }, 'produced')
  touch(id, { knowledgeId: item.id })
  return item
}

function reportSummary(report: string): string | undefined {
  const section = /## Executive summary\s+([\s\S]*?)(\n## |$)/.exec(report)?.[1]
  const text = excerpt(section ?? report, 240)
  return text || undefined
}

export function deleteInvestigation(id: ID): void {
  const inv = db.get('investigations', id)
  if (!inv) return
  for (const runId of inv.runIds) {
    const run = db.get('runs', runId)
    if (run && isRunActive(run.status)) runEngine.cancel(runId, 'Investigation deleted')
  }
  const sourceIds = db.filter('sources', (s) => s.investigationId === id).map((s) => s.id)
  for (const sid of sourceIds) forgetRef({ kind: 'source', id: sid })
  db.removeMany('sources', sourceIds)
  forgetRef(invRef(id))
  db.remove('investigations', id)
  logActivity({ actor: ME, verb: 'deleted', target: invRef(id), summary: `Deleted investigation ${quoted(inv.title)}`, projectId: inv.projectId })
}

// ---------------------------------------------------------------- sources

function domainOf(url: string | undefined): { url?: string; domain?: string } {
  if (!url?.trim()) return {}
  const raw = url.trim()
  for (const candidate of [raw, `https://${raw}`]) {
    try {
      const u = new URL(candidate)
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) continue
      return { url: u.toString(), domain: u.hostname.replace(/^www\./, '') }
    } catch {
      // try the next form
    }
  }
  return { url: raw }
}

/** Append source ids to an investigation (deduplicated, order kept). */
export function appendSourceIds(investigationId: ID, ids: readonly ID[]): void {
  if (!ids.length) return
  touch(investigationId, (inv) => {
    const missing = ids.filter((sid) => !inv.sourceIds.includes(sid))
    return missing.length ? { ...inv, sourceIds: [...inv.sourceIds, ...missing] } : inv
  })
}

/** Add a source by hand. Page content is not fetched in this build, so it starts queued with an honest note. */
export function addSource(investigationId: ID, input: { url?: string; title?: string; snippet?: string }): Source | undefined {
  const inv = db.get('investigations', investigationId)
  if (!inv) return undefined
  const { url, domain } = domainOf(input.url)
  const source: Source = {
    id: newId(ID_PREFIX.sources),
    investigationId,
    kind: url ? 'web' : 'doc',
    title: input.title?.trim() || domain || url || 'Untitled source',
    snippet: input.snippet?.trim() ?? '',
    content: 'Page content is not fetched in this build. Add your own notes or a summary to use this source in findings.',
    credibility: 0.5,
    status: 'queued',
    simulated: false,
    addedAt: Date.now(),
  }
  if (url) source.url = url
  if (domain) source.domain = domain
  db.insert('sources', source)
  appendSourceIds(investigationId, [source.id])
  logActivity({ actor: ME, verb: 'added', target: invRef(investigationId), summary: `Added source ${quoted(source.title)} to ${quoted(inv.title)}`, projectId: inv.projectId })
  return source
}

export function setSourceStatus(id: ID, status: Source['status']): Source | undefined {
  const cur = db.get('sources', id)
  if (!cur || cur.status === status) return cur
  const next = db.update('sources', id, { status })
  if (cur.investigationId) touch(cur.investigationId, {})
  return next
}

export function discardSource(id: ID): Source | undefined {
  const cur = db.get('sources', id)
  if (!cur || cur.status === 'discarded') return cur
  const next = setSourceStatus(id, 'discarded')
  const inv = cur.investigationId ? db.get('investigations', cur.investigationId) : undefined
  if (inv) logActivity({ actor: ME, verb: 'discarded', target: invRef(inv.id), summary: `Discarded source ${quoted(cur.title)}`, projectId: inv.projectId })
  return next
}

/** Restore a discarded source: back to 'read' when it has content, otherwise 'queued'. */
export function restoreSource(id: ID): Source | undefined {
  const cur = db.get('sources', id)
  if (!cur || cur.status !== 'discarded') return cur
  const cited = cur.investigationId ? db.get('investigations', cur.investigationId)?.findings.some((f) => f.sourceIds.includes(id)) : false
  const read = cur.kind === 'knowledge' || (cur.simulated && !!cur.content)
  return setSourceStatus(id, cited ? 'cited' : read ? 'read' : 'queued')
}

// ---------------------------------------------------------------- findings

export function addFinding(investigationId: ID, text: string, sourceIds: ID[] = [], confidence: Finding['confidence'] = 'medium'): Finding | undefined {
  const inv = db.get('investigations', investigationId)
  const clean = text.trim()
  if (!inv || !clean) return undefined
  const finding: Finding = { id: newId('fnd'), text: clean, sourceIds: [...new Set(sourceIds)], confidence }
  touch(investigationId, (cur) => ({ ...cur, findings: [...cur.findings, finding] }))
  markCited(finding.sourceIds)
  logActivity({ actor: ME, verb: 'added', target: invRef(investigationId), summary: `Added a finding to ${quoted(inv.title)}`, projectId: inv.projectId })
  return finding
}

export function updateFinding(investigationId: ID, findingId: ID, patch: Partial<Pick<Finding, 'text' | 'sourceIds' | 'confidence'>>): Finding | undefined {
  let updated: Finding | undefined
  touch(investigationId, (inv) => {
    const idx = inv.findings.findIndex((f) => f.id === findingId)
    if (idx < 0) return inv
    const cur = inv.findings[idx]
    updated = { ...cur, ...patch, text: patch.text !== undefined ? patch.text.trim() || cur.text : cur.text }
    const findings = [...inv.findings]
    findings[idx] = updated
    return { ...inv, findings }
  })
  if (updated && patch.sourceIds) markCited(updated.sourceIds)
  return updated
}

export function togglePinFinding(investigationId: ID, findingId: ID): Finding | undefined {
  const cur = db.get('investigations', investigationId)?.findings.find((f) => f.id === findingId)
  if (!cur) return undefined
  touch(investigationId, (inv) => ({
    ...inv,
    findings: inv.findings.map((f) => (f.id === findingId ? { ...f, pinned: !f.pinned || undefined } : f)),
  }))
  return db.get('investigations', investigationId)?.findings.find((f) => f.id === findingId)
}

export function removeFinding(investigationId: ID, findingId: ID): void {
  touch(investigationId, (inv) => {
    const findings = inv.findings.filter((f) => f.id !== findingId)
    return findings.length === inv.findings.length ? inv : { ...inv, findings }
  })
}

/** Sources referenced by findings become 'cited' (discarded ones stay discarded). */
export function markCited(sourceIds: readonly ID[]): void {
  for (const sid of sourceIds) {
    const s = db.get('sources', sid)
    if (s && s.status !== 'discarded' && s.status !== 'cited') db.update('sources', sid, { status: 'cited' })
  }
}

/** Ids of the findings a research run generates (`stableId('fnd', runId, i)`). */
export function generatedFindingId(runId: ID, index: number): ID {
  return stableId('fnd', runId, index)
}

// ---------------------------------------------------------------- hooks

export interface InvestigationFilter {
  /** Only this project's investigations (null or omitted: all). */
  projectId?: ID | null
  status?: InvestigationStatus | InvestigationStatus[]
}

export function useInvestigations(filter: InvestigationFilter = {}): Investigation[] {
  const statuses = filter.status === undefined ? null : Array.isArray(filter.status) ? filter.status : [filter.status]
  return useRows(
    'investigations',
    (inv) => (!filter.projectId || inv.projectId === filter.projectId) && (!statuses || statuses.includes(inv.status)),
    (a, b) => b.updatedAt - a.updatedAt,
  )
}

export function useInvestigation(id: ID | null | undefined): Investigation | undefined {
  return useRow('investigations', id)
}

/** Sources of an investigation in citation order ([n] = position + 1), then any unlisted ones by time. */
export function useSources(investigationId: ID | null | undefined): Source[] {
  const inv = useRow('investigations', investigationId)
  const order = inv?.sourceIds
  return useRows(
    'sources',
    (s) => !!investigationId && s.investigationId === investigationId,
    (a, b) => {
      const ia = order?.indexOf(a.id) ?? -1
      const ib = order?.indexOf(b.id) ?? -1
      if (ia >= 0 && ib >= 0) return ia - ib
      if (ia >= 0) return -1
      if (ib >= 0) return 1
      return a.addedAt - b.addedAt
    },
  )
}
