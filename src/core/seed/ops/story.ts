import type { EntityRef } from '@/core/types'
import { KNOWLEDGE, THREAD } from '../ids'
import type { Timeline } from './timeline'
import { ref } from './util'

export type Priority = 'urgent' | 'high' | 'medium' | 'low'

export interface SupportEmail {
  key: string
  at: number
  from: string
  account: 'Meridian Freight' | 'Coastal Cargo' | 'Halden Logistics'
  plan: 'Enterprise' | 'Growth' | 'Starter'
  subject: string
  quote: string
  priority: Priority
  category: string
  summary: string
  /** Linear issue for non-urgent email. */
  issue?: string
  /** Minutes until a human approved the #support-urgent alert (urgent email). */
  alertApprovedAfterMin?: number
  refs?: EntityRef[]
  /** The run failed while filing the Linear issue. */
  failure?: string
}

export interface RadarWeek {
  key: string
  at: number
  results: number
  queries: number
  items: { text: string; source: string; relevance: number }[]
  updates: EntityRef[]
  status: 'succeeded' | 'cancelled'
}

export interface PullRequestReview {
  key: string
  at: number
  number: number
  title: string
  author: string
  additions: number
  deletions: number
  files: number
  /** Review comments (reviewable PRs) or the split request (oversized PRs). */
  comments: string[]
  decision: 'approved' | 'rejected'
  waitMin: number
  note?: string
}

