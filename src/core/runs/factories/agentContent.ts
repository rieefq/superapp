import type { DemoRepoFile } from '@/core/seed/demoRepo'
import type { Rng } from '@/lib/rng'

/**
 * Pure, seeded content generators for the 'agent.task' simulation. Everything here is
 * simulated: web results are fictional publications on .example domains, query results
 * are sample data, and prose stays generic (frameworks and considerations, no facts).
 */

export type Domain =
  | 'pricing' | 'competitors' | 'churn' | 'support' | 'launch' | 'engineering' | 'data' | 'meetings' | 'scheduling' | 'general'

export interface Topic {
  /** The request without filler and leading verbs (≤ 80 chars): used for knowledge retrieval. */
  request: string
  /** A natural noun phrase for titles and prose, e.g. "support triage" or "API performance". */
  subject: string
  /** Web search query: the subject plus any names in the request (companies, products). */
  query: string
  keywords: string[]
  /** Capitalized names and acronyms from the request, e.g. ["Tidewell", "SSO"]. */
  names: string[]
  domain: Domain
}

const STOPWORDS = new Set(
  ('a an and are as at be by can could do does for from has have how i in into is it its me my of on or our please ' +
    'should so that the their them then there these this those to us was we what when where which who why will with ' +
    'would you your about after all also any before between both each few more most other over same some such than ' +
    'through under until very just need needs make sure using use get give let lets new next last week today tomorrow ' +
    'morning afternoon evening anything something everything find time quick brief short write draft summarize ' +
    'summarise research look create prepare compile investigate analyze analyse outline gather collect explain identify')
    .split(' '),
)

const LEADING_FILLER = /^(?:(?:please|kindly|can you|could you|would you|i need you to|i want you to|help me|go ahead and)\s+)+/i
const LEADING_VERB =
  /^(?:summari[sz]e|research|investigate|find(?: out)?|draft|write|create|analy[sz]e|review|prepare|compile|look into|check|outline|triage|plan|update|figure out|explain|compare|identify|list|collect|gather|send|post|schedule|build|fix|audit)\s+/i

const DOMAIN_KEYWORDS: Record<Exclude<Domain, 'general'>, string[]> = {
  pricing: ['pricing', 'price', 'prices', 'tier', 'tiers', 'packaging', 'discount', 'discounts', 'billing', 'revenue', 'arr', 'mrr', 'monetization', 'plans'],
  competitors: ['competitor', 'competitors', 'competitive', 'tidewell', 'freightly', 'shiploom', 'positioning', 'landscape', 'teardown'],
  churn: ['churn', 'churned', 'churning', 'retention', 'cancel', 'cancelled', 'cancellation', 'cancellations', 'renewal', 'renewals', 'attrition'],
  support: ['support', 'ticket', 'tickets', 'triage', 'escalation', 'escalations', 'sla', 'inbox', 'complaint', 'complaints'],
  launch: ['launch', 'campaign', 'announcement', 'messaging', 'copy', 'headline', 'headlines', 'brand', 'marketing', 'blog', 'social', 'tagline'],
  engineering: ['bug', 'code', 'api', 'refactor', 'test', 'tests', 'performance', 'latency', 'security', 'auth', 'sso', 'session', 'deploy', 'bundle', 'migration', 'endpoint', 'endpoints', 'flaky', 'rate'],
  data: ['metrics', 'dashboard', 'query', 'data', 'analysis', 'cohort', 'cohorts', 'usage', 'kpi', 'kpis', 'numbers', 'trend', 'trends', 'mix'],
  meetings: ['meeting', 'meetings', 'sync', 'transcript', 'standup', 'retro', 'agenda', 'minutes', 'recap'],
  scheduling: ['calendar', 'schedule', 'availability', 'slot', 'slots', 'invite', 'reschedule'],
}

const LOGISTICS_WORDS = new Set(['freight', 'logistics', 'shipping', 'shipment', 'shipments', 'carrier', 'carriers', 'warehouse', 'fleet'])

