import type { Block, ComposeContext, ComposedParts } from '../types'
import { marker, type Evidence } from '../evidence'
import { bullets, numbered } from '../layout'
import { extractCount } from '../shapes'
import { capitalize, collapse, ensurePeriod, joinList, keywords, splitSentences, stripTrailingPunctuation, titleCase, truncateWords } from '../text'
import { closingOffer } from './common'

export type WritingFormat =
  | 'email' | 'message' | 'blog' | 'memo' | 'social' | 'tagline' | 'release-notes' | 'press-release' | 'job' | 'bio' | 'prose'

const FORMAT_RULES: Array<[RegExp, WritingFormat]> = [
  [/\b(press release)\b/i, 'press-release'],
  [/\b(release notes|changelog|what's new)\b/i, 'release-notes'],
  [/\b(job (?:description|post(?:ing)?)|role description|hiring post)\b/i, 'job'],
  [/\b(taglines?|headlines?|slogans?|one-liners?|hooks?)\b/i, 'tagline'],
  [/\b(tweet|thread|linkedin|social(?: media)? post|instagram|caption)\b/i, 'social'],
  [/\b(e-?mail|newsletter|cover letter|letter)\b/i, 'email'],
  [/\b(memo|one-pager|brief)\b/i, 'memo'],
  [/\b(blog(?: post)?|article|essay|op-ed)\b/i, 'blog'],
  [/\b(slack|teams message|message|announcement|update to|post to|dm)\b/i, 'message'],
  [/\b(bio|about me|profile)\b/i, 'bio'],
]

export function detectFormat(text: string): WritingFormat {
  for (const [re, f] of FORMAT_RULES) if (re.test(text)) return f
  return 'prose'
}

type Tone = 'formal' | 'friendly' | 'concise' | 'neutral'

function detectTone(text: string): Tone {
  if (/\b(formal|professional|executive|board|investors?)\b/i.test(text)) return 'formal'
  if (/\b(short|concise|brief|tight|punchy)\b/i.test(text)) return 'concise'
  if (/\b(friendly|casual|warm|fun|playful|upbeat)\b/i.test(text)) return 'friendly'
  return 'neutral'
}

type Purpose = 'launch' | 'update' | 'followup' | 'request' | 'thanks' | 'invite' | 'apology' | 'general'

function detectPurpose(text: string): Purpose {
  if (/\b(launch|launching|introduc|announc|release|unveil)/i.test(text)) return 'launch'
  if (/\b(follow[- ]?up|following up|chase|reminder)\b/i.test(text)) return 'followup'
  if (/\b(update|status|progress|recap|weekly|monthly)\b/i.test(text)) return 'update'
  if (/\b(thank|thanks|gratitude|appreciat)/i.test(text)) return 'thanks'
  if (/\b(invite|invitation|join us|rsvp)\b/i.test(text)) return 'invite'
  if (/\b(apolog|sorry|delay|outage|incident)\b/i.test(text)) return 'apology'
  if (/\b(ask|request|approval|feedback|asking)\b/i.test(text)) return 'request'
  return 'general'
}

/** "a launch email for Lumen to existing customers" → about "Lumen", audience "existing customers". */
export function extractAboutAudience(np: string): { about: string; audience?: string } {
  const clean = np.replace(/^(?:a|an|the|some)\s+/i, '')
  const audienceMatch = /\b(?:to|for)\s+((?:all |our |your |the |existing |new |potential |prospective )*(?:customers?|clients?|users?|team|teammates|engineers?|engineering|leadership|execs?|executives|board|investors?|stakeholders|managers?|everyone|partners?|candidates?|subscribers|members|the company|company|sales|support|marketing|design|product))\b/i.exec(clean)
  const audience = audienceMatch?.[1]
  const withoutAudience = audienceMatch ? clean.replace(audienceMatch[0], '') : clean
  const aboutMatch = /\b(?:about|on|regarding|announcing|introducing|for|re)\s+(.+)$/i.exec(withoutAudience)
  let about = collapse(aboutMatch ? aboutMatch[1] : withoutAudience)
  about = about.replace(/^(?:the\s+)?(?:launch|release)\s+of\s+/i, '').replace(/\s+(?:that|which|to)\s.*$/i, '')
  // Drop the format noun itself ("email", "post") when nothing more specific remains.
  about = about.replace(/^(?:\w+\s+)?(?:e-?mail|memo|post|message|announcement|newsletter|letter|update|note)\b\s*/i, '').trim()
  return { about: stripTrailingPunctuation(about) || 'the update', audience }
}

function greeting(audience: string | undefined, tone: Tone): string {
  const a = audience?.toLowerCase() ?? ''
  if (/^[A-Z][a-z]+$/.test(audience ?? '')) return `${tone === 'formal' ? 'Dear' : 'Hi'} ${audience},`
  if (/team|teammates|engineer|everyone|company|sales|support|marketing|design|product/.test(a)) return tone === 'formal' ? 'Hello everyone,' : 'Hi team,'
  if (/board|investor|stakeholder|exec|leadership/.test(a)) return 'Hello everyone,'
  return tone === 'formal' ? 'Hello,' : 'Hi there,'
}

function signoff(tone: Tone, name: string): string {
  const word = tone === 'formal' ? 'Best regards,' : tone === 'friendly' ? 'Cheers,' : 'Best,'
  return `${word}  \n${name}`
}

/** Key points for the draft: real sentences from sources, or honest placeholders. */
function points(evidence: readonly Evidence[], n: number): string[] {
  const real = evidence.slice(0, n).map((e) => ensurePeriod(truncateWords(e.sentence, 30)))
  const placeholders = ['[Key point — what changes for the reader]', '[Why it matters to them]', '[What they need to do, if anything]', '[Where to learn more — link]']
  return [...real, ...placeholders].slice(0, Math.max(n, real.length))
}

const SUBJECTS: Record<Purpose, (a: string) => string> = {
  launch: (a) => `Introducing ${a}`,
  update: (a) => `${capitalize(a)}: a quick update`,
  followup: (a) => `Following up: ${a}`,
  request: (a) => `Request: ${a}`,
  thanks: () => 'Thank you',
  invite: (a) => `You're invited: ${a}`,
  apology: (a) => `About ${a}`,
  general: (a) => capitalize(a),
}

const OPENINGS: Record<Purpose, (a: string) => string> = {
  launch: (a) => `We're launching ${a} on [date], and I wanted you to hear about it first.`,
  update: (a) => `Here's a quick update on ${a}.`,
  followup: (a) => `I'm following up on ${a} to make sure it didn't get lost.`,
  request: (a) => `I'm reaching out about ${a}.`,
  thanks: (a) => `Thank you for ${a} — it made a real difference.`,
  invite: (a) => `I'd love for you to join us for ${a} on [date].`,
  apology: (a) => `I want to be upfront about ${a} and what we're doing about it.`,
  general: (a) => `I wanted to share a few thoughts on ${a}.`,
}

const CTAS: Record<Purpose, string> = {
  launch: "If you have questions, just reply — I'm happy to walk you through it.",
  update: 'Let me know if anything here needs a closer look.',
  followup: 'Could you let me know where this stands by [date]?',
  request: 'Could you let me know by [date]? Happy to talk it through if that is easier.',
  thanks: 'I really appreciate it.',
  invite: 'Please RSVP by [date] — [link].',
  apology: "I'll share another update by [date]. Reply anytime with questions.",
  general: 'Happy to discuss — just reply here.',
}

function taglines(ctx: ComposeContext, about: string, n: number): string[] {
  const kws = keywords(about, 4)
  const k = kws[0] ? capitalize(kws[0]) : 'It'
  const k2 = kws[1] ?? 'work'
  const lines = [
    `${k}, made clear.`,
    `See your ${k2} at a glance.`,
    `The calm way to run ${k2}.`,
    `Less guesswork. More ${k2}.`,
    `${k} that keeps up with you.`,
    `From scattered to sorted.`,
    `Know where you stand — every day.`,
    `Built for the way your team actually works.`,
    `${k}: the answers were in your data all along.`,
    `Clarity, without the extra work.`,
  ]
  return ctx.rng.shuffle(lines).slice(0, n)
}

const FILLER: Array<[RegExp, string]> = [
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bin the event that\b/gi, 'if'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bwith regard to\b/gi, 'about'],
  [/\bit is important to note that\s*/gi, ''],
  [/\b(?:really|very|basically|actually|just|quite|totally|literally)\s+/gi, ''],
  [/\bplease be advised that\s*/gi, ''],
  [/\bI think that\b/g, 'I think'],
]

/** Deterministic tightening: strips filler phrases; returns the rewrite and what changed. */
export function tighten(text: string): { text: string; changes: number } {
  let out = text
  let changes = 0
  for (const [re, rep] of FILLER) {
    out = out.replace(re, () => {
      changes++
      return rep
    })
  }
  out = out.replace(/ {2,}/g, ' ').replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, ch: string) => p + ch.toUpperCase())
  return { text: out.trim(), changes }
}

