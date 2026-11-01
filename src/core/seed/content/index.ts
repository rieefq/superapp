import type { Tables } from '@/core/db/schema'
import { buildGraph } from './graph'
import { byId, createCtx } from './helpers'
import { buildCollections, buildKnowledge } from './knowledge'
import { buildProjects } from './projects'
import { buildResearch } from './research'
import { buildStudio } from './studio'
import { buildTasks } from './tasks'
import { buildThreads } from './threads'

/**
 * Seed content: the user's own work in the first-run demo world (projects, tasks,
 * knowledge, conversations, research, studio) plus the links, activity and
 * notifications for those entities. Agents, runs, approvals, workflows, repos,
 * sessions and connections come from the operations part (`../ops`).
 *
 * Deterministic for a given `now`: every timestamp is relative to it and no
 * randomness or clock reads are involved.
 */
export function buildContent(now: number): Partial<Tables> {
  const ctx = createCtx(now)

  const collections = buildCollections(ctx)
  const knowledge = byId(buildKnowledge(ctx))
  const { threads, messages: messageRows } = buildThreads(ctx, knowledge)
  const messages = byId(messageRows)
  const projects = byId(buildProjects(ctx))
  const tasks = byId(buildTasks(ctx, messages))
  const research = buildResearch(ctx, messages)
  const investigations = byId(research.investigations)
  const studio = buildStudio(ctx, messages)
  const assets = byId(studio.assets)

  // Also fills in message.derived from the derived_from links.
  const graph = buildGraph(ctx, { projects, tasks, knowledge, investigations, assets, messages })

  return {
    projects,
    tasks,
    collections: byId(collections),
    knowledge,
    threads: byId(threads),
    messages,
    investigations,
    sources: byId(research.sources),
    boards: byId(studio.boards),
    assets,
    links: byId(graph.links),
    activity: byId(graph.activity),
    notifications: byId(graph.notifications),
  }
}
