import type { AssetKind, Slide } from '@/core/types'
import { createRng, hashString, type Rng } from '@/lib/rng'
import type { PaletteAdjust } from './art'
import { capitalize, excerpt, keyTerms, shorten, stripMarkdown, titleFromText, topicPhrase } from './text'

/**
 * Studio content generators: slides, marketing copy, storyboards and narration scripts.
 * Brand-neutral, derived from the prompt and (when given) quotes from the user's knowledge.
 * They never invent statistics, customers or claims.
 */

export const IMAGE_STYLES = ['photographic', 'illustration', '3d', 'abstract', 'editorial'] as const
export type ImageStyle = (typeof IMAGE_STYLES)[number]
export const IMAGE_ASPECTS = ['1:1', '4:5', '16:9', '9:16'] as const
export const VIDEO_ASPECTS = ['16:9', '9:16', '1:1'] as const
export const DOC_FORMATS = ['landing', 'blog', 'email', 'social'] as const
export type DocFormat = (typeof DOC_FORMATS)[number]
export const VOICES = ['Warm narrator', 'Calm guide', 'Bright host', 'Clear presenter'] as const
export const TONES = ['clear', 'executive', 'energetic', 'instructive', 'playful'] as const
export type Tone = (typeof TONES)[number]
export const SLIDE_LAYOUTS = ['title', 'bullets', 'quote', 'image', 'split'] as const

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

/** Pick an alternative with the rng, or the first one without (keeps rng-less output stable). */
function choose<T>(rng: Rng | undefined, options: readonly T[]): T {
  return rng ? rng.pick(options) : options[0]
}

// ---------------------------------------------------------------- instructions ("Edit with instruction")

/**
 * What an edit instruction asks for, as far as the simulator can tell. Rule-based and honest:
 * anything it cannot map to a setting is reported back as such in the run's first step.
 */
export interface EditIntent {
  palette?: PaletteAdjust
  style?: ImageStyle
  aspect?: string
  tone?: Tone
  format?: DocFormat
  voice?: string
  /** −1 shorter / fewer, +1 longer / more. */
  length?: -1 | 1
  /** A topic to add ("add a slide about pricing"). */
  add?: string
  /** Human-readable list of what was understood, one line each. */
  notes: string[]
}

const has = (re: RegExp, text: string) => re.test(text)