function subjectFor(domain: Domain, words: Set<string>, keywords: string[], cased: Map<string, string>): string {
  const any = (...w: string[]) => w.some((x) => words.has(x))
  switch (domain) {
    case 'pricing':
      return 'pricing and packaging'
    case 'competitors':
      return 'competitive positioning'
    case 'churn':
      return 'customer retention'
    case 'support':
      return 'support triage'
    case 'launch':
      return 'launch messaging'
    case 'engineering':
      if (any('latency', 'performance', 'slow', 'timeout', 'timeouts')) return 'API performance'
      if (any('security', 'auth', 'sso', 'session', 'sessions', 'login')) return 'authentication and sessions'
      if (any('test', 'tests', 'flaky')) return 'test reliability'
      if (any('migration', 'migrate')) return 'safe data migrations'
      if (any('bundle')) return 'frontend performance'
      return 'software delivery'
    case 'data':
      return 'product analytics'
    case 'meetings':
      return 'meeting follow-through'
    case 'scheduling':
      return 'team scheduling'
    case 'general':
      return keywords.slice(0, 2).map((k) => cased.get(k) ?? k).join(' ') || 'the request'
  }
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []

function clipAtWord(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.5 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,;:–-]+$/, '')
}

export function extractTopic(instruction: string): Topic {
  const firstLine = instruction.trim().split('\n')[0]?.trim() ?? ''
  const stripped = firstLine.replace(LEADING_FILLER, '').replace(LEADING_VERB, '').replace(/[.?!]+$/, '').trim()
  const request = clipAtWord((stripped || firstLine || 'the request').replace(/\s+/g, ' '), 80)
  const all = words(instruction)
  const meaningful = (list: string[]) => list.filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  // Keywords come from the request itself (leading verbs stripped), topped up from the rest.
  const keywords = [...new Set([...meaningful(words(request)), ...meaningful(all)])].slice(0, 6)
  let domain: Domain = 'general'
  let best = 0
  for (const [d, list] of Object.entries(DOMAIN_KEYWORDS) as [Exclude<Domain, 'general'>, string[]][]) {
    const score = all.filter((w) => list.includes(w)).length
    if (score > best) {
      best = score
      domain = d
    }
  }
  const wordSet = new Set(all)
  const names = [
    ...new Set(
      request
        .split(/\s+/)
        .slice(1)
        .map((w) => w.replace(/[^A-Za-z0-9-]/g, ''))
        .filter((w) => /^[A-Z][A-Za-z0-9-]+$/.test(w) && !STOPWORDS.has(w.toLowerCase())),
    ),
  ].slice(0, 3)
  const cased = new Map(request.split(/\s+/).map((w) => [w.toLowerCase().replace(/[^a-z0-9'-]/g, ''), w.replace(/[^A-Za-z0-9'’-]/g, '')]))
  const base = subjectFor(domain, wordSet, keywords, cased)
  const subject = domain !== 'general' && [...LOGISTICS_WORDS].some((w) => wordSet.has(w)) ? `${base} in logistics` : base
  const query = [subject, ...names.filter((n) => !subject.toLowerCase().includes(n.toLowerCase()))].join(' ')
  return { request, subject, query, keywords, names, domain }
}

const fill = (template: string, topic: Topic) => {
  // Lower-case the first letter for mid-sentence use, but keep acronyms ("API") and names intact.
  const keepCase = /^[A-Z]{2}/.test(topic.subject) || topic.names.some((n) => topic.subject.startsWith(n))
  const subject = keepCase ? topic.subject : topic.subject.charAt(0).toLowerCase() + topic.subject.slice(1)
  const Subject = topic.subject.charAt(0).toUpperCase() + topic.subject.slice(1)
  return template.replaceAll('{subject}', subject).replaceAll('{Subject}', Subject)
}

export function slugify(text: string): string {
  return words(text).join('-').replace(/-+/g, '-').slice(0, 60).replace(/-$/, '')
}

// ---------------------------------------------------------------- simulated web

export interface SimWebResult {
  title: string
  publication: string
  domain: string
  url: string
  snippet: string
}

/** Fictional publications. Only `.example` domains — never real outlets. */
export const SIM_PUBLICATIONS = [
  { name: 'Freight Systems Review', domain: 'freightsystems-review.example', section: 'analysis' },
  { name: 'The Logistics Ledger', domain: 'logisticsledger.example', section: 'features' },
  { name: 'SaaS Pricing Quarterly', domain: 'saaspricing-quarterly.example', section: 'articles' },
  { name: 'Ops Leadership Weekly', domain: 'opsleadership.example', section: 'notes' },
  { name: 'Product Field Notes', domain: 'productfieldnotes.example', section: 'posts' },
  { name: 'Supply Chain Signal', domain: 'supplychainsignal.example', section: 'reports' },
  { name: 'B2B Growth Digest', domain: 'b2bgrowthdigest.example', section: 'digest' },
  { name: 'Engineering Notebook', domain: 'eng-notebook.example', section: 'entries' },
  { name: 'Customer Success Journal', domain: 'csjournal.example', section: 'stories' },
  { name: 'Reliability Review', domain: 'reliability-review.example', section: 'essays' },
] as const

