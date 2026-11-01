import { DEPTH_BUDGET, type DepthExpectation } from '@/core/sim/research'
import { slugify, stripMarkdown } from '@/core/sim/text'
import type { Finding, ID, Investigation, InvestigationStatus, ResearchDepth, Run, RunStep, Source } from '@/core/types'

/**
 * Pure helpers for the Research workspace: grouping, phases of a research run, source statistics,
 * open questions in a report, export and hand-off text. No React, no store access.
 */

// ------------------------------------------------------------------------------------------------ groups

export const GROUP_ORDER: readonly InvestigationStatus[] = ['running', 'review', 'failed', 'complete', 'draft']

export const GROUP_LABEL: Record<InvestigationStatus, string> = {
  running: 'Running',
  review: 'Ready for review',
  failed: 'Failed',
  complete: 'Complete',
  draft: 'Drafts',
}

export const STATUS_WORD: Record<InvestigationStatus, string> = {
  running: 'Running',
  review: 'Ready for review',
  failed: 'Failed',
  complete: 'Complete',
  draft: 'Draft',
}

export interface InvestigationGroup {
  status: InvestigationStatus
  label: string
  items: Investigation[]
}

/** Investigations grouped Running · Ready for review · Failed · Complete · Drafts (newest first in each). */
export function groupInvestigations(list: readonly Investigation[]): InvestigationGroup[] {
  return GROUP_ORDER.map((status) => ({
    status,
    label: GROUP_LABEL[status],
    items: list.filter((i) => i.status === status).sort((a, b) => b.updatedAt - a.updatedAt),
  })).filter((g) => g.items.length > 0)
}

/** Case-insensitive match on the title or the question. */
export function matchesQuery(inv: Pick<Investigation, 'title' | 'question'>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return inv.title.toLowerCase().includes(q) || inv.question.toLowerCase().includes(q)
}

export const DEPTH_LETTER: Record<ResearchDepth, string> = { quick: 'Q', standard: 'S', deep: 'D' }
export const DEPTH_LABEL: Record<ResearchDepth, string> = { quick: 'Quick', standard: 'Standard', deep: 'Deep' }

// ------------------------------------------------------------------------------------------------ sources

export type SourceOrigin = 'knowledge' | 'web' | 'manual'

/** Where a source came from: your knowledge (live retrieval), the simulated web, or added by you. */
export function sourceOrigin(s: Pick<Source, 'kind' | 'simulated'>): SourceOrigin {
  if (s.kind === 'knowledge') return 'knowledge'
  return s.simulated ? 'web' : 'manual'
}

export const SOURCE_STATUS_WORD: Record<Source['status'], string> = {
  queued: 'Queued',
  reading: 'Reading',
  read: 'Read',
  cited: 'Cited',
  discarded: 'Discarded',
}

export interface SourceStats {
  total: number
  /** Not discarded. */
  active: number
  cited: number
  read: number
  queued: number
  discarded: number
  knowledge: number
  /** Simulated web sources that are not discarded. */
  simulated: number
  manual: number
}

export function sourceStats(sources: readonly Source[]): SourceStats {
  const s: SourceStats = { total: sources.length, active: 0, cited: 0, read: 0, queued: 0, discarded: 0, knowledge: 0, simulated: 0, manual: 0 }
  for (const src of sources) {
    if (src.status === 'discarded') {
      s.discarded++
      continue
    }
    s.active++
    if (src.status === 'cited') s.cited++
    else if (src.status === 'read') s.read++
    else s.queued++
    const origin = sourceOrigin(src)
    if (origin === 'knowledge') s.knowledge++
    else if (origin === 'web') s.simulated++
    else s.manual++
  }
  return s
}

/** Simulated sources the report cites (by [n] marker or through a finding). */
export function citedSimulatedCount(inv: Pick<Investigation, 'report' | 'sourceIds' | 'findings'>, sources: readonly Source[]): number {
  const byId = new Map(sources.map((s) => [s.id, s]))
  const cited = new Set<ID>()
  for (const n of citedNumbers(inv.report ?? '')) {
    const id = inv.sourceIds[n - 1]
    if (id) cited.add(id)
  }
  for (const f of inv.findings) for (const id of f.sourceIds) cited.add(id)
  let count = 0
  for (const id of cited) if (byId.get(id)?.simulated) count++
  return count
}

