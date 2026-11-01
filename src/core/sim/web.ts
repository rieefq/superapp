import type { SourceKind } from '@/core/types'
import type { Rng } from '@/lib/rng'
import { capitalize, detectComparison, fill, keyTerms, slugify, topicPhrase, type Comparison } from './text'
import { ACTIONS, detectCategories, facetsFor, type TopicCategory } from './topics'

/**
 * Simulated web corpus. Every publication is fictional and lives on an `.example`
 * domain (reserved, never resolvable). Titles and snippets are templated from the
 * question's key terms; snippets stay generic and cautious — no statistics, quotes or
 * claims about real organizations are ever generated.
 */

export interface Publication {
  name: string
  domain: string
  kind: SourceKind
  topics: readonly TopicCategory[]
  /** Credibility range assigned when a source from this publication is read. */
  credibility: readonly [number, number]
  section: string
}

export const PUBLICATIONS: readonly Publication[] = [
  { name: 'Pricing Lab Journal', domain: 'pricinglab.example', kind: 'web', topics: ['pricing', 'market'], credibility: [0.62, 0.86], section: 'notes' },
  { name: 'The Operator’s Ledger', domain: 'operatorsledger.example', kind: 'web', topics: ['pricing', 'churn', 'market', 'general'], credibility: [0.55, 0.8], section: 'essays' },
  { name: 'Freight Systems Quarterly', domain: 'freightsystems.example', kind: 'web', topics: ['logistics', 'market', 'product'], credibility: [0.6, 0.85], section: 'articles' },
  { name: 'Harbor & Rail Review', domain: 'harborrail.example', kind: 'web', topics: ['logistics', 'regulation', 'competition'], credibility: [0.58, 0.82], section: 'analysis' },
  { name: 'Open Methods Review', domain: 'openmethods.example', kind: 'paper', topics: ['ai', 'engineering', 'market', 'churn', 'general'], credibility: [0.7, 0.9], section: 'papers' },
  { name: 'Retention Field Notes', domain: 'retentionnotes.example', kind: 'web', topics: ['churn', 'product'], credibility: [0.55, 0.82], section: 'field-notes' },
  { name: 'Policy Desk Briefings', domain: 'policydesk.example', kind: 'doc', topics: ['regulation'], credibility: [0.66, 0.9], section: 'briefings' },
  { name: 'Compliance Commons', domain: 'compliancecommons.example', kind: 'doc', topics: ['regulation', 'engineering', 'pricing'], credibility: [0.6, 0.86], section: 'guides' },
  { name: 'Interface Weekly', domain: 'interfaceweekly.example', kind: 'web', topics: ['product', 'marketing', 'general'], credibility: [0.5, 0.78], section: 'stories' },
  { name: 'Build Notes', domain: 'buildnotes.example', kind: 'web', topics: ['engineering', 'ai'], credibility: [0.55, 0.82], section: 'posts' },
  { name: 'Systems Reliability Digest', domain: 'reliabilitydigest.example', kind: 'web', topics: ['engineering', 'ai'], credibility: [0.6, 0.86], section: 'digest' },
  { name: 'Signal & Noise Research', domain: 'signalnoise.example', kind: 'paper', topics: ['market', 'ai', 'pricing', 'competition'], credibility: [0.65, 0.88], section: 'research' },
  { name: 'Data Commons Notes', domain: 'datacommons.example', kind: 'dataset', topics: ['market', 'logistics', 'churn'], credibility: [0.6, 0.84], section: 'datasets' },
  { name: 'Practitioner Talks', domain: 'practitionertalks.example', kind: 'video', topics: ['product', 'engineering', 'marketing', 'ai', 'general'], credibility: [0.45, 0.7], section: 'talks' },
  { name: 'Launch Room', domain: 'launchroom.example', kind: 'web', topics: ['marketing', 'product'], credibility: [0.5, 0.76], section: 'playbooks' },
  { name: 'Brand & Message', domain: 'brandmessage.example', kind: 'web', topics: ['marketing'], credibility: [0.5, 0.75], section: 'columns' },
  { name: 'Competitive Notes', domain: 'competitivenotes.example', kind: 'web', topics: ['competition', 'market'], credibility: [0.52, 0.78], section: 'notes' },
  { name: 'Buyer’s Guide Collective', domain: 'buyersguide.example', kind: 'web', topics: ['competition', 'pricing'], credibility: [0.4, 0.62], section: 'guides' },
  { name: 'Community Forum Digest', domain: 'forumdigest.example', kind: 'web', topics: ['general', 'churn', 'product', 'competition'], credibility: [0.4, 0.6], section: 'threads' },
  { name: 'The Platform Post', domain: 'platformpost.example', kind: 'web', topics: ['engineering', 'ai', 'market', 'general'], credibility: [0.52, 0.8], section: 'features' },
  { name: 'Supply Chain Letters', domain: 'supplychainletters.example', kind: 'web', topics: ['logistics', 'market', 'regulation'], credibility: [0.56, 0.82], section: 'letters' },
  { name: 'Finance Ops Review', domain: 'financeops.example', kind: 'web', topics: ['pricing', 'regulation'], credibility: [0.58, 0.84], section: 'articles' },
  { name: 'Security Notes Monthly', domain: 'securitynotes.example', kind: 'web', topics: ['engineering'], credibility: [0.6, 0.86], section: 'notes' },
  { name: 'Northbound Analyst', domain: 'northbound.example', kind: 'web', topics: ['market', 'competition', 'general'], credibility: [0.55, 0.8], section: 'briefs' },
]

