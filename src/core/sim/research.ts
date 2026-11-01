import type { Finding, ResearchDepth, SourceKind } from '@/core/types'
import type { Rng } from '@/lib/rng'
import { capitalize, cleanSentence, detectComparison, excerpt, keyTerms, shorten, topicPhrase, type Comparison } from './text'
import { ACTIONS, facetsFor } from './topics'

/**
 * Pure generators for the research simulator: sub-question angles, depth budgets,
 * cautious findings and the markdown report. Nothing here invents facts — findings
 * are framings derived from the question, the (simulated) source metadata and, when
 * available, quotes from the user's own knowledge.
 */

export interface DepthBudget {
  /** Angles searched (one web.search step each). */
  searches: number
  resultsPerSearch: readonly [number, number]
  readSteps: number
  knowledgeLimit: number
  findings: readonly [number, number]
  /** Quick runs search once across all angles. */
  combinedSearch: boolean
  /** Quick runs synthesize and draft in one step. */
  mergedSynthesis: boolean
  /** Deep runs add a skeptical search and a cross-check step. */
  contrarian: boolean
}

export const DEPTH_BUDGET: Record<ResearchDepth, DepthBudget> = {
  quick: { searches: 1, resultsPerSearch: [3, 3], readSteps: 1, knowledgeLimit: 2, findings: [3, 3], combinedSearch: true, mergedSynthesis: true, contrarian: false },
  standard: { searches: 3, resultsPerSearch: [2, 3], readSteps: 2, knowledgeLimit: 3, findings: [4, 5], combinedSearch: false, mergedSynthesis: false, contrarian: false },
  deep: { searches: 4, resultsPerSearch: [2, 3], readSteps: 3, knowledgeLimit: 4, findings: [5, 6], combinedSearch: false, mergedSynthesis: false, contrarian: true },
}

/** One line per depth: what the run does differently (the brief's depth control). */
export const DEPTH_DESCRIPTION: Record<ResearchDepth, string> = {
  quick: 'One combined search and a short synthesis',
  standard: 'A search per angle, then a cited report',
  deep: 'A search per angle, a skeptical search and a cross-check',
}

type Range = readonly [number, number]

/**
 * Simulated duration (ms at speed 1) and token ranges of each research step. The run scripts draw from
 * these ranges, and the brief reads them back as expectations, so the two can never drift apart.
 */
export const STEP_PROFILE = {
  plan: { ms: [1400, 2600], tokens: [450, 900] },
  context: { ms: [700, 1300], tokens: [200, 500] },
  knowledge: { ms: [900, 1700], tokens: [300, 700] },
  search: { ms: [1600, 3200], tokens: [400, 900] },
  browse: { ms: [2200, 4200], tokens: [1600, 3800] },
  crossCheck: { ms: [1800, 3000], tokens: [900, 1600] },
  synthesize: { ms: [2400, 4200], tokens: [1800, 3200] },
  draft: { ms: [2600, 4800], tokens: [2400, 4600] },
  merged: { ms: [3000, 5200], tokens: [2400, 4200] },
} as const satisfies Record<string, { ms: Range; tokens: Range }>

export type ResearchStepName = keyof typeof STEP_PROFILE

export interface DepthExpectation {
  depth: ResearchDepth
  /** Steps the run plans. */
  steps: number
  /** Sources it is likely to collect: knowledge items plus simulated web results. */
  sources: Range
  findings: Range
  /** Simulated duration at speed 1. */
  durationMs: Range
  /** Simulated tokens (costed at reference pricing as an estimate). */
  tokens: Range
}

/**
 * What a run of this depth is likely to take, read from the same budget and step profile the run
 * script uses. Knowledge passages add a few hundred tokens on top (not counted here).
 */