/** Every `[n]` / `[n, m]` citation number in a markdown text. */
export function citedNumbers(markdown: string): number[] {
  const out = new Set<number>()
  for (const m of markdown.matchAll(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?!\()/g)) {
    for (const n of m[1].split(',')) out.add(Number(n.trim()))
  }
  return [...out].sort((a, b) => a - b)
}

/** 0..1 credibility → filled cells of an n-cell meter (at least one cell for any credibility). */
export function meterCells(value: number, cells: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.max(1, Math.min(cells, Math.round(value * cells)))
}

export const CONFIDENCE_CELLS: Record<Finding['confidence'], number> = { low: 1, medium: 2, high: 3 }

// ------------------------------------------------------------------------------------------------ run phases

export type PhaseKey = 'plan' | 'search' | 'read' | 'check' | 'synthesize' | 'draft' | 'write' | 'update'
export type PhaseState = 'done' | 'current' | 'pending'

export interface Phase {
  key: PhaseKey
  /** Participle shown in the frontier strip ("Reading 7/12"). */
  label: string
  state: PhaseState
  count?: { done: number; total: number }
}

/** Which phase a step belongs to (works for generated and scripted research runs). */
export function phaseOfStep(step: Pick<RunStep, 'kind' | 'tool' | 'title'>, followUp = false): PhaseKey {
  if (step.kind === 'plan') return 'plan'
  if (step.tool === 'context' || step.tool === 'knowledge.search' || step.tool === 'web.search' || step.kind === 'search') return 'search'
  if (step.tool === 'web.browse' || step.kind === 'browse' || step.kind === 'read') return 'read'
  if (step.kind === 'think') return /cross/i.test(step.title) ? 'check' : 'synthesize'
  if (followUp) return 'update'
  if (/synthesi[sz]e.*draft|draft.*synthesi/i.test(step.title)) return 'write'
  if (/finding/i.test(step.title)) return 'synthesize'
  return 'draft'
}

const PHASE_LABEL: Record<PhaseKey, string> = {
  plan: 'Planning',
  search: 'Searching',
  read: 'Reading',
  check: 'Cross-checking',
  synthesize: 'Synthesizing',
  draft: 'Drafting',
  write: 'Writing',
  update: 'Updating the report',
}

export interface PhaseInput {
  inv: Pick<Investigation, 'depth' | 'angles' | 'sources'>
  run: Pick<Run, 'steps' | 'status'> & { script?: { factory: string } }
  /** Web sources found so far and how many of them have been read. */
  web: { found: number; read: number }
}

/**
 * The phases of a research run with their state: `Searching 3/4 → Reading 7/12 → Synthesizing`. The
 * list follows the investigation's plan (depth, web on or off); the current phase is the last step's.
 */
export function researchPhases({ inv, run, web }: PhaseInput): Phase[] {
  const followUp = run.script?.factory === 'research.follow_up'
  const scripted = run.script?.factory === 'research.investigate' || followUp
  const b = DEPTH_BUDGET[inv.depth]
  const useWeb = inv.sources?.web !== false
  const useKnowledge = inv.sources?.knowledge !== false
  const keys: PhaseKey[] = ['plan', 'search']
  if (useWeb) keys.push('read')
  if (followUp) keys.push('update')
  else {
    if (useWeb && b.contrarian) keys.push('check')
    if (b.mergedSynthesis) keys.push('write')
    else keys.push('synthesize', 'draft')
  }
  // Steps of scripted seed runs can fall outside the planned shape: add their phases in order.
  for (const step of run.steps) {
    const k = phaseOfStep(step, followUp)
    if (!keys.includes(k)) keys.splice(Math.max(1, keys.length - 1), 0, k)
  }
  const last = run.steps[run.steps.length - 1]
  const finished = run.status === 'succeeded'
  const currentIndex = finished ? keys.length : last ? keys.indexOf(phaseOfStep(last, followUp)) : 0
  const searchesPlanned = followUp ? Number(useKnowledge) + Number(useWeb) : Number(useKnowledge) + (useWeb ? (b.combinedSearch ? 1 : Math.min(b.searches, Math.max(1, inv.angles.length))) + (b.contrarian ? 1 : 0) : 0)
  const searchesDone = run.steps.filter((s) => (s.tool === 'knowledge.search' || s.tool === 'web.search') && s.status === 'done').length
  return keys.map((key, i) => {
    const state: PhaseState = i < currentIndex ? 'done' : i === currentIndex && !finished ? 'current' : 'pending'
    const phase: Phase = { key, label: PHASE_LABEL[key], state }
    if (key === 'search' && scripted && searchesPlanned > 0) phase.count = { done: Math.min(searchesDone, Math.max(searchesPlanned, searchesDone)), total: Math.max(searchesPlanned, searchesDone) }
    if (key === 'read' && web.found > 0) phase.count = { done: Math.min(web.read, web.found), total: web.found }
    return phase
  })
}

