import { db } from '@/core/db'

/**
 * Intent detection for the command center and Home: routes free text to the workspace that
 * should handle it, using weighted keyword/regex heuristics (no model call). Also extracts a
 * short title and a schedule phrase ("every Monday at 9am"), with a cron expression when the
 * schedule is recurring.
 */

export type Intent = 'ask' | 'research' | 'build' | 'delegate' | 'automate' | 'create' | 'organize'

export interface IntentSuggestions {
  /** Short title for the task / workflow / investigation the request would create. */
  title?: string
  /** The schedule phrase as written, e.g. "every Monday at 9am". */
  schedule?: string
  /** Cron for a recurring schedule, e.g. "0 9 * * 1". */
  cron?: string
}

export interface IntentResult {
  intent: Intent
  /** 0..1 */
  confidence: number
  /** Human-readable explanation of the decision. */
  reason: string
  suggestions?: IntentSuggestions
}

// ---------------------------------------------------------------- schedules

const DAY = '(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekday|weekend)s?'
const DAYS = `${DAY}(?:\\s*(?:,|and|&|\\/)\\s*${DAY})*`
const TIME = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)|\\d{1,2}:\\d{2}|noon|midnight)'
const AT_TIME = `(?:\\s+(?:at|by|around|@)\\s+${TIME})`
const PART_OF_DAY = '(?:\\s+(?:in the\\s+)?(?:morning|afternoon|evening|night))'

const SCHEDULE_PATTERNS: RegExp[] = [
  new RegExp(`\\bevery\\s+(?:other\\s+)?(?:${DAYS}|day|morning|afternoon|evening|night|hour|week|month|quarter|year|\\d+\\s+(?:minutes?|hours?|days?|weeks?|months?))${AT_TIME}?${PART_OF_DAY}?`, 'i'),
  new RegExp(`\\b(?:daily|weekly|bi-?weekly|monthly|hourly|nightly|quarterly|annually|yearly)${AT_TIME}?`, 'i'),
  new RegExp(`\\b(?:each|on)\\s+(?:${DAYS})${AT_TIME}?${PART_OF_DAY}?`, 'i'),
  new RegExp(`\\bat\\s+${TIME}\\s+(?:every\\s+(?:day|morning|weekday|${DAYS})|daily|each day|on\\s+${DAYS})`, 'i'),
  new RegExp(`\\b(?:tomorrow|tonight|today)${AT_TIME}?`, 'i'),
  new RegExp(`\\bnext\\s+(?:${DAY}|week|month)${AT_TIME}?`, 'i'),
  /\bin\s+\d+\s+(?:minutes?|hours?|days?|weeks?)\b/i,
]

/** The schedule phrase in `text` (longest match), as written. */
export function extractSchedule(text: string): string | undefined {
  let best: RegExpExecArray | null = null
  for (const re of SCHEDULE_PATTERNS) {
    const m = re.exec(text)
    if (m && (!best || m[0].length > best[0].length || (m[0].length === best[0].length && m.index < best.index))) best = m
  }
  return best?.[0].trim()
}

const DAY_NUMBERS: Array<[RegExp, number[]]> = [
  [/\bweekdays?\b/i, [1, 2, 3, 4, 5]],
  [/\bweekends?\b/i, [6, 0]],
  [/\bmon(?:day)?s?\b/i, [1]],
  [/\btue(?:s(?:day)?)?s?\b/i, [2]],
  [/\bwed(?:nesday)?s?\b/i, [3]],
  [/\bthu(?:rs(?:day)?)?s?\b/i, [4]],
  [/\bfri(?:day)?s?\b/i, [5]],
  [/\bsat(?:urday)?s?\b/i, [6]],
  [/\bsun(?:day)?s?\b/i, [0]],
]

function parseTime(phrase: string): { h: number; m: number } | undefined {
  if (/\bnoon\b/i.test(phrase)) return { h: 12, m: 0 }
  if (/\bmidnight\b/i.test(phrase)) return { h: 0, m: 0 }
  const t = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=$|[^\d])/i.exec(phrase.replace(/\bevery\s+\d+\s+\w+/i, ''))
  if (!t || (!t[2] && !t[3])) return undefined
  let h = Number(t[1])
  const m = t[2] ? Number(t[2]) : 0
  const ampm = t[3]?.toLowerCase().replace(/\./g, '')
  if (ampm === 'pm' && h < 12) h += 12
  if (ampm === 'am' && h === 12) h = 0
  return h <= 23 && m <= 59 ? { h, m } : undefined
}

