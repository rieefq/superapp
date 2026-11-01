import { extractSchedule, scheduleToCron, suggestTitle } from '@/core/ai/intent'
import { getIntegration } from '@/core/integrations/catalog'
import type { Capability, ID, Priority, WorkflowEdge, WorkflowNode, WorkflowTrigger } from '@/core/types'
import { pickAgentForInstruction } from './agents'
import { capitalize, clip, joinList, labelize, lowerFirst, quoted, shortHash, trimTail } from './text'
import { describeTrigger } from './triggers'
import type { WorkflowDraft, WorkflowDraftContext } from './types'

/**
 * Free text → workflow graph, by rules (no model call):
 * - trigger: an event phrase ("when a new email / PR / issue / Slack message …") → event trigger;
 *   otherwise a recurring schedule phrase (extractSchedule + scheduleToCron) → schedule; else manual.
 * - steps, in the order written: summarize/analyze/draft/research… → agent step (pickAgentForInstruction);
 *   "if / when … is urgent / high / mentions …" → condition with true and false branches ("otherwise …");
 *   post / send / email → messages.send action via Slack or Gmail; "create a ticket / issue" → tasks.manage
 *   action via Linear or Jira ("create a task" → an Atrium task output); "save to knowledge / notes" →
 *   knowledge output; "ask me / approve / review before …" → approval step; "wait 2 hours" → delay.
 * - a final "Notify me" output is added when the draft has no output.
 * Layout: columns every 280px left → right, lanes every 150px; condition "false" branches sit one lane down.
 */

export const DRAFT_LAYOUT = { columnWidth: 280, laneHeight: 150 } as const

// ---------------------------------------------------------------- internal model

interface NodeSpec {
  type: WorkflowNode['type']
  label: string
  config: Record<string, unknown>
  integrationId?: string
  agentId?: ID
  capability?: Capability
  /** Explanations shown with the draft, emitted only when the step makes it into the graph. */
  notes?: string[]
  /** Internal: added by "ask me before sending"; an explicit step of the same kind replaces it. */
  implied?: boolean
  /** Internal: an approval written after its step ("…, but ask me first") moves in front of it. */
  guardsPrevious?: boolean
  /** Internal: a summary-writing agent step that is redundant right after another agent step. */
  optionalAfterAgent?: boolean
  /** Internal: approval label still generic; renamed after the step it guards. */
  autoLabel?: boolean
  /** Internal: the clause the step came from (used for the workflow name). */
  source?: string
}

interface CondStep {
  type: 'condition'
  spec: NodeSpec
  whenTrue: NodeSpec[]
  whenFalse: NodeSpec[]
  /** The false branch ends the run (trigger filters such as "when an urgent email arrives"). */
  falseTerminal?: boolean
}

interface NodeStep {
  type: 'node'
  spec: NodeSpec
}

type Step = NodeStep | CondStep

type Branch = 'true' | 'false'

interface OpenCondition {
  step: CondStep
  primary: Branch
  branch: Branch
  sentence: number
}

type Sep = 'start' | 'comma' | 'and' | 'then' | 'finally' | 'or'

interface Clause {
  text: string
  sep: Sep
  sentence: number
}

interface Env {
  ctx: WorkflowDraftContext
  fullText: string
  /** Pronoun replacement for the trigger's object: "summarize it" → "summarize the email". */
  object?: string
  triggerIntegration?: string
  /** Draft-level notes (clauses that were skipped). */
  notes: string[]
  connected: (id: string) => boolean
}

const withNotes = (spec: NodeSpec, ...notes: Array<string | undefined>): NodeSpec => {
  const list = notes.filter((n): n is string => !!n)
  return list.length ? { ...spec, notes: [...(spec.notes ?? []), ...list] } : spec
}

function connectionNote(env: Env, id: string | undefined): string | undefined {
  if (!id) return undefined
  const def = getIntegration(id)
  if (!def || env.connected(id)) return undefined
  return `${def.name} is not connected yet; connect it in Integrations before this can run.`
}

// ---------------------------------------------------------------- trigger detection

interface EventRule {
  event: string
  integrationId?: string
  type?: 'event' | 'webhook'
  re: RegExp
  object: string
}

