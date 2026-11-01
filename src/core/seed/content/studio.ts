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
  /** Index of the version shown by default (defaults to the latest). */
  current?: number
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
  const latest = versions.reduce((t, v) => Math.max(t, v.createdAt), s.createdAt)
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
    currentVersion: Math.max(0, Math.min(versions.length - 1, s.current ?? versions.length - 1)),
    ...(s.content ? { content: s.content.trim() } : {}),
    ...(s.slides ? { slides: s.slides } : {}),
    tags: s.tags,
    ...(s.favorite ? { favorite: true } : {}),
    createdAt: s.createdAt,
    updatedAt: latest,
  }
}

const NAVY = '#0B1426'
const DEEP = '#13294B'
const TEAL = '#0F4C5C'
const AMBER = '#F2A93B'
const SAND = '#F4F1EA'
const CORAL = '#F26B4F'

/** The six lines Muse wrote; #3 won the test. */
const HERO_LINES: Array<[string, string]> = [
  ['See where every shipment’s time goes.', 'Lumen turns your Atlas data into lane-by-lane answers.'],
  ['Your operation, measured.', 'On-time rates, dwell times and costs by lane, carrier and customer.'],
  ['From tracking to knowing.', 'Atlas shows where shipments are. Lumen shows why they’re late.'],
  ['Fewer surprises at the dock.', 'Spot slipping lanes a week before your customers do.'],
  ['Every lane. Every carrier. One answer.', 'Benchmarks your team can act on Monday morning.'],
  ['Analytics your ops team will actually open.', 'Built into Atlas. No exports, no spreadsheets.'],
]