const AUTHORS = [
  'R. Okafor', 'M. Lindqvist', 'A. Tanaka', 'J. Moreau', 'S. Haddad', 'L. Brennan', 'P. Castillo', 'K. Novak',
  'D. Mensah', 'E. Varga', 'T. Ishikawa', 'N. Kowalczyk', 'H. Adeyemi', 'C. Dubois', 'F. Rahman', 'G. Silva',
  'I. Petrov', 'V. Laurent', 'B. Achterberg', 'O. Nakamura',
] as const

const TITLES: Record<SourceKind | 'comparison' | 'contrarian', readonly string[]> = {
  web: [
    '{topic}: a practical framework',
    'What teams overlook about {topic}',
    'Notes on {term} and {facet}',
    'A field guide to {topic}',
    '{term} in practice: lessons from operators',
    'Questions to ask about {topic}',
    'The trade-offs behind {topic}',
    '{facet} and {term}: what to weigh',
    'How operators think about {facet}',
  ],
  paper: ['Toward a taxonomy of {topic}', 'A qualitative study of {facet} and {term}', '{term} and {facet}: a review of approaches'],
  doc: ['Briefing: {topic}', 'Explainer: what {topic} means in practice', 'Checklist: preparing for {topic}'],
  dataset: ['Dataset notes: {term} indicators', 'Open data on {term} — methodology notes'],
  video: ['Talk: {topic} — what we learned', 'Panel: practitioners on {facet}'],
  knowledge: ['{topic}'],
  comparison: ['{A} vs {B}: how to choose', 'Comparing {A} and {B} on {facet}', '{A} or {B}? A decision framework', 'Where {A} and {B} differ'],
  contrarian: ['The case against {topic}', 'Limits of {topic}: a skeptical view', 'When {term} goes wrong'],
}

const SNIPPETS: Record<SourceKind | 'comparison' | 'contrarian', readonly string[]> = {
  web: [
    'Outlines a framework for evaluating {topic}, focusing on {facet} and {facet2}. Recommends validating assumptions against your own data.',
    'Discusses common trade-offs around {facet}, illustrated with qualitative examples rather than benchmark data.',
    'An opinion piece arguing that decisions about {term} depend heavily on {facet}; it poses questions rather than prescriptive answers.',
    'Summarizes practitioner perspectives on {topic}, noting where experiences diverge on {facet}.',
    'Lists considerations for teams working on {term}, including {facet}, {facet2} and {action}.',
  ],
  paper: [
    'Reviews published approaches to {topic} and proposes a way to categorize them; the authors note their sample is small and context-specific.',
    'A qualitative study that interviews practitioners about {facet}; the findings are exploratory and not statistically generalizable.',
  ],
  doc: [
    'A briefing that explains {topic} in plain language and lists questions to clarify with advisors, especially around {facet}.',
    'A checklist-style guide covering {facet} and {facet2}; it recommends {action}.',
  ],
  dataset: ['Describes an open dataset related to {term}; the methodology notes flag coverage gaps, so figures should not be generalized.'],
  video: ['A recorded talk in which practitioners share how they approached {facet}; anecdotal, but useful for framing questions.'],
  knowledge: ['{topic}'],
  comparison: [
    'Compares {A} and {B} along {facet} and {facet2}, and stresses that the right choice depends on context; it recommends {action}.',
    'A side-by-side look at {A} and {B} that focuses on {facet}; it does not cite verifiable figures.',
  ],
  contrarian: [
    'Argues that the benefits of {topic} are often overstated and highlights {facet} as an overlooked risk.',
    'A skeptical take: {topic} tends to look simpler in planning than in practice, especially around {facet}.',
  ],
}