const TITLE_TEMPLATES = [
  'A practical framework for {subject}',
  'What operators weigh when approaching {subject}',
  'Field notes: {subject}',
  'Common pitfalls with {subject}',
  'A checklist for {subject}',
  'Questions to ask before committing to {subject}',
  '{Subject}: the trade-offs teams discuss',
  'How mid-market teams approach {subject}',
]

const SNIPPET_TEMPLATES = [
  'Outlines a step-by-step framework for {subject}, with an emphasis on clear success criteria and staged rollouts.',
  'Discusses trade-offs teams commonly weigh around {subject} and lists questions to settle before committing.',
  'Collects practitioner anecdotes about {subject}; useful for ideas, not independently verified.',
  'Proposes a checklist covering stakeholders, risks and measurement for {subject}.',
  'Argues for small, reversible experiments before broad changes to {subject}.',
  'Summarizes recurring themes from operator interviews about {subject}; the sample size is not stated.',
]

const TAKEAWAYS = [
  'Recommends agreeing on success criteria before changing {subject}.',
  'Suggests piloting with a small group and comparing against a baseline.',
  'Notes that stakeholder alignment matters as much as the mechanics.',
  'Cautions against drawing conclusions from a single period of data.',
  'Emphasizes writing down decisions and their rationale.',
  'Points out that customer conversations often surface issues that metrics miss.',
]

export function simulatedWebResults(topic: Topic, rng: Rng, count = 5): SimWebResult[] {
  const pubs = rng.shuffle(SIM_PUBLICATIONS).slice(0, count)
  const titles = rng.shuffle(TITLE_TEMPLATES)
  const snippets = rng.shuffle(SNIPPET_TEMPLATES)
  const slug = slugify(topic.keywords.slice(0, 4).join(' ') || topic.subject) || 'article'
  return pubs.map((pub, i) => ({
    title: fill(titles[i % titles.length], topic),
    publication: pub.name,
    domain: pub.domain,
    url: `https://${pub.domain}/${pub.section}/${slug}-${rng.int(1000, 9999)}`,
    snippet: fill(snippets[i % snippets.length], topic),
  }))
}

export function formatWebResults(results: readonly SimWebResult[]): string {
  if (!results.length) return 'No results.'
  return results
    .map((r, i) => `${i + 1}. ${r.title} — ${r.publication} (simulated source)\n   ${r.url}\n   ${r.snippet}`)
    .join('\n')
}

export function browseNotes(results: readonly SimWebResult[], topic: Topic, rng: Rng): string {
  const pages = results.map((r) => {
    const points = rng.shuffle(TAKEAWAYS).slice(0, 2).map((t) => `  • ${fill(t, topic)}`)
    return `▸ ${r.title} — ${r.publication} (simulated source)\n${points.join('\n')}`
  })
  return `Read ${results.length} page${results.length === 1 ? '' : 's'} (simulated content from fictional publications):\n\n${pages.join('\n\n')}`
}

// ---------------------------------------------------------------- simulated data

export interface SimQuery {
  sql: string
  columns: string[]
  rows: Array<Array<string | number>>
}

