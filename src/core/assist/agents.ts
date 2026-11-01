import { CAPABILITIES } from '@/core/permissions/capabilities'
import type { Agent, Capability, ID, Run } from '@/core/types'
import { joinList } from './text'
import type { AgentPick, PickAgentOptions } from './types'

/**
 * Pick the active agent best suited to an instruction, by capability and role keyword overlap.
 * Deterministic heuristic (no model call): topics found in the text map to capabilities
 * (research → web.search, code → repo.*, post/email → messages.send, image/video → media.generate,
 * metrics → data.query, triage/support → tasks.manage + files.read); agents that hold those
 * capabilities (not denied) and whose role fits score highest. Ties go to the better recent
 * success rate, then to name order.
 */

interface Topic {
  id: string
  /** Word used in reasons: fits “research”. */
  label: string
  re: RegExp
  caps: readonly Capability[]
  /** All caps are needed for a full match (triage needs tasks.manage + files.read). */
  all?: boolean
  role: RegExp
  /** Generic topics (writing) only nudge the score. */
  weak?: boolean
}

export const AGENT_TOPICS: readonly Topic[] = [
  {
    id: 'research',
    label: 'research',
    re: /\b(?:research\w*|investigat\w*|web|search(?:es|ing)?|brows\w*|look into|find out|look up|competitors?|competitive|market|news|sources?|trends?|landscape|benchmarks?)\b/i,
    caps: ['web.search', 'web.browse'],
    role: /research|investigat|scout/i,
  },
  {
    id: 'code',
    label: 'code',
    re: /\b(?:code|coding|codebase|repo|repos|repository|repositories|tests?|testing|bugs?|fix(?:es)?|refactor\w*|pull requests?|prs?|commits?|branch(?:es)?|implement\w*|typescript|javascript|lint\w*|builds?|deploy\w*|ci|diffs?|endpoints?)\b/i,
    caps: ['repo.read', 'repo.write', 'repo.pull_request'],
    role: /cod(?:e|ing)|engineer|developer|programm/i,
  },
  {
    id: 'comms',
    label: 'messaging',
    re: /\b(?:post(?:ing)?|send(?:ing)?|announce\w*|notify|slack|(?<!market )share|publish|broadcast|newsletter|reply|respond|dm|ping)\b|^\s*e-?mail\b|\be-?mail (?:it|them|the|to|a|an|our|my|everyone|all|customers|users|team)\b/i,
    caps: ['messages.send'],
    role: /communicat|comms|writer|announce/i,
  },
  {
    id: 'media',
    label: 'creative work',
    re: /\b(?:images?|videos?|visuals?|brand(?:ing)?|logos?|illustrat\w*|posters?|banners?|storyboards?|creative|artwork|graphics?|thumbnails?|photos?|renders?|mock-?ups?|moodboards?|key art)\b/i,
    caps: ['media.generate'],
    role: /creative|design|art|brand|visual/i,
  },
  {
    id: 'data',
    label: 'data',
    re: /\b(?:data|metrics?|revenue|mrr|arr|churn|retention|sql|quer(?:y|ies)|dashboards?|kpis?|numbers|financ\w*|cohorts?|usage|analytics|conversion|forecast\w*)\b/i,
    caps: ['data.query'],
    role: /data|metric|financ|analytic/i,
  },
  {
    id: 'triage',
    label: 'triage',
    re: /\b(?:triag\w*|classif\w*|categori[sz]\w*|prioriti[sz]\w*|support|inbox|tickets?|customer (?:e-?mails?|requests?|issues?)|queue|escalat\w*|help ?desk)\b/i,
    caps: ['tasks.manage', 'files.read'],
    all: true,
    role: /triage|support|help ?desk/i,
  },
  {
    id: 'knowledge',
    label: 'knowledge upkeep',
    re: /\b(?:knowledge(?: base)?|wiki|notion|curat\w*|dedupe|de-?duplicat\w*|tagging|re-?tag\w*|organi[sz]e (?:the |my |our )?(?:notes|docs|knowledge))\b/i,
    caps: ['knowledge.write'],
    role: /curator|knowledge|librar|archiv/i,
  },
  {
    id: 'calendar',
    label: 'scheduling',
    re: /\b(?:calendar|availability|book (?:a )?(?:meeting|call)|schedule (?:a )?(?:meeting|call)|invites?)\b/i,
    caps: ['calendar.manage'],
    role: /assistant|scheduler|coordinat/i,
  },
  {
    id: 'publishing',
    label: 'publishing',
    re: /\b(?:release notes|changelogs?|newsletters?|announcements?|press releases?|digests?)\b/i,
    caps: ['messages.send'],
    role: /communicat|writer|editor|content|comms/i,
  },
  {
    id: 'writing',
    label: 'writing',
    re: /\b(?:summar\w*|digest|recap|report|write|draft|brief(?:ing)?|outline|release notes|updates?)\b/i,
    caps: ['knowledge.read'],
    role: /communicat|writer|editor|content|comms/i,
    weak: true,
  },
]