/** Generic words in templated angles that should not become search terms. */
const ANGLE_STOP = new Set([
  'current', 'landscape', 'practitioners', 'customers', 'report', 'risks', 'trade-offs', 'tradeoffs', 'open', 'questions',
  'mean', 'roadmap', 'main', 'common', 'commonly', 'cited', 'early', 'signals', 'tend', 'precede', 'interventions',
  'discussed', 'evidence', 'supports', 'support', 'data', 'notes', 'tell', 'approaches', 'teams', 'minimal', 'first', 'step',
  'mitigated', 'measure', 'worked', 'require', 'timeline', 'parts', 'affected', 'comparable', 'companies', 'preparing',
  'resolve', 'experts', 'shifts', 'durable', 'trend', 'hype', 'adopting', 'rationale', 'positioning', 'describe',
  'appear', 'work', 'strengths', 'gaps', 'relative', 'comparing', 'options', 'differ', 'scope', 'capabilities', 'fit',
  'whom', 'switching', 'costs', 'each', 'option', 'come', 'operations', 'product', 'implications', 'implication',
])

export interface WebResultSpec {
  /** Stable key within a run, used to derive the source id. */
  key: string
  kind: SourceKind
  title: string
  url: string
  domain: string
  publication: string
  author: string
  /** Age of the publication in days, applied when the source row is created. */
  daysAgo: number
  snippet: string
  /** Credibility assigned when the source is read (0.4–0.9). */
  credibility: number
  /** Summary written to `source.content` when the source is read. */
  summary: string
  /** Comparison subjects named in the title or snippet. */
  mentions: string[]
  angleIndex: number
  contrarian: boolean
}

export interface WebSearchInput {
  question: string
  angle: string
  angleIndex: number
  count: number
  rng: Rng
  keyPrefix: string
  contrarian?: boolean
  /** Domains already used in this investigation; fresh publications are preferred. */
  usedDomains?: Set<string>
  usedTitles?: Set<string>
}

export function isSimulatedDomain(domain: string | undefined): boolean {
  return !!domain && domain.endsWith('.example')
}

/** The query string shown for a web.search step. */
export function buildSearchQuery(question: string, angle: string, opts: { contrarian?: boolean } = {}): string {
  const comparison = detectComparison(question)
  const base = comparison ? [comparison.a, 'vs', comparison.b] : keyTerms(question, 4)
  const extra = keyTerms(angle, 4, ANGLE_STOP).filter((t) => !base.some((b) => b.toLowerCase() === t.toLowerCase()))
  const terms = [...base, ...extra.slice(0, 2)]
  if (opts.contrarian) terms.push('criticism', 'limitations')
  return terms.join(' ')
}