/**
 * Cron for a recurring schedule phrase ("every Monday at 9am" → "0 9 * * 1").
 * Returns undefined for one-off phrases ("tomorrow", "next week", "in 2 hours").
 */
export function scheduleToCron(phrase: string): string | undefined {
  const p = phrase.toLowerCase()
  if (/\b(tomorrow|tonight|today|next|in\s+\d+)\b/.test(p)) return undefined
  if (/^on\s/.test(p) && !/s\b/.test(p.replace(/^on\s+/, '').split(/\s/)[0])) return undefined // "on Monday" is one-off
  const time = parseTime(p)
  const defaultHour = /\bevening\b/.test(p) ? 18 : /\bnight|nightly\b/.test(p) ? 21 : /\bafternoon\b/.test(p) ? 14 : 9
  const h = time?.h ?? defaultHour
  const m = time?.m ?? 0

  const every = /\bevery\s+(\d+)\s+(minute|hour|day|week|month)s?\b/.exec(p)
  if (every) {
    const n = Number(every[1])
    if (n < 1) return undefined
    if (every[2] === 'minute') return n < 60 ? `*/${n} * * * *` : undefined
    if (every[2] === 'hour') return n < 24 ? `0 */${n} * * *` : undefined
    if (every[2] === 'day') return `${m} ${h} */${n} * *`
    if (every[2] === 'week') return n === 1 ? `${m} ${h} * * 1` : undefined
    return `${m} ${h} 1 */${n} *`
  }
  if (/\b(hourly|every hour)\b/.test(p)) return '0 * * * *'
  const days = new Set<number>()
  for (const [re, nums] of DAY_NUMBERS) if (re.test(p)) nums.forEach((d) => days.add(d))
  if (days.size) return `${m} ${h} * * ${[...days].sort((a, b) => a - b).join(',')}`
  if (/\b(bi-?weekly|every other week)\b/.test(p)) return undefined // cron cannot express fortnightly
  if (/\b(weekly|every week)\b/.test(p)) return `${m} ${h} * * 1`
  if (/\b(monthly|every month)\b/.test(p)) return `${m} ${h} 1 * *`
  if (/\b(quarterly|every quarter)\b/.test(p)) return `${m} ${h} 1 1,4,7,10 *`
  if (/\b(yearly|annually|every year)\b/.test(p)) return `${m} ${h} 1 1 *`
  if (/\b(daily|nightly|every (?:day|morning|afternoon|evening|night)|each day)\b/.test(p) || /\bat\s/.test(p)) return `${m} ${h} * * *`
  return undefined
}

// ---------------------------------------------------------------- signals

interface Signal {
  re: RegExp
  weight: number
}

const ACTION_VERB = '(?:send|post|check|run|create|summari[sz]e|research|review|remind|email|notify|generate|update|sync|back ?up|report|scan|monitor|collect|compile|publish|share|digest|triage|draft|clean|archive|alert|refresh|pull|fetch|export)'