const MIN_SCORE = 1.5
const RECENT_RUNS = 10
const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'what', 'when', 'have', 'has', 'our', 'your', 'their',
  'them', 'they', 'then', 'will', 'should', 'could', 'would', 'please', 'make', 'sure', 'every', 'each', 'some', 'any', 'all',
  'new', 'out', 'over', 'also', 'just', 'it’s', "it's", 'its', 'week', 'day', 'today', 'tomorrow',
])

interface TopicHit {
  topic: Topic
  cue: string
  index: number
}

function topicHits(text: string): TopicHit[] {
  const hits: TopicHit[] = []
  for (const topic of AGENT_TOPICS) {
    const m = topic.re.exec(text)
    if (m) hits.push({ topic, cue: m[0].trim().toLowerCase(), index: m.index })
  }
  return hits
}

function grantedCaps(agent: Agent): Set<Capability> {
  return new Set(agent.capabilities.filter((g) => g.mode !== 'deny').map((g) => g.capability))
}

function terms(text: string): string[] {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) {
    const w = raw.replace(/['’]s$/, '')
    if (w.length >= 4 && !STOP.has(w)) out.add(w)
  }
  return [...out]
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Mentioned by name: "Scout" (capitalized), "@scout", or "have/ask/let scout …". */
function mentions(text: string, name: string): boolean {
  const n = escapeRe(name.trim())
  if (n.length < 2) return false
  return (
    new RegExp(`(?:^|[^\\p{L}\\p{N}])${n}(?![\\p{L}\\p{N}])`, 'u').test(text) ||
    new RegExp(`@${n}\\b|\\b(?:have|ask|get|tell|let|assign(?: it)? to)\\s+${n}\\b`, 'i').test(text)
  )
}

/** succeeded / finished over the agent's last 10 finished runs; null when it has none. */
export function recentSuccessRate(agentId: ID, runs: readonly Run[]): number | null {
  const finished = runs
    .filter((r) => r.agentId === agentId && (r.status === 'succeeded' || r.status === 'failed'))
    .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, RECENT_RUNS)
  if (!finished.length) return null
  return finished.filter((r) => r.status === 'succeeded').length / finished.length
}

interface Scored {
  agent: Agent
  score: number
  named: boolean
  caps: Capability[]
  cue?: string
  roleCue?: string
  capability?: Capability
}

function scoreAgent(agent: Agent, own: TopicHit[], context: TopicHit[], words: string[], text: string, contextText: string): Scored {
  const granted = grantedCaps(agent)
  const primaryIndex = own.length ? Math.min(...own.map((h) => h.index)) : -1
  const result: Scored = { agent, score: 0, named: false, caps: [] }
  let bestContribution = 0

  /**
   * Per topic: holding its capabilities is the main signal (3), a fitting role adds 2 (1 without the
   * capabilities, 1 for weak topics), and the topic named first in the instruction gets +0.5.
   */
  const apply = (hit: TopicHit, weight: number, primary: boolean) => {
    const { topic } = hit
    const matched = topic.caps.filter((c) => granted.has(c))
    let capScore = 0
    if (matched.length) {
      if (topic.weak) capScore = 0.5
      else if (topic.all) capScore = (3 * matched.length) / topic.caps.length
      else capScore = 3 + 0.25 * (matched.length - 1)
    }
    const roleScore = topic.role.test(agent.role) ? (topic.weak || capScore === 0 ? 1 : 2) : 0
    const bonus = primary && !topic.weak && capScore > 0 ? 0.5 : 0
    const contribution = weight * (capScore + roleScore + bonus)
    result.score += contribution
    if (!topic.weak) for (const c of matched) if (!result.caps.includes(c)) result.caps.push(c)
    if (contribution > bestContribution) {
      bestContribution = contribution
      result.cue = hit.cue
      result.capability = topic.weak ? undefined : matched[0]
      result.roleCue = roleScore ? agent.role : undefined
    }
  }
  // The first topic named carries full weight; later ones in the instruction 0.75; surrounding context 0.5.
  for (const hit of own) apply(hit, hit.index === primaryIndex ? 1 : 0.75, hit.index === primaryIndex)
  for (const hit of context) apply(hit, 0.5, false)

  const about = `${agent.role} ${agent.description}`.toLowerCase()
  result.score += Math.min(1, 0.25 * words.filter((w) => about.includes(w)).length)

  if (mentions(text, agent.name)) {
    result.score += 10
    result.named = true
  } else if (contextText && mentions(contextText, agent.name)) {
    result.score += 5
    result.named = true
  }
  result.score = Math.round(result.score * 100) / 100
  return result
}

function describePick(best: Scored): string {
  const { agent } = best
  if (best.named) return `You mentioned ${agent.name} by name.`
  const caps = best.caps.slice(0, 2).map((c) => CAPABILITIES[c].label.toLowerCase())
  const fits = best.cue ? ` — fits “${best.cue}”` : ''
  if (caps.length) return `${agent.name} (${agent.role}) can ${joinList(caps)}${fits}.`
  return `${agent.name}’s role (${agent.role}) matches the request${fits}.`
}

/**
 * The best active agent for `text`, or null when no agent clearly fits (score < 1.5).
 * `opts.context` (e.g. the whole workflow description) contributes at half weight;
 * `opts.runs` breaks ties by recent success rate.
 */
export function pickAgentForInstruction(text: string, agents: readonly Agent[], opts: PickAgentOptions = {}): AgentPick | null {
  const instruction = text.replace(/\s+/g, ' ').trim()
  const contextText = opts.context?.replace(/\s+/g, ' ').trim() ?? ''
  const active = agents.filter((a) => a.status === 'active')
  if (!active.length || (!instruction && !contextText)) return null

  const own = topicHits(instruction)
  // Sending is its own workflow step, so messaging cues elsewhere in the context say nothing about who does the work.
  const context = topicHits(contextText).filter((h) => h.topic.id !== 'comms' && !own.some((o) => o.topic.id === h.topic.id))
  const words = terms(instruction)
  const scored = active.map((agent) => scoreAgent(agent, own, context, words, instruction, contextText))

  const rates = new Map<ID, number | null>()
  const rate = (id: ID) => {
    if (!rates.has(id)) rates.set(id, opts.runs ? recentSuccessRate(id, opts.runs) : null)
    return rates.get(id) ?? -1
  }
  scored.sort(
    (a, b) => b.score - a.score || rate(b.agent.id) - rate(a.agent.id) || a.agent.name.localeCompare(b.agent.name) || a.agent.id.localeCompare(b.agent.id),
  )
  const best = scored[0]
  if (!best || best.score < MIN_SCORE) return null

  let reason = describePick(best)
  const runnerUp = scored[1]
  if (runnerUp && runnerUp.score === best.score) {
    const r = rates.get(best.agent.id)
    if (r !== undefined && r !== null && r !== (rates.get(runnerUp.agent.id) ?? null)) {
      reason += ` Chosen over ${runnerUp.agent.name} for a better recent success rate (${Math.round(r * 100)}%).`
    }
  }
  return { agentId: best.agent.id, score: best.score, reason, ...(best.capability ? { capability: best.capability } : {}) }
}
