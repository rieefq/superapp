import { createRng, hashString, type Rng } from '@/lib/rng'
import type { ChatTurn } from '../types'
import { parseKnowledgeBlock, parsePromptFacts, parseUserContent, type KnowledgeDoc, type ParsedNote } from '../prompt'
import { composeBrainstorm } from './answers/brainstorm'
import { composeCode } from './answers/code'
import { attachmentNoteBlock } from './answers/common'
import { composeCompare } from './answers/compare'
import { composeExplain } from './answers/explain'
import { composeHowto } from './answers/howto'
import { composePlan } from './answers/plan'
import { composeSummarize } from './answers/summarize'
import { composeWriting } from './answers/writing'
import { evidenceTitles, gatherEvidence, relevanceStems, type EvidenceSource } from './evidence'
import { assemble, bullets, heading } from './layout'
import { reasoningTrace } from './reasoning'
import { detectShape, type RequestShape } from './shapes'
import { extractSubject } from './subject'
import { ensurePeriod, splitSentences, stripTrailingPunctuation, truncateWords } from './text'
import type { Block, ComposeContext, ComposedParts, Depth } from './types'

export interface ComposeInput {
  modelId: string
  system?: string
  messages: readonly ChatTurn[]
  /** Variation seed (e.g. derived from the run id). Same input + seed → same answer. */
  seed?: number
  /** Produce the reasoning trace (sim-deep only). Default true. */
  reasoning?: boolean
}

export interface ComposedAnswer {
  shape: RequestShape | 'greeting' | 'empty'
  /** Markdown answer. */
  content: string
  /** Short trace of how the answer was approached (sim-deep only). */
  reasoning?: string
  /** The seed actually used, for reproducibility. */
  seed: number
}

const COMPOSERS: Record<RequestShape, (ctx: ComposeContext) => ComposedParts> = {
  explain: composeExplain,
  howto: composeHowto,
  compare: composeCompare,
  brainstorm: composeBrainstorm,
  write: composeWriting,
  code: composeCode,
  summarize: composeSummarize,
  plan: composePlan,
}

/** Plain text of a turn; image parts become attachment notes. */
function readTurn(turn: ChatTurn | undefined): { content: string; images: number } {
  if (!turn) return { content: '', images: 0 }
  if (typeof turn.content === 'string') return { content: turn.content, images: 0 }
  let images = 0
  const text = turn.content
    .map((p) => {
      if (p.type === 'text') return p.text
      images++
      return ''
    })
    .join('\n')
  return { content: text, images }
}

const GREETING = /^(?:hi|hello|hey|yo|hiya|thanks|thank you|thx|cheers|good (?:morning|afternoon|evening)|ok(?:ay)?|cool|great)(?:[\s,]+(?:there|atrium|again|so much|a lot))?[\s!.,]*$/i

function greetingReply(text: string, rng: Rng, name?: string): string {
  const first = name?.split(/\s+/)[0]
  if (/^(?:thanks|thank you|thx|cheers)/i.test(text.trim())) {
    return rng.pick(['You’re welcome. Anything else you want to dig into?', 'Glad it helped. What’s next?'])
  }
  return rng.pick([
    `Hi${first ? ` ${first}` : ''}. What would you like to work on? I can explain, summarize, compare options, plan, draft writing or write code — and I'll pull from your knowledge base when it's relevant.`,
    `Hello${first ? ` ${first}` : ''}. Tell me what you're working on and I'll help — drafts, plans, comparisons, summaries or code.`,
  ])
}

const CLARIFY: Partial<Record<RequestShape, string[]>> = {
  code: [
    "What should the code do, and in which language? Give me the inputs and the expected output and I'll write it — with tests if you like.",
    'Happy to write it. What should it do, which language are you using, and are there edge cases I should handle?',
  ],
  compare: [
    'What would you like to compare? Name the options (for example “Postgres vs MongoDB for event storage”) and what matters most to you.',
  ],
  write: ["What should I draft — an email, a post, a memo? Tell me who it's for and the one thing it needs to say."],
  plan: ["What's the plan for? Tell me the goal and the timeline, and I'll sketch the phases."],
  brainstorm: ["Ideas for what? Give me the topic and any constraints (budget, audience, timing) and I'll go wide."],
}

/** Short clarifying question for requests too vague to answer without guessing. */
function clarifyingQuestion(shape: RequestShape, rng: Rng): string {
  return rng.pick(
    CLARIFY[shape] ?? [
      "Could you say a bit more? Tell me what you're trying to figure out or decide, and what a good answer would help you do.",
      "I'm not sure what you're asking yet. Add a little context — the topic, and what you need it for — and I'll take it from there.",
    ],
  )
}