export function simulatedQuery(topic: Topic, rng: Rng): SimQuery {
  switch (topic.domain) {
    case 'pricing': {
      const plans = ['Starter', 'Growth', 'Scale', 'Enterprise']
      let accounts = rng.int(260, 420)
      let mrr = rng.int(90, 160)
      return {
        sql: [
          'SELECT plan, COUNT(*) AS active_accounts, ROUND(AVG(mrr_usd)) AS avg_mrr_usd',
          'FROM accounts',
          "WHERE status = 'active'",
          'GROUP BY plan',
          'ORDER BY avg_mrr_usd;',
        ].join('\n'),
        columns: ['plan', 'active_accounts', 'avg_mrr_usd'],
        rows: plans.map((plan) => {
          const row = [plan, accounts, mrr]
          accounts = Math.max(4, Math.round(accounts * rng.float(0.25, 0.6)))
          mrr = Math.round(mrr * rng.float(2.8, 4.5))
          return row
        }),
      }
    }
    case 'churn':
      return {
        sql: [
          "SELECT date_trunc('month', churned_at) AS month, COUNT(*) AS churned_accounts,",
          '       ROUND(100.0 * COUNT(*) / NULLIF(MAX(active_at_start), 0), 1) AS churn_rate_pct',
          'FROM monthly_churn',
          "WHERE churned_at >= now() - interval '6 months'",
          'GROUP BY 1 ORDER BY 1;',
        ].join('\n'),
        columns: ['month', 'churned_accounts', 'churn_rate_pct'],
        rows: [5, 4, 3, 2, 1, 0].map((m) => [m === 0 ? 'current' : `M-${m}`, rng.int(3, 19), Number(rng.float(0.6, 3.4).toFixed(1))]),
      }
    case 'support':
      return {
        sql: [
          'SELECT priority, COUNT(*) AS open_tickets,',
          '       percentile_cont(0.5) WITHIN GROUP (ORDER BY first_response_minutes) AS median_first_response_min',
          "FROM tickets WHERE status = 'open'",
          'GROUP BY priority ORDER BY open_tickets DESC;',
        ].join('\n'),
        columns: ['priority', 'open_tickets', 'median_first_response_min'],
        rows: ['urgent', 'high', 'normal', 'low'].map((p, i) => [p, rng.int(2 + i * 4, 9 + i * 12), rng.int(6 + i * 20, 25 + i * 60)]),
      }
    case 'engineering':
      return {
        sql: [
          'SELECT endpoint, COUNT(*) AS requests_7d,',
          '       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms',
          'FROM request_log',
          "WHERE ts >= now() - interval '7 days'",
          'GROUP BY endpoint ORDER BY p95_ms DESC LIMIT 4;',
        ].join('\n'),
        columns: ['endpoint', 'requests_7d', 'p95_ms'],
        rows: ['/api/shipments', '/api/invoices', '/api/auth/session', '/api/reports'].map((e) => [e, rng.int(4_000, 90_000), rng.int(120, 1_400)]),
      }
    case 'launch':
      return {
        sql: [
          'SELECT channel, COUNT(*) AS signups_30d,',
          '       ROUND(100.0 * SUM(converted::int) / COUNT(*), 1) AS conversion_pct',
          'FROM signups',
          "WHERE created_at >= now() - interval '30 days'",
          'GROUP BY channel ORDER BY signups_30d DESC;',
        ].join('\n'),
        columns: ['channel', 'signups_30d', 'conversion_pct'],
        rows: ['organic', 'referral', 'partner', 'paid'].map((c) => [c, rng.int(20, 340), Number(rng.float(1.5, 9.5).toFixed(1))]),
      }
    default:
      return {
        sql: [
          "SELECT date_trunc('week', occurred_at) AS week, COUNT(DISTINCT account_id) AS active_accounts,",
          '       COUNT(*) AS sessions',
          'FROM product_events',
          "WHERE occurred_at >= now() - interval '4 weeks'",
          'GROUP BY 1 ORDER BY 1;',
        ].join('\n'),
        columns: ['week', 'active_accounts', 'sessions'],
        rows: [3, 2, 1, 0].map((w) => [w === 0 ? 'current' : `W-${w}`, rng.int(180, 420), rng.int(2_000, 9_000)]),
      }
  }
}

