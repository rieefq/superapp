import type { Rng } from '@/lib/rng'
import type { ApproachNotes } from './types'
import type { RequestShape } from './shapes'
import { joinList } from './text'

export interface ReasoningInput {
  shape: RequestShape
  approach: ApproachNotes
  /** Titles of knowledge docs the answer draws on. */
  docTitles: string[]
  docCount: number
  fileNames: string[]
  imageNames: string[]
}

const SHAPE_READ: Record<RequestShape, string> = {
  explain: 'an explanation',
  howto: 'a practical how-to',
  compare: 'a comparison',
  brainstorm: 'a request for options',
  write: 'a writing task',
  code: 'a code request',
  summarize: 'a summarization task',
  plan: 'a planning request',
}

/** A short, honest trace (3–5 sentences) of how the simulator built its answer. */
export function reasoningTrace(input: ReasoningInput, rng: Rng): string {
  const sentences: string[] = []
  sentences.push(
    rng.pick([
      `This reads as ${SHAPE_READ[input.shape]}, so ${input.approach.format} fits best.`,
      `The request is ${SHAPE_READ[input.shape]}; ${input.approach.format} is the clearest shape for it.`,
    ]),
  )
  if (input.fileNames.length) {
    sentences.push(`The attached ${input.fileNames.length > 1 ? 'files' : 'file'} (${joinList(input.fileNames)}) ${input.fileNames.length > 1 ? 'are' : 'is'} the primary material, so I'll stay close to ${input.fileNames.length > 1 ? 'their' : 'its'} actual wording.`)
  }
  if (input.docTitles.length) {
    const named = input.docTitles.slice(0, 2).map((t) => `“${t}”`)
    sentences.push(
      rng.pick([
        `${input.docCount} knowledge passage${input.docCount === 1 ? '' : 's'} came back as relevant — mainly ${joinList(named)} — so I'll anchor on what they actually say and cite them inline.`,
        `Retrieval surfaced ${joinList(named)}${input.docCount > 2 ? ' among others' : ''}; I'll quote those passages rather than paraphrase loosely, with [n] citations.`,
      ]),
    )
  } else if (!input.fileNames.length && input.shape !== 'code') {
    sentences.push(
      rng.pick([
        "Nothing in the workspace knowledge matches, so I'll stay with structure and next steps instead of asserting specifics I can't verify.",
        "There's no source material to ground this in, so I'll avoid specific facts and numbers and keep to a framework.",
      ]),
    )
  }
  if (input.imageNames.length) {
    sentences.push(`I can't view the attached image${input.imageNames.length > 1 ? 's' : ''}, so I'll say so plainly rather than guess at the contents.`)
  }
  sentences.push(`Plan: ${input.approach.structure}.`)
  if (sentences.length < 4) {
    sentences.push(rng.pick(['Anything I would otherwise have to guess stays a placeholder or a question.', 'I will close with a concrete next step.']))
  }
  return sentences.slice(0, 5).join(' ')
}
