import type { Block, ComposeContext } from '../types'
import { citeSentence, type Evidence } from '../evidence'
import { bullets, heading } from '../layout'
import { capitalize } from '../text'

/** The subject as a noun phrase for prose, or a neutral fallback for question-shaped requests. */
export function topicOf(ctx: ComposeContext, fallback = 'this'): string {
  return ctx.subject.kind === 'question' ? fallback : ctx.subject.np
}

/** "## What your sources say" with attributed, cited sentences. */
export function sourcesBlock(ctx: ComposeContext, evidence: readonly Evidence[], title = 'What your sources say'): Block | undefined {
  if (!evidence.length) return undefined
  return { md: heading(title) + bullets(evidence.map((e) => citeSentence(e, ctx.rng))), priority: Infinity }
}

/** Honest note when nothing in the workspace grounds the answer. */
export function noSourcesBlock(ctx: ComposeContext, what = 'a framework'): Block | undefined {
  if (ctx.evidence.length) return undefined
  const md = ctx.rng.pick([
    `I didn't find anything in your workspace on this, so treat the above as ${what} rather than verified facts. Pin a doc to this conversation or add one to Knowledge and I'll ground the answer in it.`,
    `Nothing in your knowledge base covers this yet, so I've kept to ${what} instead of asserting specifics I can't verify. Attach or pin a source and I'll work from it.`,
    `This isn't grounded in your documents — none matched — so read it as ${what}, not as fact. If you have notes on this, pin them and ask again.`,
  ])
  return { md: `_${md}_`, priority: Infinity }
}

/** Offer to continue in Atrium (tasks, briefs, plans), mentioning the project when there is one. */
export function closingOffer(ctx: ComposeContext, offers: readonly string[]): Block {
  const project = ctx.facts.projectName
  const offer = ctx.rng.pick(offers).replace('{project}', project ? ` in *${project}*` : '')
  return { md: offer, priority: 1, closing: true }
}

/** Acknowledge images and unreadable files by name (the simulator cannot see them). */
export function attachmentNoteBlock(ctx: ComposeContext): Block | undefined {
  if (!ctx.notes.length) return undefined
  const images = ctx.notes.filter((n) => n.kind === 'image').map((n) => `**${n.name}**`)
  const files = ctx.notes.filter((n) => n.kind === 'file').map((n) => `**${n.name}**`)
  const parts: string[] = []
  if (images.length) {
    parts.push(
      `I can see you attached ${images.join(', ')}, but the local simulator can't view images. Describe what's in ${images.length > 1 ? 'them' : 'it'}, or switch to a vision-capable model, and I'll work with ${images.length > 1 ? 'them' : 'it'}.`,
    )
  }
  if (files.length) parts.push(`I couldn't read the contents of ${files.join(', ')}, so I've left ${files.length > 1 ? 'them' : 'it'} out.`)
  return { md: `_${parts.join(' ')}_`, priority: Infinity }
}

/** Pick `n` distinct items in a seeded order. */
export function take<T>(ctx: ComposeContext, items: readonly T[], n: number): T[] {
  return ctx.rng.shuffle(items).slice(0, Math.max(0, n))
}

/** Bold lead-in + text: "**Purpose** — what problem it solves." */
export const lead = (title: string, text: string): string => `**${title}** — ${text}`

export const sentence = (text: string): string => capitalize(text.trim())