export function depthExpectation(
  depth: ResearchDepth,
  opts: { knowledge?: boolean; web?: boolean; angles?: number; context?: boolean } = {},
): DepthExpectation {
  const b = DEPTH_BUDGET[depth]
  const knowledge = opts.knowledge !== false
  const web = opts.web !== false
  const angles = Math.max(1, opts.angles ?? (depth === 'deep' ? 4 : 3))
  const names: ResearchStepName[] = ['plan']
  if (opts.context) names.push('context')
  if (knowledge) names.push('knowledge')
  let webMin = 0
  let webMax = 0
  if (web) {
    const searches = b.combinedSearch ? 1 : Math.min(b.searches, angles)
    for (let i = 0; i < searches; i++) names.push('search')
    webMin = b.combinedSearch ? b.resultsPerSearch[1] : searches * b.resultsPerSearch[0]
    webMax = b.combinedSearch ? b.resultsPerSearch[1] : searches * b.resultsPerSearch[1]
    if (b.contrarian) {
      names.push('search')
      webMin += 2
      webMax += 2
    }
    for (let i = 0; i < Math.min(b.readSteps, Math.max(1, webMax)); i++) names.push('browse')
    if (b.contrarian) names.push('crossCheck')
  }
  names.push(...(b.mergedSynthesis ? (['merged'] as const) : (['synthesize', 'draft'] as const)))
  const sum = (key: 'ms' | 'tokens', i: 0 | 1) => names.reduce((n, s) => n + STEP_PROFILE[s][key][i], 0)
  return {
    depth,
    steps: names.length,
    sources: [webMin, webMax + (knowledge ? b.knowledgeLimit : 0)],
    findings: b.findings,
    durationMs: [sum('ms', 0), sum('ms', 1)],
    tokens: [sum('tokens', 0), sum('tokens', 1)],
  }
}

const TRAILING_CONNECTIVE = /^(of|for|to|and|or|in|on|with|by|the|a|an|their|its|from|about|into|at|as|than|is|are|be)$/i

/**
 * The subject of a question for templates, cut at its first clause and at a word boundary:
 * "How are mid-market forwarders adopting customer portals, and what do they expect?" →
 * "mid-market forwarders adopting customer portals".
 */
export function subjectPhrase(text: string, maxWords = 7): string {
  const raw = topicPhrase(text, 16)
  const clause = raw.split(/\s*[,;]\s*|\s+(?:and|or|but|so)\s+(?=(?:what|how|which|who|why|where|when|do|does|did|is|are|can|could|should|would|will)\b)/i)[0] || raw
  let ws = clause.split(' ').filter(Boolean)
  if (ws.length > maxWords) ws = ws.slice(0, maxWords)
  while (ws.length > 2 && TRAILING_CONNECTIVE.test(ws[ws.length - 1])) ws = ws.slice(0, -1)
  return ws.join(' ') || raw
}

/** Default investigation title: the question, shortened. */
export function investigationTitle(question: string): string {
  return capitalize(shorten(cleanSentence(question), 72)) || 'Untitled investigation'
}

type QuestionShape = 'comparison' | 'why' | 'impact' | 'trend' | 'competitor' | 'how' | 'general'

