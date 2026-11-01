import type {
  ActorRef, Attachment, Citation, EntityKind, EntityRef, ID, Message, Thread, ToolTrace, Usage,
} from '@/core/types'
import { ME } from '@/core/types'
import { buildAnchors, type Anchors } from './anchors'

/**
 * Shared helpers for the seed content part. Everything here is pure and deterministic:
 * timestamps are derived from the `now` passed to `buildContent`, never from the clock.
 */

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export type Unit = 'm' | 'h' | 'd'
const UNIT_MS: Record<Unit, number> = { m: MINUTE, h: HOUR, d: DAY }

export interface Clock {
  readonly now: number
  /** `n` units before now. */
  ago(n: number, unit: Unit): number
  /** `n` units after now — only for due dates and milestones. */
  ahead(n: number, unit: Unit): number
  /** `d` days, `h` hours and `m` minutes before now (use for "today" moments). */
  back(d: number, h?: number, m?: number): number
  /** The k-th most recent weekday (Mon–Fri) before today, at hh:mm local time. */
  wd(k: number, hh: number, mm?: number): number
  /** k calendar days before today (k ≥ 1), at hh:mm local time. */
  day(k: number, hh: number, mm?: number): number
  /** The most recent `count` occurrences of a weekday (0 = Sunday … 6 = Saturday) before today. */
  last(dow: number, count: number, hh: number, mm?: number): number[]
}

/**
 * History is placed on local working hours, with the same weekday arithmetic as the
 * operations part (`../ops/time.ts`), so both halves of the seed agree on when things
 * happened. Everything from `wd`/`day`/`last` is before today's midnight.
 */
export function createClock(now: number): Clock {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const base = midnight.getTime()
  const at = (daysBack: number, hh: number, mm: number): number => {
    const d = new Date(base)
    d.setDate(d.getDate() - Math.max(1, daysBack))
    d.setHours(hh, mm, 0, 0)
    return d.getTime()
  }
  const dowOf = (daysBack: number) => new Date(at(daysBack, 12, 0)).getDay()
  const weekdays: number[] = []
  for (let k = 1; weekdays.length < 45; k++) {
    const dow = dowOf(k)
    if (dow !== 0 && dow !== 6) weekdays.push(k)
  }
  return {
    now,
    ago: (n, unit) => now - n * UNIT_MS[unit],
    ahead: (n, unit) => now + n * UNIT_MS[unit],
    back: (d, h = 0, m = 0) => now - d * DAY - h * HOUR - m * MINUTE,
    wd: (k, hh, mm = 0) => at(weekdays[Math.min(weekdays.length, Math.max(1, k)) - 1], hh, mm),
    day: (k, hh, mm = 0) => at(k, hh, mm),
    last: (dow, count, hh, mm = 0) => {
      const out: number[] = []
      for (let k = 1; out.length < count; k++) if (dowOf(k) === dow) out.push(at(k, hh, mm))
      return out
    },
  }
}

/** Key story dates. Future ones are relative to now; past ones follow `anchors.ts`. */
export interface StoryDates {
  /** Atlas Lumen public launch. */
  launch: number
  /** Lumen pricing & packaging lock. */
  pricingLock: number
  /** First Stripe Billing cutover cohort. */
  cutover: number
  /** Portal v2 general availability. */
  ga: number
  /** Checkout latency incident. */
  incident: number
  /** Weekly product sync meeting. */
  sync: number
  /** Customer call with Meridian Freight. */
  meridianCall: number
}

export interface SeedCtx {
  clock: Clock
  dates: StoryDates
  at: Anchors
}

