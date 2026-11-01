import type { AssetKind, Slide } from '@/core/types'
import type { Rng } from '@/lib/rng'
import { capitalize, excerpt, keyTerms, shorten, titleFromText, topicPhrase } from './text'

/**
 * Studio content generators: slides, marketing copy, storyboards and narration scripts.
 * Brand-neutral, derived from the prompt and (when given) quotes from the user's knowledge.
 * They never invent statistics, customers or claims.
 */

export const IMAGE_STYLES = ['photographic', 'illustration', '3d', 'abstract', 'editorial'] as const
export type ImageStyle = (typeof IMAGE_STYLES)[number]
export const IMAGE_ASPECTS = ['1:1', '4:5', '16:9', '9:16'] as const
export const DOC_FORMATS = ['landing', 'blog', 'email', 'social'] as const
export type DocFormat = (typeof DOC_FORMATS)[number]
export const VOICES = ['Warm narrator', 'Calm guide', 'Bright host', 'Clear presenter'] as const

export interface KnowledgeQuote {
  title: string
  passage: string
}

export type SlideDraft = Omit<Slide, 'id'>

export function inferImageStyle(prompt: string): ImageStyle {
  const p = prompt.toLowerCase()
  if (/\b(photo\w*|realistic|camera|shot on|lens)\b/.test(p)) return 'photographic'
  if (/\b(3d|render\w*|isometric|clay|octane)\b/.test(p)) return '3d'
  if (/\b(abstract|pattern|generative|geometric|texture)\b/.test(p)) return 'abstract'
  if (/\b(editorial|magazine|poster|layout|typograph\w*)\b/.test(p)) return 'editorial'
  return 'illustration'
}

export function inferAspect(prompt: string, kind: AssetKind): string {
  const p = prompt.toLowerCase()
  if (/\b(story|stories|reel|tiktok|vertical|9:16)\b/.test(p)) return '9:16'
  if (/\b(portrait|instagram post|4:5)\b/.test(p)) return '4:5'
  if (/\b(banner|hero|header|wide|landscape|16:9|slide|youtube)\b/.test(p) || kind === 'video') return '16:9'
  return '1:1'
}

export function inferDocFormat(prompt: string): DocFormat {
  const p = prompt.toLowerCase()
  if (/\b(e-?mail|newsletter|announcement to customers)\b/.test(p)) return 'email'
  if (/\b(tweet|post|linkedin|social|thread|caption)\b/.test(p)) return 'social'
  if (/\b(blog|article|essay|write-?up)\b/.test(p)) return 'blog'
  return 'landing'
}

export function inferTone(prompt: string): string {
  const p = prompt.toLowerCase()
  if (/\b(board|investor|executive|leadership|exec)\b/.test(p)) return 'executive'
  if (/\b(launch|campaign|announce|hype|exciting)\b/.test(p)) return 'energetic'
  if (/\b(training|onboarding|how-?to|tutorial|guide)\b/.test(p)) return 'instructive'
  if (/\b(playful|fun|casual)\b/.test(p)) return 'playful'
  return 'clear'
}

export function inferVoice(prompt: string): string {
  const p = prompt.toLowerCase()
  if (/\b(calm|meditat|soothing)\b/.test(p)) return 'Calm guide'
  if (/\b(upbeat|energetic|launch|promo)\b/.test(p)) return 'Bright host'
  if (/\b(training|explainer|walkthrough|tutorial)\b/.test(p)) return 'Clear presenter'
  return 'Warm narrator'
}

/** Up to five lowercase tags from the prompt. */
export function assetTags(prompt: string): string[] {
  return keyTerms(prompt, 5).map((t) => t.toLowerCase())
}

const KIND_NOUN: Record<AssetKind, string> = { image: 'Visual', video: 'Video', presentation: 'Deck', document: 'Copy', audio: 'Narration' }

/** Default asset title from the prompt. */
export function assetTitle(prompt: string, kind: AssetKind): string {
  const t = titleFromText(prompt, 56)
  return t === 'Untitled' ? `Untitled ${KIND_NOUN[kind].toLowerCase()}` : t
}