/** Plain ASCII table; numbers right-aligned. */
export function formatTable(columns: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  const cells = rows.map((r) => r.map((c) => String(c)))
  const widths = columns.map((col, i) => Math.max(col.length, ...cells.map((r) => (r[i] ?? '').length)))
  const line = (values: string[], numeric: boolean[]) =>
    values.map((v, i) => (numeric[i] ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join(' | ').trimEnd()
  const numeric = columns.map((_, i) => rows.length > 0 && rows.every((r) => typeof r[i] === 'number'))
  return [
    line([...columns], columns.map(() => false)),
    widths.map((w) => '-'.repeat(w)).join('-+-'),
    ...cells.map((r) => line(r, numeric)),
  ].join('\n')
}

// ---------------------------------------------------------------- other tools

export function channelFor(domain: Domain): string {
  switch (domain) {
    case 'pricing':
    case 'competitors':
      return '#product-strategy'
    case 'churn':
    case 'support':
      return '#support-ops'
    case 'launch':
      return '#launch'
    case 'engineering':
      return '#eng'
    case 'data':
      return '#metrics'
    case 'meetings':
    case 'scheduling':
      return '#team-updates'
    default:
      return '#general'
  }
}

export function simulatedFreeSlots(rng: Rng, count = 3): string[] {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const start = rng.int(0, days.length - 1)
  return Array.from({ length: count }, (_, i) => {
    const hour = rng.pick([9, 10, 11, 13, 14, 15, 16])
    const half = rng.chance(0.5)
    const from = `${String(hour).padStart(2, '0')}:${half ? '30' : '00'}`
    const to = half ? `${String(hour + 1).padStart(2, '0')}:00` : `${String(hour).padStart(2, '0')}:30`
    return `${days[(start + i) % days.length]} ${from}–${to}`
  })
}

export function simulatedFileListing(topic: Topic, rng: Rng): string[] {
  const subject = topic.subject.charAt(0).toUpperCase() + topic.subject.slice(1)
  const candidates = [
    `${clipAtWord(subject, 36)} — working notes.docx`,
    `${clipAtWord(subject, 36)} — draft v${rng.int(2, 4)}.docx`,
    'Team planning tracker.xlsx',
    'Customer feedback log.xlsx',
    'Quarterly priorities.pdf',
  ]
  return rng.shuffle(candidates).slice(0, 3)
}

/** Most relevant demo-repo files for a topic (keyword hits in path weigh more than in content). */
export function pickRepoFiles(files: readonly DemoRepoFile[], topic: Topic, rng: Rng, max = 3): DemoRepoFile[] {
  if (!files.length) return []
  const scored = files
    .map((file) => {
      const path = file.path.toLowerCase()
      const content = file.content.toLowerCase()
      const score = topic.keywords.reduce((sum, k) => sum + (path.includes(k) ? 3 : 0) + (content.includes(k) ? 1 : 0), 0)
      return { file, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
  if (scored.length) return scored.slice(0, max).map((x) => x.file)
  const source = files.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f.path) && !/test|spec/.test(f.path))
  return rng.shuffle(source.length ? source : files).slice(0, Math.min(2, max))
}

export function fileExcerpt(file: DemoRepoFile, lines = 8): string {
  const all = file.content.split('\n')
  const head = all.slice(0, lines).join('\n').trimEnd()
  return all.length > lines ? `${head}\n… (${all.length - lines} more lines)` : head
}

// ---------------------------------------------------------------- reasoning text

const CONSIDERATIONS: Record<Domain, string[]> = {
  pricing: [
    'Anchor tiers on a value metric customers already track.',
    'Model the impact on existing contracts before changing list prices.',
    'Test packaging changes with a small cohort before a broad rollout.',
    'Keep the upgrade path between tiers obvious.',
  ],
  competitors: [
    'Compare positioning on customer outcomes, not feature counts.',
    'Separate verified facts from marketing claims.',
    'Track changes over time rather than relying on a single snapshot.',
    'Note where competitors are silent — gaps can be opportunities or deliberate choices.',
  ],
  churn: [
    'Segment churn by cohort and plan before drawing conclusions.',
    'Pair quantitative signals with interview themes.',
    'Separate voluntary churn from failed payments.',
    'Look at leading indicators such as declining usage before renewal.',
  ],
  support: [
    'Define severity by customer impact, not by who reported it.',
    'Keep a fast path for outages and security issues.',
    'Review misrouted requests regularly to tune the rubric.',
    'Make ownership explicit for every escalation.',
  ],
  launch: [
    'Align on one primary message and one primary audience.',
    'Enable internal teams before the external announcement.',
    'Define success metrics before launch day.',
    'Prepare answers for the obvious objections.',
  ],
  engineering: [
    'Reproduce the behavior before changing code.',
    'Prefer small, reversible changes behind a flag.',
    'Add a regression test for the failure mode.',
    'Check for related call sites that share the same assumption.',
  ],
  data: [
    'Confirm metric definitions before comparing periods.',
    'Check sample sizes before reading trends.',
    'Report data freshness alongside every number.',
    'Look for one-off events that could distort the period.',
  ],
  meetings: [
    'Record decisions separately from discussion.',
    'Give every action item an owner and a date.',
    'Carry open questions into the next agenda.',
    'Link supporting documents where decisions were made.',
  ],
  scheduling: [
    'Protect existing focus blocks when proposing times.',
    'Offer two or three options instead of one.',
    'Confirm time zones for every participant.',
    'Attach an agenda to the invite.',
  ],
  general: [
    'Clarify the decision this work is meant to support.',
    'Separate what is known from what is assumed.',
    'Agree on a next step and an owner.',
    'Note open questions explicitly rather than guessing.',
  ],
}

export function pickConsiderations(topic: Topic, rng: Rng, count = 3): string[] {
  return rng.shuffle(CONSIDERATIONS[topic.domain]).slice(0, count)
}