/** Text the user wants rewritten: pasted after a colon, quoted, or attached. */
function sourceText(ctx: ComposeContext): string | undefined {
  if (ctx.files.length) return ctx.files[0].text
  const colon = ctx.text.indexOf(':')
  if (colon > 0 && ctx.text.length - colon > 60) return ctx.text.slice(colon + 1).trim()
  const quoted = /[“"]([^”"]{60,})[”"]/.exec(ctx.text)
  return quoted?.[1]
}

export function composeWriting(ctx: ComposeContext): ComposedParts {
  const { rng, evidence, depth, facts, subject } = ctx
  const deep = depth === 'deep'
  const format = detectFormat(ctx.text)
  const tone = detectTone(ctx.text)
  const purpose = detectPurpose(ctx.text)
  const { about, audience } = extractAboutAudience(subject.np)
  const name = facts.userName ?? '[Your name]'
  const blocks: Block[] = []

  // Rewrite requests operate on the user's own text.
  const rewriteSource = /\b(rewrite|rephrase|reword|polish|edit|proofread|tighten|shorten)\b/i.test(ctx.text) ? sourceText(ctx) : undefined
  if (rewriteSource) {
    const { text: rewritten, changes } = tighten(rewriteSource)
    const longSentences = splitSentences(rewritten).filter((s) => s.split(/\s+/).length > 28).length
    blocks.push({ md: rng.pick(["Here's a tighter version:", "Here's a cleaned-up pass:"]), priority: Infinity })
    blocks.push({ md: rewritten.split('\n').map((l) => `> ${l}`).join('\n'), priority: Infinity })
    const notes = [
      changes ? `Removed ${changes} filler phrase${changes === 1 ? '' : 's'} (“in order to”, “really”, “just”…).` : 'The wording was already lean; I kept your phrasing.',
      longSentences ? `${longSentences} sentence${longSentences === 1 ? ' is' : 's are'} still over 28 words — consider splitting ${longSentences === 1 ? 'it' : 'them'}.` : 'Sentence lengths read comfortably.',
      'Meaning and claims are unchanged; I did not add new information.',
    ]
    blocks.push({ md: `**What changed**\n\n${bullets(notes)}`, priority: 2 })
    blocks.push(closingOffer(ctx, ['Want it more formal, more casual, or shorter still?', 'Tell me the audience and I can adjust the tone.']))
    return { blocks, noPadding: true, approach: { format: 'a tightened rewrite of your text', structure: 'keep your meaning, remove filler and flag long sentences' } }
  }

  const intro = rng.pick([
    `Here's a draft${format === 'prose' ? '' : ` ${formatLabel(format)}`}. Placeholders in [brackets] are details I'd rather not guess.`,
    `Draft below — anything in [brackets] is a detail for you to fill in so nothing is made up.`,
  ])
  blocks.push({ md: intro, priority: Infinity })

  const pts = points(evidence, deep ? 4 : 3)
  let draft: string
  switch (format) {
    case 'email': {
      draft = [
        `**Subject:** ${SUBJECTS[purpose](about)}`,
        greeting(audience, tone),
        OPENINGS[purpose](about),
        bullets(pts),
        CTAS[purpose],
        signoff(tone, name),
      ].join('\n\n')
      break
    }
    case 'message': {
      draft = [
        `**${purpose === 'launch' ? `${capitalize(about)} is coming` : capitalize(SUBJECTS[purpose](about))}**`,
        OPENINGS[purpose](about),
        bullets(pts.slice(0, 3)),
        purpose === 'launch' ? 'Questions? Drop them in this thread.' : 'Questions or concerns? Reply in thread.',
      ].join('\n\n')
      break
    }
    case 'memo': {
      draft = [
        `**To:** ${audience ? capitalize(audience) : '[Audience]'}  \n**From:** ${name}  \n**Date:** ${facts.date ?? '[Date]'}  \n**Re:** ${capitalize(about)}`,
        `**Summary.** ${OPENINGS[purpose](about)} [One-sentence recommendation.]`,
        `**Background.** ${pts[0]}`,
        `**Recommendation.** [What you propose, and why now.]`,
        `**Next steps.**\n\n${numbered(['[Decision needed and from whom]', '[Owner and date for the first step]', '[How we will know it worked]'])}`,
      ].join('\n\n')
      break
    }
    case 'blog': {
      draft = [
        `### ${titleCase(about)}`,
        `[Hook: a one-sentence scene or problem your reader will recognize.] This post is about ${about} — what it is, why it matters, and what comes next.`,
        `#### Why it matters\n\n${pts[0]} [Expand with an example from your own experience.]`,
        `#### What's changing\n\n${bullets(pts.slice(1))}`,
        `#### What's next\n\n[What readers should do now, and where to learn more — link.]`,
      ].join('\n\n')
      break
    }
    case 'social': {
      const n = extractCount(ctx.text, deep ? 3 : 2, 4)
      const variants = [
        `${capitalize(about)} — ${purpose === 'launch' ? 'now live' : 'here is what we learned'}. ${pts[0]} [link]`,
        `We've been working on ${about}. The short version: ${stripTrailingPunctuation(pts[0])}. More soon → [link]`,
        `One thing we've learned about ${about}: ${stripTrailingPunctuation(pts[1] ?? pts[0])}. What's your take?`,
        `${capitalize(about)}, in one sentence: [your crispest line]. Details → [link]`,
      ]
      draft = variants.slice(0, n).map((v, i) => `**Option ${i + 1}**\n\n> ${v}`).join('\n\n')
      break
    }
    case 'tagline': {
      draft = numbered(taglines(ctx, about, extractCount(ctx.text, deep ? 8 : 6, 10)))
      break
    }
    case 'release-notes': {
      draft = [
        `### What's new${about !== 'the update' ? ` in ${about}` : ''}`,
        bullets(pts.map((p) => (p.startsWith('[') ? '**[Feature]** — [what it does and who it helps]' : p))),
        '### Improvements',
        bullets(['[Improvement — the before and after]', '[Performance or reliability change]']),
        '### Fixes',
        bullets(['[Bug fixed — the symptom users saw]']),
      ].join('\n\n')
      break
    }
    case 'press-release': {
      draft = [
        '**FOR IMMEDIATE RELEASE**',
        `### [Company] announces ${about}`,
        `**[City] — ${facts.date ?? '[Date]'}** — [Company] today announced ${about}. ${pts[0]}`,
        `${pts[1] ?? '[Second paragraph: who it is for and the problem it solves.]'}`,
        '> “[Quote from a spokesperson on why this matters.]” — [Name, Title]',
        `**About [Company]** — [Two-sentence boilerplate.]  \n**Media contact:** [Name, email]`,
      ].join('\n\n')
      break
    }
    case 'job': {
      const role = titleCase(about.replace(/^(?:a|an)\s+/i, ''))
      draft = [
        `### ${role}`,
        `**About the role.** [Team, mission and why this role exists now.]`,
        `**What you'll do**\n\n${bullets(['[Core responsibility 1]', '[Core responsibility 2]', '[How success is measured in the first 90 days]'])}`,
        `**What you'll bring**\n\n${bullets(['[Must-have skill or experience]', '[Second must-have]', '[Working style that fits the team]'])}`,
        `**Nice to have**\n\n${bullets(['[Bonus skill]'])}`,
      ].join('\n\n')
      break
    }
    case 'bio': {
      draft = `${name} is [role] at [company], focused on ${about}. [One sentence on a notable project or result.] [One personal detail that makes the bio human.]`
      break
    }
    default: {
      draft = [
        `${capitalize(OPENINGS[purpose](about))}`,
        evidence.length ? pts.slice(0, 3).join(' ') : `[Main point about ${about}.] [Supporting detail or example.] [Why it matters to the reader.]`,
        '[Close with the one thing you want the reader to remember or do.]',
      ].join('\n\n')
    }
  }
  blocks.push({ md: draft, priority: Infinity })

  if (evidence.length) {
    const used = evidence.slice(0, deep ? 4 : 3)
    const refs = [...new Set(used.map((e) => `*${e.title}*${marker(e)}`))]
    blocks.push({ md: `I pulled the key points from ${joinList(refs)} — double-check them before sending.`, priority: Infinity })
  }
  if (deep) {
    blocks.push({
      md: `**Before you send**\n\n${bullets(['Fill every [bracket] or cut the line.', 'Read it aloud once; trim anything you would not say in person.', audience ? `Check it answers the first question ${audience} will have.` : 'Check it answers the first question your reader will have.'])}`,
      priority: 2,
    })
  }
  blocks.push(closingOffer(ctx, ['Want a shorter version, or a different tone?', 'I can draft a variation for a different audience if useful.']))

  return {
    blocks,
    noPadding: true,
    approach: {
      format: `a draft ${formatLabel(format)}`,
      structure: evidence.length
        ? 'use real sentences from the sources as the key points and keep unknown specifics as placeholders'
        : 'keep the structure tight and leave specifics I cannot know as placeholders',
    },
  }
}

function formatLabel(f: WritingFormat): string {
  const labels: Record<WritingFormat, string> = {
    email: 'email', message: 'message', blog: 'blog post', memo: 'memo', social: 'social post', tagline: 'set of taglines',
    'release-notes': 'release notes', 'press-release': 'press release', job: 'job description', bio: 'bio', prose: 'piece',
  }
  return labels[f]
}