function terms(prompt: string): { topic: string; a: string; b: string; c: string; title: string } {
  const ts = keyTerms(prompt, 4)
  const topic = topicPhrase(prompt, 6)
  return { topic, a: ts[0] ?? topic, b: ts[1] ?? ts[0] ?? topic, c: ts[2] ?? ts[1] ?? ts[0] ?? topic, title: titleFromText(prompt, 60) }
}

// ---------------------------------------------------------------- presentations

/** 6–10 slides from the prompt and up to two knowledge quotes. */
export function buildSlides(input: { prompt: string; title?: string; count: number; tone: string; quotes?: readonly KnowledgeQuote[] }): SlideDraft[] {
  const t = terms(input.prompt)
  const deckTitle = input.title ?? t.title
  const count = Math.min(10, Math.max(6, Math.round(input.count)))
  const subtitle: Record<string, string> = {
    executive: 'Where we are, what we recommend, what we need',
    energetic: 'What’s new, why it matters, and how we’ll launch it',
    instructive: 'A step-by-step walkthrough',
    playful: 'The short, friendly version',
    clear: 'Context, options and next steps',
  }
  const quotes = (input.quotes ?? []).slice(0, 2)
  const core: SlideDraft[] = [
    { layout: 'title', title: deckTitle, body: subtitle[input.tone] ?? subtitle.clear, notes: 'Open with the decision or outcome this deck is for; keep it under a minute.' },
    {
      layout: 'bullets',
      title: 'Why this matters',
      body: [`- What ${t.topic} changes for the people we serve`, '- What stays the same', '- The decision we need from this group'].join('\n'),
      notes: 'Frame the problem in the audience’s words before showing any solution.',
    },
    ...quotes.map(
      (q): SlideDraft => ({
        layout: 'quote',
        title: `From “${shorten(q.title, 60)}”`,
        body: excerpt(q.passage, 220),
        notes: `Quoted from your knowledge base (“${q.title}”). Check that it is still current before presenting.`,
      }),
    ),
    {
      layout: 'split',
      title: 'Options',
      body: [`**Option A — start with ${t.a}**`, `Smaller first step; learn fast and expand.`, '', `**Option B — ${t.b} end to end**`, 'Bigger scope; more coordination up front.'].join('\n'),
      notes: 'Recommend one option, and say what would change your mind.',
    },
    { layout: 'image', title: `${capitalize(t.a)} at a glance`, body: 'Visual placeholder (procedural preview) — replace with a real screenshot or diagram.', notes: 'Use one visual, not a collage.' },
    {
      layout: 'bullets',
      title: 'How we will measure it',
      body: ['- A leading indicator we can watch weekly', '- A lagging indicator tied to retention or revenue', '- Qualitative signal from customer conversations'].join('\n'),
      notes: 'Pick the actual metrics with the team — none are assumed here.',
    },
    {
      layout: 'bullets',
      title: 'Risks & open questions',
      body: [`- Where ${t.c} could slow us down`, '- Dependencies on other teams', '- What we have not validated yet'].join('\n'),
      notes: 'Name the biggest risk first.',
    },
    { layout: 'bullets', title: 'Next steps', body: ['- Agree on scope and an owner', '- Turn the plan into tasks in Projects', '- Review progress in two weeks'].join('\n'), notes: 'End with a clear ask.' },
  ]
  const extras: SlideDraft[] = [
    { layout: 'bullets', title: 'Phases', body: ['- Phase 1 — discovery', '- Phase 2 — pilot with a small group', '- Phase 3 — rollout'].join('\n'), notes: 'Dates are intentionally left out until the team commits.' },
    { layout: 'bullets', title: 'Team & roles', body: ['- Owner', '- Contributors', '- Reviewers and approvers'].join('\n'), notes: 'Fill in names before sharing.' },
  ]
  const closing: SlideDraft = { layout: 'title', title: 'Questions & discussion', body: deckTitle, notes: 'Leave time for questions; capture follow-ups as tasks.' }
  let middle = core.slice(1)
  while (middle.length + 2 < count && extras.length) middle.push(extras.shift()!)
  // Too many: drop the least essential slides first (image, then measures, then risks), keeping quotes.
  const dropOrder = ['image', 'How we will measure it', 'Risks & open questions', 'Options']
  while (middle.length + 2 > count) {
    const victim = dropOrder.map((key) => middle.findIndex((s) => s.layout === key || s.title === key)).find((i) => i >= 0)
    middle = middle.filter((_, i) => i !== (victim ?? middle.length - 1))
  }
  return [core[0], ...middle, closing].slice(0, count)
}

