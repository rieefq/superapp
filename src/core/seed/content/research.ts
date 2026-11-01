import type { ID, Investigation, Message, Source, SourceKind } from '@/core/types'
import { INVESTIGATION, KNOWLEDGE, PROJECT } from '../ids'
import { MINUTE, ref, type SeedCtx } from './helpers'
import { MSG } from './keys'
import { CHURN_REPORT_DRAFT, TIDEWELL_REPORT } from './reports'

interface WebSourceSpec {
  title: string
  path: string
  domain: string
  author: string
  /** Days before now; omitted for undated pages such as pricing pages. */
  publishedDaysAgo?: number
  snippet: string
  content?: string
  credibility: number
  status: Source['status']
  kind?: SourceKind
}

interface KnowledgeSourceSpec {
  knowledgeId: ID
  title: string
  snippet: string
  credibility: number
  status: Source['status']
}

export function buildResearch(
  { clock, at }: SeedCtx,
  messages: Record<ID, Message>,
): { investigations: Investigation[]; sources: Source[] } {
  const { back, wd } = clock
  const sources: Source[] = []

  const web = (id: ID, investigationId: ID, addedAt: number, s: WebSourceSpec): ID => {
    sources.push({
      id,
      investigationId,
      kind: s.kind ?? 'web',
      title: s.title,
      url: `https://${s.domain}${s.path}`,
      domain: s.domain,
      author: s.author,
      ...(s.publishedDaysAgo !== undefined ? { publishedAt: clock.day(s.publishedDaysAgo, 9, 0) } : {}),
      snippet: s.snippet,
      ...(s.content ? { content: s.content } : {}),
      credibility: s.credibility,
      status: s.status,
      simulated: true,
      addedAt,
    })
    return id
  }

  const fromKnowledge = (id: ID, investigationId: ID, addedAt: number, s: KnowledgeSourceSpec): ID => {
    sources.push({
      id,
      investigationId,
      kind: 'knowledge',
      title: s.title,
      snippet: s.snippet,
      credibility: s.credibility,
      status: s.status,
      simulated: false,
      knowledgeId: s.knowledgeId,
      addedAt,
    })
    return id
  }

  const startedFrom = (msgId: ID, fallback: number) => (messages[msgId]?.createdAt ?? fallback) + MINUTE / 2

  // ------------------------------------------------------------------ Tidewell (complete)
  const tidewellAt = startedFrom(MSG.tidewellStart, at.tidewell1 - 5 * MINUTE)
  const pb = (n: number) => `src_tidewell_${n}`
  const pbAdded = (n: number) => at.tidewell1 + (n + 1) * MINUTE
  const tidewellSources = [
    fromKnowledge(pb(1), INVESTIGATION.tidewell, pbAdded(1), {
      knowledgeId: KNOWLEDGE.freightlyNotes, title: 'Freightly product notes', credibility: 0.75, status: 'cited',
      snippet: 'When a broker starts serving enterprise shippers, the incumbent we meet is usually Tidewell rather than Freightly.',
    }),
    fromKnowledge(pb(2), INVESTIGATION.tidewell, pbAdded(1), {
      knowledgeId: KNOWLEDGE.marketSizing, title: 'Market sizing: mid-market freight portals', credibility: 0.7, status: 'cited',
      snippet: 'Large enterprise shippers, where Tidewell sells most of its contracts, sit outside our mid-market definition.',
    }),
    web(pb(3), INVESTIGATION.tidewell, pbAdded(2), {
      title: 'Pricing — Tidewell', domain: 'tidewell.example', path: '/pricing', author: 'Tidewell', credibility: 0.85, status: 'cited',
      snippet: 'Starter, Pro and Enterprise plans on annual contracts priced per site, plus a one-time implementation fee. No usage-based option was listed when this page was read.',
      content: 'First-party pricing page. Plan structure is clear; exact prices appear only after choosing a number of sites, and we could not confirm them.',
    }),
    web(pb(4), INVESTIGATION.tidewell, pbAdded(3), {
      title: 'Case study: customs and tracking in one portal for a consumer-goods shipper', domain: 'tidewell.example', path: '/customers/consumer-goods-shipper', author: 'Tidewell', publishedDaysAgo: 120, credibility: 0.6, status: 'cited',
      snippet: 'A first-party case study describing customs filings, document checks and shipment tracking handled in one portal across many sites.',
    }),
    web(pb(5), INVESTIGATION.tidewell, pbAdded(4), {
      title: 'Case study: how a forwarder network shares customs documents', domain: 'tidewell.example', path: '/customers/forwarder-network', author: 'Tidewell', publishedDaysAgo: 210, credibility: 0.55, status: 'cited',
      snippet: 'Shows forwarders joining an enterprise shipper’s Tidewell workspace to exchange customs documents, rather than buying Tidewell themselves.',
    }),
    web(pb(6), INVESTIGATION.tidewell, pbAdded(5), {
      title: 'Tidewell reviews: customer portal software', domain: 'stackrank-reviews.example', path: '/products/tidewell/reviews', author: 'StackRank community reviews', publishedDaysAgo: 20, credibility: 0.6, status: 'cited',
      snippet: 'Reviewers frequently praise customs coverage and reliability; recurring complaints mention invoicing workarounds and long implementations.',
    }),
    web(pb(7), INVESTIGATION.tidewell, pbAdded(6), {
      title: 'Tidewell reviews: billing and invoicing', domain: 'freightsoftwarereviews.example', path: '/tidewell/billing', author: 'Freight Software Reviews', publishedDaysAgo: 45, credibility: 0.55, status: 'cited',
      snippet: 'Users describe exporting invoices to their ERP because customers cannot view or pay them in the portal.',
    }),
    web(pb(8), INVESTIGATION.tidewell, pbAdded(8), {
      title: 'Tidewell in practice: a reviewer roundup', domain: 'loadboardreview.example', path: '/roundups/tidewell', author: 'Hollis Grant', publishedDaysAgo: 70, credibility: 0.65, status: 'cited',
      snippet: 'Insights covers standard KPIs, but cost by lane needs a spreadsheet export; each new site goes live through an implementation project rather than self-serve setup.',
    }),
    web(pb(9), INVESTIGATION.tidewell, pbAdded(9), {
      title: 'Tidewell changelog, last six months', domain: 'tidewell.example', path: '/changelog', author: 'Tidewell', credibility: 0.8, status: 'cited', kind: 'doc',
      snippet: 'Customs features dominate the last six months of releases; the move to per-site contracts and expanded implementation services are both announced here.',
    }),
    web(pb(10), INVESTIGATION.tidewell, pbAdded(10), {
      title: 'Analyst note: customer portals in freight', domain: 'logisticsanalyst.example', path: '/notes/freight-portals', author: 'Renata Okoye', publishedDaysAgo: 160, credibility: 0.5, status: 'cited',
      snippet: 'Describes Tidewell’s focus on enterprise shippers and quotes an entry price that predates its per-site pricing model.',
    }),
  ]

  // ------------------------------------------------------------------ Pricing trends (running)
  const pricingAt = startedFrom(MSG.pricingResearch, back(0, 0, 38))
  const pr = (n: number) => `src_pricing_${n}`
  const pricingSources = [
    web(pr(1), INVESTIGATION.pricingTrends, pricingAt + 2 * MINUTE, {
      title: 'The hybrid pricing playbook: platform fees plus usage', domain: 'saaspricingjournal.example', path: '/articles/hybrid-pricing-playbook', author: 'Talia Brooks', publishedDaysAgo: 48, credibility: 0.75, status: 'read',
      snippet: 'Describes hybrid models that pair a predictable platform fee or committed minimum with a usage component, and argues most application vendors that adopted usage pricing kept one.',
    }),
    web(pr(2), INVESTIGATION.pricingTrends, pricingAt + 2 * MINUTE, {
      title: 'Choosing a value metric customers can predict', domain: 'metered.example', path: '/issues/value-metrics-customers-can-predict', author: 'Lars Achterberg', publishedDaysAgo: 85, credibility: 0.7, status: 'read',
      snippet: "Argues that a good value metric tracks the customer's own business volume, is visible in their own systems, and can be forecast a month ahead.",
    }),
    web(pr(3), INVESTIGATION.pricingTrends, pricingAt + 2 * MINUTE, {
      title: 'Usage pricing beyond developer tools', domain: 'producteconomics.example', path: '/essays/usage-pricing-beyond-developer-tools', author: 'Sana Iqbal', publishedDaysAgo: 120, credibility: 0.65, status: 'read',
      snippet: 'Compares vendors that moved to usage pricing: infrastructure companies with mostly variable bills report the strongest expansion, while application vendors mostly kept a platform fee.',
    }),
    web(pr(4), INVESTIGATION.pricingTrends, pricingAt + 3 * MINUTE, {
      title: 'Bill shock is a product problem', domain: 'churnlab.example', path: '/posts/bill-shock-is-a-product-problem', author: 'Devin Marsh', publishedDaysAgo: 150, credibility: 0.6, status: 'queued',
      snippet: 'Treats surprise invoices as a product failure and recommends in-product usage meters, threshold alerts and temporary caps for new customers.',
    }),
    web(pr(5), INVESTIGATION.pricingTrends, pricingAt + 3 * MINUTE, {
      title: 'Credits, units and the procurement problem', domain: 'metered.example', path: '/issues/credits-and-procurement', author: 'Lars Achterberg', publishedDaysAgo: 60, credibility: 0.65, status: 'queued',
      snippet: 'Argues that abstract units such as credits slow procurement because buyers cannot map them to their own budgets, and recommends instrumenting the value metric before launch.',
    }),
    web(pr(6), INVESTIGATION.pricingTrends, pricingAt + 4 * MINUTE, {
      title: 'Annual commitments with usage true-ups: a field guide', domain: 'saaspricingjournal.example', path: '/articles/annual-commits-true-ups', author: 'Talia Brooks', publishedDaysAgo: 30, credibility: 0.7, status: 'queued',
      snippet: 'Explains annual commitments with a buffer and a discounted overage rate, and notes that procurement teams at operations-heavy buyers scrutinize bills with a large variable share.',
    }),
    web(pr(7), INVESTIGATION.pricingTrends, pricingAt + 4 * MINUTE, {
      title: 'Forecasting revenue when customers pay for usage', domain: 'revopsjournal.example', path: '/articles/forecasting-usage-revenue', author: 'Noor Haddad', publishedDaysAgo: 75, credibility: 0.6, status: 'queued',
      snippet: 'Finance leaders describe stronger expansion from usage-priced add-ons, alongside noisier revenue forecasts and harder quota setting.',
    }),
    web(pr(8), INVESTIGATION.pricingTrends, pricingAt + 4 * MINUTE, {
      title: 'Forum thread: how do you forecast usage-based bills?', domain: 'opsforum.example', path: '/t/forecasting-usage-based-bills', author: 'Community discussion', publishedDaysAgo: 14, credibility: 0.45, status: 'queued',
      snippet: 'Operations managers compare ways to forecast usage-based software bills; several say procurement pushes back when much of a bill is variable, and that they want usage reporting before signing.',
    }),
  ]

  // ------------------------------------------------------------------ Churn (review)
  const churnAt = at.churn1 - 10 * MINUTE
  const ch = (n: number) => `src_churn_${n}`
  const chAdded = (n: number) => at.churn1 + (n + 1) * MINUTE
  const churnSources = [
    fromKnowledge(ch(1), INVESTIGATION.churn, chAdded(1), {
      knowledgeId: KNOWLEDGE.churnInterviews, title: 'Churn interview synthesis (6 customers)', credibility: 0.8, status: 'cited',
      snippet: 'Six interviews (four churned, two at risk): slow time to first value, export-and-rebuild reporting and slow integration support were the most common themes.',
    }),
    fromKnowledge(ch(2), INVESTIGATION.churn, chAdded(1), {
      knowledgeId: KNOWLEDGE.meridianCall, title: 'Customer call: Meridian Freight', credibility: 0.7, status: 'cited',
      snippet: 'Before Lumen, Meridian rebuilt a weekly carrier report in spreadsheets; predictable pricing matters more to them than the unit price.',
    }),
    fromKnowledge(ch(3), INVESTIGATION.churn, chAdded(2), {
      knowledgeId: KNOWLEDGE.csvAccounts, title: 'Top accounts by ARR.csv', credibility: 0.85, status: 'cited',
      snippet: 'Top 15 accounts with health and days to renewal: Coastal Cargo and Halden Logistics are red, four more are yellow, and all six renew within 120 days.',
    }),
    web(ch(4), INVESTIGATION.churn, chAdded(4), {
      title: 'Why B2B customers leave in the first year', domain: 'churnlab.example', path: '/posts/first-year-churn', author: 'Devin Marsh', publishedDaysAgo: 100, credibility: 0.6, status: 'cited',
      snippet: 'Argues that the first months after signing are the riskiest period for B2B software, and that delayed time to value is a common thread in early churn.',
    }),
    web(ch(5), INVESTIGATION.churn, chAdded(5), {
      title: 'Time-to-value benchmarks are mostly folklore', domain: 'producteconomics.example', path: '/essays/time-to-value-benchmarks', author: 'Sana Iqbal', publishedDaysAgo: 140, credibility: 0.5, status: 'read',
      snippet: 'Questions widely shared time-to-value benchmarks, noting that most rest on small or undisclosed samples.',
    }),
    web(ch(6), INVESTIGATION.churn, chAdded(6), {
      title: 'What logistics software buyers value in their vendors', domain: 'supplychainsignal.example', path: '/analysis/what-buyers-value', author: 'Marco Ruiz', publishedDaysAgo: 75, credibility: 0.55, status: 'cited',
      snippet: 'Based on conversations with operations buyers, the piece reports that responsiveness when integrations break is valued above breadth of features.',
    }),
    web(ch(7), INVESTIGATION.churn, chAdded(7), {
      title: 'Spreadsheets still run freight analytics', domain: 'freighttechweekly.example', path: '/features/spreadsheets-still-run-freight-analytics', author: 'Imogen Hale', publishedDaysAgo: 55, credibility: 0.6, status: 'cited',
      snippet: 'Describes freight operations teams that still assemble carrier and lane reports in spreadsheets, even when their portals hold the underlying data.',
    }),
  ]

  const investigations: Investigation[] = [
    {
      id: INVESTIGATION.tidewell,
      title: 'Tidewell positioning & pricing',
      question: 'Who does Tidewell sell to, how does it price, and where is it stronger or weaker than Atlas?',
      projectId: PROJECT.landscape,
      status: 'complete',
      depth: 'standard',
      angles: [
        'Who Tidewell sells to and how it describes the problem',
        'Pricing and packaging, public and reported',
        'Product gaps compared with Atlas: tracking, invoicing, analytics',
        'Where customers say Tidewell wins and loses',
      ],
      sourceIds: tidewellSources,
      findings: [
        { id: 'fnd_tidewell_1', text: 'Tidewell sells annual, per-site contracts to enterprise shippers, with a one-time implementation fee.', sourceIds: [pb(3), pb(9)], confidence: 'high' },
        { id: 'fnd_tidewell_2', text: 'Customs workflows (filings, document checks, broker hand-offs) are its clearest strength, in case studies and reviews alike.', sourceIds: [pb(4), pb(5), pb(6)], confidence: 'high', pinned: true },
        { id: 'fnd_tidewell_3', text: "Invoicing is its weakest area: invoices are exported to the customer's ERP rather than viewed and paid in the portal.", sourceIds: [pb(7), pb(6)], confidence: 'medium' },
        { id: 'fnd_tidewell_4', text: 'Onboarding runs as an implementation project per site; there is no self-serve setup.', sourceIds: [pb(8), pb(9)], confidence: 'medium' },
        { id: 'fnd_tidewell_5', text: 'Sources disagreed on the Enterprise floor price; the lower figure predates per-site pricing, so the newer pricing page wins.', sourceIds: [pb(3), pb(10)], confidence: 'medium' },
        { id: 'fnd_tidewell_6', text: 'Atlas can win mid-market forwarders on invoicing and time to go-live, and is exposed on analytics until Lumen ships.', sourceIds: [pb(1), pb(2), pb(8)], confidence: 'medium', pinned: true },
      ],
      report: TIDEWELL_REPORT.trim(),
      runIds: [],
      origin: ref('message', MSG.tidewellStart),
      knowledgeId: KNOWLEDGE.tidewellTeardown,
      createdAt: tidewellAt,
      updatedAt: at.tidewell2 + 20 * MINUTE,
    },
    {
      id: INVESTIGATION.pricingTrends,
      title: 'Usage-based pricing trends in B2B SaaS',
      question: 'How are B2B SaaS companies using usage-based and hybrid pricing, which value metrics work, how do buyers react to variable bills, and what does that imply for the Atlas Lumen tiers?',
      projectId: PROJECT.landscape,
      status: 'running',
      depth: 'deep',
      angles: [
        'How widely B2B SaaS has adopted usage-based pricing',
        'Which value metrics work, and which create friction',
        'How buyers react: predictability, caps, commits',
        'What it means for an analytics add-on like Lumen',
      ],
      sourceIds: pricingSources,
      findings: [],
      runIds: [],
      origin: ref('message', MSG.pricingResearch),
      createdAt: pricingAt,
      updatedAt: pricingAt + 4 * MINUTE,
    },
    {
      id: INVESTIGATION.churn,
      title: 'Why do logistics customers churn?',
      question: 'Why do logistics customers churn from Atlas, which current accounts look at risk, and what could we measure to see it coming?',
      projectId: PROJECT.landscape,
      status: 'review',
      depth: 'standard',
      angles: [
        'What our churned customers told us',
        'What the market says about portal churn',
        'Early warning signals we could measure',
      ],
      sourceIds: churnSources,
      findings: [
        { id: 'fnd_churn_1', text: 'Slow time to first value is the most common churn theme (4 of 6 interviews); TMS integration mapping is the long pole.', sourceIds: [ch(1), ch(4)], confidence: 'high', pinned: true },
        { id: 'fnd_churn_2', text: 'Weekly export-and-rebuild reporting pushed teams to spreadsheets or separate BI tools: the gap Lumen targets.', sourceIds: [ch(1), ch(2), ch(7)], confidence: 'high' },
        { id: 'fnd_churn_3', text: 'Slow tier-2 help on EDI and TMS problems preceded difficult renewal conversations (3 of 6).', sourceIds: [ch(1), ch(6)], confidence: 'medium' },
        { id: 'fnd_churn_4', text: 'Per-seat pricing penalized occasional users and led to shared logins (2 of 6).', sourceIds: [ch(1)], confidence: 'low' },
        { id: 'fnd_churn_5', text: 'All six red or yellow accounts in the top 15 renew within 120 days; health scores may partly reflect renewal timing.', sourceIds: [ch(3)], confidence: 'low' },
      ],
      report: CHURN_REPORT_DRAFT.trim(),
      runIds: [],
      origin: ref('knowledge', KNOWLEDGE.churnInterviews),
      createdAt: churnAt,
      updatedAt: at.churn1 + 22 * MINUTE,
    },
    {
      id: INVESTIGATION.einvoicing,
      title: 'EU e-invoicing mandate: impact on Atlas',
      question: 'Which upcoming EU e-invoicing requirements apply to the invoices Atlas issues, and what would we need to change in billing, including the move to Stripe Billing, to comply?',
      projectId: PROJECT.atlas,
      status: 'draft',
      depth: 'standard',
      angles: [
        'Which countries our EU customers are billed in, and the timelines there',
        'Required structured formats, and whether PDF invoices remain acceptable',
        'Whether Stripe Billing output is enough or a certified e-invoicing provider is needed',
        'Impact on invoice numbering after the Stripe cutover',
        'What competitors are doing: ShipLoom has announced EU e-invoicing support',
      ],
      sourceIds: [],
      findings: [],
      runIds: [],
      createdAt: wd(1, 16, 30),
      updatedAt: wd(1, 16, 30),
    },
  ]

  return { investigations, sources }
}