/** Earliest match inside the trigger clause wins; on the same position the first rule wins. */
const EVENT_RULES: readonly EventRule[] = [
  { event: 'github.pull_request.merged', integrationId: 'github', re: /\b(?:pull requests?|prs?)\b(?=[^,.;]{0,30}\bmerged\b)/i, object: 'the pull request' },
  { event: 'github.pull_request.opened', integrationId: 'github', re: /\b(?:pull requests?|prs?)\b/i, object: 'the pull request' },
  { event: 'github.issue.opened', integrationId: 'github', re: /\bgithub issues?\b|\bissues? (?:on|in) github\b/i, object: 'the issue' },
  { event: 'github.push', integrationId: 'github', re: /\b(?:someone pushes|code is pushed|pushes to|commits? (?:to|on|lands?))\b/i, object: 'the commit' },
  { event: 'jira.issue.created', integrationId: 'jira', re: /\bjira (?:issues?|tickets?)\b|\b(?:issues?|tickets?) (?:in|on) jira\b/i, object: 'the issue' },
  { event: 'linear.issue.created', integrationId: 'linear', re: /\b(?:linear )?(?:issues?|tickets?|bug reports?)\b/i, object: 'the issue' },
  { event: 'gmail.message.received', integrationId: 'gmail', re: /\b(?:e-?mails?|gmail|mail|inbox)\b|\bsupport@[\w.-]+/i, object: 'the email' },
  { event: 'slack.message.posted', integrationId: 'slack', re: /\b(?:slack(?: messages?)?|mentions? me|dms? me|messages?)\b|#[\w-]+/i, object: 'the message' },
  { event: 'meetings.transcript.ready', integrationId: 'meetings', re: /\b(?:meeting|call) (?:transcripts?|recordings?|notes?|ends?)\b|\btranscripts?\b/i, object: 'the transcript' },
  { event: 'google-drive.file.created', integrationId: 'google-drive', re: /\b(?:files?|docs?|documents?) (?:is |are )?(?:added|uploaded|created) (?:to|in) (?:google )?drive\b|\bdrive files?\b/i, object: 'the file' },
  { event: 'google-calendar.event.created', integrationId: 'google-calendar', re: /\bcalendar events?\b|\bmeetings? (?:is |are |gets? )?(?:booked|scheduled)\b/i, object: 'the event' },
  { event: 'stripe.payment.succeeded', integrationId: 'stripe', re: /\b(?:payments?|charges?|subscriptions?|refunds?|stripe)\b/i, object: 'the payment' },
  { event: 'knowledge.created', re: /\b(?:knowledge(?: items?)?|notes?|docs?) (?:is |are )?(?:added|created|saved)\b/i, object: 'the note' },
  { event: 'webhook', type: 'webhook', re: /\bwebhooks?\b|\b(?:http|post) requests?\b/i, object: 'the request' },
]

const EVENT_CUE =
  /\b(?:when(?:ever)?|every time|each time|as soon as|once|after|if (?:a|an|any) new|on (?:each|every|any|a|an) new|on new|for (?:each|every|any) new|(?:each|every|any) new)\b/gi

const EVENT_TAIL =
  /^(?:\s+(?:is|are|gets?|got|has been|have been|was|were))?\s+(?:arrives?|comes? in|lands?|received|opened|created|merged|posted|added|filed|submitted|assigned|updated|closed|reopened|mentioned|sent|uploaded|scheduled|booked|pushed|ends?|ready|starts?|succeeds?|fails?|happens?|shows? up)\b(?:\s+(?:in|to|on|from|for|at|into|by)\s+[#@\w.-]+)?/i

/** Adjectives on the trigger noun that make it a filter ("when an urgent email arrives"). */
const FILTER_WORDS = /\b(?:urgent|critical|high[- ]priority|important|negative|angry|vip|enterprise)\b/i

interface FoundEvent {
  rule: EventRule
  start: number
  end: number
  atStart: boolean
  /** "new support email" — for naming. */
  noun: string
  phrase: string
}

function findEvent(text: string): FoundEvent | undefined {
  for (const cue of text.matchAll(EVENT_CUE)) {
    const cueStart = cue.index ?? 0
    const from = cueStart + cue[0].length
    const rest = text.slice(from)
    const boundary = /[,;!?]|\.(?:\s|$)|\s(?:and then|then)\s/i.exec(rest)
    const window = rest.slice(0, boundary ? boundary.index : Math.min(rest.length, 120))
    let best: { rule: EventRule; m: RegExpExecArray } | undefined
    for (const rule of EVENT_RULES) {
      const m = rule.re.exec(window)
      if (m && (!best || m.index < best.m.index)) best = { rule, m }
    }
    if (!best) continue
    const atStart = /^\s*(?:please[\s,]*|automatically[\s,]*|always[\s,]*)?$/i.test(text.slice(0, cueStart))
    const eventEnd = best.m.index + best.m[0].length
    const tail = EVENT_TAIL.exec(window.slice(eventEnd))
    let end = from + eventEnd + (tail ? tail[0].length : 0)
    // A sentence-initial trigger clause runs to its comma ("When a new email arrives in the inbox, …").
    if (atStart && boundary && /[,;]/.test(rest.charAt(boundary.index))) end = from + boundary.index + 1
    const noun = window.slice(0, eventEnd).replace(/^\s*(?:a|an|the|any|some)\s+/i, '').trim()
    return { rule: best.rule, start: cueStart, end, atStart, noun, phrase: text.slice(cueStart, end).replace(/[,;]$/, '').trim() }
  }
  return undefined
}

const TIME_RE = /\s*\b(?:at|by|around|@)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}:\d{2}|noon|midnight)/i

// ---------------------------------------------------------------- clause splitting

const AGENT_VERBS = [
  'summari[sz]e', 'analy[sz]e', 'draft', 'write', 'research', 'review', 'classify', 'categori[sz]e', 'triage', 'prioriti[sz]e',
  'investigate', 'compare', 'translate', 'extract', 'score', 'rank', 'check', 'scan', 'monitor', 'collect', 'gather', 'compile',
  'find', 'look', 'identify', 'generate', 'create', 'make', 'produce', 'design', 'prepare', 'tag', 'label', 'evaluate', 'assess',
  'read', 'go through', 'dedupe', 'de-?duplicate', 'clean', 'update', 'pull', 'fetch', 'get', 'query', 'calculate', 'estimate',
  'draw', 'turn', 'convert', 'format', 'list', 'flag', 'route', 'enrich', 'answer', 'suggest', 'recommend', 'propose', 'outline',
  'plan', 'build', 'test', 'fix', 'run', 'organi[sz]e', 'sort', 'group', 'transcribe', 'proofread', 'edit', 'rewrite',
]
const OTHER_VERBS = [
  'post', 'send', 'notify', 'alert', 'e-?mail', 'message', 'announce', 'share', 'ping', 'dm', 'tell', 'forward', 'reply',
  'respond', 'publish', 'broadcast', 'remind', 'open', 'file', 'log', 'raise', 'submit', 'track', 'add', 'save', 'store', 'keep',
  'archive', 'record', 'put', 'append', 'jot', 'upload', 'export', 'wait', 'pause', 'hold', 'ask', 'approve', 'let', 'have',
  'confirm', 'escalate', 'assign', 'move', 'close', 'mark', 'skip', 'ignore', 'leave', 'comment',
]

const STEP_START = new RegExp(
  `^(?:(?:only\\s+)?(?:if|when|whenever|unless|in case|otherwise|else)\\b|(?:${[...AGENT_VERBS, ...OTHER_VERBS].join('|')})\\b)`,
  'i',
)
const AGENT_VERB = new RegExp(`^(?:${AGENT_VERBS.join('|')})\\b`, 'i')

const LEAD =
  /^(?:and|also|then|so|please|just|automatically|always|immediately|finally|next|afterwards|after that|first|second|third|lastly|plus|to|it should|you should|we should|i want (?:you )?to|i'd like (?:you )?to|i would like (?:you )?to|can you|could you|have (?:it|them|the agent|an agent)|make sure (?:to|you)|go ahead and|try to)\b[\s,:]*/i

function stripLead(text: string): string {
  let s = text.trim()
  for (let i = 0; i < 4; i++) {
    const next = s.replace(LEAD, '').trim()
    if (next === s) break
    s = next
  }
  return s
}

const isStepStart = (text: string) => STEP_START.test(stripLead(text))

const SEP =
  /\s*,\s*(?:(and then|and|then|but|or|so|plus|finally)\s+)?|\s+(and then|then|and|but|after that|afterwards|finally|next|plus)\s+|\s+(?=(?:otherwise|else)\b)/gi

function sepKind(word: string, comma: boolean): Sep {
  const w = word.toLowerCase()
  if (w === 'then' || w === 'and then' || w === 'after that' || w === 'afterwards' || w === 'next') return 'then'
  if (w === 'finally') return 'finally'
  if (w === 'or') return 'or'
  if (w) return 'and'
  return comma ? 'comma' : 'and'
}

/** Sentences → clauses; pieces that do not start a step ("…pricing and packaging") stay joined. */
export function splitClauses(body: string): Clause[] {
  const sentences = body
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.replace(/[.;!?]+$/, '').trim())
    .filter(Boolean)
  const out: Clause[] = []
  sentences.forEach((sentence, si) => {
    let last = 0
    let sep: Sep = 'start'
    let raw = ''
    const pieces: Array<{ text: string; sep: Sep; raw: string }> = []
    for (const m of sentence.matchAll(SEP)) {
      const index = m.index ?? 0
      pieces.push({ text: sentence.slice(last, index), sep, raw })
      sep = sepKind(m[1] ?? m[2] ?? '', m[0].includes(','))
      raw = m[0]
      last = index + m[0].length
    }
    pieces.push({ text: sentence.slice(last), sep, raw })
    for (const p of pieces) {
      const text = p.text.trim()
      if (!text) continue
      const prev = out[out.length - 1]
      if (prev && prev.sentence === si && !isStepStart(text)) prev.text = `${prev.text}${p.raw}${text}`
      else out.push({ text, sep: p.sep, sentence: si })
    }
  })
  return out
}

// ---------------------------------------------------------------- conditions

const COND_WORDS =
  /\b(?:urgent|critical|p0|p1|sev ?[12]|emergency|outage|high(?:[- ]priority)?|important|negative|angry|unhappy|upset|frustrated|complain\w*|positive|large|big|small|over|above|below|under|more than|less than|greater than|at least|at most|score|contains?|mentions?|includes?|is about|vip|enterprise|spam|fail(?:s|ed|ing)?|empty|missing|overdue|late|stale|blocked)\b|[<>]=?/i

const EMBEDDED_STEP =
  /(?:,\s*|\s+)(?:then\s+)?(?=(?:post|send|notify|alert|e-?mail|message|create|open|file|save|store|add|log|ask|escalate|assign|share|ping|forward|reply|respond|summari[sz]e|draft|write|tag|label|flag|mark|move|close|archive|wait|research|review|analy[sz]e|update|upload|publish|skip|ignore|stop|let)\b)/gi

function splitEmbeddedStep(body: string): { cond: string; rest: string } {
  for (const m of body.matchAll(EMBEDDED_STEP)) {
    const index = m.index ?? 0
    const cond = body.slice(0, index).trim()
    if (!cond || /\b(?:a|an|the|to|my|our|your|their|its|is|are|be|it|not|no)$/i.test(cond)) continue
    return { cond, rest: body.slice(index + m[0].length).trim() }
  }
  return { cond: body.trim(), rest: '' }
}

const SUBJECT =
  /^(?:it|this|that|they|one|any(?:thing|one)?|the (?:email|e-mail|message|issue|ticket|pr|pull request|request|item|result|output|summary|customer|sender|payment|file|event|change|diff))(?:['’]s|['’]re|\s+(?:is|are|was|were|has|have|looks?|seems?|gets?|comes?))?\s+/i

interface ParsedCondition {
  expression: string
  label: string
  negate: boolean
  rest: string
}

const OPS: Record<string, string> = { above: '>', over: '>', 'greater than': '>', 'at least': '>=', below: '<', under: '<', 'less than': '<', 'at most': '<=' }

function conditionFrom(cond: string): { expression: string; label: string } {
  const c = cond.toLowerCase()
  if (/\b(?:urgent|critical|p0|sev ?1|emergency|outage)\b/.test(c)) return { expression: 'priority is urgent', label: 'Urgent?' }
  if (/\b(?:high(?:[- ]priority)?|important|p1|sev ?2)\b/.test(c)) return { expression: 'priority is high or urgent', label: 'High priority?' }
  if (/\b(?:negative|angry|unhappy|upset|frustrated|complain\w*)\b/.test(c)) return { expression: 'sentiment is negative', label: 'Negative tone?' }
  const score = /\bscore\b[^\d<>]*?(>=|<=|>|<|above|over|greater than|at least|below|under|less than|at most)\s*(\d+(?:\.\d+)?)/.exec(c)
  if (score) {
    const op = OPS[score[1]] ?? score[1]
    return { expression: `score ${op} ${score[2]}`, label: `Score ${op} ${score[2]}?` }
  }
  const mention = /\b(?:mentions?|contains?|includes?|is about|talks about|says|refers to)\s+["“']?([\p{L}\p{N}#@][\p{L}\p{N}-]*)/iu.exec(cond)
  if (mention) return { expression: `subject contains "${mention[1].toLowerCase()}"`, label: `Mentions “${mention[1]}”?` }
  const plain = trimTail(cond.replace(SUBJECT, '').trim()) || cond.trim()
  return { expression: clip(cond.trim(), 80), label: `${labelize(plain, 6)}?` }
}

/** "if it's urgent, post …" / "unless it is spam" / "check whether …". Returns null for non-conditions. */
function parseCondition(text: string): ParsedCondition | { sequence: true; rest: string } | null {
  const m = /^(?:only\s+)?(if|when|whenever|unless|in case)\s+|^(?:check|see|determine|decide|find out)\s+(?:if|whether)\s+/i.exec(text)
  if (!m) return null
  const cue = (m[1] ?? 'if').toLowerCase()
  const { cond, rest } = splitEmbeddedStep(text.slice(m[0].length))
  if ((cue === 'when' || cue === 'whenever') && !COND_WORDS.test(cond)) return { sequence: true, rest }
  let negate = cue === 'unless'
  let body = cond
  const neg = /^(?:(?:it|this|that|they|one|the \w+)\s+)?(?:is not|isn't|isn’t|are not|aren't|aren’t|was not|wasn't|does not|doesn't|doesn’t|do not|don't|don’t|not)\s+/i.exec(body)
  if (neg) {
    negate = !negate
    body = body.slice(neg[0].length)
  }
  return { ...conditionFrom(body), negate, rest }
}

/** "<step> if <condition>" → the condition first, the step in its branch. */
function splitTrailingCondition(text: string): { cond: ParsedCondition; step: string } | null {
  const m = /^(.+?)\s+(?:but\s+)?(?:only\s+)?(if|unless|when(?:ever)?)\s+(.+)$/i.exec(text)
  if (!m) return null
  const lead = stripLead(m[1])
  if (!isStepStart(lead) || /^(?:if|when|whenever|unless|otherwise|else)\b/i.test(lead) || /^(?:check|see|determine|decide|find out)$/i.test(lead)) return null
  const cue = m[2].toLowerCase()
  if (cue.startsWith('when') && !COND_WORDS.test(m[3])) return null
  const parsed = parseCondition(`${cue} ${m[3]}`)
  if (!parsed || 'sequence' in parsed) return null
  return { cond: { ...parsed, rest: '' }, step: m[1] }
}

// ---------------------------------------------------------------- step builders

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, 'a few': 3, ten: 10 }

const IRREGULAR: Record<string, string> = {
  posting: 'post', posted: 'post', sending: 'send', sent: 'send', emailing: 'email', emailed: 'email', publishing: 'publish',
  published: 'publish', sharing: 'share', shared: 'share', creating: 'create', created: 'create', filing: 'file', filed: 'file',
  saving: 'save', saved: 'save', merging: 'merge', merged: 'merge', replying: 'reply', replied: 'reply', responding: 'respond',
  notifying: 'notify', announcing: 'announce', updating: 'update', closing: 'close', opening: 'open', uploading: 'upload',
  uploaded: 'upload', submitting: 'submit', forwarding: 'forward', forwarded: 'forward', messaging: 'message', alerting: 'alert',
  logging: 'log', logged: 'log', storing: 'store', stored: 'store', adding: 'add', added: 'add', escalating: 'escalate',
  assigning: 'assign', running: 'run', commenting: 'comment', leaving: 'leave',
}

function toImperative(word: string): string {
  const w = word.toLowerCase()
  return IRREGULAR[w] ?? w.replace(/ing$/, '').replace(/([^aeiou])\1$/, '$1')
}

const APPROVAL_CLAUSE =
  /^(?:ask (?:me|for (?:my |an )?(?:approval|sign-?off|ok|review))|get (?:my )?(?:approval|sign-?off|ok)|wait for (?:my )?(?:approval|sign-?off|ok|review)|let me (?:approve|review|check|see|confirm|sign off)|have me (?:approve|review|check)|check with me|confirm with me|run (?:it|this) by me|(?:i|we) (?:approve|review|sign off)|approve\b|requires? (?:my )?approval|needs? (?:my )?approval|pause for (?:my )?(?:approval|review)|for my (?:approval|review)|review (?:it |them |this |that )?(?:first|before))/i

const INLINE_APPROVAL =
  /\s*,?\s*(?:but\s+)?(?:only\s+)?(?:(?:after|once|when|if) (?:i(?:'ve| have)?|you get my) (?:approve[sd]?|reviewed?|review|signed off|sign off|ok(?:'d|ed)?)(?: it| them| that)?|with my (?:approval|ok|sign-?off)|(?:once|after|if|when) (?:it(?:'s| is| has been) )?approved|(?:after|once) approval|but ask me first)\b/i

const DELAY = /^(?:wait|pause|sleep|hold)(?:\s+for)?\s+(\d+|an?|one|two|three|four|five|six|ten|a few)\s*(minutes?|mins?|hours?|hrs?|days?)\b/i

const SUMMARY_DELIVERY =
  /^(?:send|e-?mail|post|share|give|deliver|dm|message|slack)\s+(?:(me|us|the team|everyone|[#@][\w-]+)\s+)?(?:an?|the|my|our)?\s*(?:(daily|weekly|monthly|nightly|short|quick|brief)\s+)?(summary|digest|report|recap|update|overview|list|brief|roundup|round-up|briefing)\b(.*)$/i

const KNOWLEDGE_VERB = /^(?:save|store|add|file|log|keep|archive|record|put|append|write|create|make|jot)\b/i
const KNOWLEDGE_NOUN = /\b(?:knowledge(?: base)?|notes?|wiki|library|collection|kb)\b/i
const SAVE_ONLY = /^(?:save|store|archive|record)\b/i
const FILES_DEST = /\b(?:google )?drive\b|\bs3\b|\bbucket\b/i
const TRACKER_VERB = /^(?:create|open|file|make|add|log|raise|submit|track)\b/i
const TRACKER_NOUN = /\b(?:tasks?|tickets?|issues?|to-?dos?|bugs?|cards?)\b/i
const TRACKER_NAME = /\b(?:linear|jira)\b/i
const NOTIFY_ME = /^(?:notify|alert|tell|ping|message|remind)\s+me\b|^let me know\b|^send me\b|^keep me (?:posted|updated|in the loop)\b/i
const SEND_VERB = /^(?:post|send|notify|alert|e-?mail|message|announce|share|ping|dm|tell|forward|reply|respond|publish|broadcast|slack)\b/i
const REVIEW_POST = /^(?:post|leave|add|submit|publish|share)\b.*\b(?:review|comments?)\b/i
const DELEGATE = /^(?:have|ask|get|tell|let)\s+@?([\p{L}][\p{L}\p{N}_-]*)\s+(?:to\s+)?/iu
const WHEN_DONE = /\s+(?:when|once|after)\s+(?:it(?:'s| is)\s+|that(?:'s| is)\s+|everything is\s+|they(?:'re| are)\s+)?(?:done|finished|complete|ready)\b.*$/i

function replacePronoun(text: string, object: string | undefined): string {
  return object ? text.replace(/\b(?:it|them)\b/i, object) : text
}

function notifySpec(source?: string): NodeSpec {
  return { type: 'output', label: 'Notify me', config: { kind: 'notify' }, ...(source ? { source } : {}) }
}

function approvalSpec(source: string): NodeSpec {
  return { type: 'approval', label: 'Ask me first', config: { instructions: 'Review before the workflow continues.' }, autoLabel: true, source }
}

function taskOutput(text: string, note?: string): NodeSpec {
  const priority: Priority | undefined = /\burgent\b/i.test(text) ? 'urgent' : /\bhigh[- ]priority\b/i.test(text) ? 'high' : undefined
  return withNotes({ type: 'output', label: 'Create a task', config: { kind: 'task', ...(priority ? { priority } : {}) }, source: text }, note)
}

function messageSpec(text: string, env: Env): NodeSpec {
  const channel = /(?:^|[\s(])(#[\w-]+)/.exec(text)?.[1]
  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(text)?.[0]
  const reply = /\b(?:reply|respond)\b/i.test(text)
  let integrationId: 'slack' | 'gmail'
  let note: string | undefined
  if (channel || /\bslack\b|\bchannel\b|\bdm\b/i.test(text)) integrationId = 'slack'
  else if (email || /\be-?mail|\bgmail\b|\binbox\b/i.test(text) || (reply && env.triggerIntegration === 'gmail')) integrationId = 'gmail'
  else if (env.connected('slack') || !env.connected('gmail')) {
    integrationId = 'slack'
    note = `${quoted(clip(text, 50))} doesn’t say where to send, so it posts to Slack — change it in the step settings.`
  } else {
    integrationId = 'gmail'
    note = `${quoted(clip(text, 50))} doesn’t say where to send, so it uses Gmail — change it in the step settings.`
  }
  const defaultChannel = env.ctx.connections.find((c) => c.id === 'slack')?.config.defaultChannel
  const toMe = /\bme\b/i.test(text)
  const config: Record<string, unknown> =
    integrationId === 'slack'
      ? channel ? { channel } : defaultChannel ? { channel: defaultChannel } : {}
      : email ? { to: email } : reply ? { to: 'the sender' } : toMe ? { to: 'me' } : {}
  const label =
    integrationId === 'slack'
      ? `Post to ${typeof config.channel === 'string' ? config.channel : 'Slack'}`
      : email ? `Email ${email}` : reply ? 'Reply to the sender' : toMe ? 'Email me' : 'Send email'
  return withNotes({ type: 'action', label, integrationId, capability: 'messages.send', config, source: text }, note, connectionNote(env, integrationId))
}

function trackerSpec(text: string, env: Env): NodeSpec {
  const named = /\blinear\b/i.test(text) ? 'linear' : /\bjira\b/i.test(text) ? 'jira' : undefined
  const taskWord = /\b(?:tasks?|to-?dos?)\b/i.test(text) && !/\b(?:tickets?|issues?|bugs?|cards?)\b/i.test(text)
  if (!named && taskWord) return taskOutput(text)
  const integrationId = named ?? (env.connected('linear') ? 'linear' : env.connected('jira') ? 'jira' : undefined)
  if (!integrationId) return taskOutput(text, 'No issue tracker (Linear or Jira) is connected, so the ticket step creates an Atrium task instead.')
  const conn = env.ctx.connections.find((c) => c.id === integrationId)
  const team = conn?.config.team ?? conn?.config.project
  const name = getIntegration(integrationId)?.name ?? integrationId
  return withNotes(
    { type: 'action', label: `Create ${name} issue`, integrationId, capability: 'tasks.manage', config: team ? { team } : {}, source: text },
    connectionNote(env, integrationId),
  )
}

function agentSpec(text: string, env: Env, forcedAgentId?: ID): NodeSpec {
  const instruction = capitalize(replacePronoun(text, env.object))
  const label = labelize(instruction, 6)
  const pick = forcedAgentId ? null : pickAgentForInstruction(text, env.ctx.agents, { runs: env.ctx.runs, context: env.fullText })
  const agentId = forcedAgentId ?? pick?.agentId
  const note = forcedAgentId
    ? `${quoted(label, 40)}: assigned to ${env.ctx.agents.find((a) => a.id === forcedAgentId)?.name ?? 'the agent you named'}, as written.`
    : pick
      ? `${quoted(label, 40)}: ${pick.reason}`
      : `${quoted(label, 40)}: no active agent clearly fits — choose one before running.`
  return withNotes(
    {
      type: 'agent',
      label,
      config: { prompt: /[.!?]$/.test(instruction) ? instruction : `${instruction}.` },
      ...(agentId ? { agentId } : {}),
      ...(pick?.capability ? { capability: pick.capability } : {}),
      source: text,
    },
    note,
  )
}

function approvalNodes(text: string, env: Env): NodeSpec[] {
  const spec = approvalSpec(text)
  const before = /\bbefore\s+(?:it(?:'s|’s| is| gets)\s+|they(?:'re|’re| are| get)\s+)?(\w+(?:ing|ed)|sent)\b(.*)$/i.exec(text)
  if (before) {
    const implied = nodesFor(`${toImperative(before[1])}${before[2] ?? ''}`, env).filter((s) => s.type === 'action' || s.type === 'output')
    if (implied.length) return [spec, ...implied.map((s) => ({ ...s, implied: true }))]
  }
  if (/\b(?:first|beforehand)\b|\bbefore (?:it|anything|this|that) (?:goes out|is sent|gets sent|is posted|gets posted|is published)\b/i.test(text)) {
    spec.guardsPrevious = true
  }
  return [spec]
}

/** One clause → zero or more step specs. */
function nodesFor(raw: string, env: Env): NodeSpec[] {
  const text = stripLead(raw).replace(WHEN_DONE, '').trim()
  if (!text) return []

  if (APPROVAL_CLAUSE.test(text)) return approvalNodes(text, env)
  const inline = INLINE_APPROVAL.exec(text)
  if (inline && inline.index > 0) {
    const rest = `${text.slice(0, inline.index)} ${text.slice(inline.index + inline[0].length)}`.replace(/\s+/g, ' ').trim()
    return [approvalSpec(text), ...nodesFor(rest, env)]
  }

  const delay = DELAY.exec(text)
  if (delay) {
    const n = NUMBER_WORDS[delay[1].toLowerCase()] ?? Number(delay[1])
    const unit = delay[2].toLowerCase()
    const config = unit.startsWith('d') ? { hours: n * 24 } : unit.startsWith('h') ? { hours: n } : { minutes: n }
    const word = unit.startsWith('d') ? 'day' : unit.startsWith('h') ? 'hour' : 'minute'
    return [{ type: 'delay', label: `Wait ${n} ${word}${n === 1 ? '' : 's'}`, config, source: text }]
  }

  const delegate = DELEGATE.exec(text)
  if (delegate) {
    const agent = env.ctx.agents.find((a) => a.status === 'active' && a.name.toLowerCase() === delegate[1].toLowerCase())
    if (agent) return [agentSpec(text.slice(delegate[0].length), env, agent.id)]
  }

  const summary = SUMMARY_DELIVERY.exec(text)
  if (summary) {
    const [, who, cadence, noun, restRaw = ''] = summary
    const rest = restRaw.replace(/\s+(?:to|in|on|via|by|into)\s+(?:#[\w-]+|slack|e-?mail|gmail|me|us|the team|everyone)\b.*$/i, '')
    const writer: NodeSpec = { ...agentSpec(`Write a ${cadence ? `${cadence.toLowerCase()} ` : ''}${noun.toLowerCase()}${rest}`, env), optionalAfterAgent: true }
    const toMe = !!who && /^(?:me|us)$/i.test(who)
    const delivery = toMe && !/^e-?mail/i.test(text) && !/\bslack\b|#[\w-]+|\be-?mail\b/i.test(restRaw) ? notifySpec(text) : messageSpec(text, env)
    return [writer, delivery]
  }

  if (NOTIFY_ME.test(text) && !/\bslack\b|#[\w-]+|\be-?mail\b|\bgmail\b/i.test(text)) return [notifySpec(text)]
  if (KNOWLEDGE_VERB.test(text) && /\bnotion\b/i.test(text)) {
    return [withNotes({ type: 'action', label: 'Save to Notion', integrationId: 'notion', capability: 'knowledge.write', config: {}, source: text }, connectionNote(env, 'notion'))]
  }
  if (KNOWLEDGE_VERB.test(text) && FILES_DEST.test(text)) {
    const integrationId = /\bs3\b|\bbucket\b/i.test(text) ? 's3' : 'google-drive'
    const name = getIntegration(integrationId)?.name ?? integrationId
    return [withNotes({ type: 'action', label: `Upload to ${name}`, integrationId, capability: 'files.write', config: {}, source: text }, connectionNote(env, integrationId))]
  }
  const trackerWords = TRACKER_NOUN.test(text) || TRACKER_NAME.test(text)
  if ((KNOWLEDGE_VERB.test(text) && KNOWLEDGE_NOUN.test(text) && !trackerWords) || (SAVE_ONLY.test(text) && !trackerWords)) {
    return [{ type: 'output', label: 'Save to Knowledge', config: { kind: 'knowledge' }, source: text }]
  }
  if (TRACKER_VERB.test(text) && trackerWords) return [trackerSpec(text, env)]
  if (REVIEW_POST.test(text) && env.triggerIntegration === 'github') {
    return [withNotes({ type: 'action', label: 'Post review on GitHub', integrationId: 'github', capability: 'repo.pull_request', config: {}, source: text }, connectionNote(env, 'github'))]
  }
  if (SEND_VERB.test(text)) return [messageSpec(text, env)]
  if (AGENT_VERB.test(text)) return [agentSpec(text, env)]

  env.notes.push(`Skipped ${quoted(clip(text, 60))}: not sure which step that is — add it by hand if needed.`)
  return []
}

// ---------------------------------------------------------------- step lists

const sameFamily = (a: NodeSpec, b: NodeSpec) =>
  a.type === b.type && (a.capability ?? '') === (b.capability ?? '') && (a.type !== 'output' || a.config.kind === b.config.kind)

const isGuardable = (s: NodeSpec | undefined) => !!s && (s.type === 'action' || s.type === 'output' || s.type === 'agent')

/** Insert respecting the implied / guard / redundancy rules. */
function insertSpec(list: NodeSpec[], spec: NodeSpec): void {
  const last = list[list.length - 1]
  if (spec.optionalAfterAgent && last?.type === 'agent') return
  if (spec.guardsPrevious && isGuardable(last)) {
    list.splice(list.length - 1, 0, spec)
    return
  }
  if (!spec.implied) {
    const impliedAt = list.findIndex((s) => s.implied && sameFamily(s, spec))
    if (impliedAt >= 0) list.splice(impliedAt, 1)
  }
  list.push(spec)
}

/** Insert at the top level: rules apply to the trailing run of plain steps (after the last condition). */
function insertTop(steps: Step[], spec: NodeSpec): void {
  let i = steps.length
  while (i > 0 && steps[i - 1].type === 'node') i--
  const tail = (steps.slice(i) as NodeStep[]).map((s) => s.spec)
  insertSpec(tail, spec)
  steps.splice(i, steps.length - i, ...tail.map((s): NodeStep => ({ type: 'node', spec: s })))
}

function pushSpecs(steps: Step[], open: OpenCondition | null, specs: NodeSpec[]): void {
  for (const spec of specs) {
    if (open) insertSpec(open.branch === 'true' ? open.step.whenTrue : open.step.whenFalse, spec)
    else insertTop(steps, spec)
  }
}

const GERUND: ReadonlyArray<[(s: NodeSpec) => boolean, string]> = [
  [(s) => s.integrationId === 'slack', 'posting'],
  [(s) => s.capability === 'repo.pull_request' || s.capability === 'repo.write', 'posting'],
  [(s) => s.capability === 'messages.send', 'sending'],
  [(s) => s.capability === 'tasks.manage' || s.config.kind === 'task', 'filing'],
  [(s) => s.config.kind === 'knowledge' || s.capability === 'knowledge.write' || s.capability === 'files.write', 'saving'],
  [(s) => s.config.kind === 'notify', 'notifying'],
]

function relabelApproval(spec: NodeSpec, next: NodeSpec | undefined): void {
  if (spec.type !== 'approval' || !spec.autoLabel || !next) return
  const gerund = GERUND.find(([test]) => test(next))?.[1]
  if (gerund) spec.label = `Review before ${gerund}`
  if (next.capability && !spec.capability) spec.capability = next.capability
}

function relabelApprovals(steps: Step[]): void {
  steps.forEach((step, i) => {
    if (step.type === 'node') {
      const next = steps[i + 1]
      relabelApproval(step.spec, next?.type === 'node' ? next.spec : undefined)
      return
    }
    for (const list of [step.whenTrue, step.whenFalse]) list.forEach((spec, j) => relabelApproval(spec, list[j + 1]))
  })
}

// ---------------------------------------------------------------- assembly

interface End {
  id: string
  handle?: Branch
}

function assemble(trigger: WorkflowTrigger, steps: Step[], prefix: string, notes: string[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []
  let n = 0
  let e = 0
  const place = (spec: NodeSpec, col: number, lane: number): WorkflowNode => {
    const node: WorkflowNode = {
      id: `${prefix}-n${++n}`,
      type: spec.type,
      label: spec.label,
      position: { x: col * DRAFT_LAYOUT.columnWidth, y: lane * DRAFT_LAYOUT.laneHeight },
      config: { ...spec.config },
      ...(spec.integrationId ? { integrationId: spec.integrationId } : {}),
      ...(spec.agentId ? { agentId: spec.agentId } : {}),
      ...(spec.capability ? { capability: spec.capability } : {}),
    }
    nodes.push(node)
    for (const note of spec.notes ?? []) if (!notes.includes(note)) notes.push(note)
    return node
  }
  const link = (from: End, to: string) => {
    edges.push({
      id: `${prefix}-e${++e}`,
      source: from.id,
      target: to,
      ...(from.handle ? { sourceHandle: from.handle, label: from.handle === 'true' ? 'Yes' : 'No' } : {}),
    })
  }
  const chain = (specs: NodeSpec[], startCol: number, lane: number): { first: string; last: string } | null => {
    const ids = specs.map((spec, i) => place(spec, startCol + i, lane).id)
    ids.slice(1).forEach((id, i) => link({ id: ids[i] }, id))
    return ids.length ? { first: ids[0], last: ids[ids.length - 1] } : null
  }

  const triggerNode = place(
    {
      type: 'trigger',
      label: trigger.label,
      config: { type: trigger.type, ...(trigger.cron ? { cron: trigger.cron } : {}), ...(trigger.event ? { event: trigger.event } : {}) },
      ...(trigger.integrationId ? { integrationId: trigger.integrationId } : {}),
    },
    0,
    0,
  )
  let ends: End[] = [{ id: triggerNode.id }]
  let col = 1
  for (const step of steps) {
    if (step.type === 'node') {
      const node = place(step.spec, col, 0)
      for (const end of ends) link(end, node.id)
      ends = [{ id: node.id }]
      col++
      continue
    }
    const cond = place(step.spec, col, 0)
    for (const end of ends) link(end, cond.id)
    col++
    const yes = chain(step.whenTrue, col, 0)
    const no = chain(step.whenFalse, col, 1)
    if (yes) link({ id: cond.id, handle: 'true' }, yes.first)
    if (no) link({ id: cond.id, handle: 'false' }, no.first)
    ends = [yes ? { id: yes.last } : { id: cond.id, handle: 'true' }]
    if (!step.falseTerminal) ends.push(no ? { id: no.last } : { id: cond.id, handle: 'false' })
    col += Math.max(step.whenTrue.length, step.whenFalse.length)
  }
  const hasOutput = nodes.some((node) => node.type === 'output' && node.config.kind !== 'none')
  if (!hasOutput || ends.some((end) => end.handle)) {
    const out = place(notifySpec(), col, 0)
    for (const end of ends) link(end, out.id)
    if (!hasOutput) notes.push('Added a final “Notify me” step so you see each result.')
  }
  return { nodes, edges }
}

// ---------------------------------------------------------------- naming

function pluralNoun(noun: string): string {
  const words = noun.split(' ')
  const last = words[words.length - 1] ?? ''
  if (!last || /s$/i.test(last)) return noun
  words[words.length - 1] = /^[A-Z0-9]+$/.test(last) ? `${last}s` : /(?:sh|ch|x|z)$/i.test(last) ? `${last}es` : `${last}s`
  return words.join(' ')
}

function firstSource(steps: Step[]): NodeSpec | undefined {
  for (const step of steps) {
    const specs = step.type === 'node' ? [step.spec] : [...step.whenTrue, ...step.whenFalse]
    const hit = specs.find((s) => s.source && (s.type === 'agent' || s.type === 'action'))
    if (hit) return hit
  }
  return undefined
}

function draftName(text: string, steps: Step[], event: FoundEvent | undefined, schedule: string | undefined): string {
  const first = firstSource(steps)
  if (first?.source) {
    const base = stripLead(first.source).replace(INLINE_APPROVAL, '').replace(WHEN_DONE, '')
    const noun = event?.noun ? pluralNoun(/\bnew\b/i.test(event.noun) ? event.noun : `new ${event.noun}`) : undefined
    const label = labelize(noun ? base.replace(/\b(?:it|them)\b/i, noun) : base, 7)
    if (label) return clip(label, 60)
  }
  return clip(suggestTitle(text, schedule, 7) ?? 'New workflow', 60)
}

function describeSteps(trigger: WorkflowTrigger, steps: Step[]): string {
  const lower = (specs: NodeSpec[]) => joinList(specs.map((s) => lowerFirst(s.label)))
  const phrases = steps.map((step) =>
    step.type === 'node'
      ? lowerFirst(step.spec.label)
      : `check “${step.spec.label}” (yes: ${lower(step.whenTrue) || 'continue'}; no: ${step.falseTerminal ? 'stop' : lower(step.whenFalse) || 'continue'})`,
  )
  const start = trigger.type === 'manual' ? 'When you run it' : describeTrigger(trigger)
  return phrases.length ? `${start}: ${phrases.join(', then ')}.` : `${start}.`
}

// ---------------------------------------------------------------- entry point

/** Draft a workflow from a plain-language description. Deterministic for a given text and context. */
export function draftWorkflowFromText(text: string, ctx: WorkflowDraftContext): WorkflowDraft {
  const input = text.replace(/\s+/g, ' ').trim()
  const notes: string[] = []
  const connected = (id: string) => ctx.connections.some((c) => c.id === id && c.status === 'connected')
  const prefix = ctx.idPrefix ?? `draft-${shortHash(input)}`
  const env: Env = { ctx, fullText: input, notes, connected }

  // Trigger: event › recurring schedule › manual.
  const event = findEvent(input)
  const schedule = extractSchedule(input)
  let cron = schedule ? scheduleToCron(schedule) : undefined
  let timePhrase: string | undefined
  if (schedule && cron && !/\d|noon|midnight/i.test(schedule)) {
    const t = TIME_RE.exec(input.replace(schedule, ' '))
    const withTime = t ? scheduleToCron(`${schedule} at ${t[1]}`) : undefined
    if (t && withTime) {
      cron = withTime
      timePhrase = t[0]
    }
  }

  let trigger: WorkflowTrigger
  let body = input
  const steps: Step[] = []
  if (event) {
    const { rule } = event
    let integrationId = rule.integrationId
    let eventId = rule.event
    // "ticket" / "issue" without a named tracker: prefer the connected one.
    if (eventId === 'linear.issue.created' && !/\blinear\b/i.test(event.phrase) && !connected('linear') && connected('jira')) {
      eventId = 'jira.issue.created'
      integrationId = 'jira'
    }
    trigger =
      rule.type === 'webhook'
        ? { type: 'webhook', label: describeTrigger({ type: 'webhook' }) }
        : { type: 'event', label: describeTrigger({ type: 'event', event: eventId, integrationId }), event: eventId, ...(integrationId ? { integrationId } : {}) }
    env.object = rule.object
    env.triggerIntegration = integrationId
    notes.push(`Starts ${lowerFirst(trigger.label)} (from ${quoted(event.phrase, 50)}).`)
    const triggerNote = connectionNote(env, integrationId)
    if (triggerNote) notes.push(triggerNote)
    body = event.atStart ? input.slice(event.end) : `${input.slice(0, event.start)}${rule.object}${input.slice(event.end)}`
    const filterWord = FILTER_WORDS.exec(event.phrase)
    if (filterWord) {
      const { expression, label } = conditionFrom(filterWord[0])
      steps.push({
        type: 'condition',
        spec: { type: 'condition', label, config: { expression } },
        whenTrue: [],
        whenFalse: [{ type: 'output', label: 'Skip', config: { kind: 'none' } }],
        falseTerminal: true,
      })
    }
    if (schedule) {
      body = body.replace(schedule, ' ')
      if (cron) notes.push(`Starts on the event, so ${quoted(schedule)} was not used as a schedule.`)
    }
  } else if (schedule && cron) {
    trigger = { type: 'schedule', label: describeTrigger({ type: 'schedule', cron }), cron }
    notes.push(`Runs ${lowerFirst(trigger.label)} (from ${quoted(`${schedule}${timePhrase ?? ''}`.trim(), 50)}).`)
    body = body.replace(schedule, ' ')
    if (timePhrase) body = body.replace(timePhrase, ' ')
  } else {
    trigger = { type: 'manual', label: describeTrigger({ type: 'manual' }) }
    if (schedule) {
      body = body.replace(schedule, ' ')
      notes.push(`${quoted(schedule)} is a one-off time, so the draft starts manually — add a schedule if it should repeat.`)
    }
  }

  body = body
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([,;])\s*[,;]+/g, '$1')
    .replace(/^[\s,;:.—–-]+/, '')
    .trim()

  // Steps, in the order written; conditions open a branch that lasts until the sentence ends.
  let open: OpenCondition | null = null
  const openCondition = (cond: ParsedCondition, sentence: number): OpenCondition => {
    const step: CondStep = { type: 'condition', spec: { type: 'condition', label: cond.label, config: { expression: cond.expression } }, whenTrue: [], whenFalse: [] }
    steps.push(step)
    const primary: Branch = cond.negate ? 'false' : 'true'
    return { step, primary, branch: primary, sentence }
  }

  for (const clause of splitClauses(body)) {
    const text = stripLead(clause.text)
    if (!text) continue
    if (open) {
      const continues = /^(?:otherwise|else)\b/i.test(text)
      if ((clause.sentence !== open.sentence && !continues) || clause.sep === 'finally' || (open.branch !== open.primary && clause.sep === 'then')) {
        open = null
      }
    }

    const trailing = splitTrailingCondition(text)
    if (trailing) {
      open = openCondition(trailing.cond, clause.sentence)
      pushSpecs(steps, open, nodesFor(trailing.step, env))
      continue
    }

    const cond = parseCondition(text)
    if (cond && 'sequence' in cond) {
      pushSpecs(steps, open, nodesFor(cond.rest, env))
      continue
    }
    if (cond) {
      if (open && cond.negate && cond.expression === open.step.spec.config.expression && open.branch === open.primary) {
        open = { ...open, branch: open.primary === 'true' ? 'false' : 'true', sentence: clause.sentence }
      } else {
        open = openCondition(cond, clause.sentence)
      }
      pushSpecs(steps, open, nodesFor(cond.rest, env))
      continue
    }

    const otherwise = /^(?:otherwise|else|or else)\b[\s,:]*/i.exec(text)
    if (otherwise) {
      if (open) open = { ...open, branch: open.primary === 'true' ? 'false' : 'true', sentence: clause.sentence }
      pushSpecs(steps, open, nodesFor(text.slice(otherwise[0].length), env))
      continue
    }
    pushSpecs(steps, open, nodesFor(text, env))
  }

  relabelApprovals(steps)
  const { nodes, edges } = assemble(trigger, steps, prefix, notes)
  return {
    name: draftName(input, steps, event, schedule),
    description: describeSteps(trigger, steps),
    trigger,
    nodes,
    edges,
    notes,
  }
}