function candidatePublications(categories: TopicCategory[], rng: Rng, used: Set<string>): Publication[] {
  const scored = rng.shuffle(PUBLICATIONS).map((p) => {
    const overlap = p.topics.filter((t) => categories.includes(t) && t !== 'general').length
    return { p, score: overlap * 2 + (p.topics.includes('general') ? 0.5 : 0) - (used.has(p.domain) ? 3 : 0) }
  })
  return scored.sort((a, b) => b.score - a.score).map((s) => s.p)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Generate `count` simulated results for one search. Deterministic for a given rng state. */
export function searchSimulatedWeb(input: WebSearchInput): WebResultSpec[] {
  const { question, angle, rng } = input
  const usedDomains = input.usedDomains ?? new Set<string>()
  const usedTitles = input.usedTitles ?? new Set<string>()
  const comparison = detectComparison(question)
  const categories = detectCategories(`${question} ${angle}`)
  const terms = keyTerms(question, 4)
  const angleTerms = keyTerms(angle, 3, ANGLE_STOP)
  const topic = topicPhrase(question, 5)
  const facets = facetsFor(`${question} ${angle}`, 6)
  const pubs = candidatePublications(categories, rng, usedDomains)
  const results: WebResultSpec[] = []

  for (let i = 0; i < input.count; i++) {
    const pub = pubs[i % pubs.length]
    const facetPool = rng.shuffle(facets)
    const vars: Record<string, string> = {
      topic,
      term: angleTerms[0] ?? terms[0] ?? topic,
      facet: facetPool[0] ?? 'trade-offs',
      facet2: facetPool[1] ?? 'risks',
      facet3: facetPool[2] ?? 'adoption',
      action: rng.pick(ACTIONS),
      A: comparison?.a ?? '',
      B: comparison?.b ?? '',
    }
    const family: SourceKind | 'comparison' | 'contrarian' = input.contrarian
      ? 'contrarian'
      : comparison && pub.kind === 'web' && rng.chance(0.6)
        ? 'comparison'
        : pub.kind
    let title = ''
    for (let attempt = 0; attempt < 6; attempt++) {
      title = capitalize(fill(rng.pick(TITLES[family]), vars))
      if (!usedTitles.has(title.toLowerCase())) break
      vars.term = terms[(attempt + 1) % Math.max(1, terms.length)] ?? vars.term
      vars.facet = facetPool[(attempt + 2) % facetPool.length] ?? vars.facet
    }
    usedTitles.add(title.toLowerCase())
    usedDomains.add(pub.domain)
    const snippet = capitalize(fill(rng.pick(SNIPPETS[family]), vars))
    const credibility = round2(Math.min(0.9, Math.max(0.4, rng.float(pub.credibility[0], pub.credibility[1]) - (input.contrarian ? 0.05 : 0))))
    results.push({
      key: `${input.keyPrefix}-${i}`,
      kind: pub.kind,
      title,
      url: `https://${pub.domain}/${pub.section}/${slugify(title, 60)}`,
      domain: pub.domain,
      publication: pub.name,
      author: pub.kind === 'doc' ? `${pub.name} editorial team` : rng.pick(AUTHORS),
      daysAgo: rng.int(6, 540),
      snippet,
      credibility,
      summary: readSummary(vars, pub, rng),
      mentions: comparison ? mentionsOf(comparison, `${title} ${snippet}`) : [],
      angleIndex: input.angleIndex,
      contrarian: !!input.contrarian,
    })
  }
  return results
}

function mentionsOf(c: Comparison, text: string): string[] {
  const lower = text.toLowerCase()
  return [c.a, c.b].filter((s) => lower.includes(s.toLowerCase()))
}

function readSummary(vars: Record<string, string>, pub: Publication, rng: Rng): string {
  const lead = rng.pick([
    'Frames {topic} around {facet} and {facet2}.',
    'Treats {facet} as the deciding factor for {topic}, with {facet2} as a secondary concern.',
    'Walks through {facet} step by step, using hypothetical scenarios rather than case data.',
  ])
  const advice = rng.pick([
    'Recommends {action} before committing to a direction.',
    'Suggests {action} to test the main assumption cheaply.',
    'Encourages {action}, and documenting what would change the decision.',
  ])
  const caveat = rng.pick([
    'Cautions that {facet3} varies a lot by context.',
    'Notes that experiences differ by segment, especially on {facet3}.',
    'Acknowledges that the evidence for {facet3} is mostly anecdotal.',
  ])
  return [
    `Key points (${pub.name}):`,
    `• ${fill(lead, vars)}`,
    `• ${fill(advice, vars)}`,
    `• ${fill(caveat, vars)}`,
    'No quantitative claims were extracted that could be verified here — treat this as perspective, not evidence.',
    '',
    'Simulated source: generated locally from a fictional publication; no web page was fetched.',
  ].join('\n')
}

/** Text output of a web.search step. */
export function formatSearchOutput(query: string, results: readonly WebResultSpec[]): string {
  const lines = [`Query: "${query}"`, '']
  results.forEach((r, i) => lines.push(`${i + 1}. ${r.title} — ${r.publication} (${r.domain})`))
  lines.push('', `${results.length} result${results.length === 1 ? '' : 's'} · simulated web corpus (fictional publications, .example domains)`)
  return lines.join('\n')
}
