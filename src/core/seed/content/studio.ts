import type { Asset, AssetKind, AssetVersion, Board, ID, Message, Slide } from '@/core/types'
import { hashString } from '@/lib/rng'
import { BOARD, PROJECT } from '../ids'
import { dayLabel, MINUTE, type SeedCtx } from './helpers'
import { ASSET, MSG } from './keys'

const GENERATORS: Record<AssetKind, Asset['generator']> = {
  image: { id: 'image-gen', label: 'Image generator', simulated: true },
  video: { id: 'video-gen', label: 'Video generator', simulated: true },
  audio: { id: 'voice', label: 'Voice synthesis', simulated: true },
  presentation: { id: 'studio-docs', label: 'Studio writer', simulated: true },
  document: { id: 'studio-docs', label: 'Studio writer', simulated: true },
}

interface VersionSpec {
  at: number
  palette: string[]
  style: string
  prompt?: string
  note?: string
}

interface AssetSpec {
  id: ID
  kind: AssetKind
  title: string
  prompt: string
  projectId: ID | null
  boardId: ID | null
  status?: Asset['status']
  params: Record<string, unknown>
  versions: VersionSpec[]
  content?: string
  slides?: Slide[]
  tags: string[]
  favorite?: boolean
  createdAt: number
}

function toAsset(s: AssetSpec): Asset {
  const versions: AssetVersion[] = s.versions.map((v, i) => ({
    id: `${s.id}_v${i + 1}`,
    prompt: v.prompt ?? s.prompt,
    preview: { type: 'procedural', seed: hashString(`${s.id}:v${i + 1}`), palette: v.palette, style: v.style },
    ...(v.note ? { note: v.note } : {}),
    createdAt: v.at,
  }))
  const last = versions[versions.length - 1]
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
    prompt: s.prompt,
    projectId: s.projectId,
    boardId: s.boardId,
    status: s.status ?? 'ready',
    generator: GENERATORS[s.kind],
    params: s.params,
    versions,
    currentVersion: Math.max(0, versions.length - 1),
    ...(s.content ? { content: s.content.trim() } : {}),
    ...(s.slides ? { slides: s.slides } : {}),
    tags: s.tags,
    ...(s.favorite ? { favorite: true } : {}),
    createdAt: s.createdAt,
    updatedAt: last ? Math.max(last.createdAt, s.createdAt) : s.createdAt,
  }
}

const NAVY = '#0B1426'
const DEEP = '#13294B'
const AMBER = '#F2A93B'
const SAND = '#F4F1EA'
const CORAL = '#F26B4F'