/** Sources being read right now: their URL is in the input of the running browse step. */
export function readingSourceIds(run: Pick<Run, 'steps'> | undefined, sources: readonly Source[]): Set<ID> {
  const out = new Set<ID>()
  const step = run?.steps.find((s) => s.status === 'running' && (s.tool === 'web.browse' || s.kind === 'browse'))
  if (!step) return out
  const urls = new Set((step.input ?? '').split('\n').map((l) => l.trim()).filter(Boolean))
  const refs = new Set((step.refs ?? []).filter((r) => r.kind === 'source').map((r) => r.id))
  for (const s of sources) if ((s.url && urls.has(s.url)) || refs.has(s.id)) out.add(s.id)
  return out
}

// ------------------------------------------------------------------------------------------------ plan checklist

export type CheckState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface PlanItem {
  key: string
  label: string
  state: CheckState
  /** Why an angle has no search of its own. */
  note?: string
  /** "3 sources" next to the item. */
  count?: number
  /** Context, knowledge and skeptical rows are not angles. */
  kind: 'context' | 'knowledge' | 'angle' | 'skeptic' | 'read' | 'synthesize' | 'draft'
}

const stepState = (s: RunStep | undefined): CheckState =>
  !s ? 'pending' : s.status === 'done' ? 'done' : s.status === 'failed' ? 'failed' : s.status === 'skipped' ? 'skipped' : s.status === 'pending' ? 'pending' : 'running'

/**
 * The Plan column: angles with checks, framed by context, knowledge, reading and writing. Scripted
 * runs (the seeded demo runs) only show the rows their steps actually cover.
 */
export function planChecklist(
  inv: Pick<Investigation, 'angles' | 'sources' | 'depth'>,
  run: (Pick<Run, 'steps' | 'status'> & { script?: { factory: string } }) | undefined,
  counts: { knowledge: number; webRead: number; webFound: number },
): PlanItem[] {
  const steps = run?.steps ?? []
  const generated = !run?.script || run.script.factory === 'research.investigate' || run.script.factory === 'research.follow_up'
  const items: PlanItem[] = []
  const contextStep = steps.find((s) => s.tool === 'context')
  if (contextStep) items.push({ key: 'context', label: 'Your context', state: stepState(contextStep), count: contextStep.refs?.length, kind: 'context' })
  const k = steps.find((s) => s.tool === 'knowledge.search')
  if (inv.sources?.knowledge !== false && (generated || k)) {
    items.push({ key: 'knowledge', label: 'Your knowledge', state: stepState(k), count: k?.status === 'done' ? (k.refs ? k.refs.length : counts.knowledge) : undefined, kind: 'knowledge' })
  }
  const webSearches = steps.filter((s) => s.tool === 'web.search' || (s.kind === 'search' && s.tool !== 'knowledge.search' && s.tool !== 'context'))
  const angleSearches = webSearches.filter((s) => !/skeptic/i.test(s.title))
  const combined = DEPTH_BUDGET[inv.depth].combinedSearch || (!generated && angleSearches.length <= 1)
  if (inv.sources?.web !== false) {
    const budget = DEPTH_BUDGET[inv.depth].searches
    inv.angles.forEach((angle, i) => {
      if (!combined && generated && i >= budget) {
        items.push({ key: `angle-${i}`, label: angle, state: 'skipped', note: 'No search of its own at this depth — covered in the synthesis', kind: 'angle' })
        return
      }
      const step = combined ? angleSearches[0] : angleSearches[i]
      items.push({ key: `angle-${i}`, label: angle, state: stepState(step), count: step?.status === 'done' ? step.refs?.length : undefined, kind: 'angle' })
    })
    if (DEPTH_BUDGET[inv.depth].contrarian && (generated || webSearches.some((s) => /skeptic/i.test(s.title)))) {
      const step = webSearches.find((s) => /skeptic/i.test(s.title))
      items.push({ key: 'skeptic', label: 'Skeptical views', state: stepState(step), count: step?.status === 'done' ? step.refs?.length : undefined, kind: 'skeptic' })
    }
    const reads = steps.filter((s) => s.tool === 'web.browse' || s.kind === 'browse')
    const readState: CheckState = !reads.length ? 'pending' : reads.some((s) => s.status === 'running') ? 'running' : steps.some((s) => s.kind === 'think' || s.kind === 'write') ? 'done' : 'running'
    items.push({ key: 'read', label: counts.webFound ? `Read ${counts.webRead} of ${counts.webFound} sources` : 'Read the sources', state: readState, kind: 'read' })
  } else {
    inv.angles.forEach((angle, i) => items.push({ key: `angle-${i}`, label: angle, state: stepState(steps.find((s) => s.tool === 'knowledge.search')), kind: 'angle' }))
  }
  const synth = steps.find((s) => s.kind === 'think' && !/cross/i.test(s.title)) ?? steps.find((s) => s.kind === 'write' && /synthesi|finding/i.test(s.title))
  items.push({ key: 'synthesize', label: 'Synthesize findings', state: stepState(synth), kind: 'synthesize' })
  const draft = [...steps].reverse().find((s) => s.kind === 'write')
  items.push({ key: 'draft', label: 'Draft the report', state: draft && /draft|report/i.test(draft.title) ? stepState(draft) : run?.status === 'succeeded' ? 'done' : 'pending', kind: 'draft' })
  return items
}