const SIGNALS: Record<Exclude<Intent, 'ask'>, Signal[]> = {
  research: [
    { re: /\b(research|investigate|investigation|deep[- ]dive|dig into|look into)\b/i, weight: 3 },
    { re: /\b(market|landscape|competitors?|competitive|industry|vendors?)\b/i, weight: 2 },
    { re: /\b(sources|citations|literature|studies|papers|evidence|references)\b/i, weight: 2 },
    { re: /\b(trends?|benchmarks?|state of the art|survey of|best practices)\b/i, weight: 2 },
    { re: /\b(analy[sz]e|analysis)\b/i, weight: 1.5 },
    { re: /\b(compare|comparison|versus|vs\.?|pros and cons)\b/i, weight: 1.5 },
  ],
  build: [
    { re: /\b(fix|bug|bugs|broken|crash(?:es|ing)?|exception|stack ?trace|regression|500 error|error message)\b/i, weight: 2.5 },
    { re: /\b(implement|refactor|unit tests?|tests? for|write tests|failing tests?|flaky|lint|type ?errors?)\b/i, weight: 2.5 },
    { re: /\b(pr|prs|pull requests?|repo|repository|branch|commit|merge conflict|code review)\b/i, weight: 2.5 },
    { re: /\b(endpoint|component|function|api|module|class|schema|database migration|deploy(?:ment)?|staging|production|ci|pipeline|build)\b/i, weight: 1.5 },
    { re: /\b(typescript|javascript|python|react|node|golang|rust|sql|css|html)\b/i, weight: 1 },
  ],
  automate: [
    { re: /\b(automate|automation|automatically|workflow|trigger|recurring|cron)\b/i, weight: 2.5 },
    { re: /\bschedule[ds]?\b/i, weight: 2 },
    { re: /\b(each time|every time|whenever)\b/i, weight: 5 },
    { re: /\bwhen\b.{3,80}\b(then|automatically)\b/i, weight: 5 },
    { re: /\bif\b.{3,80}\bthen\b/i, weight: 3 },
  ],
  create: [
    { re: /\b(images?|logo|posters?|videos?|slides?|slide deck|deck|presentation|banners?|illustrations?|storyboard|thumbnails?|mockups?|moodboard|hero image|icons?|graphics?|visuals?|animation|jingle|voiceover)\b/i, weight: 3 },
    { re: /\bcopy for\b|\b(ad copy|landing page copy|marketing copy|product copy)\b/i, weight: 2.5 },
    { re: /\b(design|draw|render|generate|illustrate|animate|make|create)\b.{0,40}\b(image|logo|poster|video|slides?|deck|banner|illustration|visual|graphic|icon)/i, weight: 1.5 },
  ],
  delegate: [
    { re: /\b(delegate|assign (?:it|this|that) to|hand (?:it|this|that) off|on my behalf|take care of)\b/i, weight: 3 },
    { re: /\b(?:an?|the|my)\s+agents?\b|\bagents? (?:to|should|that)\b/i, weight: 3 },
    { re: /\b(monitor|keep an eye on|watch for|watch over|follow up|follow-up|chase|check in on)\b/i, weight: 2.5 },
  ],
  organize: [
    { re: /\bremind me\b/i, weight: 7 },
    { re: /\b(create|add|make|log|open|file|set up|start)\s+(?:a\s+|an\s+|new\s+|a new\s+)?(task|todo|to-do|ticket|issue|reminder|note|milestone|project|checklist)\b/i, weight: 4 },
    { re: /\b(task|tasks|todo|to-do|milestone|backlog|checklist|due date|deadline)\b/i, weight: 2 },
    { re: /\b(?:take|save|add|write down|jot down|make)\s+(?:a\s+)?note\b|\bnote (?:this|that) down\b|\bsave (?:this|that|it)\b|\bbookmark\b|\badd (?:this |it )?to (?:my )?(?:list|project|knowledge)\b/i, weight: 3 },
    { re: /\bproject\b/i, weight: 1 },
  ],
}

/** Tie-break order when scores are equal. */
const PRIORITY: readonly Exclude<Intent, 'ask'>[] = ['automate', 'organize', 'delegate', 'create', 'build', 'research']

const LABEL: Record<Intent, string> = {
  ask: 'a question for chat',
  research: 'a research task',
  build: 'a coding task',
  delegate: 'work for an agent',
  automate: 'an automation',
  create: 'a creative request',
  organize: 'something to organize',
}

