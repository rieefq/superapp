import { db } from '@/core/db'
import { retrieveKnowledge, type RetrievedPassage } from '@/core/search'
import {
  RESEARCH_FACTORY, RESEARCH_FOLLOW_UP_FACTORY, appendSourceIds, generatedFindingId, markCited,
} from '@/core/services/research'
import { logActivity } from '@/core/services/activity'
import { KIND_META, resolveEntity } from '@/core/services/entities'
import { stableId } from '@/core/sim/ids'
import { paramString } from '@/core/sim/params'
import {
  DEPTH_BUDGET, STEP_PROFILE, buildFollowUpSection, buildReport, deriveAngles, formatPlanOutput, synthesizeFindings,
  type DraftFinding, type NumberedSource, type ResearchStepName,
} from '@/core/sim/research'
import { excerpt, shorten } from '@/core/sim/text'
import { buildSearchQuery, formatSearchOutput, searchSimulatedWeb, type WebResultSpec } from '@/core/sim/web'
import type { ActorRef, EntityKind, EntityRef, Finding, ID, Investigation, Run, Source } from '@/core/types'
import { createRng, type Rng } from '@/lib/rng'
import { TIME } from '@/lib/format'
import { registerRunFactory } from '../registry'
import { updateStep } from '../service'
import type { RunPlan, StepContext, StepPlan } from '../types'

/**
 * Research simulation scripts.
 *
 * 'research.investigate' — plan → read the context you attached → search the user's knowledge (real
 * retrieval) → simulated web searches per angle → read → synthesize findings → draft the report.
 * Sources and findings are written progressively by step side effects (idempotent: stable ids,
 * checked before inserting), so the investigation fills in live and survives reloads. Search and
 * read steps record the sources they produced as refs, so the timeline shows them and the run's
 * Saw list is complete.
 *
 * 'research.follow_up' — a shorter run that appends a "Follow-up" section and findings.
 *
 * Params: `investigationId`, optional `context` (entity refs from the composer's Context Line —
 * knowledge items among them become sources) and `memory` (project memory rode along).
 */

interface SearchPlan {
  query: string
  angle: string
  angleIndex: number
  contrarian: boolean
  results: WebResultSpec[]
}

interface KnowledgeHit {
  knowledgeId: ID
  title: string
  passage: string
}

/** Plan-time metadata of the sources a run creates, keyed by source id. */
type SourceMeta = Map<ID, { angleIndex?: number; contrarian?: boolean; mentions?: string[]; passage?: string; publication?: string }>

/** A step's simulated duration and tokens, drawn from the shared profile (src/core/sim/research.ts). */
function timing(rng: Rng, name: ResearchStepName): { durationMs: number; tokens: number } {
  const p = STEP_PROFILE[name]
  return { durationMs: rng.int(p.ms[0], p.ms[1]), tokens: rng.int(p.tokens[0], p.tokens[1]) }
}

function failedPlan(message: string): RunPlan {
  return { steps: [{ kind: 'think', title: 'Check the investigation', durationMs: 400, failChance: 1, failMessage: message }] }
}

const knowledgeSourceId = (investigationId: ID, knowledgeId: ID) => stableId('src', investigationId, 'kno', knowledgeId)
const webSourceId = (runId: ID, key: string) => stableId('src', runId, 'web', key)
const sourceRef = (id: ID): EntityRef => ({ kind: 'source', id })

/** Entity refs from a run param (the composer's context), deduped, existing kinds only. */
function paramRefs(params: Record<string, unknown>, key: string): EntityRef[] {
  const raw = params[key]
  if (!Array.isArray(raw)) return []
  const out: EntityRef[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const { kind, id } = r as { kind?: unknown; id?: unknown }
    if (typeof kind !== 'string' || typeof id !== 'string' || !(kind in KIND_META)) continue
    if (!out.some((x) => x.kind === kind && x.id === id)) out.push({ kind: kind as EntityKind, id })
  }
  return out
}

function retrieve(inv: Investigation, query: string, limit: number): KnowledgeHit[] {
  let passages: RetrievedPassage[] = []
  try {
    passages = retrieveKnowledge(query, { projectId: inv.projectId ?? undefined, limit: limit + 2 })
  } catch {
    passages = []
  }
  return passages
    .filter((p) => p.item.id !== inv.knowledgeId && !(p.item.source.ref?.kind === 'investigation' && p.item.source.ref.id === inv.id))
    .slice(0, limit)
    .map((p) => ({ knowledgeId: p.item.id, title: p.item.title, passage: p.passage }))
}