export function buildStory(tl: Timeline) {
  const { wd } = tl.clock
  const meridian = { account: 'Meridian Freight', plan: 'Enterprise' } as const
  const coastal = { account: 'Coastal Cargo', plan: 'Starter' } as const
  const halden = { account: 'Halden Logistics', plan: 'Growth' } as const

  const supportEmails: SupportEmail[] = [
    {
      key: 'triage_01', at: wd(20, 8, 40), from: 'it-admin@haldenlogistics.example', ...halden,
      subject: 'Add a second admin to our account',
      quote: 'Our only admin is going on leave next month. Can you give admin rights to a second person on our team?',
      priority: 'low', category: 'account-admin', issue: 'SUP-388',
      summary: 'Halden needs a second admin before their only admin goes on leave. Routine permissions change.',
    },
    {
      key: 'triage_02', at: wd(18, 13, 5), from: 'billing@coastalcargo.example', ...coastal,
      subject: 'Invoice PDFs return 404',
      quote: 'Every “Download PDF” link on the billing page goes to a 404. Our finance team needs them for month-end close.',
      priority: 'high', category: 'billing', issue: 'SUP-395',
      summary: 'Invoice PDF links on the billing page return 404 for Coastal Cargo. Blocks their month-end close.',
    },
    {
      key: 'triage_03', at: wd(3, 7, 55), from: 'ops@meridianfreight.example', ...meridian,
      subject: 'Users signed out about an hour after logging in',
      quote: 'Since last week several dispatchers get bounced back to the SSO login roughly an hour after signing in, sometimes mid-booking. Our IdP sessions last 12 hours.',
      priority: 'urgent', category: 'auth', alertApprovedAfterMin: 6,
      summary: 'Dispatchers at Meridian are sent back to SSO login about an hour after signing in, mid-booking. More than one user affected.',
      refs: [ref('knowledge', KNOWLEDGE.adrSessions), ref('thread', THREAD.ssoBug)],
    },
    {
      key: 'triage_04', at: wd(13, 11, 30), from: 'dispatch@haldenlogistics.example', ...halden,
      subject: 'ETAs on the tracking page are a day off',
      quote: 'Containers arriving overnight in Rotterdam show an ETA of the previous day. Our own customers are calling us about it.',
      priority: 'medium', category: 'shipments', issue: 'SUP-401',
      summary: 'Overnight arrivals show the previous day’s ETA, likely a time zone display issue. Halden’s customers have noticed.',
    },
    {
      key: 'triage_05', at: wd(10, 14, 45), from: 'procurement@coastalcargo.example', ...coastal,
      subject: 'Question about Lumen beta pricing',
      quote: 'We joined the Lumen beta and want to budget for next year. Will pricing be per seat or per shipment?',
      priority: 'low', category: 'sales', issue: 'SUP-409',
      summary: 'Coastal Cargo asks how Lumen will be priced after the beta (per seat or per shipment) for budgeting.',
      refs: [ref('knowledge', KNOWLEDGE.pricingMemo)],
    },
    {
      key: 'triage_06', at: tl.saturday, from: 'ops-team@haldenlogistics.example', ...halden,
      subject: 'Please stop the weekly shipment report emails',
      quote: 'Please stop sending the weekly shipment summary to this shared inbox. We use the dashboard now.',
      priority: 'low', category: 'notifications', issue: 'SUP-410',
      summary: 'Halden wants the weekly shipment summary email turned off for their shared inbox.',
    },
    {
      key: 'triage_07', at: wd(7, 9, 20), from: 'bookings@haldenlogistics.example', ...halden,
      subject: 'Bulk booking upload stops at row 200',
      quote: 'Our CSV upload of next week’s bookings stops at row 200 with no error message. The file has 640 rows.',
      priority: 'medium', category: 'bookings', issue: 'SUP-414',
      summary: 'Halden’s bulk booking upload silently stops at row 200 of 640. Looks like an undocumented row limit.',
      failure: 'Linear API returned 503 Service Unavailable after 3 retries. The email stays unlabeled, so the next run files it.',
    },
    {
      key: 'triage_08', at: wd(5, 16, 5), from: 'integrations@haldenlogistics.example', ...halden,
      subject: '429 errors from /v1/shipments during our nightly sync',
      quote: 'Our nightly sync started failing with HTTP 429 at about 01:00 UTC. We page through roughly 40,000 shipments.',
      priority: 'high', category: 'api', issue: 'SUP-417',
      summary: 'Halden’s nightly sync hits rate limits on /v1/shipments while paging ~40k shipments. Their integration is failing every night.',
      refs: [ref('knowledge', KNOWLEDGE.rateLimits)],
    },
    {
      key: 'triage_09', at: wd(4, 6, 52), from: 'ops@meridianfreight.example', ...meridian,
      subject: 'Shipments not syncing since 05:00 UTC',
      quote: 'None of our ocean shipments have updated since about 05:00 UTC. The dashboard still shows yesterday’s positions.',
      priority: 'urgent', category: 'sync-outage', alertApprovedAfterMin: 4,
      summary: 'No ocean shipment updates for Meridian since 05:00 UTC; the dashboard shows stale positions. Possible carrier feed outage.',
    },
    {
      key: 'triage_10', at: wd(1, 10, 50), from: 'billing@coastalcargo.example', ...coastal,
      subject: 'Plan upgrade stuck on “Processing payment”',
      quote: 'I tried to upgrade us to Growth and the page said “Processing payment…” for ten minutes, so I tried again. Were we charged twice?',
      priority: 'high', category: 'billing', issue: 'SUP-423',
      summary: 'Upgrade page stuck on “Processing payment…”; the customer retried and may have been charged twice.',
    },
  ]

  const [m1 = 0, m2 = 0, m3 = 0, m4 = 0] = tl.radarMondays
  const radarWeeks: RadarWeek[] = [
    {
      key: 'radar_1', at: m4, results: 27, queries: 9, status: 'succeeded',
      items: [
        { text: 'Freightly is hiring 6 enterprise account executives in Rotterdam and Hamburg.', source: 'careers.freightly.example', relevance: 0.74 },
        { text: 'ShipLoom launched an EDI connector marketplace with 40 carriers at launch.', source: 'news.shiploom.example', relevance: 0.81 },
      ],
      updates: [ref('knowledge', KNOWLEDGE.freightlyNotes)],
    },
    { key: 'radar_2', at: m3, results: 14, queries: 9, status: 'succeeded', items: [], updates: [] },
    {
      key: 'radar_3', at: m2, results: 31, queries: 9, status: 'succeeded',
      items: [
        { text: 'Portbase introduced a usage-based “Insights” tier priced per tracked shipment.', source: 'portbase.example/pricing', relevance: 0.93 },
        { text: 'Freightly shipped carbon reporting for ocean freight.', source: 'freightly.example/changelog', relevance: 0.68 },
      ],
      updates: [ref('knowledge', KNOWLEDGE.portbaseTeardown), ref('knowledge', KNOWLEDGE.freightlyNotes)],
    },
    {
      key: 'radar_4', at: m1, results: 22, queries: 9, status: 'succeeded',
      items: [
        { text: 'ShipLoom says EU e-invoicing support is coming next quarter.', source: 'blog.shiploom.example', relevance: 0.88 },
        { text: 'Portbase raised list prices on its Pro plan by about 8%.', source: 'portbase.example/pricing', relevance: 0.79 },
      ],
      updates: [ref('knowledge', KNOWLEDGE.portbaseTeardown)],
    },
  ]

  const [pr208 = 0, pr209 = 0, pr211 = 0, pr212 = 0, pr215 = 0] = tl.prReviews
  const pullRequests: PullRequestReview[] = [
    {
      key: 'pr_01', at: pr208, number: 208, title: 'Add a status filter to the shipments table', author: 'jberg',
      additions: 142, deletions: 31, files: 5, decision: 'approved', waitMin: 22, note: 'Good catches. Post it.',
      comments: [
        'src/pages/Shipments.tsx: every keystroke in Search changes the query and refetches. Debounce the value (~250 ms) before it reaches useShipments; fast typing fires a request per character and responses can land out of order.',
        'src/pages/Shipments.tsx: `(e.target.value || undefined) as ShipmentStatus` trusts the option value. Narrow it against STATUS_LABEL so a stale value can never reach the API.',
        'Missing test: nothing covers the empty state when a filter matches no shipments.',
      ],
    },
    {
      key: 'pr_02', at: pr209, number: 209, title: 'Retry idempotent requests with jittered backoff', author: 'amaya-r',
      additions: 96, deletions: 12, files: 2, decision: 'approved', waitMin: 35,
      comments: [
        'src/api/client.ts: on 429, prefer the Retry-After header over the computed backoff. portal-api sends it, and ignoring it makes the thundering herd worse.',
        'src/api/client.ts: the backoff sleep ignores the request’s AbortSignal. Reject the sleep when it aborts, or unmounted components keep retrying for up to 8 s.',
        'Nice: POST and PATCH are excluded from retries. Please add a test that pins that down.',
      ],
    },
    {
      key: 'pr_03', at: pr211, number: 211, title: 'Show ETAs in the destination time zone (SUP-401)', author: 'tkowalski',
      additions: 58, deletions: 40, files: 3, decision: 'rejected', waitMin: 48,
      note: 'I’ll pair with the author on this one instead. The time zone edge cases need a conversation, not review comments.',
      comments: [
        'src/lib/date.ts: formatEta takes the zone from the destination, good. Add a test for an arrival that crosses midnight in the destination zone, which is the exact case in SUP-401.',
        'src/components/ShipmentTable.tsx: the header still says “ETA”. Say whose time it is, e.g. “ETA (destination time)”.',
      ],
    },
    {
      key: 'pr_04', at: pr212, number: 212, title: 'Shipment detail page with live map', author: 'jberg',
      additions: 1084, deletions: 56, files: 23, decision: 'approved', waitMin: 15, note: 'Agreed. Thanks for keeping it friendly.',
      comments: [
        'Thanks for this! At 1,140 changed lines it is hard to review well in one sitting. Could you split it so each part takes under 30 minutes to review? Suggested split: (1) the getShipment API and route, (2) the detail page without the map, (3) the map component and its lazy-loaded dependency.',
      ],
    },
    {
      key: 'pr_05', at: pr215, number: 215, title: 'Export shipments to CSV', author: 'amaya-r',
      additions: 188, deletions: 9, files: 6, decision: 'approved', waitMin: 27,
      comments: [
        'CSV injection: prefix cells that start with =, +, - or @ with a single quote before writing them. Shipment references come from customers.',
        'Large accounts page through ~40k shipments (see SUP-417). Stream rows to the file instead of building one string in memory.',
        'Use formatEta with the destination time zone for the ETA column, so the export matches the table.',
      ],
    },
  ]

  return { supportEmails, radarWeeks, pullRequests }
}

export type Story = ReturnType<typeof buildStory>
