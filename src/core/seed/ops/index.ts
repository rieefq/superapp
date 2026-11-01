import type { Tables } from '@/core/db/schema'
import type { Approval, ID, Run } from '@/core/types'
import { buildActivity, buildLinks } from './activity'
import { buildAgents } from './agents'
import { buildSessions, codeRunSpecs, STRIPE_INFLIGHT_RUN } from './code'
import { buildConnections } from './connections'
import { agentRunSpecs } from './history/agentRuns'
import { chatRunSpecs } from './history/chatRuns'
import { researchRunSpecs } from './history/researchRuns'
import { studioRunSpecs } from './history/studioRuns'
import { workflowRunSpecs } from './history/workflowRuns'
import { inflightSpecs } from './inflight'
import { buildNotifications } from './notifications'
import { buildRepo, buildSessionChanges } from './repo'
import { materializeInflight, materializeRun } from './runKit'
import { buildStory } from './story'
import { createClock } from './time'
import { buildTimeline } from './timeline'
import { byId } from './util'
import { buildWorkflows } from './workflows'

export type { ScriptedRunParams, SeedPatch } from './types'
export { SCRIPTED_FACTORY } from './types'

/**
 * Operations half of the first-run demo world: agents, workflows, the demo repo and its
 * coding sessions, ~75 runs (5 still in flight), approvals, connections, notifications,
 * activity and links. Deterministic for a given `now`; every timestamp is relative to it.
 */
export function buildOps(now: number): Partial<Tables> {
  const clock = createClock(now)
  const tl = buildTimeline(clock)
  const story = buildStory(tl)
  const changes = buildSessionChanges()

  const agents = buildAgents(clock)
  const workflows = buildWorkflows(clock)
  const repo = buildRepo(clock)

  const history = [
    ...chatRunSpecs(tl),
    ...agentRunSpecs(tl, story),
    ...workflowRunSpecs(tl, story),
    ...researchRunSpecs(tl),
    ...studioRunSpecs(tl),
    ...codeRunSpecs(tl, changes),
  ].map(materializeRun)
  const live = inflightSpecs(tl, story, changes).map((spec) => materializeInflight(spec, now))
  const runs: Run[] = [...history, ...live].map((m) => m.run).sort((a, b) => a.createdAt - b.createdAt)
  const approvals: Approval[] = [...history, ...live].flatMap((m) => m.approvals)

  for (const wf of workflows) {
    const last = runs.filter((r) => r.workflowId === wf.id).reduce((t, r) => Math.max(t, r.startedAt ?? r.createdAt), 0)
    if (last) wf.lastRunAt = last
  }

  const stripeRun = required(runs.find((r) => r.id === STRIPE_INFLIGHT_RUN), STRIPE_INFLIGHT_RUN)
  const stripeWait = stripeRun.steps.find((step) => step.status === 'waiting')
  const sessions = buildSessions(tl, changes, {
    createdAt: stripeRun.createdAt,
    pausedAt: stripeWait?.startedAt ?? stripeRun.createdAt,
  })
  const connections = buildConnections(clock, runs, agents, workflows)

  const runIndex = byId(runs)
  const approvalIndex = byId(approvals)
  const lookup = {
    run: (id: ID) => required(runIndex[id], id),
    approval: (id: ID) => required(approvalIndex[id], id),
  }
  const notifications = buildNotifications(tl, lookup)
  const activity = buildActivity({ tl, runs, approvals, agents, workflows, sessions, connections, repo })
  const links = buildLinks(runs, sessions)

  return {
    agents: byId(agents),
    workflows: byId(workflows),
    repos: byId([repo]),
    runs: runIndex,
    approvals: approvalIndex,
    sessions: byId(sessions),
    connections: byId(connections),
    notifications: byId(notifications),
    activity: byId(activity),
    links: byId(links),
  }
}

function required<T>(row: T | undefined, id: ID): T {
  if (!row) throw new Error(`seed: missing ${id}`)
  return row
}