// ------------------------------------------------------------------------------------------------ expectations

/** "~30 s" for a simulated duration range at the current speed. */
export function formatDurationRange([lo, hi]: readonly [number, number], speed = 1): string {
  const f = Math.max(0.25, speed || 1)
  const mid = (lo + hi) / 2 / f
  if (mid < 10_000) return `~${Math.max(1, Math.round(mid / 1000))} s`
  if (mid < 60_000) return `~${Math.round(mid / 5_000) * 5} s`
  return `~${Math.round(mid / 60_000)} min`
}

export function formatRange([lo, hi]: readonly [number, number]): string {
  return lo === hi ? `${lo}` : `${lo}–${hi}`
}

/** The midpoint token estimate of a depth (for the cost estimate). */
export function midTokens(exp: Pick<DepthExpectation, 'tokens'>): number {
  return Math.round((exp.tokens[0] + exp.tokens[1]) / 2)
}

// ------------------------------------------------------------------------------------------------ open questions

export interface OpenQuestion {
  id: string
  /** Section heading it came from ("Open questions & next steps"). */
  section: string
  /** Plain text of the item (no markdown, no citations). */
  text: string
}

const WANTED_SECTION = /open questions|next steps|recommendations|what this suggests|action items|to do/i

/** Open questions, next steps and recommendations listed in a report, as candidate tasks. */
export function openQuestions(report: string | undefined): OpenQuestion[] {
  if (!report) return []
  const out: OpenQuestion[] = []
  let section: { title: string; level: number } | null = null
  for (const raw of report.split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw)
    if (heading) {
      const level = heading[1].length
      const title = stripMarkdown(heading[2]).trim()
      if (WANTED_SECTION.test(title)) section = { title, level }
      else if (section && level <= section.level) section = null
      continue
    }
    if (!section) continue
    const item = /^\s{0,3}(?:[-*+]|\d{1,2}[.)])\s+(.+)$/.exec(raw)
    if (!item) continue
    const text = cleanItem(item[1])
    if (text.length < 4) continue
    out.push({ id: `oq${out.length + 1}`, section: section.title, text })
  }
  return out
}

function cleanItem(md: string): string {
  return stripMarkdown(md.replace(/\s*\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?!\()/g, ''))
    .replace(/[“”]/g, (q) => q)
    .replace(/\s+/g, ' ')
    .trim()
}