export function buildStudio({ clock, dates }: SeedCtx, messages: Record<ID, Message>): { boards: Board[]; assets: Asset[] } {
  const { back } = clock
  const heroCopyAt = (messages[MSG.heroSaved]?.createdAt ?? back(0, 3, 9)) + MINUTE

  const boards: Board[] = [
    { id: BOARD.launch, name: 'Lumen launch visuals', description: 'Hero imagery, keynote, hero video and launch copy for launch day.', projectId: PROJECT.lumen, createdAt: back(19, 2) },
    { id: BOARD.social, name: 'Social cutdowns', description: 'Square and vertical cards and posts for launch week.', projectId: PROJECT.lumen, createdAt: back(10, 4) },
    { id: BOARD.brand, name: 'Brand explorations', description: "Icon, pattern and mood explorations for Lumen's visual identity.", projectId: null, createdAt: back(27, 3) },
  ]

  const keynoteSlides: Slide[] = [
    { id: 'sld_keynote_1', title: 'Atlas Lumen', body: "See every shipment's story.", layout: 'title', notes: 'Open on the night-port hero image. Pause before the tagline.' },
    { id: 'sld_keynote_2', title: 'The Monday problem', layout: 'bullets', body: "- Every Monday, ops teams export last week's shipments from Atlas\n- They rebuild the same carrier report by hand\n- They argue about whose numbers are right\n- By Tuesday, the report is already out of date", notes: 'Four of six churn interviews described this loop. Do not name customers.' },
    { id: 'sld_keynote_3', title: 'What our design partners told us', layout: 'quote', body: '“Lumen turned our Monday carrier review from a three-hour spreadsheet exercise into a twenty-minute conversation.”\n— Dana Whitfield, VP Operations, Meridian Freight', notes: "Quote pending Meridian's legal approval. Fallback: paraphrase without attribution." },
    { id: 'sld_keynote_4', title: 'Meet Lumen', layout: 'image', body: 'Live dashboards, carrier scorecards, lane cost trends and exception alerts, built from the shipments you already track in Atlas.', notes: 'Hero image v3 full-bleed. Key point: no new integration.' },
    { id: 'sld_keynote_5', title: 'Carrier scorecards', layout: 'split', body: 'On-time rate, damage and invoice accuracy for every carrier, with one definition of "on time" for everyone.\n\nReady before your carrier review, and exportable for QBRs.', notes: 'Demo moment: open the scorecard for a lane that has been slipping for six weeks.' },
    { id: 'sld_keynote_6', title: 'Exceptions, caught early', layout: 'split', body: 'Alerts for late, stuck and at-risk shipments, tuned to your own 30-day baseline, so the two or three that matter stand out.', notes: 'Beta lesson: the first alerts were too noisy; baselines fixed it.' },
    { id: 'sld_keynote_7', title: 'Pricing that grows with your volume', layout: 'bullets', body: '- Core, Pro and Enterprise tiers\n- Priced on active shipments, not seats, so you can share with everyone\n- Usage alerts and guardrails: no surprise bills\n- Details at launch', notes: `No prices on this slide until pricing locks on ${dayLabel(dates.pricingLock)}.` },
    { id: 'sld_keynote_8', title: 'Available today', layout: 'title', body: "Turn on Lumen in Settings → Add-ons.\nSee every shipment's story.", notes: 'Close on the tagline, then Q&A.' },
  ]

  const storyboardShots: Slide[] = [
    { id: 'sld_story_1', title: 'Shot 1 · 0:00–0:05 · Night port', layout: 'image', body: 'Wide shot of a container port at night: cranes, slow-moving trucks. The camera pushes in toward a lit control-room window.', notes: 'No narration; port ambience.' },
    { id: 'sld_story_2', title: 'Shot 2 · 0:05–0:11 · Every shipment tells a story', layout: 'image', body: 'Inside: an operator at a desk facing a wall display with faint route lines that pulse as shipments move.', notes: "VO: Every shipment tells a story. Most of the time, nobody's listening." },
    { id: 'sld_story_3', title: 'Shot 3 · 0:11–0:18 · The Monday spreadsheet', layout: 'image', body: 'A cluttered spreadsheet on a laptop; cells flicker as numbers are retyped. A wall calendar shows Monday.', notes: 'VO: By Monday, the story is a spreadsheet: rebuilt by hand, argued over, out of date.' },
    { id: 'sld_story_4', title: 'Shot 4 · 0:18–0:25 · Lumen turns on', layout: 'image', body: 'The spreadsheet dissolves into the Lumen dashboard on the wall display; amber route lines brighten.', notes: 'VO: Lumen reads the shipments you already track in Atlas, and tells the story for you.' },
    { id: 'sld_story_5', title: 'Shot 5 · 0:25–0:32 · Scorecards and lane costs', layout: 'image', body: 'Close-ups: a carrier scorecard ranking, then a lane cost trend with one outlier highlighted.', notes: 'VO: Carrier scorecards that are ready before your review. Lane costs, with the outliers flagged.' },
    { id: 'sld_story_6', title: 'Shot 6 · 0:32–0:39 · An exception, caught early', layout: 'image', body: 'One route line turns coral and an alert card slides in. The operator picks up the phone before the customer notices.', notes: 'VO: And when a shipment starts to slip, you know before your customer does.' },
    { id: 'sld_story_7', title: 'Shot 7 · 0:39–0:42 · Calm', layout: 'image', body: 'The operator leans back; the wall shows steady amber lines. First light at the window.', notes: 'No narration; the music resolves.' },
    { id: 'sld_story_8', title: 'Shot 8 · 0:42–0:45 · End card', layout: 'title', body: "Atlas Lumen wordmark on navy. Tagline: See every shipment's story.", notes: "VO: Atlas Lumen. See every shipment's story." },
  ]

  const specs: AssetSpec[] = [
    // ------------------------------------------------------------ Images
    {
      id: ASSET.heroImage, kind: 'image', title: 'Lumen hero — night port control room',
      prompt: 'Wide cinematic view of a calm operations control room at night overlooking a container port. One large wall display shows clean dashboards with thin amber route lines. Deep navy palette, soft volumetric light, no text, no logos.',
      projectId: PROJECT.lumen, boardId: BOARD.launch, favorite: true,
      params: { aspect: '16:9', style: 'cinematic', quality: 'high' },
      tags: ['hero', 'landing-page', 'launch'],
      createdAt: back(6, 4),
      versions: [
        { at: back(6, 4), style: 'mesh', palette: [NAVY, '#1C3557', '#3E6A9A', AMBER, '#F6E7C1'], prompt: 'Cinematic control room at night overlooking a container port, a wall of monitors with dashboards, navy and amber, no text.', note: 'First pass: too many screens; it reads like a trading floor.' },
        { at: back(4, 6), style: 'mesh', palette: ['#0A1322', DEEP, '#2F5D8C', AMBER, '#F7E3B5'], prompt: 'Calm control room at night over a container port, one large wall display, an operator silhouette at a desk, navy palette, soft light, no text.', note: 'Calmer, and the silhouette works. Route lines too faint.' },
        { at: back(2, 5), style: 'mesh', palette: [NAVY, DEEP, '#1F4E79', AMBER, '#FFD27A'], note: 'The pick for the hero: amber lines still read at small sizes.' },
      ],
    },
    {
      id: ASSET.scorecardVisual, kind: 'image', title: 'Feature visual: carrier scorecards',
      prompt: 'Abstract feature visual: stacked translucent cards ranking carriers, each with a thin amber performance bar. Isometric, soft shadows, navy and sand palette, no text.',
      projectId: PROJECT.lumen, boardId: BOARD.launch,
      params: { aspect: '4:3', style: 'isometric', quality: 'high' },
      tags: ['feature', 'scorecards', 'landing-page'],
      createdAt: back(5, 3),
      versions: [
        { at: back(5, 3), style: 'blocks', palette: ['#101B33', '#2B4C7E', '#E8DCC4', AMBER, '#FFFFFF'], note: 'Cards feel heavy; try more space between them.' },
        { at: back(3, 6), style: 'blocks', palette: ['#0E1830', '#24467A', '#EFE6D2', AMBER, '#F7F4EC'], note: 'Lighter stack, clearer ranking.' },
      ],
    },
    {
      id: ASSET.warehouseIso, kind: 'image', title: 'Isometric warehouse illustration',
      prompt: 'Isometric illustration of a cross-dock warehouse with trucks at the doors and floating status chips above each door, navy and amber palette, clean vector style.',
      projectId: PROJECT.lumen, boardId: BOARD.launch, status: 'failed',
      params: { aspect: '1:1', style: 'isometric', quality: 'high' },
      tags: ['illustration', 'launch'],
      createdAt: back(1, 2),
      versions: [],
    },
    {
      id: ASSET.socialSquare, kind: 'image', title: 'Social card — “Exceptions, caught early.”',
      prompt: 'Square social card background: a single coral route line breaking away from steady amber lines on deep navy, generous empty space at the top for a headline, no text.',
      projectId: PROJECT.lumen, boardId: BOARD.social,
      params: { aspect: '1:1', style: 'graphic', quality: 'standard' },
      tags: ['social', 'exceptions', 'launch-week'],
      createdAt: back(4, 2),
      versions: [
        { at: back(4, 2), style: 'stripes', palette: [DEEP, AMBER, '#F7E3B5', NAVY], note: 'Missing the exception moment; everything is amber.' },
        { at: back(1, 6), style: 'stripes', palette: [NAVY, CORAL, AMBER, SAND], note: 'Coral line added; leave headline space at the top.' },
      ],
    },
    {
      id: ASSET.socialVertical, kind: 'image', title: 'Vertical teaser — route lines',
      prompt: 'Vertical 9:16 teaser frame: amber route lines flowing upward across a dark navy map, subtle grain, room for a caption at the bottom, no text.',
      projectId: PROJECT.lumen, boardId: BOARD.social,
      params: { aspect: '9:16', style: 'motion still', quality: 'standard' },
      tags: ['social', 'teaser', 'launch-week'],
      createdAt: back(3, 1),
      versions: [{ at: back(3, 1), style: 'waves', palette: ['#0A1322', '#1F4E79', AMBER, '#FFD27A', SAND] }],
    },
    {
      id: ASSET.socialQuote, kind: 'image', title: 'Quote card — Meridian Freight',
      prompt: 'Square quote card background in sand with a thin navy frame and a small amber route-line motif in one corner, space for a two-line quote and attribution, no text.',
      projectId: PROJECT.lumen, boardId: BOARD.social,
      params: { aspect: '1:1', style: 'editorial', quality: 'standard' },
      tags: ['social', 'customer-quote', 'meridian'],
      createdAt: back(8, 3),
      versions: [{ at: back(8, 3), style: 'grid', palette: [SAND, DEEP, AMBER, '#8A9BB5'], note: "Hold until Meridian's legal team approves the quote." }],
    },
    {
      id: ASSET.brandIcon, kind: 'image', title: 'Lumen app icon explorations',
      prompt: 'App icon explorations for Lumen: a simple geometric mark combining a lens and a route line, amber on navy, flat, works at 16px.',
      projectId: null, boardId: BOARD.brand, favorite: true,
      params: { aspect: '1:1', style: 'geometric', quality: 'high', variations: 4 },
      tags: ['brand', 'icon', 'identity'],
      createdAt: back(27, 2),
      versions: [
        { at: back(27, 2), style: 'orbits', palette: [DEEP, AMBER, '#FFFFFF', '#2F5D8C'], note: 'Four directions; the lens-and-route mark is the strongest.' },
        { at: back(21, 4), style: 'orbits', palette: [NAVY, AMBER, '#FFD27A', SAND], note: 'Refined lens-and-route mark; holds up at small sizes.' },
      ],
    },
    {
      id: ASSET.brandPattern, kind: 'image', title: 'Route-line background pattern',
      prompt: 'Seamless background pattern of thin topographic route lines in muted blues with occasional amber highlights, for slides and the website, low contrast.',
      projectId: null, boardId: BOARD.brand,
      params: { aspect: '16:9', style: 'line art', quality: 'high', tileable: true },
      tags: ['brand', 'pattern', 'background'],
      createdAt: back(25, 5),
      versions: [
        { at: back(25, 5), style: 'contours', palette: [NAVY, '#1F4E79', '#3E6A9A', AMBER], note: 'Too busy behind text.' },
        { at: back(18, 3), style: 'contours', palette: ['#0E1830', '#24467A', AMBER, '#F7E3B5', '#8A9BB5'], note: 'Lower contrast; works behind slide titles.' },
      ],
    },

    // ------------------------------------------------------------ Presentation
    {
      id: ASSET.keynote, kind: 'presentation', title: 'Lumen launch keynote',
      prompt: 'An 8-slide launch keynote for Atlas Lumen following the messaging house: the Monday problem, design-partner proof, the product, two feature deep-dives, pricing approach without prices, and availability.',
      projectId: PROJECT.lumen, boardId: BOARD.launch, favorite: true,
      params: { slideCount: 8, theme: 'night', durationMin: 12 },
      tags: ['keynote', 'launch', 'presentation'],
      slides: keynoteSlides,
      createdAt: back(5, 6),
      versions: [
        { at: back(5, 6), style: 'rays', palette: [NAVY, DEEP, AMBER, SAND], note: 'v1: outline and first pass at each slide.' },
        { at: back(2, 2), style: 'rays', palette: [NAVY, '#1F4E79', AMBER, '#FFD27A', SAND], note: 'v2: tighter story, the Meridian quote slide, and no prices on the pricing slide.' },
      ],
    },

    // ------------------------------------------------------------ Video storyboard
    {
      id: ASSET.storyboard, kind: 'video', title: 'Launch hero video — storyboard',
      prompt: "A 45-second hero video for Atlas Lumen: night port, the Monday spreadsheet, Lumen turning on, scorecards and lane costs, an exception caught early, end card with the tagline \"See every shipment's story.\"",
      projectId: PROJECT.lumen, boardId: BOARD.launch,
      params: { aspect: '16:9', durationSec: 45, shotCount: 8, style: 'cinematic', narration: true },
      tags: ['hero-video', 'storyboard', 'launch'],
      slides: storyboardShots,
      createdAt: back(3, 4),
      versions: [{ at: back(3, 4), style: 'mesh', palette: ['#0A1322', DEEP, '#2F5D8C', AMBER, CORAL], note: 'v1 storyboard by Muse: 8 shots, timing matched to the narration draft.' }],
    },

    // ------------------------------------------------------------ Audio
    {
      id: ASSET.narration, kind: 'audio', title: 'Hero video narration',
      prompt: 'Narration for the 45-second Lumen hero video in a calm, measured voice, following the storyboard timing.',
      projectId: PROJECT.lumen, boardId: BOARD.launch,
      params: { voice: 'Calm narrator', durationSec: 44, pace: 'measured', format: 'mp3' },
      tags: ['narration', 'hero-video', 'voice'],
      createdAt: back(2, 8),
      versions: [{ at: back(2, 8), style: 'waves', palette: [NAVY, AMBER, '#FFD27A', '#2F5D8C'], note: 'Draft read; trim the pause after shot 3.' }],
      content: `
# Hero video narration (v1)

**Voice:** calm narrator · **Pace:** measured · **Length:** 44 s, inside the 45 s video · **Words:** 74

| Time | Line |
|---|---|
| 0:00–0:05 | *(no narration: port ambience)* |
| 0:05–0:11 | Every shipment tells a story. Most of the time, nobody's listening. |
| 0:11–0:18 | By Monday, the story is a spreadsheet: rebuilt by hand, argued over, out of date. |
| 0:18–0:25 | Lumen reads the shipments you already track in Atlas, and tells the story for you. |
| 0:25–0:32 | Carrier scorecards that are ready before your review. Lane costs, with the outliers flagged. |
| 0:32–0:39 | And when a shipment starts to slip, you know before your customer does. |
| 0:39–0:42 | *(music resolves)* |
| 0:42–0:45 | Atlas Lumen. See every shipment's story. |

## Pronunciation
- Lumen: LOO-men

## Notes
- Keep the whole read under 80 words so the visuals carry the story.
- A no-narration cut is needed for social; captions replace the voice there.
`,
    },

    // ------------------------------------------------------------ Documents
    {
      id: ASSET.heroCopy, kind: 'document', title: 'Landing page hero copy — variants',
      prompt: 'Five hero headline and subhead options for the Lumen landing page following the messaging house and the brand voice guide; audience: operations managers.',
      projectId: PROJECT.lumen, boardId: BOARD.launch,
      params: { format: 'markdown', tone: 'clear, calm, specific', length: 'short' },
      tags: ['copy', 'landing-page', 'hero'],
      createdAt: heroCopyAt,
      versions: [{ at: heroCopyAt, style: 'paper', palette: [SAND, DEEP, AMBER, '#8A9BB5'], note: 'Saved from the "Hero copy variations" conversation.' }],
      content: `
# Landing page hero copy: variants

**Pick: 3b.** From the "Hero copy variations" conversation; follows the Lumen messaging house and the brand voice guide.

## 3b (selected)
**Headline:** From spreadsheet Mondays to answers in minutes.
**Subhead:** Lumen builds carrier scorecards, lane trends and exception alerts from the shipments you already track in Atlas.
**Primary button:** See Lumen in action · **Secondary:** Talk to sales

## Alternates
**2a.** Know which lanes are slipping before Monday's review.
*Carrier scorecards and lane trends, built from the shipments you already track in Atlas.*

**3a.** Your Monday carrier review, done before Monday.
*Lumen builds the report from your Atlas shipments. You bring the decisions.*

**1.** See every shipment's story.
*Lumen turns your Atlas data into live dashboards, carrier scorecards and exception alerts, so you can fix problems before your customers notice.*

**4.** Exceptions, caught early.
*Live alerts for late, stuck and at-risk shipments, tuned to your own baseline.*

## Notes for Aisha
- 3b echoes Meridian's quote but does not depend on it; it still works if the quote is not approved.
- Voice guide: no "finally", no "real-time" for dashboards, and no "visibility" on its own.
- If "spreadsheet Mondays" tests poorly, fall back to 2a; its subhead works under either headline.
`,
    },
    {
      id: ASSET.launchEmail, kind: 'document', title: 'Launch email — existing customers',
      prompt: 'Launch email from Morgan Lee to admins and ops leads at existing Atlas customers announcing Lumen and the free customer preview, in the brand voice.',
      projectId: PROJECT.lumen, boardId: BOARD.launch,
      params: { format: 'markdown', tone: 'clear, calm, specific', length: 'short', channel: 'email' },
      tags: ['email', 'launch', 'customers'],
      createdAt: back(9, 2),
      versions: [
        { at: back(9, 2), style: 'paper', palette: ['#F7F4EC', DEEP, '#2F5D8C', AMBER], note: 'First draft.' },
        { at: back(1, 3), style: 'paper', palette: ['#F7F4EC', DEEP, '#2F5D8C', AMBER, '#8A9BB5'], note: 'Shorter intro; pricing line softened until the lock.' },
      ],
      content: `
# Launch email: existing customers

**Status:** draft in review · **Send:** at the start of the customer preview · **From:** Morgan Lee, Product Lead
**Audience:** admins and ops leads at Growth and Enterprise accounts

---

**Subject:** Your Monday carrier review, minus the spreadsheet
**Preview text:** Lumen is coming to Atlas, and you can try it first.

Hi {{first_name}},

Most operations teams we talk to spend Monday morning rebuilding the same carrier report from Atlas exports. We built Lumen so you don't have to.

**Lumen is a new analytics add-on for Atlas.** It uses the shipments you already track to give you:
- **Carrier scorecards:** on-time rate, damage and invoice accuracy for every carrier, ready for your next review
- **Lane cost trends:** cost per shipment and per kg by lane, with outliers flagged
- **Exception alerts:** late, stuck and at-risk shipments, tuned to your own baseline

There's nothing to integrate. Turn it on in **Settings → Add-ons** and your dashboards fill in from the data already in Atlas.

**Try it early.** As an Atlas customer you can use Lumen free until launch day, ${dayLabel(dates.launch)}. We'll share pricing well before then, and there are no surprise charges.

[Turn on Lumen]

Questions? Reply to this email; it comes straight to me.

Morgan Lee
Product Lead, Northwind Labs

---

## Review notes
- [ ] Confirm the preview start date with Priya (feature flag rollout)
- [ ] Legal: check "no surprise charges" against the pricing guardrails
- [x] Aisha: tone pass done; shortened the intro
`,
    },
    {
      id: ASSET.socialPosts, kind: 'document', title: 'Social posts — launch week',
      prompt: 'Six social posts for Lumen launch week: launch day, two feature posts, a customer quote, and a behind-the-build post, in the brand voice.',
      projectId: PROJECT.lumen, boardId: BOARD.social,
      params: { format: 'markdown', tone: 'clear, calm, specific', posts: 6 },
      tags: ['social', 'launch-week', 'copy'],
      createdAt: back(3, 5),
      versions: [{ at: back(3, 5), style: 'paper', palette: [SAND, NAVY, CORAL, AMBER] }],
      content: `
# Social posts: launch week

Six posts. Visuals come from the *Social cutdowns* board. Voice: clear, calm, specific.

## Day 0: launch (long post)
Today we're launching Atlas Lumen.

Every Monday, operations teams rebuild the same carrier report from scratch. Lumen builds it for them: carrier scorecards, lane cost trends and exception alerts, from the shipments they already track in Atlas.

No new integration. Turn it on and the dashboards fill in.

## Day 0: launch (short post)
From spreadsheet Mondays to answers in minutes. Atlas Lumen is live.

## Day 1: carrier scorecards
One definition of "on time" for every carrier, ready before your review. Carrier scorecards in Atlas Lumen.

## Day 2: exception alerts
Exceptions, caught early. Lumen alerts are tuned to your own 30-day baseline, so the two or three shipments that matter stand out.

## Day 3: customer quote (pending approval)
"Lumen turned our Monday carrier review from a three-hour spreadsheet exercise into a twenty-minute conversation." Dana Whitfield, VP Operations, Meridian Freight

## Day 5: behind the build
Eight design partners shaped Lumen. Our first alerts were too noisy; one partner switched them off after a week. Tuning alerts to each account's own baseline fixed it. What we learned building Lumen with our customers:

## Do not post until
- Pricing is locked (the day 0 posts link to the plans page)
- Meridian's legal team approves the quote
`,
    },
    {
      id: ASSET.salesOnePager, kind: 'document', title: 'Lumen one-pager for sales',
      prompt: 'A one-page sales summary of Atlas Lumen: problem, product, buyers, draft pricing approach, proof points, Portbase comparison and discovery questions.',
      projectId: PROJECT.lumen, boardId: null,
      params: { format: 'markdown', tone: 'direct', length: 'one page', audience: 'sales' },
      tags: ['sales-enablement', 'one-pager', 'lumen'],
      createdAt: back(6, 2),
      versions: [
        { at: back(6, 2), style: 'paper', palette: ['#F7F4EC', NAVY, '#1F4E79', AMBER], note: 'First draft from the PRD and the messaging house.' },
        { at: back(1, 4), style: 'paper', palette: ['#F7F4EC', NAVY, '#1F4E79', AMBER, '#8A9BB5'], note: 'Added the Portbase talk tracks.' },
      ],
      content: `
# Atlas Lumen: one-pager for sales

**Internal. Pricing is a draft until ${dayLabel(dates.pricingLock)}; do not quote overage rates.**

## The problem
Operations teams export Atlas data every week and rebuild the same carrier and lane reports in spreadsheets. Four of six churned or at-risk customers we interviewed described exactly this.

## What Lumen does
Live dashboards, carrier scorecards, lane cost trends and exception alerts, built from the shipments customers already track in Atlas. No new integration.

## Who buys it
- **Champion:** operations manager (on-time performance, carrier relationships)
- **Economic buyer:** head of operations
- **Best fit:** Growth and Enterprise accounts tracking more than 3,000 shipments a month

## Pricing approach (draft)
Three tiers (Core, Pro, Enterprise), priced on active shipments rather than seats, with usage alerts and guardrails against surprise bills. Design partners get 50% off year one.

## Proof
- Meridian Freight: Monday carrier review from about three hours to about twenty minutes (quote pending approval)
- 6 of 8 design partners use scorecards every week

## Against Portbase Insights
- Lead with lane-level cost and carrier scorecards, where Insights is thin
- "Share with everyone; pay for shipments" against per-user pricing
- Ask about response times when an integration breaks

## Discovery questions
1. How do you prepare for carrier reviews today, and how long does it take?
2. How do you find out about a late shipment: from a system, or from your customer?
3. How many people outside your ops team need to see shipment performance?
`,
    },
  ]

  return { boards, assets: specs.map(toAsset) }
}
