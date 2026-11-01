import type {
  ActorRef, Attachment, Citation, EntityKind, EntityRef, ID, Message, Thread, ToolTrace, Usage,
} from '@/core/types'
import { ME } from '@/core/types'

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
  /** `d` days, `h` hours and `m` minutes before now. */
  back(d: number, h?: number, m?: number): number
}

export function createClock(now: number): Clock {
  return {
    now,
    ago: (n, unit) => now - n * UNIT_MS[unit],
    ahead: (n, unit) => now + n * UNIT_MS[unit],
    back: (d, h = 0, m = 0) => now - d * DAY - h * HOUR - m * MINUTE,
  }
}

/** Key story dates, all relative to `now`. Shared so every document agrees on them. */
export interface StoryDates {
  /** Atlas Lumen public launch. */
  launch: number
  /** Lumen pricing & packaging lock. */
  pricingLock: number
  /** Stripe Billing cutover. */
  cutover: number
  /** Portal v2 general availability. */
  ga: number
  /** Checkout latency incident. */
  incident: number
  /** Weekly product sync meeting (notes imported from Notion). */
  sync: number
  /** Customer call with Meridian Freight (meeting recorder transcript). */
  meridianCall: number
}

export interface SeedCtx {
  clock: Clock
  dates: StoryDates
}

export function createCtx(now: number): SeedCtx {
  const clock = createClock(now)
  return {
    clock,
    dates: {
      launch: clock.ahead(24, 'd'),
      pricingLock: clock.ahead(5, 'd'),
      cutover: clock.ahead(9, 'd'),
      ga: clock.ahead(34, 'd'),
      incident: clock.back(11, 6),
      sync: clock.back(4, 2),
      meridianCall: clock.back(9, 4),
    },
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Oct 21" — computed in UTC so the seed is identical on every machine. */
export function dayLabel(ts: number): string {
  const d = new Date(ts)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Wednesday" (UTC). */
export function weekdayLabel(ts: number): string {
  return WEEKDAYS[new Date(ts).getUTCDay()]
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
        content: turn.text,
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
      content: turn.text,
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
