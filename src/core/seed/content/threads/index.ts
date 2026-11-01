import type { ID, KnowledgeItem, Message, Thread } from '@/core/types'
import { buildThread, type SeedCtx, type ThreadSpec } from '../helpers'
import { atlasThreads } from './atlas'
import { lumenThreads } from './lumen'
import { landscapeThreads, opsThreads, personalThreads, unscopedThreads } from './other'

export function threadSpecs(ctx: SeedCtx): ThreadSpec[] {
  return [
    ...atlasThreads(ctx),
    ...landscapeThreads(ctx),
    ...lumenThreads(ctx),
    ...opsThreads(ctx),
    ...personalThreads(ctx),
    ...unscopedThreads(ctx),
  ]
}

export function buildThreads(
  ctx: SeedCtx,
  knowledge: Record<ID, KnowledgeItem>,
): { threads: Thread[]; messages: Message[] } {
  const threads: Thread[] = []
  const messages: Message[] = []
  const titleOf = (id: ID) => knowledge[id]?.title
  for (const spec of threadSpecs(ctx)) {
    const built = buildThread(spec, titleOf)
    threads.push(built.thread)
    messages.push(...built.messages)
  }
  return { threads, messages }
}