export function buildStudio({ clock, dates, at }: SeedCtx, messages: Record<ID, Message>): { boards: Board[]; assets: Asset[] } {
  const { wd, day } = clock
  const heroCopyAt = (messages[MSG.heroSaved]?.createdAt ?? at.heroCopyPick) + MINUTE
  const formats = ['1200×628', '1080×1080', '1080×1920']

  const boards: Board[] = [
    { id: BOARD.launch, name: 'Lumen launch visuals', description: 'Key art, keynote, hero video and launch copy for launch day.', projectId: PROJECT.lumen, createdAt: day(19, 10, 0) },
    { id: BOARD.social, name: 'Social cutdowns', description: 'Launch-week images in three formats, with captions and alt text.', projectId: PROJECT.lumen, createdAt: day(12, 10, 0) },
    { id: BOARD.brand, name: 'Brand explorations', description: "Gradients, icon and illustration explorations for Lumen's visual identity.", projectId: null, createdAt: day(28, 10, 0) },
  ]

  const keynoteSlides: Slide[] = [
    { id: 'sld_keynote_1', title: 'Atlas Lumen', body: 'From tracking to knowing.', layout: 'title', notes: 'Open on key art direction 2 (the dispatch desk). Pause before the tagline.' },
    { id: 'sld_keynote_2', title: 'The Monday problem', layout: 'bullets', body: "- Every Monday, ops teams export last week's shipments from Atlas\n- They rebuild the same carrier report by hand\n- They argue about whose numbers are right\n- By Tuesday, the report is already out of date", notes: 'Four of six churn interviews described this loop. Do not name customers.' },
    { id: 'sld_keynote_3', title: 'What our design partners told us', layout: 'quote', body: '“Lumen turned our Monday carrier review from a three-hour spreadsheet exercise into a twenty-minute conversation.”\n— Dana Whitfield, VP Operations, Meridian Freight', notes: "Quote pending Meridian's legal approval. Fallback: paraphrase without attribution." },
    { id: 'sld_keynote_4', title: 'Meet Lumen', layout: 'image', body: 'Live dashboards, carrier scorecards, lane cost trends and exception alerts, built from the shipments you already track in Atlas.', notes: 'Key art full-bleed. Key point: no new integration.' },
    { id: 'sld_keynote_5', title: 'Carrier scorecards', layout: 'split', body: 'On-time rate, damage and invoice accuracy for every carrier, with one definition of "on time" for everyone.\n\nReady before your carrier review, and exportable for QBRs.', notes: 'Demo moment: open the scorecard for a lane that has been slipping for six weeks.' },
    { id: 'sld_keynote_6', title: 'Fewer surprises at the dock', layout: 'split', body: 'Alerts for late, stuck and at-risk shipments, tuned to your own 30-day baseline, so the two or three that matter stand out.', notes: 'Beta lesson: the first alerts were too noisy; baselines fixed it.' },
    { id: 'sld_keynote_7', title: 'Pricing that grows with your volume', layout: 'bullets', body: '- Core, Pro and Enterprise tiers\n- Priced on active shipments, not seats, so you can share with everyone\n- Usage alerts and guardrails: no surprise bills\n- Details at launch', notes: `No prices on this slide until pricing locks on ${dayLabel(dates.pricingLock)}.` },
    { id: 'sld_keynote_8', title: 'Available today', layout: 'title', body: 'Turn on Lumen in Settings → Add-ons.\nFrom tracking to knowing.', notes: 'Close on the tagline, then Q&A.' },
  ]

  const beats: Slide[] = [
    { id: 'sld_beat_1', title: 'Beat 1 · 0:00–0:05 · Cold open', layout: 'image', body: 'A dispatcher at 6 a.m., three screens, one late container.', notes: 'No narration; quiet office sound.' },
    { id: 'sld_beat_2', title: 'Beat 2 · 0:05–0:12 · The question', layout: 'image', body: 'On screen: "Why is Rotterdam → Chicago late again?"', notes: 'VO: Why is Rotterdam to Chicago late again?' },
    { id: 'sld_beat_3', title: 'Beat 3 · 0:12–0:22 · Lumen appears', layout: 'image', body: 'The Lumen lane view, with dwell time at the transfer port highlighted.', notes: 'VO: Lumen shows you where the time goes, stop by stop.' },
    { id: 'sld_beat_4', title: 'Beat 4 · 0:22–0:32 · The answer', layout: 'image', body: 'Carriers compared side by side on the same lane; a better routing chosen.', notes: 'VO: Compare carriers on the same lane, and pick the one that keeps its promises.' },
    { id: 'sld_beat_5', title: 'Beat 5 · 0:32–0:40 · Outcome', layout: 'image', body: "The lane's on-time rate climbing over four weeks.", notes: 'VO: Four weeks later, the lane runs on time.' },
    { id: 'sld_beat_6', title: 'Beat 6 · 0:40–0:45 · Close', layout: 'title', body: 'Atlas Lumen. From tracking to knowing.', notes: 'VO: Atlas Lumen. From tracking to knowing.' },
  ]

  const heroAlternates = HERO_LINES.map(([h, s], i) => ({ n: i + 1, h, s })).filter((l) => l.n !== 3 && l.n !== 4)

  const specs: AssetSpec[] = [
    // ------------------------------------------------------------ Launch visuals
    {
      id: ASSET.keyArt, kind: 'image', title: 'Hero key art — four directions',
      prompt: 'Hero key art for Atlas Lumen in four directions, each tied to a message pillar. Calm, operational, navy with amber accents, no text, no logos.',
      projectId: PROJECT.lumen, boardId: BOARD.launch, favorite: true, current: 1,
      params: { aspect: '16:9', style: 'cinematic', quality: 'high', directions: 4 },
      tags: ['key-art', 'hero', 'landing-page', 'launch'],
      createdAt: at.studioKeyArt + MINUTE,
      versions: [
        { at: at.studioKeyArt + MINUTE, style: 'mesh', palette: [NAVY, '#1C3557', '#3E6A9A', AMBER, '#F6E7C1'], prompt: 'Night terminal: cranes in the dark, one lane lit up in amber.', note: 'Direction 1: night terminal.' },
        { at: at.studioKeyArt + 2 * MINUTE, style: 'mesh', palette: ['#0A1322', DEEP, '#2F5D8C', AMBER, '#FFD27A'], prompt: 'Dispatch desk: the Lumen lane view on a real screen at 6 a.m., soft window light.', note: 'Direction 2: dispatch desk. The pick: it matches the hero video’s cold open.' },
        { at: at.studioKeyArt + 3 * MINUTE, style: 'waves', palette: [NAVY, '#24467A', AMBER, '#FFD27A', SAND], prompt: 'Light trails: shipment paths drawn over a muted map.', note: 'Direction 3: light trails.' },
        { at: at.studioKeyArt + 4 * MINUTE, style: 'grid', palette: [SAND, DEEP, AMBER, '#8A9BB5'], prompt: 'Still life: one container, its whole journey annotated around it.', note: 'Direction 4: annotated still life.' },
      ],
    },
    {
      id: ASSET.scorecardVisual, kind: 'image', title: 'Feature visual: carrier scorecards',
      prompt: 'Abstract feature visual: stacked translucent cards ranking carriers, each with a thin amber performance bar. Isometric, soft shadows, navy and sand palette, no text.',
      projectId: PROJECT.lumen, boardId: BOARD.launch,
      params: { aspect: '4:3', style: 'isometric', quality: 'high' },
      tags: ['feature', 'scorecards', 'landing-page'],
      createdAt: wd(7, 15, 0),
      versions: [
        { at: wd(7, 15, 0), style: 'blocks', palette: ['#101B33', '#2B4C7E', '#E8DCC4', AMBER, '#FFFFFF'], note: 'Cards feel heavy; try more space between them.' },
        { at: wd(4, 14, 0), style: 'blocks', palette: ['#0E1830', '#24467A', '#EFE6D2', AMBER, '#F7F4EC'], note: 'Lighter stack, clearer ranking.' },
      ],
    },

    // ------------------------------------------------------------ Brand explorations
    {
      id: ASSET.gradients, kind: 'image', title: 'Lumen gradient explorations',
      prompt: 'Gradient studies for Lumen: four palettes in two compositions, quiet enough to sit behind dark dashboards.',
      projectId: PROJECT.lumen, boardId: BOARD.brand,
      params: { aspect: '16:9', style: 'gradient', quality: 'standard', variants: 8 },
      tags: ['brand', 'gradients', 'identity'],
      createdAt: at.studioGradients + MINUTE,
      versions: [
        { at: at.studioGradients + MINUTE, style: 'mesh', palette: [NAVY, '#1F4E79', '#5B8EF0', '#C9D8F2'], note: 'Navy to sky. Clean, but cold.' },
        { at: at.studioGradients + 2 * MINUTE, style: 'mesh', palette: [DEEP, '#5C3D7A', CORAL, '#F7D6C9'], note: 'Plum to coral. Too warm for a data product.' },
        { at: at.studioGradients + 3 * MINUTE, style: 'mesh', palette: [NAVY, TEAL, '#1F7A72', AMBER, '#FFD27A'], note: 'Deep teal to amber: reads best on dark dashboards. 3 of 8 studies kept.' },
      ],
    },
    {
      id: ASSET.isometric, kind: 'image', title: 'Isometric freight yard illustrations',
      prompt: 'Six isometric freight yard scenes: trucks at the doors, containers stacked, floating status chips. Navy and amber, clean vector style.',
      projectId: PROJECT.lumen, boardId: BOARD.brand, status: 'failed',
      params: { aspect: '1:1', style: 'isometric', quality: 'high', scenes: 6, stoppedAfter: 2 },
      tags: ['illustration', 'brand'],
      createdAt: at.studioIsometric + MINUTE,
      versions: [],
    },
    {
      id: ASSET.appIcon, kind: 'image', title: 'Lumen app icon explorations',
      prompt: 'App icon explorations for Lumen: a simple geometric mark combining a lens and a route line, amber on navy, flat, legible at 16 px.',
      projectId: PROJECT.lumen, boardId: BOARD.brand,
      params: { aspect: '1:1', style: 'geometric', quality: 'high', variations: 4 },
      tags: ['brand', 'icon', 'identity'],
      createdAt: day(27, 14, 0),
      versions: [
        { at: day(27, 14, 0), style: 'orbits', palette: [DEEP, AMBER, '#FFFFFF', '#2F5D8C'], note: 'Four directions; the lens-and-route mark is the strongest.' },
        { at: day(21, 11, 0), style: 'orbits', palette: [NAVY, AMBER, '#FFD27A', SAND], note: 'Refined lens-and-route mark; holds up at small sizes.' },
      ],
    },
    {
      id: ASSET.backgrounds, kind: 'image', title: 'Product screenshot backgrounds',
      prompt: 'Quiet backgrounds for product screenshots in the launch deck and docs, matched to the dark and light product themes.',
      projectId: PROJECT.lumen, boardId: null,
      params: { aspect: '16:9', style: 'soft gradient', quality: 'standard', count: 6 },
      tags: ['backgrounds', 'screenshots', 'docs'],
      createdAt: at.studioBackgrounds + MINUTE,
      versions: [
        { at: at.studioBackgrounds + MINUTE, style: 'contours', palette: [NAVY, '#16243D', TEAL, '#2B3E5C'], note: 'Three backgrounds for the dark theme.' },
        { at: at.studioBackgrounds + 2 * MINUTE, style: 'contours', palette: [SAND, '#E8E3D7', '#D7E3EA', '#C9D2DC'], note: 'Three backgrounds for the light theme.' },
      ],
    },

    // ------------------------------------------------------------ Social cutdowns
    {
      id: ASSET.cutdownTracking, kind: 'image', title: 'Cutdowns — “From tracking to knowing.”',
      prompt: 'Recompose the dispatch-desk key art for three formats with room for the line "From tracking to knowing."',
      projectId: PROJECT.lumen, boardId: BOARD.social,
      params: { formats, style: 'key art recomposition', quality: 'standard' },
      tags: ['social', 'launch-week', 'tagline'],
      createdAt: at.studioSocial + MINUTE,
      versions: formats.map((f, i) => ({ at: at.studioSocial + (1 + i) * MINUTE, style: 'mesh', palette: ['#0A1322', DEEP, '#2F5D8C', AMBER, '#FFD27A'], note: f })),
    },
    {
      id: ASSET.cutdownDock, kind: 'image', title: 'Cutdowns — “Fewer surprises at the dock.”',
      prompt: 'One coral route line breaking away from steady amber lines on navy, recomposed for three formats, with room for a headline.',
      projectId: PROJECT.lumen, boardId: BOARD.social,
      params: { formats, style: 'graphic', quality: 'standard' },
      tags: ['social', 'launch-week', 'exceptions'],
      createdAt: at.studioSocial + 4 * MINUTE,
      versions: formats.map((f, i) => ({ at: at.studioSocial + (4 + i) * MINUTE, style: 'stripes', palette: [NAVY, CORAL, AMBER, SAND], note: f })),
    },
    {
      id: ASSET.cutdownQuote, kind: 'image', title: 'Cutdowns — Meridian quote',
      prompt: 'Quote card in sand with a thin navy frame and a small amber route motif, recomposed for three formats, with space for a two-line quote.',
      projectId: PROJECT.lumen, boardId: BOARD.social,
      params: { formats, style: 'editorial', quality: 'standard' },
      tags: ['social', 'customer-quote', 'meridian'],
      createdAt: at.studioSocial + 7 * MINUTE,
      versions: formats.map((f, i) => ({ at: at.studioSocial + (7 + i) * MINUTE, style: 'grid', palette: [SAND, DEEP, AMBER, '#8A9BB5'], note: i === 0 ? `${f} · hold until Meridian's legal team approves the quote` : f })),
    },
    {
      id: ASSET.socialPosts, kind: 'document', title: 'Social captions and alt text — launch week',
      prompt: 'Captions and alt text for the nine launch-week cutdowns (three messages × three formats), in brand voice.',
      projectId: PROJECT.lumen, boardId: BOARD.social,
      params: { format: 'markdown', tone: 'clear, calm, specific', messages: 3, formats: 3 },
      tags: ['social', 'launch-week', 'copy'],
      createdAt: at.studioSocial + 10 * MINUTE,
      versions: [{ at: at.studioSocial + 10 * MINUTE, style: 'paper', palette: [SAND, NAVY, CORAL, AMBER] }],
      content: `
# Social captions and alt text: launch week

Three messages, each in three formats (${formats.join(', ')}). Images are on the *Social cutdowns* board. Voice: clear, calm, specific.

## 1. From tracking to knowing.
**Caption:** Atlas shows where your shipments are. Lumen shows why they're late. Atlas Lumen is live today.
**Alt text:** A dispatcher's desk at dawn, with a screen showing shipping lanes in amber, and the words "From tracking to knowing."

## 2. Fewer surprises at the dock.
**Caption:** Spot slipping lanes a week before your customers do. Lumen's alerts are tuned to your own 30-day baseline, so the few that matter stand out.
**Alt text:** One coral line breaking away from steady amber lines on a dark blue background.

## 3. Customer quote (pending approval)
**Caption:** "Lumen turned our Monday carrier review from a three-hour spreadsheet exercise into a twenty-minute conversation." Dana Whitfield, VP Operations, Meridian Freight
**Alt text:** A quote card in sand and navy with a small amber route line in the corner.

## Do not post until
- Pricing is locked (the launch-day captions link to the plans page)
- Meridian's legal team approves the quote
`,
    },

    // ------------------------------------------------------------ Presentation, video, audio
    {
      id: ASSET.keynote, kind: 'presentation', title: 'Lumen launch keynote',
      prompt: 'An 8-slide launch keynote for Atlas Lumen following the messaging house: the Monday problem, design-partner proof, the product, two feature deep-dives, the pricing approach without prices, and availability.',
      projectId: PROJECT.lumen, boardId: BOARD.launch, favorite: true,
      params: { slideCount: 8, theme: 'night', durationMin: 12 },
      tags: ['keynote', 'launch', 'presentation'],
      slides: keynoteSlides,
      createdAt: wd(7, 16, 0),
      versions: [
        { at: wd(7, 16, 0), style: 'rays', palette: [NAVY, DEEP, AMBER, SAND], note: 'v1: outline and a first pass at each slide.' },
        { at: wd(2, 15, 30), style: 'rays', palette: [NAVY, '#1F4E79', AMBER, '#FFD27A', SAND], note: 'v2: the new tagline, the Meridian quote slide, and no prices on the pricing slide.' },
      ],
    },
    {
      id: ASSET.storyboard, kind: 'video', title: 'Launch hero video — beat sheet',
      prompt: 'A 45-second hero video for Atlas Lumen in six beats: a dispatcher at 6 a.m., the question, Lumen appears, the answer, the outcome, and the close on "From tracking to knowing."',
      projectId: PROJECT.lumen, boardId: BOARD.launch,
      params: { aspect: '16:9', durationSec: 45, beats: 6, style: 'cinematic', narration: true },
      tags: ['hero-video', 'storyboard', 'launch'],
      slides: beats,
      createdAt: at.museBeats + 2 * MINUTE,
      versions: [{ at: at.museBeats + 2 * MINUTE, style: 'mesh', palette: ['#0A1322', DEEP, '#2F5D8C', AMBER, CORAL], note: 'Beat sheet with shot notes by Muse. The six storyboard frames are being generated.' }],
    },
    {
      id: ASSET.narration, kind: 'audio', title: 'Hero video narration',
      prompt: 'Narration for the 45-second Lumen hero video in a calm, measured voice, following the six beats.',
      projectId: PROJECT.lumen, boardId: BOARD.launch,
      params: { voice: 'Calm narrator', durationSec: 40, pace: 'measured', format: 'mp3' },
      tags: ['narration', 'hero-video', 'voice'],
      createdAt: wd(4, 15, 0),
      versions: [{ at: wd(4, 15, 0), style: 'waves', palette: [NAVY, AMBER, '#FFD27A', '#2F5D8C'], note: 'Draft read; leave more air after beat 2.' }],
      content: `
# Hero video narration (draft)

**Voice:** calm narrator · **Pace:** measured · **Length:** about 40 s of speech inside the 45 s video

| Beat | Time | Line |
|---|---|---|
| 1 | 0:00–0:05 | *(no narration: a dispatcher at 6 a.m.)* |
| 2 | 0:05–0:12 | Why is Rotterdam to Chicago late again? |
| 3 | 0:12–0:22 | Lumen shows you where the time goes, stop by stop. |
| 4 | 0:22–0:32 | Compare carriers on the same lane, and pick the one that keeps its promises. |
| 5 | 0:32–0:40 | Four weeks later, the lane runs on time. |
| 6 | 0:40–0:45 | Atlas Lumen. From tracking to knowing. |

## Pronunciation
- Lumen: LOO-men

## Notes
- Under 50 words, so the visuals carry the story.
- The social cut drops the voice entirely; captions carry beats 2 and 6.
`,
    },

    // ------------------------------------------------------------ Documents
    {
      id: ASSET.heroCopy, kind: 'document', title: 'Landing page hero copy — variants',
      prompt: "Muse's six hero headline and subline pairs for the Lumen landing page, with the test result and notes for Aisha.",
      projectId: PROJECT.lumen, boardId: BOARD.launch,
      params: { format: 'markdown', tone: 'clear, calm, specific', length: 'short' },
      tags: ['copy', 'landing-page', 'hero'],
      createdAt: heroCopyAt,
      versions: [{ at: heroCopyAt, style: 'paper', palette: [SAND, DEEP, AMBER, '#8A9BB5'], note: 'Saved from the "Hero copy variations" conversation.' }],
      content: `
# Landing page hero copy: variants

**Pick: #3.** Six options from Muse, compared in the "Hero copy variations" conversation. #3 beat #4 in a five-second test with 12 beta users.

## #3 (selected)
**Headline:** ${HERO_LINES[2][0]}
**Subline:** ${HERO_LINES[2][1]}
**Primary button:** See Lumen in action · **Secondary:** Talk to sales

## Runner-up: #4
**${HERO_LINES[3][0]}** ${HERO_LINES[3][1]}

## Alternates
${heroAlternates.map((l) => `- **#${l.n}. ${l.h}** ${l.s}`).join('\n')}

## Notes for Aisha
- Testers repeated "tracking to knowing" back to us without prompting.
- Tighten the subline if you like, but keep the "where / why" contrast between Atlas and Lumen.
- Voice guide: no "finally", no "unlock", and never "real-time" for dashboards.
`,
    },
    {
      id: ASSET.launchEmail, kind: 'document', title: 'Launch email — existing customers',
      prompt: 'Launch email from Morgan Lee to admins and ops leads at existing Atlas customers announcing Lumen and the free customer preview, in the brand voice.',
      projectId: PROJECT.lumen, boardId: BOARD.launch,
      params: { format: 'markdown', tone: 'clear, calm, specific', length: 'short', channel: 'email' },
      tags: ['email', 'launch', 'customers'],
      createdAt: wd(8, 11, 0),
      versions: [
        { at: wd(8, 11, 0), style: 'paper', palette: ['#F7F4EC', DEEP, '#2F5D8C', AMBER], note: 'First draft.' },
        { at: wd(1, 14, 0), style: 'paper', palette: ['#F7F4EC', DEEP, '#2F5D8C', AMBER, '#8A9BB5'], note: 'Aisha’s tone pass; new tagline in the preview text.' },
      ],
      content: `
# Launch email: existing customers

**Status:** draft in review · **Send:** at the start of the customer preview · **From:** Morgan Lee, Product Lead
**Audience:** admins and ops leads at Growth and Enterprise accounts

---

**Subject:** Your Monday carrier review, minus the spreadsheet
**Preview text:** From tracking to knowing: Lumen is coming to Atlas, and you can try it first.

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
      id: ASSET.onePager, kind: 'document', title: 'Lumen one-pager for sales',
      prompt: 'A one-page sales summary of Atlas Lumen: problem, product, buyers, pricing approach, proof points, Tidewell comparison and discovery questions.',
      projectId: PROJECT.lumen, boardId: null,
      params: { format: 'markdown', tone: 'direct', length: 'one page', audience: 'sales' },
      tags: ['sales-enablement', 'one-pager', 'lumen'],
      createdAt: wd(6, 15, 0),
      versions: [
        { at: wd(6, 15, 0), style: 'paper', palette: ['#F7F4EC', NAVY, '#1F4E79', AMBER], note: 'First draft from the PRD and the messaging house.' },
        { at: wd(1, 16, 30), style: 'paper', palette: ['#F7F4EC', NAVY, '#1F4E79', AMBER, '#8A9BB5'], note: 'Updated the Tidewell section after the radar updates.' },
      ],
      content: `
# Atlas Lumen: one-pager for sales

**Internal. Pricing is a draft until ${dayLabel(dates.pricingLock)}; do not quote overage rates.**

## The problem
Operations teams export Atlas data every week and rebuild the same carrier and lane reports in spreadsheets. Four of six churned or at-risk customers we interviewed described exactly this.

## What Lumen does
Live dashboards, carrier scorecards, lane cost trends and exception alerts, built from the shipments customers already track in Atlas. No new integration. **From tracking to knowing.**

## Who buys it
- **Champion:** operations manager (on-time performance, carrier relationships)
- **Economic buyer:** head of operations
- **Best fit:** Growth and Enterprise accounts tracking more than 3,000 shipments a month

## Pricing approach (draft)
Three tiers (Core, Pro, Enterprise), priced on active shipments rather than seats, with usage alerts and guardrails against surprise bills. Design partners get 50% off year one.

## Proof
- Meridian Freight: Monday carrier review from about three hours to about twenty minutes (quote pending approval)
- 6 of 8 design partners use scorecards every week

## Against Tidewell Insights
- Insights covers standard KPIs; lane-level cost needs exports. Lead with depth: lane cost, scorecards, alerts
- Tidewell now prices Insights per tracked shipment too, so don't sell the pricing model; sell what it measures
- Tidewell's core is per-site contracts with implementation projects; Atlas is self-serve

## Discovery questions
1. How do you prepare for carrier reviews today, and how long does it take?
2. How do you find out about a late shipment: from a system, or from your customer?
3. How many people outside your ops team need to see shipment performance?
`,
    },
  ]

  return { boards, assets: specs.map(toAsset) }
}