/**
 * The context that rode along (held, attached, likely and project-memory items): every ref is read
 * (it is listed in the step's refs, so it lands in the Saw list); knowledge items also become
 * sources. Items set to "Available to AI: Never" are skipped — they never reach a model.
 */
function contextPlan(inv: Investigation, refs: readonly EntityRef[]): { read: EntityRef[]; hits: KnowledgeHit[] } {
  const read: EntityRef[] = []
  const hits: KnowledgeHit[] = []
  for (const ref of refs) {
    if (ref.kind === 'investigation' && ref.id === inv.id) continue
    if (ref.kind === 'knowledge') {
      const item = db.get('knowledge', ref.id)
      if (!item || item.aiAvailability === 'never' || item.id === inv.knowledgeId) continue
      read.push(ref)
      hits.push({ knowledgeId: item.id, title: item.title, passage: excerpt(item.summary ? `${item.summary}\n\n${item.content}` : item.content, 600) })
      continue
    }
    if (resolveEntity(ref).exists) read.push(ref)
  }
  return { read, hits }
}

function contextOutput(read: readonly EntityRef[], memoryOf: string | null): string {
  const lines: string[] = []
  if (memoryOf) lines.push(`Project memory of ${memoryOf}: goal and instructions`)
  for (const ref of read) lines.push(`${KIND_META[ref.kind].label} “${shorten(resolveEntity(ref).title, 80)}”`)
  lines.push('', `${read.length} item${read.length === 1 ? '' : 's'} from your context (read locally, not simulated).`)
  return lines.join('\n')
}

function knowledgeOutput(hits: readonly KnowledgeHit[]): string {
  if (!hits.length) return 'No matching items in your knowledge base.'
  return [
    ...hits.map((h, i) => `${i + 1}. ${h.title}\n   “${shorten(excerpt(h.passage, 200), 180)}”`),
    '',
    `${hits.length} item${hits.length === 1 ? '' : 's'} from your knowledge base (local search, not simulated).`,
  ].join('\n')
}

/** Knowledge hits from the context first, then retrieval, without duplicates. */
function mergeHits(first: readonly KnowledgeHit[], then: readonly KnowledgeHit[]): KnowledgeHit[] {
  const out = [...first]
  for (const h of then) if (!out.some((x) => x.knowledgeId === h.knowledgeId)) out.push(h)
  return out
}

// ---------------------------------------------------------------- side effects (idempotent)

function ensureKnowledgeSources(investigationId: ID, hits: readonly KnowledgeHit[]): void {
  const inv = db.get('investigations', investigationId)
  if (!inv || !hits.length) return
  const now = Date.now()
  const rows: Source[] = []
  for (const h of hits) {
    const id = knowledgeSourceId(investigationId, h.knowledgeId)
    if (db.get('sources', id)) continue
    rows.push({
      id,
      investigationId,
      kind: 'knowledge',
      title: h.title,
      snippet: shorten(excerpt(h.passage, 240), 220),
      content: h.passage,
      credibility: 0.9,
      status: 'read',
      simulated: false,
      knowledgeId: h.knowledgeId,
      addedAt: now,
    })
  }
  db.insertMany('sources', rows)
  appendSourceIds(investigationId, hits.map((h) => knowledgeSourceId(investigationId, h.knowledgeId)))
}

function ensureWebSources(investigationId: ID, runId: ID, results: readonly WebResultSpec[]): void {
  if (!db.get('investigations', investigationId) || !results.length) return
  const now = Date.now()
  const rows: Source[] = []
  for (const r of results) {
    const id = webSourceId(runId, r.key)
    if (db.get('sources', id)) continue
    rows.push({
      id,
      investigationId,
      kind: r.kind,
      title: r.title,
      url: r.url,
      domain: r.domain,
      author: r.author,
      publishedAt: now - r.daysAgo * TIME.DAY,
      snippet: r.snippet,
      credibility: 0.5,
      status: 'queued',
      simulated: true,
      addedAt: now,
    })
  }
  db.insertMany('sources', rows)
  appendSourceIds(investigationId, results.map((r) => webSourceId(runId, r.key)))
}