function shapeOf(q: string): QuestionShape {
  if (detectComparison(q)) return 'comparison'
  if (/^\s*why\b/i.test(q)) return 'why'
  if (/\b(impact|affect\w*|implications?|mandate\w*|regulat\w*|laws?|complian\w*)\b/i.test(q)) return 'impact'
  if (/\b(trends?|future|state of|outlook|emerging)\b/i.test(q)) return 'trend'
  if (/\b(competitor\w*|competitive|position\w*|teardown|landscape|against)\b/i.test(q)) return 'competitor'
  if (/^\s*(?:how (?:do|can|could|should|would|might) (?:we|i|you|teams?|companies)|how to|what(?:'s| is) the best way)\b/i.test(q)) return 'how'
  return 'general'
}

/** 3–4 templated sub-questions ("angles") derived from the question. */
export function deriveAngles(question: string, count = 4, opts: { projectName?: string } = {}): string[] {
  const topic = subjectPhrase(question, 6)
  const subject = opts.projectName ?? 'our product'
  const comparison = detectComparison(question)
  const proper = keyTerms(question, 4).find((t) => /^\p{Lu}/u.test(t)) ?? topic
  const templates: Record<QuestionShape, string[]> = {
    comparison: comparison
      ? [
          `How do ${comparison.a} and ${comparison.b} differ in scope and capabilities?`,
          `How do ${comparison.a} and ${comparison.b} compare on pricing and packaging?`,
          'Where does each option fit best, and for whom?',
          'What are the switching costs and risks of each?',
        ]
      : [],
    why: [
      `Which drivers are most often cited when ${topic}?`,
      `Which early signals tend to show up before ${topic}?`,
      'What interventions are discussed, and what supports them?',
      'What do our own notes and customer conversations suggest?',
    ],
    impact: [
      `What does ${topic} require, and of whom?`,
      `Which parts of ${subject} and operations would be affected?`,
      'How are comparable teams preparing?',
      'Which open questions need expert input?',
    ],
    trend: [
      `What shifts are being discussed in ${topic}?`,
      'Which signals suggest a durable trend rather than hype?',
      'Who is adopting it, and why?',
      `What would it mean for ${subject}?`,
    ],
    competitor: [
      `How does ${proper} describe its positioning and target customers?`,
      'How do its packaging and pricing appear to work?',
      'Where are its strengths and gaps relative to us?',
      'What do customers say when comparing the options?',
    ],
    how: [
      `What approaches do teams use for ${topic}?`,
      'What would a minimal first step look like?',
      'What are the main risks, and how are they mitigated?',
      'How would we measure whether it worked?',
    ],
    general: [
      `What is the current landscape for ${topic}?`,
      'What do practitioners and customers report?',
      'What risks, trade-offs and open questions come up?',
      `What would this mean for ${subject}?`,
    ],
  }
  const shape = shapeOf(question)
  const list = templates[shape].length ? templates[shape] : templates.general
  return list.slice(0, Math.max(1, Math.min(count, list.length)))
}

/** A source as seen by synthesis/report code, numbered by its position in the investigation. */
export interface NumberedSource {
  /** 1-based citation number ([n]) — position in `investigation.sourceIds`. */
  n: number
  id: string
  title: string
  kind: SourceKind
  simulated: boolean
  status: 'queued' | 'reading' | 'read' | 'cited' | 'discarded'
  credibility: number
  domain?: string
  publication?: string
  /** Knowledge passage for knowledge sources. */
  passage?: string
  /** Index of the angle whose search produced it (undefined for knowledge sources). */
  angleIndex?: number
  contrarian?: boolean
  /** Comparison subjects the source mentions. */
  mentions?: string[]
}

export interface DraftFinding {
  text: string
  sourceIds: string[]
  confidence: Finding['confidence']
}

const CAUTIONS = [
  'none of them offers data that generalizes beyond their own context.',
  'the evidence is qualitative, so treat this as a hypothesis to test.',
  'they agree on the direction but not on how much it matters.',
  'the more credible sources are also the most hedged.',
]

function avg(ns: number[]): number {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0
}

function webConfidence(sources: NumberedSource[]): Finding['confidence'] {
  return sources.length >= 2 && avg(sources.map((s) => s.credibility)) >= 0.72 ? 'medium' : 'low'
}

/**
 * 3–6 cautious findings. Knowledge-backed findings quote the user's own material; web-backed
 * findings only describe how the (simulated) sources frame the question.
 */
export function synthesizeFindings(input: {
  question: string
  angles: readonly string[]
  sources: readonly NumberedSource[]
  count: number
  rng: Rng
}): DraftFinding[] {
  const { question, angles, rng } = input
  const usable = input.sources.filter((s) => s.status !== 'discarded')
  const knowledge = usable.filter((s) => s.kind === 'knowledge')
  const web = usable.filter((s) => s.kind !== 'knowledge')
  const facets = rng.shuffle(facetsFor(question, 6))
  const topic = subjectPhrase(question, 6)
  const comparison = detectComparison(question)
  const out: DraftFinding[] = []

  for (const k of knowledge.slice(0, input.count >= 5 ? 2 : 1)) {
    const quote = k.passage ? excerpt(k.passage, 170) : ''
    out.push({
      text: quote
        ? `Your own material is directly relevant: “${k.title}” says “${quote.replace(/[“”"]/g, '')}”`
        : `Your knowledge base already covers part of this in “${k.title}”.`,
      sourceIds: [k.id],
      confidence: knowledge.length >= 2 ? 'high' : 'medium',
    })
  }

  if (comparison) {
    const cited = web.filter((s) => s.mentions?.length)
    out.push({
      text: `${comparison.a} and ${comparison.b} appear to differ most on ${facets[0] ?? 'scope'} and ${facets[1] ?? 'cost'}; confirm against current first-party documentation before drawing conclusions.`,
      sourceIds: (cited.length ? cited : web).slice(0, 3).map((s) => s.id),
      confidence: cited.length >= 2 ? 'medium' : 'low',
    })
  }

  angles.forEach((angle, ai) => {
    const cited = web.filter((s) => s.angleIndex === ai && !s.contrarian)
    if (!cited.length) return
    const f = rng.shuffle(facets)
    out.push({
      text: `On “${shorten(cleanSentence(angle), 80)}”: the sources frame it around ${f[0] ?? 'trade-offs'} and ${f[1] ?? 'risks'}; ${rng.pick(CAUTIONS)}`,
      sourceIds: cited.map((s) => s.id),
      confidence: webConfidence(cited),
    })
  })

  const fromAngles = [...new Set(web.filter((s) => !s.contrarian).map((s) => s.angleIndex))]
  if (fromAngles.length >= 2) {
    const pair = fromAngles.slice(0, 2).map((ai) => web.find((s) => s.angleIndex === ai && !s.contrarian)!)
    out.push({
      text: `Sources diverge on how much ${facets[2] ?? 'timing'} matters: some treat it as decisive, others as secondary. The answer likely depends on your segment — worth ${rng.pick(ACTIONS)}.`,
      sourceIds: pair.map((s) => s.id),
      confidence: 'low',
    })
  }

  const skeptics = web.filter((s) => s.contrarian)
  if (skeptics.length) {
    out.push({
      text: `A skeptical source argues that the benefits of ${topic} are easy to overstate, pointing to ${facets[3] ?? 'hidden costs'} as an overlooked risk.`,
      sourceIds: skeptics.map((s) => s.id),
      confidence: 'low',
    })
  }

  // Keep the knowledge finding(s) first, then the most-supported ones, within the budget.
  const head = out.filter((f) => knowledge.some((k) => f.sourceIds.includes(k.id)))
  const rest = out.filter((f) => !head.includes(f))
  const picked = [...head, ...rest].slice(0, Math.max(3, input.count))
  let gap = 0
  while (picked.length < 3 && gap < angles.length) {
    const angle = angles[gap++]
    if (picked.some((p) => p.text.includes(shorten(cleanSentence(angle), 80)))) continue
    picked.push({
      text: `Little material was found for “${shorten(cleanSentence(angle), 80)}”; this remains an open question.`,
      sourceIds: [],
      confidence: 'low',
    })
  }
  return picked.slice(0, Math.max(3, input.count))
}

function cite(sourceIds: readonly string[], byId: Map<string, NumberedSource>): string {
  const ns = sourceIds
    .map((id) => byId.get(id))
    .filter((s): s is NumberedSource => !!s && s.status !== 'discarded')
    .map((s) => s.n)
    .sort((a, b) => a - b)
  return [...new Set(ns)].map((n) => `[${n}]`).join('')
}

function sourceLine(s: NumberedSource): string {
  if (s.kind === 'knowledge') return `- [${s.n}] ${s.title} — your knowledge base`
  const where = [s.publication, s.domain].filter(Boolean).join(', ')
  return `- [${s.n}] ${s.title}${where ? ` — ${where}` : ''}${s.simulated ? ' · simulated' : ''}`
}

function comparisonTable(c: Comparison, question: string, sources: readonly NumberedSource[]): string {
  const facets = facetsFor(question, 4)
  const coverage = (subject: string) => {
    const ns = sources
      .filter((s) => s.status !== 'discarded' && s.mentions?.some((m) => m.toLowerCase() === subject.toLowerCase()))
      .map((s) => `[${s.n}]`)
    return ns.length ? `Discussed in ${ns.slice(0, 3).join(', ')}` : 'No coverage yet'
  }
  const rows = facets.map((f) => `| ${capitalize(f)} | ${coverage(c.a)} | ${coverage(c.b)} | Current ${f} details from first-party material |`)
  return [`| Dimension | ${c.a} | ${c.b} | What to verify |`, '| --- | --- | --- | --- |', ...rows].join('\n')
}

export interface ReportInput {
  title: string
  question: string
  depth: ResearchDepth
  angles: readonly string[]
  findings: ReadonlyArray<Pick<Finding, 'text' | 'sourceIds'>>
  /** Every source of the investigation, numbered in `sourceIds` order. */
  sources: readonly NumberedSource[]
  rng: Rng
}

/** The investigation's markdown report, with [n] citations in source order. */
export function buildReport(input: ReportInput): string {
  const { question, depth, angles, rng } = input
  const byId = new Map(input.sources.map((s) => [s.id, s]))
  const active = input.sources.filter((s) => s.status !== 'discarded')
  const discarded = input.sources.length - active.length
  const knowledge = active.filter((s) => s.kind === 'knowledge')
  const simulated = active.filter((s) => s.simulated)
  const other = active.length - knowledge.length - simulated.length
  const comparison = detectComparison(question)
  const facets = facetsFor(question, 4)
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

  const highlight = knowledge.length
    ? 'Your own notes already address part of the question, and they are the strongest material here.'
    : `External perspectives converge on ${facets[0]} and ${facets[1]} as the main considerations, but offer little verifiable evidence.`

  const lines: string[] = [
    `# ${input.title}`,
    '',
    `**Question:** ${question.replace(/\s+/g, ' ').trim()}`,
    '',
    '> Draft produced by Atrium’s research simulator. Web sources are **simulated** (fictional publications on `.example` domains, generated locally); sources marked “your knowledge base” come from your workspace.',
    '',
    '## Executive summary',
    '',
    `This ${depth} investigation looked at the question from ${plural(angles.length, 'angle')}, drawing on ${plural(knowledge.length, 'item')} from your knowledge base and ${plural(simulated.length, 'simulated web source')}. ${highlight} Treat the conclusions below as a framework to validate rather than settled answers.`,
    '',
    '## Key findings',
    '',
  ]
  input.findings.forEach((f, i) => {
    const c = cite(f.sourceIds, byId)
    lines.push(`${i + 1}. ${f.text}${c ? ` ${c}` : ''}`)
  })
  if (!input.findings.length) lines.push('_No findings yet._')

  if (comparison) {
    lines.push('', '## Comparison', '', comparisonTable(comparison, question, input.sources))
  }

  const thin = angles.filter((_, ai) => active.filter((s) => s.angleIndex === ai).length <= 1)
  const next: string[] = []
  for (const a of thin.slice(0, 2)) next.push(`“${cleanSentence(a)}” — still thinly covered.`)
  next.push('What evidence would change the recommendation? Agree on it before acting.')
  next.push(`Validate the top findings by ${rng.pick(ACTIONS)}.`)
  if (comparison) next.push(`Pull current first-party documentation for ${comparison.a} and ${comparison.b}.`)
  if (simulated.length) next.push('Replace the simulated web sources with real, primary sources before sharing this outside the team.')
  lines.push('', '## Open questions & next steps', '', ...next.map((n) => `- ${n}`))

  lines.push(
    '',
    '## Method & sources',
    '',
    `Produced by the local research simulator (${depth} depth). Of ${plural(active.length, 'source')} consulted, ${knowledge.length} came from your knowledge base (retrieved with Atrium’s local search)${other ? `, ${other} ${other === 1 ? 'was' : 'were'} added manually` : ''} and ${simulated.length} ${simulated.length === 1 ? 'is a simulated web source' : 'are simulated web sources'} — fictional publications generated locally, not real search results.${discarded ? ` ${plural(discarded, 'discarded source')} ${discarded === 1 ? 'was' : 'were'} excluded.` : ''} Verify any claim against primary sources before relying on it.`,
    '',
    ...active.map(sourceLine),
  )
  return lines.join('\n')
}

/** A "Follow-up" section appended to an existing report. */
export function buildFollowUpSection(input: {
  question: string
  findings: ReadonlyArray<Pick<Finding, 'text' | 'sourceIds'>>
  /** Every source of the investigation, numbered in `sourceIds` order. */
  sources: readonly NumberedSource[]
  /** Sources added by the follow-up run (listed under the section). */
  newSourceIds: readonly string[]
}): string {
  const byId = new Map(input.sources.map((s) => [s.id, s]))
  const used = new Set(input.findings.flatMap((f) => f.sourceIds))
  const cited = input.sources.filter((s) => used.has(s.id) && s.status !== 'discarded')
  const k = cited.filter((s) => s.kind === 'knowledge').length
  const m = cited.filter((s) => s.simulated).length
  const lines = [`## Follow-up: ${cleanSentence(input.question)}`, '']
  input.findings.forEach((f) => {
    const c = cite(f.sourceIds, byId)
    lines.push(`- ${f.text}${c ? ` ${c}` : ''}`)
  })
  lines.push('', `_Follow-up method: cites ${k} knowledge ${k === 1 ? 'source' : 'sources'} and ${m} simulated web ${m === 1 ? 'source' : 'sources'}._`)
  const added = input.newSourceIds.map((id) => byId.get(id)).filter((s): s is NumberedSource => !!s && s.status !== 'discarded')
  if (added.length) lines.push('', 'New sources:', ...added.map(sourceLine))
  return lines.join('\n')
}

/** Plain-text output for a plan step: numbered angles. */
export function formatPlanOutput(question: string, angles: readonly string[], depth: ResearchDepth): string {
  const b = DEPTH_BUDGET[depth]
  return [
    `Question: ${cleanSentence(question)}`,
    '',
    'Angles to investigate:',
    ...angles.map((a, i) => `${i + 1}. ${a}`),
    '',
    `Depth: ${depth} — search your knowledge base, then ${b.combinedSearch ? 'one combined web search' : `${Math.min(b.searches, angles.length)}${b.contrarian ? ' + 1 skeptical' : ''} web searches`}, read the results, and synthesize findings with citations.`,
  ].join('\n')
}
