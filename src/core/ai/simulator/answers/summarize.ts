import type { Block, ComposeContext, ComposedParts } from '../types'
import { parseUserContent } from '../../prompt'
import { bullets, heading } from '../layout'
import { ensurePeriod, stem, splitSentences, STOPWORDS, truncateWords, words } from '../text'
import { closingOffer } from './common'

export interface ExtractiveSummary {
  /** Sentences picked for the summary, in original order. */
  picked: string[]
  actions: string[]
  questions: string[]
  total: number
}

const ACTION_RE = /\b(will|should|need(?:s)? to|must|action item|todo|to-do|next step|owner|by (?:mon|tue|wed|thu|fri|sat|sun)\w*|deadline|follow up|decide|assign(?:ed)?)\b/i

/**
 * Extractive summary: scores sentences by the frequency of their content words across the
 * document (plus a small lead bias) and keeps the best ones in original order. Every output
 * sentence is a real sentence from the input.
 */
export function extractiveSummary(text: string, keep: number): ExtractiveSummary {
  const sentences = splitSentences(text)
  const freq = new Map<string, number>()
  for (const s of sentences) {
    for (const w of new Set(words(s).filter((x) => x.length > 2 && !STOPWORDS.has(x)).map(stem))) {
      freq.set(w, (freq.get(w) ?? 0) + 1)
    }
  }
  const scored = sentences.map((s, i) => {
    const ws = words(s).filter((x) => x.length > 2 && !STOPWORDS.has(x)).map(stem)
    const content = ws.reduce((n, w) => n + (freq.get(w) ?? 0), 0)
    const lead = i === 0 ? 1.5 : i < 3 ? 0.5 : 0
    return { s, i, score: content / Math.sqrt(Math.max(ws.length, 4)) + lead }
  })
  const picked = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, keep)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
  const pickedSet = new Set(picked)
  const actions = sentences.filter((s) => !pickedSet.has(s) && !s.trim().endsWith('?') && ACTION_RE.test(s)).slice(0, 4)
  const questions = sentences.filter((s) => s.trim().endsWith('?') && !pickedSet.has(s)).slice(0, 3)
  return { picked, actions, questions, total: sentences.length }
}

interface Source {
  name: string
  text: string
}

const CONVERSATION_RE = /\b(conversation|chat|thread|discussion|above|so far)\b/i
const PREVIOUS_RE = /\b(previous|last|your) (?:answer|reply|response|message)\b|\b(?:that|it)\b/i

function findSource(ctx: ComposeContext): Source | undefined {
  if (ctx.files.length) {
    return { name: ctx.files.map((f) => f.name).join(', '), text: ctx.files.map((f) => f.text).join('\n\n') }
  }
  const firstBreak = ctx.text.search(/\n/)
  const colon = ctx.text.indexOf(':')
  if (colon > 0 && colon < 80 && ctx.text.length - colon > 200) return { name: 'the text you pasted', text: ctx.text.slice(colon + 1) }
  if (firstBreak > 0 && ctx.text.length - firstBreak > 200) return { name: 'the text you pasted', text: ctx.text.slice(firstBreak + 1) }

  const turns = ctx.history.map((t) => ({ role: t.role, text: typeof t.content === 'string' ? parseUserContent(t.content).text : t.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n') }))
  if (turns.length && CONVERSATION_RE.test(ctx.text)) {
    return { name: 'this conversation', text: turns.map((t) => t.text).join('\n\n') }
  }
  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')
  if (lastAssistant && ctx.text.split(/\s+/).length <= 12 && PREVIOUS_RE.test(ctx.text)) {
    return { name: 'my previous answer', text: lastAssistant.text }
  }
  return undefined
}

export function composeSummarize(ctx: ComposeContext): ComposedParts {
  const { rng, depth, docs } = ctx
  const deep = depth === 'deep'
  const blocks: Block[] = []
  const source = findSource(ctx)

  if (!source && docs.length) {
    blocks.push({ md: rng.pick(["Here's what the relevant documents in your workspace say:", 'Summarizing the matching documents from your knowledge base:']), priority: Infinity })
    for (const doc of docs.slice(0, deep ? 4 : 3)) {
      const { picked } = extractiveSummary(doc.passage, deep ? 3 : 2)
      if (!picked.length) continue
      blocks.push({ md: `**${doc.title}** [${doc.index}]\n\n${bullets(picked.map((s) => `${ensurePeriod(truncateWords(s, 40))} [${doc.index}]`))}`, priority: Infinity })
    }
    blocks.push({ md: '_Extractive summary: every point is a sentence from the cited passage, lightly trimmed._', priority: 2 })
    blocks.push(closingOffer(ctx, ['Want me to pull these into a single brief{project}?', 'I can turn these into tasks{project} if any need action.']))
    return { blocks, noPadding: true, approach: { format: 'a per-document extractive summary', structure: 'keep each point traceable to its document', material: 'the matching knowledge passages' } }
  }

  if (!source) {
    blocks.push({
      md: "I don't see any text to summarize yet. Paste it after your request (for example “Summarize this: …”), attach a file, or pin a document to this conversation and ask again.",
      priority: Infinity,
    })
    return { blocks, noPadding: true, approach: { format: 'a request for the source text', structure: 'ask for the material instead of inventing a summary' } }
  }

  const sentenceCount = splitSentences(source.text).length
  const keep = Math.max(2, Math.min(deep ? 7 : 4, Math.round(sentenceCount * 0.35)))
  const summary = extractiveSummary(source.text, keep)
  if (!summary.picked.length) {
    blocks.push({ md: `${source.name} is too short to summarize meaningfully — it's already the summary.`, priority: Infinity })
    return { blocks, noPadding: true, approach: { format: 'a short note', structure: 'avoid padding a short text' } }
  }

  const [lead, ...rest] = summary.picked
  blocks.push({ md: `Here's a summary of **${source.name}** (${summary.total} sentences, condensed to ${summary.picked.length}).`, priority: Infinity })
  blocks.push({ md: `**TL;DR:** ${ensurePeriod(truncateWords(lead, 45))}`, priority: Infinity })
  if (rest.length) blocks.push({ md: heading('Key points') + bullets(rest.map((s) => ensurePeriod(truncateWords(s, 40)))), priority: Infinity })
  if (summary.actions.length) blocks.push({ md: heading('Action items') + bullets(summary.actions.map((s) => ensurePeriod(truncateWords(s, 35)))), priority: 3 })
  if (deep && summary.questions.length) blocks.push({ md: heading('Open questions') + bullets(summary.questions.map((s) => truncateWords(s, 35))), priority: 2 })
  blocks.push({ md: '_Extractive summary: the sentences come from the original, lightly trimmed. Nothing has been added._', priority: 2 })
  if (summary.actions.length) blocks.push(closingOffer(ctx, ['Want me to turn the action items into tasks{project}?']))

  return {
    blocks,
    noPadding: true,
    approach: { format: `an extractive summary of ${source.name}`, structure: 'lead with the single most central sentence, then key points and action items', material: source.name },
  }
}
