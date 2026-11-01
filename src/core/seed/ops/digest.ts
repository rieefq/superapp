import type { Story } from './story'
import type { Timeline } from './timeline'

export type DigestSection = 'atlas' | 'lumen' | 'landscape' | 'ops'

export interface Headline {
  at: number
  section: DigestSection
  text: string
}

const SECTION_TITLES: Record<DigestSection, string> = {
  atlas: 'Atlas Portal v2',
  lumen: 'Lumen Launch',
  landscape: 'Q4 Competitive Landscape',
  ops: 'Support Ops Automation',
}
const ORDER: DigestSection[] = ['atlas', 'lumen', 'landscape', 'ops']
/** The digest task asks for under 250 words. */
const MAX_WORDS = 240

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

/** Everything worth a line in a weekly digest, dated by when it happened. */
export function storyHeadlines(tl: Timeline, story: Story): Headline[] {
  const h = (at: number, section: DigestSection, text: string): Headline => ({ at, section, text })
  const [pr208 = 0, pr209 = 0, , pr212 = 0] = tl.prReviews
  return [
    h(pr208, 'atlas', 'PR review assistant reviewed #208 (shipments status filter): debounce search before it reaches the API.'),
    h(pr209, 'atlas', '#209 adds retries with jittered backoff for idempotent requests and honors Retry-After.'),
    h(tl.bundleTurn1, 'atlas', 'Forge is profiling the dashboard, which takes 4+ s to become interactive on a mid-range laptop.'),
    h(tl.bundleMerged, 'atlas', 'Dashboard initial JS is down 62% (912 kB → 348 kB) with route-level code splitting (#214, merged).'),
    h(pr212, 'atlas', '#212 (shipment detail page, 1,140 lines) went back to be split into reviewable parts.'),
    h(tl.flakyTurn2, 'atlas', 'Flaky checkout e2e: the fixed 3 s wait is gone, but 1 in 20 runs still fails. The cause is an out-of-order poll response in Checkout.tsx, so it needs an app fix.'),
    h(tl.ssoTurn2, 'atlas', 'SSO session fix is ready for review: refreshes now follow the lifetime of the token we hold. Two regression tests, all checks green.'),
    h(tl.stripeTurn1, 'atlas', 'Stripe Billing migration mapped: three legacy call sites in src/api/invoices.ts move behind VITE_FLAG_STRIPE_BILLING.'),
    h(tl.studioGradients, 'lumen', 'Eight gradient studies are up on Brand explorations.'),
    h(tl.assetsDisabled, 'lumen', 'Launch asset pipeline is off until the Drive folder is shared with the integration.'),
    h(tl.museHeroCopy, 'lumen', 'Six hero copy variations in brand voice are ready to pick from (Muse).'),
    h(tl.studioKeyArt, 'lumen', 'Four hero key-art directions are on Lumen launch visuals.'),
    h(tl.museBeats, 'lumen', 'Hero video beat sheet drafted (Muse); storyboard frames are next.'),
    h(tl.studioSocial, 'lumen', 'Social cutdowns generated for LinkedIn, X and Instagram Stories.'),
    h(tl.ledgerLumenUsage, 'lumen', 'Lumen beta usage by account is in for the pricing decision (Ledger).'),
    h(tl.scoutSizing, 'landscape', 'Market sizing for mid-market freight portals refreshed (Scout).'),
    h(tl.tidewell2, 'landscape', 'Tidewell teardown published in Knowledge: strong on customs workflows, weak on invoicing and self-serve.'),
    ...story.radarWeeks.flatMap((w) => w.items.map((item) => h(w.at, 'landscape', `Radar: ${item.text}`))),
    h(tl.churn1, 'landscape', 'Churn research (“Why do logistics customers churn?”) is ready for review.'),
    h(tl.scoutBrief, 'landscape', 'Competitor brief for the board deck is drafted (Scout).'),
    h(tl.sentinelRubric, 'ops', 'Sentinel drafted triage rubric v2 from last month’s tickets; it waits on Morgan’s review.'),
    h(tl.archivistPaused, 'ops', 'Archivist is paused after the nightly Notion sync hit rate limits.'),
    h(tl.jiraTokenExpired, 'ops', 'Jira sync is disconnected: the token expired.'),
  ]
}

/** One-line support summary for a window, from the triage workflow’s emails. */
function supportLine(story: Story, from: number, to: number): string | null {
  const handled = story.supportEmails.filter((e) => e.at >= from && e.at < to && !e.failure)
  if (handled.length === 0) return null
  const urgent = handled.filter((e) => e.priority === 'urgent').length
  const noun = handled.length === 1 ? 'email' : 'emails'
  return urgent > 0
    ? `Support triage handled ${handled.length} ${noun}; ${urgent} urgent, alerted in #support-urgent.`
    : `Support triage handled ${handled.length} ${noun}, none urgent.`
}

/** Slack-formatted digest for [from, to): decisions first, then up to three bullets per project. */
export function composeDigest(input: {
  tl: Timeline
  story: Story
  from: number
  to: number
  decisions?: string[]
  extra?: Headline[]
}): string {
  const { story, from, to } = input
  const all = [...storyHeadlines(input.tl, story), ...(input.extra ?? [])].filter((h) => h.at >= from && h.at < to)
  const support = supportLine(story, from, to)
  if (support) all.push({ at: to, section: 'ops', text: support })

  // Newest first, at most three per project; drop the oldest bullets until it fits the word budget.
  const bySection = new Map(
    ORDER.map((section) => [section, all.filter((h) => h.section === section).sort((a, b) => b.at - a.at).slice(0, 3)]),
  )
  const render = () => {
    const lines = ['*Weekly product digest*']
    if (input.decisions?.length) lines.push('', '*Needs a decision*', ...input.decisions.map((d, i) => `${i + 1}. ${d}`))
    for (const section of ORDER) {
      const items = bySection.get(section) ?? []
      if (items.length) lines.push('', `*${SECTION_TITLES[section]}*`, ...items.map((h) => `• ${h.text}`))
    }
    if (lines.length === 1) lines.push('', 'A quiet week: no merged work, launches or support escalations to report.')
    return lines.join('\n')
  }
  let text = render()
  while (wordCount(text) > MAX_WORDS) {
    const longest = [...bySection.values()].sort((a, b) => b.length - a.length)[0]
    if (!longest || longest.length <= 1) break
    longest.pop()
    text = render()
  }
  return text
}
