import type { AssetKind } from '@/core/types'
import { capitalize } from './text'
import type { CreateKind } from './types'

/**
 * Studio request → asset kind + cleaned prompt. The earliest kind cue in the text wins
 * ("Write a blog post with a hero image" is a document; "Create an image for the blog post"
 * is an image). Image is the default when nothing points elsewhere.
 */

const KIND_CUES: ReadonlyArray<{ kind: AssetKind; re: RegExp }> = [
  {
    kind: 'audio',
    re: /\b(?:voice[- ]?overs?|voices?|narrat\w*|podcasts?|audio(?:books?)?|jingles?|sound ?(?:bites?|tracks?)|read (?:it |this )?aloud|radio spots?)\b/i,
  },
  {
    kind: 'video',
    re: /\b(?:videos?|clips?|storyboards?|animations?|animated|reels?|teasers?|trailers?|footage|films?|tiktoks?|motion graphics)\b/i,
  },
  { kind: 'presentation', re: /\b(?:slide ?decks?|pitch decks?|decks?|slides?|slideshows?|presentations?|keynotes?)\b/i },
  {
    kind: 'document',
    re: /\b(?:copy(?:writing)?|e-?mails?|headlines?|taglines?|slogans?|landing ?pages?|landing|blog(?: posts?)?|blogs?|posts?(?!\s+(?:images?|graphics?|visuals?|photos?|pictures?|art))|articles?|newsletters?|press releases?|captions?|scripts?|one-pagers?|product descriptions?|faqs?|announcements?)\b/i,
  },
  {
    kind: 'image',
    re: /\b(?:images?|pictures?|photos?|photographs?|illustrations?|logos?|posters?|banners?|icons?|graphics?|visuals?|thumbnails?|mock-?ups?|moodboards?|wallpapers?|drawings?|renders?|sketch(?:es)?|artwork|key art)\b/i,
  },
]

/** Writing verbs make text the default when no kind noun is present ("Write something about …"). */
const WRITE_VERB = /^(?:write|draft|compose|copywrite|rewrite|edit)\b/i

const LEADS: readonly RegExp[] = [
  /^(?:hey|hi|hello|ok(?:ay)?|so)\b[\s,!.:-]*/i,
  /^(?:please|pls|kindly)\b[\s,]*/i,
  /^(?:can|could|would|will) you(?: please)?\s+/i,
  /^(?:i(?:'d| would)? (?:like|want|need)(?: you)?(?: to)?|we need(?: to)?|let's|lets|help me(?: to)?)\s+/i,
  /^(?:create|make|generate|design|draw|render|produce|write|draft|compose|build|paint|illustrate|record|narrate|film|shoot|sketch|craft|prepare|put together|whip up|come up with|give me|get me|mock up)\s+(?:me\s+|us\s+)?/i,
  /^(?:a|an|the|some|a few|a couple of)\s+/i,
]

/** "image of …", "slides on …", "a video about …" — the container noun before the actual subject. */
const CONTAINER =
  /^(?:images?|pictures?|photos?|illustrations?|videos?|clips?|slides?|slide ?decks?|decks?|presentations?|slideshows?|voice[- ]?overs?|narrations?|podcasts?|audio(?: clips?)?|recordings?|renders?)\s+(?:of|about|on|showing|depicting|explaining|covering|featuring|with|that shows|that explains)\s+/i

const BARE_KIND =
  /^(?:images?|pictures?|photos?|illustrations?|videos?|clips?|slides?|slide ?decks?|decks?|presentations?|voice[- ]?overs?|narrations?|podcasts?|audio(?: clips?)?|recordings?|copy|documents?|docs?|logos?|something|one|it)$/i

/** Phrases that contain a kind word without asking for that kind ("in our brand voice"). */
const NOT_A_KIND = /\b(?:brand voice|tone of voice|voice and tone|voice guide)\b/gi

function earliestCue(text: string): { kind: AssetKind; cue: string } | undefined {
  const scan = text.replace(NOT_A_KIND, (m) => ' '.repeat(m.length))
  let best: { kind: AssetKind; cue: string; index: number } | undefined
  for (const { kind, re } of KIND_CUES) {
    const m = re.exec(scan)
    if (m && (!best || m.index < best.index)) best = { kind, cue: m[0].toLowerCase(), index: m.index }
  }
  return best && { kind: best.kind, cue: best.cue }
}

/** Remove the request lead-in so the prompt describes the subject itself. */
export function cleanCreatePrompt(text: string): string {
  const original = text.replace(/\s+/g, ' ').trim()
  let s = original
  for (let pass = 0; pass < 3; pass++) {
    const before = s
    for (const re of LEADS) s = s.replace(re, '').trimStart()
    if (s === before) break
  }
  s = s.replace(CONTAINER, '').trim().replace(/[\s.!]+$/u, '')
  // Nothing but the kind itself is left ("Make an image"): keep the request as written.
  if (s.replace(/[^\p{L}\p{N}]/gu, '').length < 2 || BARE_KIND.test(s)) s = original.replace(/[\s.!]+$/u, '')
  return capitalize(s)
}

/** Studio request → `{ kind, prompt, cue }` (image when nothing else matches). */
export function kindFromCreateText(text: string): CreateKind {
  const input = text.replace(/\s+/g, ' ').trim()
  const prompt = cleanCreatePrompt(input)
  const hit = earliestCue(input)
  if (hit) return { kind: hit.kind, prompt, cue: hit.cue }
  const verb = WRITE_VERB.exec(input.replace(/^(?:please|can you|could you)\s+/i, ''))
  if (verb) return { kind: 'document', prompt, cue: verb[0].toLowerCase() }
  return { kind: 'image', prompt }
}
