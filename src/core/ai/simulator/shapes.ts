/**
 * Request-shape detection for the local answer composer. Weighted regex heuristics;
 * ties resolve by SHAPE_PRIORITY (more specific shapes first).
 */
export type RequestShape = 'summarize' | 'code' | 'compare' | 'plan' | 'write' | 'howto' | 'brainstorm' | 'explain'

export const SHAPE_PRIORITY: readonly RequestShape[] = [
  'summarize', 'code', 'compare', 'plan', 'write', 'howto', 'brainstorm', 'explain',
]

interface Rule {
  re: RegExp
  weight: number
}

export const CODE_LANGUAGE_PATTERN =
  /\b(typescript|javascript|python|golang|rust|java|kotlin|swift|ruby|php|sql|postgres(?:ql)?|mysql|sqlite|bash|shell script|zsh|powershell|csharp|html|css|tsx|jsx|react|node(?:\.js)?|deno|pandas|django|flask|fastapi|express|vue|svelte|regex)\b|\b(?:a|an|in|using|with|written in)\s+go\b(?![-'’])|\bgo (?:code|function|program|service|handler|struct|module)\b|(?:^|\s)(?:c#|c\+\+)(?=$|[\s,.?!])/i

const RULES: Record<RequestShape, Rule[]> = {
  summarize: [
    { re: /\b(summari[sz]e|summary|summarise|tl;?dr|recap|condense|sum (?:it|this|that) up|boil (?:it|this) down)\b/i, weight: 5 },
    { re: /\b(key (?:points|takeaways)|main points|the gist|highlights of|digest of)\b/i, weight: 3 },
    { re: /\b(shorter|shorten|make it brief)\b/i, weight: 2 },
  ],
  code: [
    { re: CODE_LANGUAGE_PATTERN, weight: 2 },
    {
      re: /\b(function|method|class|snippet|script|regex|regular expression|algorithm|implement(?:ation)?|code|component|hook|endpoint|api route|route handler|query|unit tests?|refactor|stack trace|compile|cli|parser|debounce|throttle|memoi[sz]e)\b/i,
      weight: 2,
    },
    { re: /\b(write|give me|show me|create|build|generate)\b.{0,30}\b(function|script|query|component|class|snippet|hook|endpoint|regex|test)\b/i, weight: 2 },
    { re: /```/, weight: 2 },
  ],
  compare: [
    { re: /\b(compare|comparison|versus|vs\.?|difference(?:s)? between|differ from|pros and cons|trade-?offs? between|which is better|better than|head[- ]to[- ]head)\b/i, weight: 4 },
    { re: /\b(?:should (?:i|we) (?:use|pick|choose|go with)|which (?:one|should))\b.*\bor\b/i, weight: 3 },
  ],
  plan: [
    { re: /\b(plan|roadmap|timeline|milestones?|phases?|rollout|roll-out|itinerary|curriculum|learning path|okrs?|sprint|schedule for|game plan|go-to-market|gtm)\b/i, weight: 3 },
    { re: /\b(\d+|one|two|three|four|six|eight|twelve)[- ](?:day|week|month|quarter)s?\b/i, weight: 1 },
    { re: /\b(strategy for|prepare for|get ready for|launch)\b/i, weight: 1 },
  ],
  write: [
    { re: /\b(write|draft|compose|rewrite|rephrase|reword|polish|edit|proofread)\b/i, weight: 2 },
    {
      re: /\b(e-?mail|memo|letter|blog(?: post)?|post|tweet|thread|announcement|press release|release notes|changelog|newsletter|bio|cover letter|job (?:description|post(?:ing)?)|tagline|headline|slogan|copy|caption|speech|toast|invitation|reply|message|update to|intro(?:duction)?|one-pager|faq)\b/i,
      weight: 3,
    },
  ],
  howto: [
    { re: /^(?:\s*(?:hey|hi|please|so),?\s*)?(?:how (?:do|can|should|would) (?:i|we|you)|how to|what(?:'s| is) the best way to|steps to|walk me through|guide (?:to|for)|set ?up|configure|install|get started)\b/i, weight: 4 },
    { re: /\bhow (?:do|can|should) (?:i|we)\b/i, weight: 2 },
    { re: /\b(step[- ]by[- ]step|instructions|checklist|tutorial)\b/i, weight: 2 },
  ],
  brainstorm: [
    { re: /\b(ideas?|brainstorm|suggest(?:ions)?|options|alternatives|names? for|ways to|list (?:of|some)|examples of|inspiration|angles|themes?)\b/i, weight: 3 },
    { re: /\b(?:give me|list|suggest)\s+(?:\d+|a few|some|several)\b/i, weight: 2 },
    { re: /\b\d+\s+(?:ideas|ways|names|options|tips|questions|titles|topics|hooks)\b/i, weight: 2 },
  ],
  explain: [
    { re: /^(?:\s*(?:hey|hi|so),?\s*)?(?:what|why|how does|how do .+ work|who|when|where|which|is|are|can|does|do|should|explain|describe|define|tell me about|help me understand)\b/i, weight: 2 },
    { re: /\?\s*$/, weight: 1 },
  ],
}

export interface ShapeResult {
  shape: RequestShape
  scores: Record<RequestShape, number>
}

export interface ShapeContext {
  /** Text attachments are present (makes "what does this say" a summary). */
  hasFiles: boolean
}

export function detectShape(text: string, ctx: ShapeContext = { hasFiles: false }): ShapeResult {
  const scores = {} as Record<RequestShape, number>
  for (const shape of SHAPE_PRIORITY) {
    let s = 0
    for (const rule of RULES[shape]) if (rule.re.test(text)) s += rule.weight
    scores[shape] = s
  }
  // A language plus a code noun is a strong code signal ("a Python function", "SQL query").
  if (CODE_LANGUAGE_PATTERN.test(text) && RULES.code[1].re.test(text)) scores.code += 3
  // "Write a plan" is a plan; "write a function" is code.
  if (scores.plan >= 3 && /\b(write|draft)\b/i.test(text)) scores.write -= 1
  // Short instruction about an attached file reads as a summary request.
  if (ctx.hasFiles && text.trim().split(/\s+/).length <= 8 && /\b(this|these|attached|file|doc(?:ument)?|notes?)\b/i.test(text)) {
    scores.summarize += 2
  }
  scores.explain += 0.5 // default when nothing else matches
  let best: RequestShape = 'explain'
  for (const shape of SHAPE_PRIORITY) if (scores[shape] > scores[best]) best = shape
  return { shape: best, scores }
}

// ---------------------------------------------------------------- parameters

export type CodeLanguage =
  | 'typescript' | 'javascript' | 'tsx' | 'jsx' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'swift' | 'ruby'
  | 'php' | 'csharp' | 'sql' | 'bash' | 'css' | 'html'

const LANGUAGE_RULES: Array<[RegExp, CodeLanguage]> = [
  [/\b(tsx)\b/i, 'tsx'],
  [/\b(jsx)\b/i, 'jsx'],
  [/\breact\b.*\bjavascript\b|\bjavascript\b.*\breact\b/i, 'jsx'],
  [/\b(react|vue|svelte)\b/i, 'tsx'],
  [/\b(typescript|ts|deno)\b/i, 'typescript'],
  [/\b(javascript|js|node(?:\.js)?|express)\b/i, 'javascript'],
  [/\b(python|py|pandas|django|flask|fastapi)\b/i, 'python'],
  [/\b(golang)\b|\b(?:a|an|in|using|with|written in)\s+go\b(?![-'’])|\bgo (?:code|function|program|service|handler|struct|module)\b/i, 'go'],
  [/\b(rust)\b/i, 'rust'],
  [/\b(kotlin)\b/i, 'kotlin'],
  [/\b(java)\b(?!script)/i, 'java'],
  [/\b(swift)\b/i, 'swift'],
  [/\b(ruby|rails)\b/i, 'ruby'],
  [/\b(php|laravel)\b/i, 'php'],
  [/(c#|\bcsharp\b|\.net\b)/i, 'csharp'],
  [/\b(sql|postgres(?:ql)?|mysql|sqlite|query)\b/i, 'sql'],
  [/\b(bash|shell|zsh|sh script|cron job)\b/i, 'bash'],
  [/\b(css|stylesheet|tailwind)\b/i, 'css'],
  [/\b(html|markup)\b/i, 'html'],
]

/** Programming language mentioned in the request (TypeScript by default). */
export function detectLanguage(text: string): CodeLanguage {
  for (const [re, lang] of LANGUAGE_RULES) if (re.test(text)) return lang
  return 'typescript'
}

/** Items being compared: "Postgres vs MongoDB", "compare A, B and C", "difference between A and B". */
export function extractComparisonItems(text: string): string[] {
  const clean = text.replace(/[?!.]+\s*$/, '').replace(/\s+/g, ' ')
  const patterns = [
    /\bdifferences? between (.+?) and (.+?)(?:\s+(?:for|in|when|regarding|in terms of)\b.*)?$/i,
    /\bcompare (.+?) (?:and|with|to|against|vs\.?|versus) (.+?)(?:\s+(?:for|in|when|regarding|on|in terms of)\b.*)?$/i,
    /\b(?:should (?:i|we) (?:use|pick|choose|go with)|which is better[,:]?|which one[,:]?) (.+?) or (.+?)(?:\s+(?:for|in|when)\b.*)?$/i,
    /(?:^|[:,]\s*)([^,:]+?) (?:vs\.?|versus) ([^,]+?)(?:\s+(?:for|in|when|regarding)\b.*)?$/i,
  ]
  for (const re of patterns) {
    const m = re.exec(clean)
    if (!m) continue
    const items = splitItems(m[1]).concat(splitItems(m[2]))
    const cleaned = items.map(cleanItem).filter((s) => s.length > 0 && s.split(' ').length <= 6)
    if (cleaned.length >= 2) return dedupe(cleaned).slice(0, 4)
  }
  return []
}

function splitItems(s: string): string[] {
  return s.split(/,\s*(?:and\s+|or\s+)?|\s+(?:and|or|vs\.?|versus)\s+/i)
}

function cleanItem(s: string): string {
  return s
    .replace(/^(?:the|a|an|our|my|using|between)\s+/i, '')
    .replace(/\s+(?:options?|approach(?:es)?)$/i, '')
    .replace(/[“”"'`*]/g, '')
    .trim()
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>()
  return items.filter((i) => {
    const k = i.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Requested count: "give me 5 ideas", "ten names" (bounded). */
export function extractCount(text: string, fallback: number, max = 12): number {
  const WORDS: Record<string, number> = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
  const m = /\b(\d{1,2}|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:\w+\s+)?(?:ideas|ways|names|options|tips|questions|titles|topics|hooks|taglines|headlines|slogans|variations|versions|examples|alternatives|suggestions|points|things)\b/i.exec(
    text,
  )
  if (!m) return fallback
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1].toLowerCase()]
  return Math.min(max, Math.max(2, n || fallback))
}

/** Duration phrase for plans: "in 6 weeks", "a 30-day", "over the next quarter". */
export function extractDuration(text: string): { amount: number; unit: 'day' | 'week' | 'month' } | undefined {
  const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12 }
  const m = /\b(\d{1,3}|one|two|three|four|five|six|eight|ten|twelve)[- ](day|week|month)s?\b/i.exec(text)
  if (m) {
    const amount = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1].toLowerCase()]
    if (amount > 0) return { amount, unit: m[2].toLowerCase() as 'day' | 'week' | 'month' }
  }
  if (/\b(?:a|one|next|this) quarter\b/i.test(text)) return { amount: 3, unit: 'month' }
  return undefined
}