export function createCtx(now: number): SeedCtx {
  const clock = createClock(now)
  const at = buildAnchors(clock)
  return {
    clock,
    at,
    dates: {
      launch: clock.ahead(24, 'd'),
      pricingLock: clock.ahead(5, 'd'),
      cutover: clock.ahead(9, 'd'),
      ga: clock.ahead(34, 'd'),
      incident: at.incident,
      sync: at.productSync,
      meridianCall: at.meridianCall,
    },
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Oct 21" in local time, matching how the app displays dates. */
export function dayLabel(ts: number): string {
  const d = new Date(ts)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** "Wednesday" (local time). */
export function weekdayLabel(ts: number): string {
  return WEEKDAYS[new Date(ts).getDay()]
}

// ---------------------------------------------------------------- refs & actors

export const ref = (kind: EntityKind, id: ID): EntityRef => ({ kind, id })
export const kref = (id: ID): EntityRef => ({ kind: 'knowledge', id })
export const agentActor = (id: ID): ActorRef => ({ type: 'agent', id })
export const SYSTEM: ActorRef = { type: 'system', id: 'system' }
export { ME }

/** Rough token estimate (~4 characters per token), matching the app's estimator. */
export function tokensOf(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

// ---------------------------------------------------------------- conversations

export type SimModel = 'sim-deep' | 'sim-swift'

export interface UserTurn {
  role: 'user'
  id: ID
  at: number
  text: string
  attachments?: Attachment[]
}

export interface AssistantTurn {
  role: 'assistant'
  id: ID
  at: number
  model: SimModel
  text: string
  /** Knowledge items the (simulated) retrieval step returned. */
  searched?: ID[]
  /** Citations: knowledge id + a snippet quoted verbatim from that item's content. */
  cites?: Array<[ID, string]>
  reasoning?: string
  feedback?: 'up' | 'down'
}

export type Turn = UserTurn | AssistantTurn

export function user(id: ID, at: number, text: string, attachments?: Attachment[]): UserTurn {
  return { role: 'user', id, at, text, attachments }
}

export function ai(
  id: ID,
  at: number,
  model: SimModel,
  text: string,
  opts: Omit<AssistantTurn, 'role' | 'id' | 'at' | 'model' | 'text'> = {},
): AssistantTurn {
  return { role: 'assistant', id, at, model, text, ...opts }
}

export function textAttachment(id: ID, name: string, mime: string, text: string, knowledgeId?: ID): Attachment {
  return { id, name, mime, size: text.length, kind: 'text', text, knowledgeId }
}

export interface ThreadSpec {
  id: ID
  title: string
  projectId: ID | null
  pinned?: boolean
  contextRefs?: EntityRef[]
  turns: Turn[]
}

const SYSTEM_PROMPT_TOKENS = 850
const TOKENS_PER_RETRIEVED_PASSAGE = 420

/**
 * Turn a thread spec into a Thread row plus its Message rows. Assistant messages are
 * always marked simulated (the local simulator "wrote" them) with plausible token usage
 * and zero cost; `derived` is filled in later from the link graph.
 */
export function buildThread(
  spec: ThreadSpec,
  titleOf: (knowledgeId: ID) => string | undefined,
): { thread: Thread; messages: Message[] } {
  const messages: Message[] = []
  let contextTokens = 0
  let lastModel: SimModel = 'sim-swift'
  for (const turn of spec.turns) {
    if (turn.role === 'user') {
      messages.push({
        id: turn.id,
        threadId: spec.id,
        role: 'user',
        content: turn.text.trim(),
        status: 'complete',
        createdAt: turn.at,
        ...(turn.attachments?.length ? { attachments: turn.attachments } : {}),
      })
      contextTokens += tokensOf(turn.text) + (turn.attachments ?? []).reduce((n, a) => n + tokensOf(a.text ?? ''), 0)
      continue
    }
    lastModel = turn.model
    const searched = turn.searched ?? []
    const tools: ToolTrace[] = searched.length
      ? [{
          id: `tool_${turn.id}_1`,
          name: 'knowledge.search',
          label: 'Searched knowledge',
          status: 'done',
          detail: `${searched.length} ${searched.length === 1 ? 'result' : 'results'}`,
          results: searched.map(kref),
          simulated: true,
        }]
      : []
    const citations: Citation[] = (turn.cites ?? []).map(([knowledgeId, snippet], i) => ({
      id: `cit_${turn.id}_${i + 1}`,
      ref: kref(knowledgeId),
      title: titleOf(knowledgeId) ?? knowledgeId,
      snippet,
    }))
    const usage: Usage = {
      inputTokens: SYSTEM_PROMPT_TOKENS + contextTokens + TOKENS_PER_RETRIEVED_PASSAGE * searched.length,
      outputTokens: tokensOf(turn.text) + (turn.reasoning ? tokensOf(turn.reasoning) : 0),
      costUsd: 0,
    }
    messages.push({
      id: turn.id,
      threadId: spec.id,
      role: 'assistant',
      content: turn.text.trim(),
      status: 'complete',
      createdAt: turn.at,
      modelId: turn.model,
      providerId: 'simulator',
      simulated: true,
      usage,
      ...(citations.length ? { citations } : {}),
      ...(tools.length ? { tools } : {}),
      ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
      ...(turn.feedback ? { feedback: turn.feedback } : {}),
    })
    contextTokens += tokensOf(turn.text)
  }
  const first = messages[0]?.createdAt ?? 0
  const last = messages[messages.length - 1]?.createdAt ?? first
  return {
    thread: {
      id: spec.id,
      title: spec.title,
      projectId: spec.projectId,
      modelId: lastModel,
      messageIds: messages.map((m) => m.id),
      contextRefs: spec.contextRefs ?? [],
      ...(spec.pinned ? { pinned: true } : {}),
      createdAt: first,
      updatedAt: last,
    },
    messages,
  }
}

/** Index rows by id. */
export function byId<T extends { id: ID }>(rows: readonly T[]): Record<ID, T> {
  const out: Record<ID, T> = {}
  for (const r of rows) out[r.id] = r
  return out
}