function markRead(investigationId: ID, runId: ID, results: readonly WebResultSpec[]): void {
  ensureWebSources(investigationId, runId, results)
  for (const r of results) {
    const id = webSourceId(runId, r.key)
    const s = db.get('sources', id)
    if (!s || s.status === 'discarded' || s.status === 'cited' || s.status === 'read') continue
    db.update('sources', id, { status: 'read', content: r.summary, credibility: r.credibility })
  }
}

/** Record the sources a step produced or read as its refs (timeline chips and the run's Saw list). */
function recordSourceRefs(ctx: StepContext, ids: readonly ID[]): void {
  const refs = ids.filter((id) => db.get('sources', id)).map(sourceRef)
  if (refs.length) updateStep(ctx.run.id, ctx.step.id, { refs })
}

/** The investigation's sources numbered in `sourceIds` order, with plan metadata attached. */
function numberedSources(inv: Investigation, meta: SourceMeta): NumberedSource[] {
  const out: NumberedSource[] = []
  inv.sourceIds.forEach((id, i) => {
    const s = db.get('sources', id)
    if (!s) return
    const m = meta.get(id)
    out.push({
      n: i + 1,
      id,
      title: s.title,
      kind: s.kind,
      simulated: s.simulated,
      status: s.status,
      credibility: s.credibility,
      domain: s.domain,
      publication: m?.publication,
      passage: m?.passage ?? (s.kind === 'knowledge' ? s.content : undefined),
      angleIndex: m?.angleIndex,
      contrarian: m?.contrarian,
      mentions: m?.mentions,
    })
  })
  return out
}

function toFindings(runId: ID, drafts: readonly DraftFinding[]): Finding[] {
  return drafts.map((d, i) => ({ id: generatedFindingId(runId, i), text: d.text, sourceIds: d.sourceIds, confidence: d.confidence }))
}

/**
 * Write a run's findings. A main run replaces findings generated by earlier runs (unless
 * pinned); findings added by hand are always kept. Re-running is idempotent (stable ids).
 */
function writeFindings(investigationId: ID, findings: readonly Finding[], mode: 'replace' | 'append'): void {
  db.update('investigations', investigationId, (inv) => {
    const generated = new Set(inv.runIds.flatMap((r) => Array.from({ length: 12 }, (_, i) => generatedFindingId(r, i))))
    const base = mode === 'replace' ? inv.findings.filter((f) => f.pinned || !generated.has(f.id)) : inv.findings
    const kept = base.filter((f) => !findings.some((n) => n.id === f.id))
    return { ...inv, findings: [...kept, ...findings], updatedAt: Date.now() }
  })
}

function sourcesCitedBy(inv: Investigation): ID[] {
  return [...new Set(inv.findings.flatMap((f) => f.sourceIds))]
}

function researchActor(run: Run): ActorRef {
  return run.agentId ? { type: 'agent', id: run.agentId } : { type: 'system', id: 'system' }
}

/** The "Read your context" step, when anything rode along. */
function contextStep(inv: Investigation, read: readonly EntityRef[], hits: readonly KnowledgeHit[], memory: boolean, rng: Rng): StepPlan | null {
  const project = memory && inv.projectId ? db.get('projects', inv.projectId) : undefined
  const memoryOf = project && (project.goal || project.instructions) ? project.name : null
  if (!read.length && !memoryOf) return null
  const t = timing(rng, 'context')
  return {
    kind: 'read',
    title: read.length ? `Read ${read.length} item${read.length === 1 ? '' : 's'} from your context` : 'Read the project memory',
    detail: 'Held, attached and likely items from the Context Line',
    tool: 'context',
    capability: 'knowledge.read',
    output: contextOutput(read, memoryOf),
    refs: [...read],
    durationMs: t.durationMs,
    tokens: t.tokens + hits.reduce((a, h) => a + Math.ceil(h.passage.length / 4), 0),
    onComplete: () => ensureKnowledgeSources(inv.id, hits),
  }
}

// ---------------------------------------------------------------- research.investigate