/** Interpret an edit instruction for a kind of asset. */
export function interpretInstruction(instruction: string, kind: AssetKind): EditIntent {
  const t = ` ${instruction.toLowerCase().replace(/[^\p{L}\p{N}:'\s-]+/gu, ' ')} `
  const intent: EditIntent = { notes: [] }
  const visual = kind === 'image' || kind === 'video'

  if (visual) {
    const palette: PaletteAdjust = {}
    if (has(/\b(warm(er|th)?|sunn(y|ier)|golden|cozy|cosy|amber|sunset)\b/, t)) palette.warmth = 0.85
    else if (has(/\b(cool(er)?|cold(er)?|icy|icier|bluer|chill(y|ier)?|wintry)\b/, t)) palette.warmth = -0.85
    if (has(/\b(light(er|en)?|bright(er|en)?|airy|airier|pastel|softer light)\b/, t) && !has(/\blight(er)? tone\b/, t)) palette.light = 0.65
    else if (has(/\b(dark(er|en)?|moody|moodier|night|dim(mer)?|shadow(y|s)?|noir)\b/, t)) palette.light = -0.65
    if (has(/\b(vivid|vibrant|bold(er)?|saturated|punch(y|ier)|pop|richer|more colou?r(ful)?)\b/, t)) palette.saturation = 0.75
    else if (has(/\b(muted|subtle|subdued|desaturated|calm(er)?|quiet(er)?|soft(er)?|washed|less colou?r)\b/, t)) palette.saturation = -0.6
    if (palette.warmth || palette.light || palette.saturation) {
      intent.palette = palette
      const words = [
        palette.warmth ? (palette.warmth > 0 ? 'warmer' : 'cooler') : '',
        palette.light ? (palette.light > 0 ? 'lighter' : 'darker') : '',
        palette.saturation ? (palette.saturation > 0 ? 'more vivid' : 'more muted') : '',
      ].filter(Boolean)
      intent.notes.push(`Palette: ${words.join(', ')}`)
    }
    const style: ImageStyle | undefined = has(/\b(photo\w*|realistic|photoreal\w*)\b/, t)
      ? 'photographic'
      : has(/\b(illustrat\w*|flat|vector|drawn)\b/, t)
        ? 'illustration'
        : has(/\b(3d|three-d|render\w*|clay|isometric)\b/, t)
          ? '3d'
          : has(/\b(abstract|geometric|pattern)\b/, t)
            ? 'abstract'
            : has(/\b(editorial|poster|magazine|typograph\w*|print)\b/, t)
              ? 'editorial'
              : undefined
    if (style) {
      intent.style = style
      intent.notes.push(`Style: ${style === '3d' ? '3D' : style}`)
    }
    const aspect = has(/\b(square|1:1)\b/, t)
      ? '1:1'
      : has(/\b(vertical|story|stories|reel|9:16)\b/, t)
        ? '9:16'
        : has(/\b(portrait|4:5)\b/, t) && kind === 'image'
          ? '4:5'
          : has(/\b(wide|widescreen|landscape|banner|16:9)\b/, t)
            ? '16:9'
            : undefined
    if (aspect) {
      intent.aspect = aspect
      intent.notes.push(`Aspect: ${aspect}`)
    }
  }

  if (kind === 'presentation' || kind === 'document' || kind === 'audio') {
    const tone: Tone | undefined = has(/\b(formal|executive|board|investor|leadership|serious)\b/, t)
      ? 'executive'
      : has(/\b(playful|fun|funny|casual|light-?hearted|friendlier|friendly)\b/, t)
        ? 'playful'
        : has(/\b(energetic|exciting|punch(y|ier)|bold(er)?|hype)\b/, t)
          ? 'energetic'
          : has(/\b(step[- ]by[- ]step|how[- ]to|tutorial|instructive|teach)\b/, t)
            ? 'instructive'
            : has(/\b(clear(er)?|simpler|plain(er)?|straightforward)\b/, t)
              ? 'clear'
              : undefined
    if (tone) {
      intent.tone = tone
      intent.notes.push(`Tone: ${tone}`)
    }
  }

  if (kind === 'document') {
    const format: DocFormat | undefined = has(/\b(e-?mail|newsletter)\b/, t)
      ? 'email'
      : has(/\b(blog|article)\b/, t)
        ? 'blog'
        : has(/\b(social|tweets?|linkedin|posts?|thread)\b/, t)
          ? 'social'
          : has(/\b(landing( page)?|web ?page|homepage)\b/, t)
            ? 'landing'
            : undefined
    if (format) {
      intent.format = format
      intent.notes.push(`Format: ${format === 'landing' ? 'landing page' : format === 'blog' ? 'blog post' : format === 'social' ? 'social posts' : 'email'}`)
    }
  }

  if (kind === 'audio') {
    const voice = has(/\b(calm(er)?|sooth\w*|slow(er)?|gentle|gentler)\b/, t)
      ? 'Calm guide'
      : has(/\b(upbeat|energetic|brighter|faster|excited)\b/, t)
        ? 'Bright host'
        : has(/\b(presenter|explainer|neutral|crisp(er)?)\b/, t)
          ? 'Clear presenter'
          : has(/\b(warm(er)?|friendly|friendlier)\b/, t)
            ? 'Warm narrator'
            : undefined
    if (voice) {
      intent.voice = voice
      intent.notes.push(`Voice: ${voice}`)
    }
  }

  if (kind !== 'image') {
    if (has(/\b(short(er|en)?|tight(er|en)?|concise|trim|cut|brief(er)?|fewer|less)\b/, t)) {
      intent.length = -1
      intent.notes.push(kind === 'presentation' ? 'Fewer slides' : kind === 'video' || kind === 'audio' ? 'Shorter' : 'Shorter copy')
    } else if (has(/\b(long(er)?|expand|more detail|detailed|elaborate|extend|more slides|more shots)\b/, t)) {
      intent.length = 1
      intent.notes.push(kind === 'presentation' ? 'More slides' : kind === 'video' || kind === 'audio' ? 'Longer' : 'Longer copy')
    }
    const add = /\badd(?:ing)?\s+(?:a|an|one|another)?\s*(?:slide|section|shot|scene|paragraph|part|line)?\s*(?:about|on|for|covering|with)\s+([\p{L}\p{N}' -]{3,60})/u.exec(t)
    if (add && (kind === 'presentation' || kind === 'document')) {
      const topic = add[1].trim().replace(/\s+(and|then|please)\b.*$/, '')
      if (topic) {
        intent.add = topic
        intent.notes.push(`${kind === 'presentation' ? 'New slide' : 'New section'}: ${topic}`)
      }
    }
  }

  return intent
}

/** True when an intent changes nothing the simulator understands. */
export function isEmptyIntent(intent: EditIntent): boolean {
  return intent.notes.length === 0
}

// ---------------------------------------------------------------- presentations

const SUBTITLES: Record<string, readonly string[]> = {
  executive: ['Where we are, what we recommend, what we need', 'The decision in front of us, and why now', 'Recommendation and the ask'],
  energetic: ['What’s new, why it matters, and how we’ll launch it', 'The launch, in one story', 'Why this is the moment'],
  instructive: ['A step-by-step walkthrough', 'How it works, one step at a time', 'From first step to done'],
  playful: ['The short, friendly version', 'Everything you need, nothing you don’t', 'A quick tour'],
  clear: ['Context, options and next steps', 'What we know, what we propose', 'The plan in brief'],
}

/** 6–10 slides from the prompt and up to two knowledge quotes. `rng` varies the wording between takes. */
export function buildSlides(input: {
  prompt: string
  title?: string
  count: number
  tone: string
  quotes?: readonly KnowledgeQuote[]
  rng?: Rng
  /** Add a slide about this topic before the next steps. */
  add?: string
}): SlideDraft[] {
  const { rng } = input
  const t = terms(input.prompt)
  const deckTitle = input.title ?? t.title
  const count = Math.min(10, Math.max(6, Math.round(input.count)))
  const tone = input.tone in SUBTITLES ? input.tone : 'clear'
  const exec = tone === 'executive'
  const quotes = (input.quotes ?? []).slice(0, 2)

  type Keyed = SlideDraft & { key: string }
  const core: Keyed[] = [
    { key: 'title', layout: 'title', title: deckTitle, body: choose(rng, SUBTITLES[tone]), notes: 'Open with the decision or outcome this deck is for; keep it under a minute.' },
    {
      key: 'why',
      layout: 'bullets',
      title: choose(rng, exec ? ['The decision we need', 'Why this needs a decision now'] : ['Why this matters', 'The problem', 'What’s at stake']),
      body: [
        `- What ${t.topic} changes for the people we serve`,
        choose(rng, ['- What stays the same', '- What we keep doing', '- What does not change']),
        exec ? '- The decision we need from this group, and by when' : '- The decision we need from this group',
      ].join('\n'),
      notes: 'Frame the problem in the audience’s words before showing any solution.',
    },
    ...quotes.map(
      (q, i): Keyed => ({
        key: `quote${i}`,
        layout: 'quote',
        title: `From “${shorten(q.title, 60)}”`,
        body: excerpt(q.passage, 220),
        notes: `Quoted from your knowledge base (“${q.title}”). Check that it is still current before presenting.`,
      }),
    ),
    {
      key: 'options',
      layout: 'split',
      title: choose(rng, ['Options', 'Two ways forward', 'Choices in front of us']),
      body: [`**Option A — start with ${t.a}**`, choose(rng, ['Smaller first step; learn fast and expand.', 'Start narrow, prove it, then widen.']), '', `**Option B — ${t.b} end to end**`, choose(rng, ['Bigger scope; more coordination up front.', 'All at once; slower to start, fewer seams later.'])].join('\n'),
      notes: 'Recommend one option, and say what would change your mind.',
    },
    { key: 'image', layout: 'image', title: `${capitalize(t.a)} at a glance`, body: 'Visual placeholder (procedural preview) — replace with a real screenshot or diagram.', notes: 'Use one visual, not a collage.' },
    {
      key: 'measure',
      layout: 'bullets',
      title: choose(rng, ['How we will measure it', 'What good looks like', 'Measuring progress']),
      body: ['- A leading indicator we can watch weekly', '- A lagging indicator tied to retention or revenue', '- Qualitative signal from customer conversations'].join('\n'),
      notes: 'Pick the actual metrics with the team — none are assumed here.',
    },
    {
      key: 'risks',
      layout: 'bullets',
      title: choose(rng, ['Risks & open questions', 'What could go wrong', 'Open questions']),
      body: [`- Where ${t.c} could slow us down`, '- Dependencies on other teams', '- What we have not validated yet'].join('\n'),
      notes: 'Name the biggest risk first.',
    },
    {
      key: 'next',
      layout: 'bullets',
      title: choose(rng, exec ? ['The ask', 'Decision and next steps'] : ['Next steps', 'What happens next']),
      body: ['- Agree on scope and an owner', '- Turn the plan into tasks in Projects', '- Review progress in two weeks'].join('\n'),
      notes: 'End with a clear ask.',
    },
  ]
  const extras: Keyed[] = [
    { key: 'phases', layout: 'bullets', title: 'Phases', body: ['- Phase 1 — discovery', '- Phase 2 — pilot with a small group', '- Phase 3 — rollout'].join('\n'), notes: 'Dates are intentionally left out until the team commits.' },
    { key: 'team', layout: 'bullets', title: 'Team & roles', body: ['- Owner', '- Contributors', '- Reviewers and approvers'].join('\n'), notes: 'Fill in names before sharing.' },
  ]
  const closing: Keyed = { key: 'closing', layout: 'title', title: choose(rng, ['Questions & discussion', 'Discussion']), body: deckTitle, notes: 'Leave time for questions; capture follow-ups as tasks.' }
  let middle = core.slice(1)
  if (input.add?.trim()) {
    const topic = capitalize(input.add.trim())
    const at = Math.max(0, middle.findIndex((s) => s.key === 'next'))
    middle.splice(at, 0, {
      key: 'added',
      layout: 'bullets',
      title: shorten(topic, 60),
      body: [`- What ${input.add.trim()} means for this plan`, '- What we know and what we still need to find out', '- Our recommendation'].join('\n'),
      notes: 'Added on request. Fill in specifics with the owner before presenting.',
    })
  }
  while (middle.length + 2 < count && extras.length) middle.push(extras.shift()!)
  // Too many: drop the least essential slides first (image, then measures, then risks), keeping quotes and requested slides.
  const dropOrder = ['image', 'measure', 'risks', 'options']
  while (middle.length + 2 > count) {
    const victim = dropOrder.map((key) => middle.findIndex((s) => s.key === key)).find((i) => i >= 0)
    const fallback = middle.findLastIndex((s) => s.key !== 'added' && !s.key.startsWith('quote'))
    middle = middle.filter((_, i) => i !== (victim ?? (fallback >= 0 ? fallback : middle.length - 1)))
  }
  return [core[0], ...middle, closing].slice(0, Math.max(count, 1)).map(({ key: _key, ...slide }) => slide)
}

// ---------------------------------------------------------------- documents

function groundingNote(quotes: readonly KnowledgeQuote[]): string[] {
  return quotes.length ? [`> Grounded in your knowledge: ${quotes.map((q) => `“${q.title}”`).join(', ')}.`, ''] : []
}

const CTAS: Record<string, readonly string[]> = {
  executive: ['Book a briefing', 'Talk to our team', 'Request a walkthrough'],
  energetic: ['Get early access', 'Start a free trial', 'See it in action'],
  instructive: ['Follow the guide', 'Start with step one', 'Read the walkthrough'],
  playful: ['Take it for a spin', 'Try it free', 'Come see'],
  clear: ['Start a free trial', 'Book a walkthrough', 'See it in action', 'Get early access'],
}

const OPENERS: Record<string, (topic: string) => string> = {
  executive: (topic) => `This note summarizes what is changing with ${topic}, and what it means for your team.`,
  energetic: (topic) => `Something new is here: ${topic}, built to get out of your way.`,
  instructive: (topic) => `Here is how ${topic} works, step by step.`,
  playful: (topic) => `Good news: ${topic} just got a lot less fiddly.`,
  clear: (topic) => `Most teams we talk to handle ${topic} with a patchwork of tools. Here is what changes.`,
}

/** Marketing/editorial copy in a brand-neutral voice. */
export function buildDocumentCopy(input: {
  prompt: string
  format: DocFormat
  tone: string
  quotes?: readonly KnowledgeQuote[]
  rng: Rng
  /** −1 shorter, +1 longer. */
  length?: -1 | 0 | 1
  /** Add a section about this topic. */
  add?: string
}): string {
  const { rng } = input
  const t = terms(input.prompt)
  const tone = input.tone in CTAS ? input.tone : 'clear'
  const quotes = (input.quotes ?? []).slice(0, 2)
  const length = input.length ?? 0
  const headlines = rng
    .shuffle([
      `${capitalize(t.topic)}, without the busywork`,
      `See ${t.a} and ${t.b} in one place`,
      `Make ${t.a} simple for your whole team`,
      `${capitalize(t.a)} that keeps up with you`,
      `Less chasing, more ${t.b}`,
    ])
    .slice(0, 3)
  const cta = rng.pick(CTAS[tone])
  const quoteLine = quotes[0] ? `As your own notes put it: “${excerpt(quotes[0].passage, 160).replace(/[“”"]/g, '')}”` : ''
  const opener = OPENERS[tone](t.topic)
  const added = input.add?.trim() ? [``, `## ${capitalize(input.add.trim())}`, `What ${input.add.trim()} means for you, in plain words — fill in the specifics before publishing.`] : []
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
        ...(length >= 0 ? [`In short: ${t.a} and ${t.b} now live in one place, so your team spends less time switching tools.`] : []),
        ...(length > 0 ? ['', `What changes day to day: fewer hand-offs, one place to look, and the context you need already attached.`] : []),
        ...(quoteLine ? ['', quoteLine] : []),
        ...added,
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
        ...(length >= 0 ? ['', '**Post 3 — short**', `${headlines[1]}.`] : []),
        ...(length > 0 ? ['', '**Post 4 — behind the scenes**', `Why we built it: ${t.topic} should not need a spreadsheet.`] : []),
        ...added,
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
        opener,
        '',
        '## What changes',
        `${capitalize(t.a)} and ${t.b} come together in one workflow, with fewer hand-offs.`,
        ...(length >= 0 ? ['', '## How it works', `Start from ${t.c}, and the rest follows: the context you need is already there.`] : []),
        ...(quoteLine ? ['', quoteLine] : []),
        ...(length > 0 ? ['', '## Questions we hear', `**Does it replace our current tools?** No — it connects them, so ${t.a} stops living in five places.`, '', '**How long does it take to set up?** Start with one team; the rest can follow at its own pace.'] : []),
        ...added,
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
        ...(length >= 0 ? ['', '## Built for how your team works', choose(rng, ['Shared context means fewer status meetings and faster hand-offs.', 'Everyone sees the same picture, so hand-offs stop dropping things.'])] : []),
        ...(length > 0 ? ['', '## Questions, answered', `**Who is it for?** Teams that live in ${t.a} every day.`, '', '**What does it replace?** The copy-paste between tools — not the tools themselves.'] : []),
        ...added,
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
export function buildNarration(input: { prompt: string; voice: string; durationSec: number; quotes?: readonly KnowledgeQuote[]; rng?: Rng }): string {
  const { rng } = input
  const t = terms(input.prompt)
  const lines = [
    choose(rng, [`What if ${t.topic} just worked?`, `Imagine ${t.topic} without the busywork.`, `Picture ${t.topic}, done right.`]),
    choose(rng, [
      `Today, ${t.a} is spread across too many tools, and the team pays for it in time.`,
      `Right now, ${t.a} lives in five places, and every hand-off costs a little more time.`,
    ]),
    choose(rng, [`Here’s a simpler way: ${t.a} and ${t.b}, together in one place.`, `There’s a better way: ${t.a} and ${t.b}, side by side.`]),
    `Start from ${t.c}; everything you need is already in context.`,
    ...(input.quotes?.[0] ? [`As your own notes say: ${excerpt(input.quotes[0].passage, 140).replace(/[“”"]/g, '')}`] : []),
    choose(rng, ['Try it with one team this week, and see what changes.', 'Start with one team this week. See the difference for yourself.']),
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

/** The spoken words of a narration script: no markdown, timestamps, tables markup or production notes. */
export function spokenText(script: string): string {
  const lines = script
    .split('\n')
    .filter((l) => !/^\s*(\*\*voice:\*\*|_simulated|#|>|\|?\s*-{3,})/i.test(l))
    .map((l) => {
      const row = /^\s*\|(.+)\|\s*$/.exec(l)
      // Table rows (seeded scripts): the last cell is the line; skip header and empty/aside cells.
      if (row) {
        const cells = row[1].split('|').map((c) => c.trim())
        const last = cells[cells.length - 1] ?? ''
        return /^(line|beat|time)$/i.test(last) || /^\*?\(/.test(last) ? '' : last
      }
      return l
    })
    .map((l) => l.replace(/^\s*\[\d+:\d{2}\]\s*/, '').replace(/^\s*[-*]\s+/, ''))
  return stripMarkdown(lines.join('\n')).replace(/\s+/g, ' ').trim()
}

/**
 * A deterministic amplitude envelope (0–1) for a narration script, `bars` long: words make energy
 * proportional to their length, punctuation and line breaks make pauses. Drawn as the waveform of a
 * simulated narration — no audio exists.
 */
export function narrationWaveform(script: string, bars = 96): number[] {
  const text = spokenText(script) || script
  const rng = createRng(hashString(text))
  const units: number[] = []
  for (const token of text.split(/(\s+|[.,;:!?—–]+)/)) {
    if (!token) continue
    if (/^[.!?]+$/.test(token)) units.push(0, 0, 0)
    else if (/^[,;:—–]+$/.test(token)) units.push(0)
    else if (/^\s+$/.test(token)) continue
    else {
      const syllables = Math.max(1, Math.round(token.replace(/[^a-z]/gi, '').length / 3))
      for (let i = 0; i < syllables; i++) units.push(0.45 + rng.float(0, 0.55))
    }
  }
  if (!units.length) return Array.from({ length: bars }, () => 0.08)
  const out: number[] = []
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((b / bars) * units.length)
    const to = Math.max(from + 1, Math.floor(((b + 1) / bars) * units.length))
    let sum = 0
    for (let i = from; i < to; i++) sum += units[i]
    const v = sum / (to - from)
    out.push(Math.round(Math.max(0.08, Math.min(1, v * (0.85 + rng.float(0, 0.3)))) * 100) / 100)
  }
  return out
}
