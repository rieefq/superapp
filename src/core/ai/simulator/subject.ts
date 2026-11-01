import { collapse, gerund, keywords, stripTrailingPunctuation, swapPerson } from './text'

/**
 * What the user is asking about, restated in forms the templates can safely insert:
 * - `thing`:    "What is a vector database?"      → np "a vector database"
 * - `action`:   "How do I set up SSO for our app?" → vp "set up SSO for your app", np "setting up SSO for your app"
 * - `question`: "Why does churn spike in Q4?"      → np "why churn spikes in Q4" (only used in quotes/headings)
 */
export type SubjectKind = 'thing' | 'action' | 'question'

export interface Subject {
  kind: SubjectKind
  /** Noun phrase usable after "about"/"for". */
  np: string
  /** Verb phrase (imperative) when the request is an action. */
  vp?: string
  /** The cleaned request, pronouns swapped to second person. */
  phrase: string
  keywords: string[]
}

const LEAD_INS: RegExp[] = [
  /^(?:hey|hi|hello|ok(?:ay)?|so|quick question|question)\b[\s,!.:-]*/i,
  /^(?:please|pls|kindly)\b[\s,]*/i,
  /^(?:can|could|would|will) you(?: please)?(?: help me)?\s+/i,
  /^(?:i(?:'d| would) like(?: you)? to|i (?:need|want)(?: you)? to|help me(?: to)?|let's|lets|we need to|i(?:'m| am) trying to|i have to)\s+/i,
  /^(?:i need|i want|i'd like|give me|get me|show me|send me|find me|give us|show us)\s+/i,
]

/** Verbs that open an instruction ("draft a memo …"). The object becomes the noun phrase. */
const INSTRUCTION_VERBS =
  /^(write|draft|compose|create|make|build|generate|design|prepare|put together|come up with|suggest|list|brainstorm|summari[sz]e|compare|plan|outline|explain|describe|define|review|analy[sz]e|improve|rewrite|refactor|implement|fix|find|recommend|propose|estimate|calculate|organi[sz]e|sketch|map out|break down|turn|convert)\b\s*/i

function stripLeadIns(text: string): string {
  let out = text
  for (let pass = 0; pass < 4; pass++) {
    const before = out
    for (const re of LEAD_INS) out = out.replace(re, '')
    if (out === before) break
  }
  return out
}

/** The first clause of the request (before a colon introducing pasted content, or the first line). */
function requestClause(text: string): string {
  const firstLine = text.trim().split(/\n/)[0] ?? ''
  const colon = firstLine.indexOf(':')
  const clause = colon > 8 && firstLine.length - colon > 40 ? firstLine.slice(0, colon) : firstLine
  const sentence = /^(.{12,}?[?.!])(\s|$)/.exec(clause)?.[1] ?? clause
  return collapse(sentence).slice(0, 240)
}

function capWords(text: string, max: number): string {
  const parts = text.split(/\s+/)
  if (parts.length <= max) return text
  let cut = parts.slice(0, max).join(' ')
  // Prefer ending at a clause boundary when one exists in the kept words.
  const boundary = cut.search(/,\s|\s(?:so that|because|which|where|while)\s/)
  if (boundary > 20) cut = cut.slice(0, boundary)
  return cut.replace(/\s+(?:a|an|the|of|for|to|and|or|with|in|on|at|by|from|that|which)$/i, '')
}

const AUX = '(?:do|does|did|is|are|was|were|can|could|should|would|will|has|have)'

export function extractSubject(text: string): Subject {
  const clause = stripTrailingPunctuation(stripLeadIns(requestClause(text)))
  const phrase = swapPerson(clause)
  const kw = keywords(phrase)
  let m: RegExpExecArray | null

  // "how does X work" → "how X works"
  if ((m = /^how (?:does|do) (.+?) work\b(.*)$/i.exec(phrase))) {
    return mk('question', `how ${m[1]} ${/\b(?:they|these|those|you)\b$/i.test(m[1]) ? 'work' : 'works'}${m[2]}`)
  }
  // "how do I X" / "how to X" / "best way to X" / "steps to X" → action
  if (
    (m = /^how (?:do|can|should|would|could|might) (?:i|you|one|someone)\s+(.+)$/i.exec(phrase)) ||
    (m = /^how (?:to|best to)\s+(.+)$/i.exec(phrase)) ||
    (m = /^(?:what(?:'s| is) (?:the|a) (?:best|right|good|easiest|fastest|simplest) way to|(?:the )?best way to|steps to|walk (?:you|me) through(?: how to)?|guide (?:to|for))\s+(.+)$/i.exec(
      phrase,
    ))
  ) {
    const vp = capWords(m[1], 12)
    return { kind: 'action', vp, np: gerund(vp), phrase, keywords: kw }
  }
  // "what is X" / "who are X" → thing
  if ((m = new RegExp(`^(?:what|who|which)(?:'s| ${AUX})\\s+(.+)$`, 'i').exec(phrase))) {
    return mk('thing', m[1])
  }
  // "why does X" / "when should X" / yes-no questions → question
  if (/^(?:why|when|where|whether)\b/i.test(phrase) || new RegExp(`^${AUX}\\b`, 'i').test(phrase)) {
    return mk('question', phrase.charAt(0).toLowerCase() + phrase.slice(1))
  }
  // "explain X" / "tell you about X" / "overview of X"
  if ((m = /^(?:explain|describe|define|tell you about|give you an overview of|an overview of|overview of|teach you|understand)\s+(.+)$/i.exec(phrase))) {
    return mk('thing', m[1])
  }
  // Instructions: "draft a launch email for Lumen" → np "a launch email for Lumen"
  if ((m = INSTRUCTION_VERBS.exec(phrase))) {
    const object = phrase.slice(m[0].length).trim()
    if (object) {
      const vp = capWords(phrase.charAt(0).toLowerCase() + phrase.slice(1), 14)
      return { kind: 'action', vp, np: capWords(object, 12), phrase, keywords: kw }
    }
  }
  return mk('thing', phrase)

  function mk(kind: SubjectKind, np: string): Subject {
    return { kind, np: capWords(np.trim() || 'this', 12), phrase, keywords: kw }
  }
}