function agentNames(): string[] {
  try {
    return db
      .all('agents')
      .filter((a) => a.status !== 'archived')
      .map((a) => a.name.trim().toLowerCase())
      .filter((n) => n.length > 1)
  } catch {
    return []
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------- titles

const TITLE_LEADS: RegExp[] = [
  /^(?:hey|hi|hello|ok(?:ay)?|so)\b[\s,!.:-]*/i,
  /^(?:please|pls|kindly)\b[\s,]*/i,
  /^(?:can|could|would|will) you(?: please)?\s+/i,
  /^(?:i (?:need|want|would like|'d like)(?: you)?(?: to)?|we need to|let's|lets|help me(?: to)?)\s+/i,
  /^(?:remind me(?: to)?|don't let me forget to)\s+/i,
  /^(?:create|add|make|log|open|file|set up|start)\s+(?:a\s+|an\s+|new\s+|a new\s+)?(?:task|todo|to-do|ticket|issue|reminder|note|automation|workflow)\s*(?:to|for|:|-|—)?\s*/i,
  /^(?:automate|automatically)\s+/i,
  /^(?:have|ask|get|tell)\s+(?:an?\s+|the\s+|my\s+)?(?:agent\s+)?(?:\w+\s+)?to\s+/i,
  /^(?:every time|each time|whenever)\s+/i,
]

/** A short title for whatever the request would create (task, workflow, investigation…). */
export function suggestTitle(text: string, schedule?: string, maxWords = 10): string | undefined {
  let s = text.split('\n')[0] ?? ''
  if (schedule) s = s.replace(schedule, ' ')
  s = s.replace(/\s+/g, ' ').replace(/^[\s,;:—–-]+/, '').trim()
  for (let pass = 0; pass < 4; pass++) {
    const before = s
    for (const re of TITLE_LEADS) {
      const next = s.replace(re, '').replace(/^[\s,;:—–-]+/, '')
      if (next.split(' ').filter(Boolean).length >= 2) s = next
    }
    if (s === before) break
  }
  let words = s.split(' ').filter(Boolean).slice(0, maxWords).join(' ')
  for (let i = 0; i < 3; i++) words = words.replace(/[\s.,!?;:…—–-]+$/u, '').replace(/\s+(?:a|an|the|of|for|to|and|or|with|in|on|at|by|from)$/i, '')
  if (!words) return undefined
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// ---------------------------------------------------------------- detection

const QUESTION_START = /^(?:what|why|how|who|when|where|which|is|are|can|could|should|would|does|do|did|explain|tell me)\b/i

export function detectIntent(text: string): IntentResult {
  const input = text.replace(/\s+/g, ' ').trim()
  if (!input) return { intent: 'ask', confidence: 0.3, reason: 'Empty request; defaulting to chat.' }

  const schedule = extractSchedule(input)
  const scores = new Map<Exclude<Intent, 'ask'>, { score: number; cues: string[] }>()
  for (const intent of PRIORITY) {
    let score = 0
    const cues: string[] = []
    for (const signal of SIGNALS[intent]) {
      const m = signal.re.exec(input)
      if (m) {
        score += signal.weight
        cues.push(m[0].trim())
      }
    }
    scores.set(intent, { score, cues })
  }

  // A recurring schedule is a strong automation signal, stronger when paired with an action.
  if (schedule && scheduleToCron(schedule)) {
    const auto = scores.get('automate')!
    const withAction = new RegExp(`\\b${ACTION_VERB}\\b`, 'i').test(input)
    auto.score += withAction ? 6 : 3
    auto.cues.unshift(schedule)
  }
  // Addressing a named agent ("have Scout…", "ask Forge to…") is delegation.
  const names = agentNames()
  if (names.length) {
    const re = new RegExp(`\\b(?:have|ask|get|tell|let)\\s+(${names.map(escapeRe).join('|')})\\b`, 'i')
    const m = re.exec(input)
    if (m) {
      const del = scores.get('delegate')!
      del.score += 4.5
      del.cues.unshift(m[0])
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score || PRIORITY.indexOf(a[0]) - PRIORITY.indexOf(b[0]))
  const [topIntent, top] = ranked[0]
  const second = ranked[1]?.[1].score ?? 0

  const suggestions: IntentSuggestions = {}
  const title = suggestTitle(input, schedule)
  if (title) suggestions.title = title
  if (schedule) {
    suggestions.schedule = schedule
    const cron = scheduleToCron(schedule)
    if (cron) suggestions.cron = cron
  }
  const withSuggestions = (r: IntentResult): IntentResult => (Object.keys(suggestions).length ? { ...r, suggestions } : r)

  if (top.score < 1.5) {
    const question = QUESTION_START.test(input) || input.endsWith('?')
    return withSuggestions({
      intent: 'ask',
      confidence: question ? 0.8 : 0.6,
      reason: question ? 'Reads as a question, so chat is the best place to answer it.' : 'No strong action cues; treating it as a chat request.',
    })
  }
  const confidence = Math.min(0.97, Math.max(0.5, 0.42 + 0.06 * top.score + 0.06 * (top.score - second)))
  const cues = [...new Set(top.cues)].slice(0, 3).map((c) => `“${c}”`)
  return withSuggestions({
    intent: topIntent,
    confidence: Math.round(confidence * 100) / 100,
    reason: `Looks like ${LABEL[topIntent]}: mentions ${cues.join(', ')}.`,
  })
}
