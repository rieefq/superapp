import type { ID, Investigation, Message, Source, SourceKind } from '@/core/types'
import { INVESTIGATION, KNOWLEDGE, PROJECT } from '../ids'
import { MINUTE, ref, type SeedCtx } from './helpers'
import { KNO, MSG } from './keys'
import { CHURN_REPORT_DRAFT, PORTBASE_REPORT } from './reports'

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
  { clock }: SeedCtx,
  messages: Record<ID, Message>,
): { investigations: Investigation[]; sources: Source[] } {
  const { back } = clock
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
      ...(s.publishedDaysAgo !== undefined ? { publishedAt: back(s.publishedDaysAgo) } : {}),
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

  // ------------------------------------------------------------------ Portbase (complete)
  const portbaseAt = startedFrom(MSG.portbaseStart, back(13, 5, 49))
  const pb = (n: number) => `src_portbase_${n}`
  const pbAdded = (n: number) => portbaseAt + n * MINUTE
  const portbaseSources = [
    fromKnowledge(pb(1), INVESTIGATION.portbase, pbAdded(1), {
      knowledgeId: KNO.winloss, title: 'Win/loss notes: Q3 competitive deals', credibility: 0.8, status: 'cited',
      snippet: 'Two Q3 losses to Portbase named its ready-made customer portal as the deciding factor; our wins came when operations or IT evaluators prioritized data, the API, EDI and SSO.',
    }),
    fromKnowledge(pb(2), INVESTIGATION.portbase, pbAdded(1), {
      knowledgeId: KNOWLEDGE.churnInterviews, title: 'Churn interview synthesis (6 customers)', credibility: 0.75, status: 'cited',
      snippet: 'Two churned customers had evaluated Portbase; Bluefen Maritime switched for the customer-facing portal and later reported slow support there.',
    }),
    web(pb(3), INVESTIGATION.portbase, pbAdded(2), {
      title: 'Pricing — Portbase', domain: 'portbase.example', path: '/pricing', author: 'Portbase', credibility: 0.85, status: 'cited',
      snippet: 'Lists three plans (Starter, Business and Enterprise), each priced per user per month on annual terms. Insights analytics appears from the Business plan upward; no usage-based option is listed.',
      content: 'First-party pricing page. Plan names and structure are clear; individual price points are shown only after choosing a team size, and we could not confirm them.',
    }),
    web(pb(4), INVESTIGATION.portbase, pbAdded(3), {
      title: 'Introducing Portbase Insights: analytics for every shipment', domain: 'portbase.example', path: '/blog/introducing-insights', author: 'Portbase Product Team', publishedDaysAgo: 130, credibility: 0.7, status: 'cited',
      snippet: 'Launch post presenting Insights as part of the Portbase platform: standard shipment KPIs, an on-time ranking of carriers and scheduled email digests.',
    }),
    web(pb(5), INVESTIGATION.portbase, pbAdded(4), {
      title: 'Portbase raises new funding to court mid-market forwarders', domain: 'freighttechweekly.example', path: '/news/portbase-funding-mid-market', author: 'Imogen Hale', publishedDaysAgo: 62, credibility: 0.65, status: 'cited',
      snippet: 'Reports that Portbase plans to use new funding to expand sales coverage for mid-sized freight forwarders. The article does not disclose financial terms that could be verified.',
    }),
    web(pb(6), INVESTIGATION.portbase, pbAdded(5), {
      title: 'Portbase reviews: customer portal software', domain: 'stackrank-reviews.example', path: '/products/portbase/reviews', author: 'StackRank community reviews', publishedDaysAgo: 20, credibility: 0.6, status: 'cited',
      snippet: 'Reviewers frequently praise quick setup and a clean interface; recurring complaints mention rigid reporting and slow responses from support.',
    }),
    web(pb(7), INVESTIGATION.portbase, pbAdded(6), {
      title: 'Customer portals are becoming table stakes for 3PLs', domain: 'supplychainsignal.example', path: '/analysis/customer-portals-table-stakes', author: 'Marco Ruiz', publishedDaysAgo: 95, credibility: 0.55, status: 'cited',
      snippet: 'A trend piece arguing that shippers increasingly expect self-service tracking and documents from their logistics providers. It draws on conversations with operations leaders rather than survey data.',
    }),
    web(pb(8), INVESTIGATION.portbase, pbAdded(8), {
      title: 'Hands-on with Portbase Insights', domain: 'loadboardreview.example', path: '/reviews/portbase-insights-hands-on', author: 'Hollis Grant', publishedDaysAgo: 70, credibility: 0.7, status: 'cited',
      snippet: 'Finds standard KPIs well presented, but notes that cost analysis by lane requires exporting data to a spreadsheet and that report layouts are fixed templates.',
    }),
    web(pb(9), INVESTIGATION.portbase, pbAdded(9), {
      title: 'What operations leaders want from visibility tools', domain: 'opsleaderquarterly.example', path: '/features/what-ops-leaders-want', author: 'Renata Okoye', publishedDaysAgo: 160, credibility: 0.45, status: 'cited',
      snippet: 'An opinion piece built on a handful of interviews suggests buyers increasingly ask for exception management rather than more dashboards. The methodology is not described.',
    }),
    web(pb(10), INVESTIGATION.portbase, pbAdded(10), {
      title: 'Portbase API reference: limits and webhooks', domain: 'portbase.example', path: '/docs/api/limits', author: 'Portbase', credibility: 0.8, status: 'cited', kind: 'doc',
      snippet: 'Documents per-key rate limits by plan and a short list of webhook events for shipment status changes; higher limits are available to Enterprise customers on request.',
    }),
  ]

  // ------------------------------------------------------------------ Pricing trends (running)
  const pricingAt = startedFrom(MSG.pricingResearch, back(0, 0, 38))
  const pr = (n: number) => `src_pricing_${n}`
  const pricingSources = [
    web(pr(1), INVESTIGATION.pricingTrends, pricingAt + 2 * MINUTE, {
      title: 'The hybrid pricing playbook: platform fees plus usage', domain: 'saaspricingjournal.example', path: '/articles/hybrid-pricing-playbook', author: 'Talia Brooks', publishedDaysAgo: 48, credibility: 0.75, status: 'read',
      snippet: 'Describes hybrid models that pair a predictable platform fee with a usage component, and argues the fee should cover the value most customers get every month while usage captures growth.',
    }),
    web(pr(2), INVESTIGATION.pricingTrends, pricingAt + 2 * MINUTE, {
      title: 'Choosing a value metric customers can predict', domain: 'metered.example', path: '/issues/value-metrics-customers-can-predict', author: 'Lars Achterberg', publishedDaysAgo: 85, credibility: 0.7, status: 'read',
      snippet: "Argues that a good value metric tracks the customer's own business volume, is visible to the customer in their own systems, and can be forecast a month ahead.",
    }),
    web(pr(3), INVESTIGATION.pricingTrends, pricingAt + 3 * MINUTE, {
      title: 'Bill shock is a product problem', domain: 'producteconomics.example', path: '/essays/bill-shock-is-a-product-problem', author: 'Sana Iqbal', publishedDaysAgo: 120, credibility: 0.65, status: 'read',
      snippet: 'Treats surprise invoices as a product failure rather than a billing one, and recommends in-product usage meters, threshold alerts and temporary caps for new customers.',
    }),
    web(pr(4), INVESTIGATION.pricingTrends, pricingAt + 3 * MINUTE, {
      title: 'Freightly pricing update: pay per load', domain: 'freightly.example', path: '/blog/pricing-update', author: 'Freightly', publishedDaysAgo: 150, credibility: 0.8, status: 'queued',
      snippet: "Freightly's announcement of per-load pricing, with a free tier for low volumes and fees that fall as volume grows.",
    }),
    web(pr(5), INVESTIGATION.pricingTrends, pricingAt + 3 * MINUTE, {
      title: 'When usage-based pricing backfires', domain: 'churnlab.example', path: '/posts/when-usage-pricing-backfires', author: 'Devin Marsh', publishedDaysAgo: 210, credibility: 0.55, status: 'queued',
      snippet: 'Collects accounts from SaaS operators whose move to usage pricing was followed by churn among customers with seasonal volume.',
    }),
    web(pr(6), INVESTIGATION.pricingTrends, pricingAt + 4 * MINUTE, {
      title: 'Annual commitments with usage true-ups: a field guide', domain: 'saaspricingjournal.example', path: '/articles/annual-commits-true-ups', author: 'Talia Brooks', publishedDaysAgo: 30, credibility: 0.7, status: 'queued',
      snippet: 'Explains contracts that commit to an annual volume with a buffer and reconcile once a year, a structure aimed at buyers with fixed annual budgets.',
    }),
    web(pr(7), INVESTIGATION.pricingTrends, pricingAt + 4 * MINUTE, {
      title: 'Pricing analytics add-ons in vertical SaaS', domain: 'verticalsaasreview.example', path: '/analysis/pricing-analytics-add-ons', author: 'Noor Haddad', publishedDaysAgo: 65, credibility: 0.6, status: 'queued',
      snippet: 'Surveys how vertical software vendors package analytics: bundled into higher tiers, sold as seat-based add-ons, or priced on usage as a separate module.',
    }),
    web(pr(8), INVESTIGATION.pricingTrends, pricingAt + 4 * MINUTE, {
      title: 'Forum thread: how do you forecast usage-based bills?', domain: 'opsforum.example', path: '/t/forecasting-usage-based-bills', author: 'Community discussion', publishedDaysAgo: 14, credibility: 0.45, status: 'queued',
      snippet: 'Operations managers compare ways to forecast usage-based software bills; several mention asking vendors for caps or annual commitments.',
    }),
  ]

  // ------------------------------------------------------------------ Churn (review)
  const churnAt = back(3, 7)
  const ch = (n: number) => `src_churn_${n}`
  const churnSources = [
    fromKnowledge(ch(1), INVESTIGATION.churn, churnAt + 2 * MINUTE, {
      knowledgeId: KNOWLEDGE.churnInterviews, title: 'Churn interview synthesis (6 customers)', credibility: 0.8, status: 'cited',
      snippet: 'Six interviews (four churned, two at risk): slow time to first value, export-and-rebuild reporting and slow integration support were the most common themes.',
    }),
    fromKnowledge(ch(2), INVESTIGATION.churn, churnAt + 2 * MINUTE, {
      knowledgeId: KNOWLEDGE.meridianCall, title: 'Customer call: Meridian Freight', credibility: 0.7, status: 'cited',
      snippet: 'Before Lumen, Meridian rebuilt a weekly carrier report in spreadsheets; predictable pricing matters more to them than the unit price.',
    }),
    fromKnowledge(ch(3), INVESTIGATION.churn, churnAt + 3 * MINUTE, {
      knowledgeId: KNOWLEDGE.csvAccounts, title: 'Top accounts by ARR.csv', credibility: 0.85, status: 'cited',
      snippet: 'Top 15 accounts with health and days to renewal: Coastal Cargo and Halden Logistics are red, four more are yellow, and all six renew within 120 days.',
    }),
    web(ch(4), INVESTIGATION.churn, churnAt + 5 * MINUTE, {
      title: 'Why B2B customers leave in the first year', domain: 'churnlab.example', path: '/posts/first-year-churn', author: 'Devin Marsh', publishedDaysAgo: 100, credibility: 0.6, status: 'cited',
      snippet: 'Argues that the first months after signing are the riskiest period for B2B software, and that delayed time to value is a common thread in early churn.',
    }),
    web(ch(5), INVESTIGATION.churn, churnAt + 6 * MINUTE, {
      title: 'Time-to-value benchmarks are mostly folklore', domain: 'producteconomics.example', path: '/essays/time-to-value-benchmarks', author: 'Sana Iqbal', publishedDaysAgo: 140, credibility: 0.5, status: 'read',
      snippet: 'Questions widely shared time-to-value benchmarks, noting that most rest on small or undisclosed samples.',
    }),
    web(ch(6), INVESTIGATION.churn, churnAt + 7 * MINUTE, {
      title: 'What logistics software buyers value in their vendors', domain: 'supplychainsignal.example', path: '/analysis/what-buyers-value', author: 'Marco Ruiz', publishedDaysAgo: 75, credibility: 0.55, status: 'cited',
      snippet: 'Based on conversations with operations buyers, the piece reports that responsiveness when integrations break is valued above breadth of features.',
    }),
    web(ch(7), INVESTIGATION.churn, churnAt + 8 * MINUTE, {
      title: 'Spreadsheets still run freight analytics', domain: 'freighttechweekly.example', path: '/features/spreadsheets-still-run-freight-analytics', author: 'Imogen Hale', publishedDaysAgo: 55, credibility: 0.6, status: 'cited',
      snippet: 'Describes freight operations teams that still assemble carrier and lane reports in spreadsheets, even when their portals hold the underlying data.',
    }),
  ]

  const investigations: Investigation[] = [
    {
      id: INVESTIGATION.portbase,
      title: 'Portbase positioning & pricing',
      question: 'How does Portbase position and price its customer portal against Atlas, and where are we exposed?',
      projectId: PROJECT.landscape,
      status: 'complete',
      depth: 'standard',
      angles: ['Positioning and messaging', 'Pricing and packaging', 'Product gaps compared with Atlas', 'Customer sentiment', 'Recent launches and funding'],
      sourceIds: portbaseSources,
      findings: [
        { id: 'fnd_portbase_1', text: 'Portbase positions itself as an all-in-one customer experience platform and leads with onboarding speed and design rather than analytics depth.', sourceIds: [pb(3), pb(4), pb(6)], confidence: 'high', pinned: true },
        { id: 'fnd_portbase_2', text: 'Pricing is per user, with Insights analytics only from the Business plan upward; no usage-based option was found.', sourceIds: [pb(3), pb(10)], confidence: 'high' },
        { id: 'fnd_portbase_3', text: 'Insights covers standard shipment KPIs but is thin on lane-level cost analysis and custom reports; reviewers describe exporting to spreadsheets.', sourceIds: [pb(8), pb(6), pb(1)], confidence: 'medium', pinned: true },
        { id: 'fnd_portbase_4', text: 'Slow support responses are the most consistent complaint, both in public reviews and in our own churn interviews.', sourceIds: [pb(6), pb(2)], confidence: 'medium' },
        { id: 'fnd_portbase_5', text: "Portbase is moving toward mid-market forwarders after new funding, which overlaps directly with Atlas's core segment.", sourceIds: [pb(5), pb(7)], confidence: 'medium' },
        { id: 'fnd_portbase_6', text: 'We lose to Portbase when customer experience or sales leads the evaluation, and win when operations or IT evaluators prioritize data, the API, EDI and SSO.', sourceIds: [pb(1)], confidence: 'medium' },
      ],
      report: PORTBASE_REPORT.trim(),
      runIds: [],
      origin: ref('message', MSG.portbaseStart),
      knowledgeId: KNOWLEDGE.portbaseTeardown,
      createdAt: portbaseAt,
      updatedAt: back(11, 2),
    },
    {
      id: INVESTIGATION.pricingTrends,
      title: 'Usage-based pricing trends in B2B SaaS',
      question: 'What are B2B SaaS companies learning from hybrid and usage-based pricing (value metrics, bill-shock guardrails, moving customers off seats), and what does that imply for the Atlas Lumen tiers?',
      projectId: PROJECT.lumen,
      status: 'running',
      depth: 'deep',
      angles: [
        'Hybrid models: platform fee plus usage',
        'Choosing a value metric customers can predict',
        'Bill-shock guardrails: alerts, caps and true-ups',
        'Moving existing customers from seats to usage',
        'Competitor moves: Freightly, Portbase, ShipLoom',
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
      question: 'Why do logistics customers churn from Atlas, which current accounts are at risk, and what should change in onboarding, support and Lumen to prevent it?',
      projectId: PROJECT.landscape,
      status: 'review',
      depth: 'standard',
      angles: [
        'Reasons customers give for leaving',
        'Early-life risk: onboarding and time to first value',
        'Support and integration problems before churn',
        'Pricing and packaging as a churn driver',
        'Which current accounts look at risk',
      ],
      sourceIds: churnSources,
      findings: [
        { id: 'fnd_churn_1', text: 'Slow time to first value is the most common churn theme (4 of 6 interviews); TMS integration mapping is the long pole.', sourceIds: [ch(1), ch(4)], confidence: 'high', pinned: true },
        { id: 'fnd_churn_2', text: 'Weekly export-and-rebuild reporting pushed teams to spreadsheets or separate BI tools: the gap Lumen targets.', sourceIds: [ch(1), ch(2), ch(7)], confidence: 'high' },
        { id: 'fnd_churn_3', text: 'Slow tier-2 help on EDI and TMS problems preceded difficult renewal conversations (3 of 6).', sourceIds: [ch(1), ch(6)], confidence: 'medium' },
        { id: 'fnd_churn_4', text: 'Per-seat pricing penalized occasional users and led to shared logins (2 of 6).', sourceIds: [ch(1)], confidence: 'medium' },
        { id: 'fnd_churn_5', text: 'All six red or yellow accounts in the top 15 renew within 120 days; health scores may partly reflect renewal timing.', sourceIds: [ch(3)], confidence: 'low' },
      ],
      report: CHURN_REPORT_DRAFT.trim(),
      runIds: [],
      origin: ref('knowledge', KNOWLEDGE.churnInterviews),
      createdAt: churnAt,
      updatedAt: back(2, 1),
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
        'Documents Atlas generates on behalf of customers in the portal',
      ],
      sourceIds: [],
      findings: [],
      runIds: [],
      createdAt: back(1, 3),
      updatedAt: back(1, 3),
    },
  ]

  return { investigations, sources }
}