/**
 * Retrieved or pinned passages that share no keywords with the request: cite them honestly
 * as possibly related instead of presenting them as support for the answer.
 */
function relatedDocsBlock(docs: readonly KnowledgeDoc[]): Block | undefined {
  if (!docs.length) return undefined
  const lines = docs.slice(0, 3).map((d) => {
    const first = splitSentences(d.passage)[0] ?? d.passage
    return `*${d.title}* — “${ensurePeriod(stripTrailingPunctuation(truncateWords(first, 20)))}” [${d.index}]`
  })
  return {
    md: `${heading('Possibly related in your workspace')}These came up as context but don't address the question directly, so I haven't leaned on them:\n\n${bullets(lines)}`,
    priority: 2,
  }
}

/**
 * Compose a complete simulated answer for the last user turn. Deterministic for a given
 * input and seed; grounded only in the request, its attachments and the knowledge passages
 * in the system prompt.
 */
export function composeAnswer(input: ComposeInput): ComposedAnswer {
  const depth: Depth = input.modelId === 'sim-deep' ? 'deep' : 'swift'
  const turns = input.messages
  let lastUser = -1
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'user') { lastUser = i; break }
  const { content, images } = readTurn(turns[lastUser])
  const parsed = parseUserContent(content)
  const notes: ParsedNote[] = [...parsed.notes, ...Array.from({ length: images }, (_, i) => ({ name: images > 1 ? `image ${i + 1}` : 'the image', kind: 'image' as const }))]
  const docs = parseKnowledgeBlock(input.system)
  const facts = parsePromptFacts(input.system)

  const promptKey = `${input.modelId}\n${input.system ?? ''}\n${content}`
  const seed = input.seed === undefined ? hashString(promptKey) : hashString(`${promptKey}#${input.seed}`)
  const rng = createRng(seed)

  const typed = parsed.text.trim()
  if (!typed && !parsed.files.length && !notes.length) {
    return { shape: 'empty', content: 'It looks like the message was empty — what would you like to work on?', seed }
  }
  if (typed && !parsed.files.length && !notes.length && GREETING.test(typed)) {
    return { shape: 'greeting', content: greetingReply(typed, rng, facts.userName), seed }
  }

  const text = typed || (parsed.files.length ? `Summarize ${parsed.files.map((f) => f.name).join(', ')}` : 'What can you tell from the attachment?')
  const { shape } = detectShape(text, { hasFiles: parsed.files.length > 0 })
  if (shape !== 'summarize' && !parsed.files.length && !notes.length && relevanceStems(text).size === 0) {
    return { shape, content: clarifyingQuestion(shape, rng), seed }
  }
  const sources: EvidenceSource[] = [
    ...docs.map((d) => ({ index: d.index, title: d.title, text: d.passage, source: 'knowledge' as const })),
    ...parsed.files.map((f) => ({ index: 0, title: f.name, text: f.text, source: 'file' as const })),
  ]
  const evidence = gatherEvidence(sources, text, { perSource: depth === 'deep' ? 2 : 1, max: depth === 'deep' ? 5 : 3 })

  const ctx: ComposeContext = {
    text,
    subject: extractSubject(text),
    rng,
    depth,
    docs,
    evidence,
    files: parsed.files,
    notes,
    facts,
    history: turns.slice(0, Math.max(0, lastUser)),
  }
  const parts = COMPOSERS[shape](ctx)
  const note = attachmentNoteBlock(ctx)
  if (note) parts.blocks.splice(Math.min(1, parts.blocks.length), 0, note)
  const knowledgeUsed = evidence.some((e) => e.source === 'knowledge')
  const related = !knowledgeUsed && shape !== 'summarize' ? relatedDocsBlock(docs) : undefined
  if (related) {
    const closing = parts.blocks.findIndex((b) => b.closing)
    parts.blocks.splice(closing === -1 ? parts.blocks.length : closing, 0, related)
  }
  const answer = assemble(parts, depth)

  const reasoning =
    depth === 'deep' && input.reasoning !== false
      ? reasoningTrace(
          {
            shape,
            approach: parts.approach,
            docTitles: evidenceTitles(evidence.filter((e) => e.source === 'knowledge')),
            docCount: docs.length,
            unmatchedDocs: knowledgeUsed ? 0 : docs.length,
            fileNames: parsed.files.map((f) => f.name),
            imageNames: notes.filter((n) => n.kind === 'image').map((n) => n.name),
          },
          rng,
        )
      : undefined

  return { shape, content: answer, reasoning, seed }
}