/** A task title from an open question: its first sentence, clipped at a word boundary. */
export function taskTitle(text: string, max = 96): string {
  const first = /^(.+?[.?!])(\s|$)/.exec(text)?.[1] ?? text
  const t = first.replace(/[.]$/, '')
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).trimEnd()}…`
}

// ------------------------------------------------------------------------------------------------ hand-off text

export interface NumberedRef {
  n: number
  title: string
  simulated: boolean
}

/** `[3][9]` for a finding's sources, in report numbering. */
export function citeMarks(sourceIds: readonly ID[], order: readonly ID[]): string {
  const ns = sourceIds.map((id) => order.indexOf(id) + 1).filter((n) => n > 0).sort((a, b) => a - b)
  return [...new Set(ns)].map((n) => `[${n}]`).join('')
}

/** The coding-session prompt for "Send to Code": the selected findings, quoted with their citations. */
export function findingsBrief(inv: Pick<Investigation, 'title' | 'question' | 'sourceIds'>, findings: readonly Finding[], sources: readonly Source[]): string {
  const byId = new Map(sources.map((s) => [s.id, s]))
  const simulated = new Set(findings.flatMap((f) => f.sourceIds).filter((id) => byId.get(id)?.simulated))
  const lines = [
    `Use ${findings.length === 1 ? 'this finding' : 'these findings'} from the investigation “${inv.title}”:`,
    '',
    ...findings.map((f, i) => {
      const marks = citeMarks(f.sourceIds, inv.sourceIds)
      return `> ${i + 1}. ${f.text}${marks ? ` ${marks}` : ''} (${f.confidence} confidence)`
    }),
    '',
    `Research question: ${inv.question}`,
  ]
  if (simulated.size) lines.push('', `Note: ${simulated.size} of the cited sources are simulated web results — verify before relying on them.`)
  return lines.join('\n')
}

// ------------------------------------------------------------------------------------------------ export

export interface ExportInput {
  inv: Pick<Investigation, 'id' | 'title' | 'question' | 'report' | 'status' | 'depth' | 'sourceIds' | 'findings'>
  sources: readonly Source[]
  /** When the content was generated (the latest run's start, else the investigation's update time). */
  generatedAt: number
  simulated: boolean
  /** "INV-K3J9" */
  handle: string
}

const longDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

/**
 * The report as a Markdown file. Simulated content starts with the §8.4 notice; a numbered source list
 * is appended when the report does not list its sources itself.
 */
export function reportMarkdown({ inv, sources, generatedAt, simulated, handle }: ExportInput): string {
  const lines: string[] = []
  if (simulated) {
    lines.push(`> **Simulated content.** Generated by Atrium's local simulator on ${longDate(generatedAt)}. No AI model, web search or external service was used.`, '')
  }
  const body = (inv.report ?? '').trim()
  lines.push(body || `# ${inv.title}\n\n**Question:** ${inv.question}\n\n_No report yet._`)
  const byId = new Map(sources.map((s) => [s.id, s]))
  const listed = /^\s*[-*]\s+\[\d+\]\s/m.test(body)
  if (!listed && inv.sourceIds.length) {
    lines.push('', '## Sources', '')
    inv.sourceIds.forEach((id, i) => {
      const s = byId.get(id)
      if (!s) return
      const where =
        s.kind === 'knowledge'
          ? 'your knowledge base'
          : [s.domain, s.url && !s.simulated ? s.url : null, s.simulated ? 'simulated source, not fetched' : null].filter(Boolean).join(' · ')
      lines.push(`${i + 1}. ${s.title}${where ? ` — ${where}` : ''}${s.status === 'discarded' ? ' (discarded)' : ''}`)
    })
  }
  lines.push('', '---', '', `_Exported from Atrium · ${handle} · ${STATUS_WORD[inv.status]} · ${DEPTH_LABEL[inv.depth].toLowerCase()} depth · ${longDate(Date.now())}_`)
  return `${lines.join('\n')}\n`
}

export function exportFileName(title: string): string {
  return `${slugify(title, 64) || 'investigation'}.md`
}

// ------------------------------------------------------------------------------------------------ examples

/** Example questions for the empty brief: open questions from recent reports first, then evergreen ones. */
export function exampleQuestions(reports: ReadonlyArray<Pick<Investigation, 'report' | 'question'>>, max = 3): string[] {
  const out: string[] = []
  const asked = new Set(reports.map((r) => r.question.trim().toLowerCase()))
  for (const r of reports) {
    for (const q of openQuestions(r.report)) {
      const first = /^(.+?\?)(\s|$)/.exec(q.text)?.[1]
      if (!first || first.length > 140 || first.length < 16 || asked.has(first.toLowerCase())) continue
      if (!out.includes(first)) out.push(first)
      if (out.length >= max) return out
    }
  }
  for (const q of EVERGREEN) {
    if (out.length >= max) break
    if (!out.includes(q)) out.push(q)
  }
  return out
}

const EVERGREEN = [
  'How are B2B SaaS companies packaging analytics add-ons?',
  'What do mid-market freight forwarders expect from a customer portal?',
  'Which onboarding practices shorten time to first value?',
]