export function planInvestigation(params: Record<string, unknown>, rng: Rng): RunPlan {
  const investigationId = paramString(params, 'investigationId')
  const inv = investigationId ? db.get('investigations', investigationId) : undefined
  if (!inv) return failedPlan('This investigation no longer exists.')
  const id = inv.id
  const budget = DEPTH_BUDGET[inv.depth]
  const angles = inv.angles.length ? inv.angles : deriveAngles(inv.question, inv.depth === 'quick' ? 3 : 4)
  const useKnowledge = inv.sources?.knowledge !== false
  const useWeb = inv.sources?.web !== false
  const context = contextPlan(inv, paramRefs(params, 'context'))
  const retrieved = useKnowledge ? retrieve(inv, inv.question, budget.knowledgeLimit) : []
  const retrievedOnly = retrieved.filter((h) => !context.hits.some((c) => c.knowledgeId === h.knowledgeId))
  const hits = mergeHits(context.hits, retrieved)

  // Web searches: one per angle (quick: one combined search; deep: plus a skeptical one).
  const usedDomains = new Set<string>()
  const usedTitles = new Set<string>()
  const searches: SearchPlan[] = []
  if (!useWeb) {
    // Web search switched off for this investigation: knowledge-only research.
  } else if (budget.combinedSearch) {
    const results = searchSimulatedWeb({ question: inv.question, angle: angles.join('; '), angleIndex: 0, count: budget.resultsPerSearch[1], rng, keyPrefix: 's0', usedDomains, usedTitles })
    results.forEach((r, i) => (r.angleIndex = i % Math.max(1, angles.length)))
    searches.push({ query: buildSearchQuery(inv.question, angles[0] ?? ''), angle: 'all angles', angleIndex: 0, contrarian: false, results })
  } else {
    angles.slice(0, budget.searches).forEach((angle, ai) => {
      const count = rng.int(budget.resultsPerSearch[0], budget.resultsPerSearch[1])
      const results = searchSimulatedWeb({ question: inv.question, angle, angleIndex: ai, count, rng, keyPrefix: `s${ai}`, usedDomains, usedTitles })
      searches.push({ query: buildSearchQuery(inv.question, angle), angle, angleIndex: ai, contrarian: false, results })
    })
  }
  if (useWeb && budget.contrarian) {
    const results = searchSimulatedWeb({ question: inv.question, angle: inv.question, angleIndex: angles.length, count: 2, rng, keyPrefix: 'c', contrarian: true, usedDomains, usedTitles })
    searches.push({ query: buildSearchQuery(inv.question, '', { contrarian: true }), angle: 'skeptical views', angleIndex: angles.length, contrarian: true, results })
  }
  const web = searches.flatMap((s) => s.results)
  const batches: WebResultSpec[][] = Array.from({ length: Math.min(budget.readSteps, Math.max(1, web.length)) }, () => [])
  web.forEach((r, i) => batches[i % batches.length].push(r))

  /** Metadata for synthesis, resolved against the run id at execution time. */
  const metaFor = (runId: ID): SourceMeta => {
    const meta: SourceMeta = new Map()
    for (const h of hits) meta.set(knowledgeSourceId(id, h.knowledgeId), { passage: h.passage })
    for (const r of web) {
      meta.set(webSourceId(runId, r.key), { angleIndex: r.contrarian ? undefined : r.angleIndex, contrarian: r.contrarian, mentions: r.mentions, publication: r.publication })
    }
    return meta
  }
  /** Repair: make sure every source this run plans exists (a step may have been skipped by a reload). */
  const ensureAll = (runId: ID) => {
    ensureKnowledgeSources(id, hits)
    for (const s of searches) ensureWebSources(id, runId, s.results)
  }
  const findingCount = rng.int(budget.findings[0], budget.findings[1])
  const synthesize = (runId: ID, stepId?: ID) => {
    ensureAll(runId)
    const cur = db.get('investigations', id)
    if (!cur) return
    const drafts = synthesizeFindings({
      question: cur.question,
      angles,
      sources: numberedSources(cur, metaFor(runId)),
      count: findingCount,
      rng: createRng(`${runId}:findings`),
    })
    writeFindings(id, toFindings(runId, drafts), 'replace')
    if (stepId) updateStep(runId, stepId, { output: drafts.map((d, i) => `${i + 1}. ${d.text} (${d.confidence} confidence)`).join('\n') })
  }
  const draftReport = (runId: ID, stepId?: ID) => {
    const cur = db.get('investigations', id)
    if (!cur) return
    const report = buildReport({
      title: cur.title,
      question: cur.question,
      depth: cur.depth,
      angles,
      findings: cur.findings,
      sources: numberedSources(cur, metaFor(runId)),
      rng: createRng(`${runId}:report`),
    })
    db.update('investigations', id, { report, updatedAt: Date.now() })
    if (stepId) updateStep(runId, stepId, { output: report.split('\n').slice(0, 18).join('\n') })
  }

  const ctxStep = contextStep(inv, context.read, context.hits, params.memory === true, rng)
  const steps: StepPlan[] = [
    {
      kind: 'plan',
      title: 'Plan the investigation',
      detail: `${angles.length} angles · ${inv.depth} depth`,
      output: formatPlanOutput(inv.question, angles, inv.depth),
      ...timing(rng, 'plan'),
    },
    ...(ctxStep ? [ctxStep] : []),
    ...(useKnowledge ? [{
      kind: 'search',
      title: 'Search your knowledge base',
      detail: retrievedOnly.length ? `${retrievedOnly.length} relevant item${retrievedOnly.length === 1 ? '' : 's'}` : 'Nothing new beyond your context',
      tool: 'knowledge.search',
      capability: 'knowledge.read',
      input: inv.question,
      output: knowledgeOutput(retrievedOnly),
      refs: retrievedOnly.map((h): EntityRef => ({ kind: 'knowledge', id: h.knowledgeId })),
      ...timing(rng, 'knowledge'),
      onComplete: () => ensureKnowledgeSources(id, retrievedOnly),
    } satisfies StepPlan] : []),
    ...searches.map((s): StepPlan => {
      const t = timing(rng, 'search')
      return {
        kind: 'search',
        title: s.contrarian ? 'Search for skeptical views' : budget.combinedSearch ? 'Search the web' : `Search the web: ${shorten(s.angle, 64)}`,
        detail: 'Simulated results from a local corpus of fictional publications',
        tool: 'web.search',
        integrationId: 'web-search',
        capability: 'web.search',
        input: s.query,
        output: formatSearchOutput(s.query, s.results),
        ...t,
        onComplete: (ctx) => {
          ensureWebSources(id, ctx.run.id, s.results)
          recordSourceRefs(ctx, s.results.map((r) => webSourceId(ctx.run.id, r.key)))
        },
      }
    }),
    ...batches
      .filter((b) => b.length)
      .map((batch): StepPlan => ({
        kind: 'browse',
        title: `Read ${batch.length} source${batch.length === 1 ? '' : 's'}`,
        detail: 'Simulated pages — summaries are generated, no page is fetched',
        tool: 'web.browse',
        integrationId: 'web-search',
        capability: 'web.browse',
        input: batch.map((r) => r.url).join('\n'),
        output: batch.map((r) => `• ${r.title} (${r.domain}) — credibility ${Math.round(r.credibility * 100)}%`).join('\n'),
        ...timing(rng, 'browse'),
        onComplete: (ctx) => {
          markRead(id, ctx.run.id, batch)
          recordSourceRefs(ctx, batch.map((r) => webSourceId(ctx.run.id, r.key)))
        },
      })),
  ]
  if (useWeb && budget.contrarian) {
    const weak = web.filter((r) => r.credibility < 0.55)
    steps.push({
      kind: 'think',
      title: 'Cross-check sources',
      output: [
        `Compared ${web.length} simulated sources across ${angles.length} angles${hits.length ? ` and ${hits.length} knowledge items` : ''}.`,
        weak.length ? `Treating ${weak.length} lower-credibility source${weak.length === 1 ? '' : 's'} as weak evidence: ${weak.map((w) => w.publication).join(', ')}.` : 'No source falls below the credibility threshold.',
        'None of the simulated sources provides verifiable data; findings will be framed as considerations.',
      ].join('\n'),
      ...timing(rng, 'crossCheck'),
    })
  }
  if (budget.mergedSynthesis) {
    steps.push({
      kind: 'write',
      title: 'Synthesize findings and draft the report',
      output: `Synthesizing ${findingCount} findings and drafting the report…`,
      ...timing(rng, 'merged'),
      onComplete: (ctx) => {
        synthesize(ctx.run.id, ctx.step.id)
        draftReport(ctx.run.id, ctx.step.id)
      },
    })
  } else {
    steps.push(
      {
        kind: 'think',
        title: 'Synthesize findings',
        output: `Synthesizing ${findingCount} findings with citations…`,
        ...timing(rng, 'synthesize'),
        onComplete: (ctx) => synthesize(ctx.run.id, ctx.step.id),
      },
      {
        kind: 'write',
        title: 'Draft the report',
        output: 'Drafting the report…',
        ...timing(rng, 'draft'),
        onComplete: (ctx) => draftReport(ctx.run.id, ctx.step.id),
      },
    )
  }

  const sourceWords = [
    hits.length ? `${hits.length} knowledge item${hits.length === 1 ? '' : 's'}` : null,
    useWeb ? `${web.length} simulated web source${web.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return {
    steps,
    summary: `Drafted a report on “${shorten(inv.title, 80)}” from ${sourceWords.length ? sourceWords.join(' and ') : 'no sources'}.`,
    onSuccess: (ctx) => {
      const cur = db.get('investigations', id)
      if (!cur) return
      if (!cur.findings.some((f) => f.id === generatedFindingId(ctx.run.id, 0))) synthesize(ctx.run.id)
      if (!db.get('investigations', id)?.report) draftReport(ctx.run.id)
      const latest = db.get('investigations', id)
      if (!latest) return
      markCited(sourcesCitedBy(latest))
      db.update('investigations', id, { status: 'review', updatedAt: Date.now() })
      logActivity({
        actor: researchActor(ctx.run),
        verb: 'drafted',
        target: { kind: 'investigation', id },
        summary: `Drafted the report for “${shorten(latest.title, 80)}” — ready for review`,
        projectId: latest.projectId,
      })
    },
    onFailure: () => {
      const cur = db.get('investigations', id)
      if (cur) db.update('investigations', id, { status: cur.report ? 'review' : 'failed', updatedAt: Date.now() })
    },
  }
}

// ---------------------------------------------------------------- research.follow_up

export function planFollowUp(params: Record<string, unknown>, rng: Rng): RunPlan {
  const investigationId = paramString(params, 'investigationId')
  const question = paramString(params, 'question')
  const inv = investigationId ? db.get('investigations', investigationId) : undefined
  if (!inv || !question) return failedPlan('This investigation or follow-up question no longer exists.')
  const id = inv.id
  const useKnowledge = inv.sources?.knowledge !== false
  const useWeb = inv.sources?.web !== false
  const context = contextPlan(inv, paramRefs(params, 'context'))
  const retrieved = useKnowledge ? retrieve(inv, question, 2) : []
  const retrievedOnly = retrieved.filter((h) => !context.hits.some((c) => c.knowledgeId === h.knowledgeId))
  const hits = mergeHits(context.hits, retrieved)
  const usedDomains = new Set(db.filter('sources', (s) => s.investigationId === id && !!s.domain).map((s) => s.domain as string))
  const results = useWeb ? searchSimulatedWeb({ question, angle: question, angleIndex: 0, count: rng.int(2, 3), rng, keyPrefix: 'f', usedDomains }) : []
  const query = buildSearchQuery(question, '')
  const count = rng.int(2, 3)

  const newIds = (runId: ID) => [...hits.map((h) => knowledgeSourceId(id, h.knowledgeId)), ...results.map((r) => webSourceId(runId, r.key))]
  const metaFor = (runId: ID): SourceMeta => {
    const meta: SourceMeta = new Map()
    for (const h of hits) meta.set(knowledgeSourceId(id, h.knowledgeId), { passage: h.passage })
    for (const r of results) meta.set(webSourceId(runId, r.key), { angleIndex: 0, mentions: r.mentions, publication: r.publication })
    return meta
  }
  const appendSection = (runId: ID, stepId?: ID) => {
    ensureKnowledgeSources(id, hits)
    markRead(id, runId, results)
    const cur = db.get('investigations', id)
    if (!cur) return
    const ids = new Set(newIds(runId))
    const numbered = numberedSources(cur, metaFor(runId))
    const drafts = synthesizeFindings({ question, angles: [question], sources: numbered.filter((s) => ids.has(s.id)), count, rng: createRng(`${runId}:follow-up`) })
    const findings = toFindings(runId, drafts)
    writeFindings(id, findings, 'append')
    const section = buildFollowUpSection({ question, findings, sources: numbered, newSourceIds: results.map((r) => webSourceId(runId, r.key)) })
    db.update('investigations', id, (i) => (i.report?.includes(section) ? i : { ...i, report: `${(i.report ?? `# ${i.title}`).replace(/\s+$/, '')}\n\n${section}\n`, updatedAt: Date.now() }))
    if (stepId) updateStep(runId, stepId, { output: section })
  }

  const ctxStep = contextStep(inv, context.read, context.hits, params.memory === true, rng)
  const steps: StepPlan[] = [
    {
      kind: 'plan',
      title: 'Plan the follow-up',
      output: `Follow-up: ${question}\n\n1. Check your knowledge base\n2. ${useWeb ? 'Search for new material' : 'Skip the web (switched off for this investigation)'}\n3. Add findings and a “Follow-up” section to the report`,
      ...timing(rng, 'plan'),
    },
    ...(ctxStep ? [ctxStep] : []),
  ]
  if (useKnowledge) {
    steps.push({
      kind: 'search',
      title: 'Search your knowledge base',
      tool: 'knowledge.search',
      capability: 'knowledge.read',
      input: question,
      output: knowledgeOutput(retrievedOnly),
      refs: retrievedOnly.map((h): EntityRef => ({ kind: 'knowledge', id: h.knowledgeId })),
      ...timing(rng, 'knowledge'),
      onComplete: () => ensureKnowledgeSources(id, retrievedOnly),
    })
  }
  if (useWeb) {
    steps.push(
      {
        kind: 'search',
        title: 'Search the web',
        detail: 'Simulated results from a local corpus of fictional publications',
        tool: 'web.search',
        integrationId: 'web-search',
        capability: 'web.search',
        input: query,
        output: formatSearchOutput(query, results),
        ...timing(rng, 'search'),
        onComplete: (ctx) => {
          ensureWebSources(id, ctx.run.id, results)
          recordSourceRefs(ctx, results.map((r) => webSourceId(ctx.run.id, r.key)))
        },
      },
      {
        kind: 'browse',
        title: `Read ${results.length} sources`,
        detail: 'Simulated pages — summaries are generated, no page is fetched',
        tool: 'web.browse',
        integrationId: 'web-search',
        capability: 'web.browse',
        input: results.map((r) => r.url).join('\n'),
        output: results.map((r) => `• ${r.title} (${r.domain}) — credibility ${Math.round(r.credibility * 100)}%`).join('\n'),
        ...timing(rng, 'browse'),
        onComplete: (ctx) => {
          markRead(id, ctx.run.id, results)
          recordSourceRefs(ctx, results.map((r) => webSourceId(ctx.run.id, r.key)))
        },
      },
    )
  }
  steps.push({ kind: 'write', title: 'Update the report', output: 'Writing the follow-up section…', ...timing(rng, 'draft'), onComplete: (ctx) => appendSection(ctx.run.id, ctx.step.id) })

  return {
    steps,
    summary: `Answered the follow-up “${shorten(question, 80)}” and updated the report.`,
    onSuccess: (ctx) => {
      const cur = db.get('investigations', id)
      if (!cur) return
      if (!cur.findings.some((f) => f.id === generatedFindingId(ctx.run.id, 0))) appendSection(ctx.run.id)
      const latest = db.get('investigations', id)
      if (!latest) return
      markCited(sourcesCitedBy(latest))
      // The report changed: it goes back to review.
      db.update('investigations', id, { status: 'review', updatedAt: Date.now() })
    },
    onFailure: () => {
      const cur = db.get('investigations', id)
      if (cur) db.update('investigations', id, { status: cur.report ? 'review' : 'failed', updatedAt: Date.now() })
    },
  }
}

export function registerResearchFactories(): void {
  registerRunFactory(RESEARCH_FACTORY, planInvestigation)
  registerRunFactory(RESEARCH_FOLLOW_UP_FACTORY, planFollowUp)
}
