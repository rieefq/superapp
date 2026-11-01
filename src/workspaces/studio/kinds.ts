import { AudioLines, Clapperboard, FileText, Image, Presentation, type LucideIcon } from 'lucide-react'
import { IMAGE_ASPECTS, VIDEO_ASPECTS, VOICES } from '@/core/sim/studio'
import type { AssetKind } from '@/core/types'

/**
 * Studio's vocabulary per asset kind (labels match the Start sheet: Image · Video · Deck · Doc, plus Audio),
 * the generation params each kind offers, and example prompts for empty boards.
 */

export interface KindInfo {
  label: string
  plural: string
  icon: LucideIcon
  /** What the generator is called in this build. */
  generator: string
  /** Its short name for tile captions. */
  short: string
  /** The honest one-liner for a simulated output of this kind (§8.4). */
  simulatedLine: string
  placeholder: string
  iteratePlaceholder: string
  examples: string[]
}

export const KIND_ORDER: readonly AssetKind[] = ['image', 'video', 'presentation', 'document', 'audio']

export const KINDS: Record<AssetKind, KindInfo> = {
  image: {
    label: 'Image',
    plural: 'Images',
    icon: Image,
    generator: 'Procedural preview',
    short: 'Procedural',
    simulatedLine: 'Simulated preview — no image model was called',
    placeholder: 'Describe an image — subject, mood, colors…',
    iteratePlaceholder: 'Make the sky warmer…',
    examples: ['Quiet harbor at dawn, soft teal and coral, wide hero banner', 'Isometric freight yard at night, navy and amber', 'Abstract pattern of route lines in sand and navy'],
  },
  video: {
    label: 'Video',
    plural: 'Video',
    icon: Clapperboard,
    generator: 'Procedural storyboard',
    short: 'Storyboard',
    simulatedLine: 'Simulated preview — no video model was called',
    placeholder: 'Describe a video — the story, the shots, the feeling…',
    iteratePlaceholder: 'Make it shorter and more vertical…',
    examples: ['30-second launch teaser: a dispatcher at dawn finds the late shipment', 'Product walkthrough of carrier scorecards, calm and clear'],
  },
  presentation: {
    label: 'Deck',
    plural: 'Decks',
    icon: Presentation,
    generator: 'Studio writer',
    short: 'Studio writer',
    simulatedLine: 'Simulated draft — written by the local simulator, no model was called',
    placeholder: 'Describe a deck — audience, goal, the story…',
    iteratePlaceholder: 'Make it more executive and add a slide about pricing…',
    examples: ['Board update on the analytics launch: progress, risks, the ask', 'Onboarding deck for new support agents'],
  },
  document: {
    label: 'Doc',
    plural: 'Docs',
    icon: FileText,
    generator: 'Studio writer',
    short: 'Studio writer',
    simulatedLine: 'Simulated draft — written by the local simulator, no model was called',
    placeholder: 'Describe the copy — what, for whom, which format…',
    iteratePlaceholder: 'Shorter, and turn it into an email…',
    examples: ['Landing page hero copy for shipment analytics', 'Launch email to existing customers', 'Three LinkedIn posts for launch week'],
  },
  audio: {
    label: 'Audio',
    plural: 'Audio',
    icon: AudioLines,
    generator: 'Script only',
    short: 'Script',
    simulatedLine: 'Simulated narration — a script was written, no audio was synthesized',
    placeholder: 'Describe the narration — topic, voice, length…',
    iteratePlaceholder: 'Calmer voice, a little longer…',
    examples: ['Calm 45-second narration for the onboarding walkthrough', 'Upbeat voice-over for the launch teaser'],
  },
}

export interface Option<T extends string = string> {
  value: T
  label: string
}

export const ASPECT_OPTIONS: Record<'image' | 'video', readonly Option[]> = {
  image: IMAGE_ASPECTS.map((a) => ({ value: a, label: a })),
  video: VIDEO_ASPECTS.map((a) => ({ value: a, label: a })),
}

export const STYLE_OPTIONS: readonly Option[] = [
  { value: 'photographic', label: 'Photo' },
  { value: 'illustration', label: 'Illustration' },
  { value: '3d', label: '3D' },
  { value: 'abstract', label: 'Abstract' },
  { value: 'editorial', label: 'Editorial' },
]

export const TONE_OPTIONS: readonly Option[] = [
  { value: 'clear', label: 'Clear' },
  { value: 'executive', label: 'Executive' },
  { value: 'energetic', label: 'Energetic' },
  { value: 'instructive', label: 'Instructive' },
  { value: 'playful', label: 'Playful' },
]

export const FORMAT_OPTIONS: readonly Option[] = [
  { value: 'landing', label: 'Landing page' },
  { value: 'blog', label: 'Blog post' },
  { value: 'email', label: 'Email' },
  { value: 'social', label: 'Social posts' },
]

export const VOICE_OPTIONS: readonly Option[] = VOICES.map((v) => ({ value: v, label: v }))

export const VIDEO_DURATIONS: readonly Option[] = ['15', '30', '45', '60'].map((s) => ({ value: s, label: `${s} s` }))
export const AUDIO_DURATIONS: readonly Option[] = ['30', '45', '60', '90'].map((s) => ({ value: s, label: `${s} s` }))
export const SLIDE_COUNTS: readonly Option[] = ['6', '7', '8', '9', '10'].map((n) => ({ value: n, label: `${n} slides` }))

/** Human labels for stored params, in the order the Inspector lists them. */
export const PARAM_LABELS: Record<string, string> = {
  aspect: 'Aspect',
  style: 'Style',
  durationSec: 'Duration',
  shots: 'Shots',
  slideCount: 'Slides',
  tone: 'Tone',
  format: 'Format',
  voice: 'Voice',
  takes: 'Takes',
  length: 'Length',
}

/** A stored param value, for display ("45 s", "Landing page", "3D"). */
export function paramDisplay(key: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return undefined
  const v = String(value)
  if (key === 'durationSec') return `${v} s`
  if (key === 'format') return FORMAT_OPTIONS.find((o) => o.value === v)?.label ?? v
  if (key === 'style') return STYLE_OPTIONS.find((o) => o.value === v)?.label ?? v
  if (key === 'tone') return TONE_OPTIONS.find((o) => o.value === v)?.label ?? v.charAt(0).toUpperCase() + v.slice(1)
  if (key === 'length') return v === '-1' ? 'Shorter' : v === '1' ? 'Longer' : undefined
  return v
}