// ---------------------------------------------------------------- documents

function groundingNote(quotes: readonly KnowledgeQuote[]): string[] {
  return quotes.length ? [`> Grounded in your knowledge: ${quotes.map((q) => `“${q.title}”`).join(', ')}.`, ''] : []
}

/** Marketing/editorial copy in a brand-neutral voice. */
export function buildDocumentCopy(input: { prompt: string; format: DocFormat; tone: string; quotes?: readonly KnowledgeQuote[]; rng: Rng }): string {
  const { rng } = input
  const t = terms(input.prompt)
  const quotes = (input.quotes ?? []).slice(0, 2)
  const headlines = rng
    .shuffle([
      `${capitalize(t.topic)}, without the busywork`,
      `See ${t.a} and ${t.b} in one place`,
      `Make ${t.a} simple for your whole team`,
      `${capitalize(t.a)} that keeps up with you`,
      `Less chasing, more ${t.b}`,
    ])
    .slice(0, 3)
  const cta = rng.pick(['Start a free trial', 'Book a walkthrough', 'See it in action', 'Get early access'])
  const quoteLine = quotes[0] ? `As your own notes put it: “${excerpt(quotes[0].passage, 160).replace(/[“”"]/g, '')}”` : ''
  switch (input.format) {
    case 'email':
      return [
        ...groundingNote(quotes),
        '**Subject options**',
        ...headlines.map((h, i) => `${i + 1}. ${h}`),
        '',
        `**Preview text:** A quick look at what’s new with ${t.a}.`,
        '',
        'Hi {first name},',
        '',
        `We’ve been working on ${t.topic}, and wanted you to hear about it first.`,
        `In short: ${t.a} and ${t.b} now live in one place, so your team spends less time switching tools.`,
        ...(quoteLine ? ['', quoteLine] : []),
        '',
        `[${cta}]`,
        '',
        'Thanks,',
        'The team',
      ].join('\n')
    case 'social':
      return [
        ...groundingNote(quotes),
        '**Post 1 — announcement**',
        `${headlines[0]}. ${capitalize(t.a)} and ${t.b}, finally in one view. ${cta} →`,
        '',
        '**Post 2 — problem first**',
        `Still piecing ${t.a} together from five tabs? There’s a simpler way.`,
        '',
        '**Post 3 — short**',
        `${headlines[1]}.`,
        '',
        `Hashtags: ${keyTerms(input.prompt, 3).map((x) => `#${x.replace(/[^A-Za-z0-9]/g, '')}`).join(' ')}`,
      ].join('\n')
    case 'blog':
      return [
        `# ${headlines[0]}`,
        '',
        ...groundingNote(quotes),
        `**Title options:** ${headlines.slice(1).join(' · ')}`,
        '',
        `Most teams we talk to handle ${t.a} with a patchwork of tools. This post explains what we’re changing and why.`,
        '',
        '## What changes',
        `${capitalize(t.a)} and ${t.b} come together in one workflow, with fewer hand-offs.`,
        '',
        '## How it works',
        `Start from ${t.c}, and the rest follows: the context you need is already there.`,
        ...(quoteLine ? ['', quoteLine] : []),
        '',
        '## What’s next',
        'We’ll keep improving it with the teams using it every day — tell us what you need.',
        '',
        `**${cta}**`,
      ].join('\n')
    default:
      return [
        `# ${headlines[0]}`,
        '',
        ...groundingNote(quotes),
        '**Headline options**',
        ...headlines.map((h, i) => `${i + 1}. ${h}`),
        '',
        `**Subheadline:** Bring ${t.a}, ${t.b} and ${t.c} together so your team can focus on the work, not the tools.`,
        '',
        '## Everything in one view',
        `Stop switching tabs: ${t.a} and ${t.b} live side by side.`,
        '',
        '## Built for how your team works',
        'Shared context means fewer status meetings and faster hand-offs.',
        '',
        '## Ready when you are',
        'Start small with one team, then roll out at your own pace.',
        ...(quoteLine ? ['', quoteLine] : []),
        '',
        `**Call to action:** ${cta} · _Secondary:_ Talk to us`,
      ].join('\n')
  }
}

// ---------------------------------------------------------------- video & audio

const BEATS = ['Hook', 'Problem', 'Turn', 'Solution', 'Detail', 'Call to action'] as const
const FRAMINGS = ['Wide establishing shot', 'Medium shot', 'Close-up', 'Over-the-shoulder', 'Top-down detail', 'Tracking shot', 'Screen capture']
const MOTIONS = ['slow push-in', 'static, locked off', 'gentle pan left', 'handheld follow', 'rack focus', 'slow pull back']

function clock(sec: number): string {
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function voLine(beat: string, t: ReturnType<typeof terms>): string {
  switch (beat) {
    case 'Hook':
      return `What if ${t.topic} just worked?`
    case 'Problem':
      return `Today, ${t.a} lives in too many places.`
    case 'Turn':
      return 'There’s a simpler way.'
    case 'Solution':
      return `${capitalize(t.a)} and ${t.b}, together in one view.`
    case 'Detail':
      return `Everything about ${t.c} is one click away.`
    default:
      return 'See it for yourself.'
  }
}

/** One storyboard slide per shot: framing, motion and a voice-over line. */
export function buildStoryboard(input: { prompt: string; shots: number; durationSec: number; aspect: string; rng: Rng }): SlideDraft[] {
  const { rng } = input
  const t = terms(input.prompt)
  const shots = Math.min(12, Math.max(3, Math.round(input.shots)))
  const per = input.durationSec / shots
  return Array.from({ length: shots }, (_, i) => {
    const beat = i === shots - 1 ? 'Call to action' : BEATS[Math.min(i, BEATS.length - 2)]
    return {
      layout: 'image' as const,
      title: `Shot ${i + 1} · ${beat}`,
      body: [`Framing: ${rng.pick(FRAMINGS)}`, `Motion: ${rng.pick(MOTIONS)}`, `VO: “${voLine(beat, t)}”`].join('\n'),
      notes: `${clock(i * per)}–${clock((i + 1) * per)} · ${input.aspect}`,
    }
  })
}

/** Narration script with timestamps, sized to the duration (~2.3 words per second). */
export function buildNarration(input: { prompt: string; voice: string; durationSec: number; quotes?: readonly KnowledgeQuote[] }): string {
  const t = terms(input.prompt)
  const lines = [
    `What if ${t.topic} just worked?`,
    `Today, ${t.a} is spread across too many tools, and the team pays for it in time.`,
    `Here’s a simpler way: ${t.a} and ${t.b}, together in one place.`,
    `Start from ${t.c}; everything you need is already in context.`,
    ...(input.quotes?.[0] ? [`As your own notes say: ${excerpt(input.quotes[0].passage, 140).replace(/[“”"]/g, '')}`] : []),
    'Try it with one team this week, and see what changes.',
  ]
  const budget = Math.round(input.durationSec * 2.3)
  const out: string[] = []
  let words = 0
  let at = 0
  for (const line of lines) {
    const n = line.split(/\s+/).length
    if (words + n > budget && out.length >= 2) break
    out.push(`[${clock(at)}] ${line}`)
    words += n
    at += n / 2.3
  }
  return [`**Voice:** ${input.voice} · about ${input.durationSec}s (~${words} words)`, '', ...out, '', '_Simulated narration script — no audio was synthesized._'].join('\n')
}
