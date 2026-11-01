import { INTEGRATION_BY_ID } from '@/core/integrations/catalog'
import type {
  ActivityEvent, ActorRef, Agent, Approval, CodeSession, EntityRef, ID, IntegrationConnection, Link, LinkRel, Repo, Run, Workflow,
} from '@/core/types'
import { AGENT, PROJECT } from '../ids'
import type { Timeline } from './timeline'
import { ref } from './util'

const ME: ActorRef = { type: 'user', id: 'usr_me' }
const SYSTEM: ActorRef = { type: 'system', id: 'system' }

interface Input {
  tl: Timeline
  runs: Run[]
  approvals: Approval[]
  agents: Agent[]
  workflows: Workflow[]
  sessions: CodeSession[]
  connections: IntegrationConnection[]
  repo: Repo
}

type Draft = Omit<ActivityEvent, 'id'>

/** Audit trail for the operations side of the demo world (chat activity belongs to the threads). */
export function buildActivity(input: Input): ActivityEvent[] {
  const { tl, runs, approvals, agents, workflows, sessions, connections, repo } = input
  const agentName = (id: ID | undefined) => agents.find((a) => a.id === id)?.name ?? 'Agent'
  const workflowName = (id: ID | undefined) => workflows.find((w) => w.id === id)?.name ?? 'Workflow'
  const events: Draft[] = []
  const add = (e: Draft) => events.push(e)

  for (const c of connections) {
    const name = INTEGRATION_BY_ID[c.id]?.name ?? c.id
    add({
      at: c.connectedAt ?? tl.clock.now, actor: ME, verb: 'connected', target: ref('integration', c.id), projectId: null,
      summary: `Connected ${name} (${c.mode === 'live' ? 'live, public repositories' : 'simulated'})`,
    })
  }
  add({
    at: tl.jiraTokenExpired, actor: SYSTEM, verb: 'failed', target: ref('integration', 'jira'), projectId: null,
    summary: 'Jira sync failed: token expired', meta: { error: 'Token expired — reconnect to resume syncing' },
  })
  add({
    at: repo.connectedAt, actor: ME, verb: 'connected', target: ref('repo', repo.id), projectId: PROJECT.atlas,
    summary: `Connected repository ${repo.fullName} (bundled demo, simulated)`,
  })

  for (const a of agents) {
    add({ at: a.createdAt, actor: ME, verb: 'created', target: ref('agent', a.id), projectId: null, summary: `Created agent ${a.name} (${a.role})` })
  }
  const agentUpdates: [ID, string][] = [
    [AGENT.scout, 'Set Scout’s monthly budget to $25'],
    [AGENT.forge, 'Updated Forge’s instructions: run e2e when touching auth, billing or checkout'],
    [AGENT.herald, 'Scheduled Herald for Mondays at 09:00'],
    [AGENT.sentinel, 'Changed Sentinel’s autonomy to autonomous'],
    [AGENT.muse, 'Limited Muse’s knowledge to the Brand collection and the Lumen project'],
  ]
  for (const [id, summary] of agentUpdates) {
    const agent = agents.find((a) => a.id === id)
    if (agent) add({ at: agent.updatedAt, actor: ME, verb: 'updated', target: ref('agent', id), projectId: null, summary })
  }
  add({
    at: tl.archivistPaused, actor: ME, verb: 'paused', target: ref('agent', AGENT.archivist), projectId: null,
    summary: 'Paused Archivist until the Notion workspace reorganization is done',
    meta: { reason: 'Nightly sync hit Notion rate limits after the reorganization' },
  })

  const workflowUpdates: Record<string, string> = {
    wfl_triage: 'Linear issues now quote the customer’s exact words',
    wfl_digest: 'added the calendar lookahead',
    wfl_pr_review: 'review limit set to 600 changed lines',
    wfl_radar: 'dedupe against the Research collection',
  }
  for (const w of workflows) {
    add({ at: w.createdAt, actor: ME, verb: 'created', target: ref('workflow', w.id), projectId: w.projectId, summary: `Created workflow “${w.name}”` })
    const change = workflowUpdates[w.id]
    if (change) {
      add({
        at: w.updatedAt, actor: ME, verb: 'updated', target: ref('workflow', w.id), projectId: w.projectId,
        summary: `Updated “${w.name}” (v${w.version}): ${change}`, meta: { version: w.version },
      })
    }
    if (!w.enabled) {
      add({
        at: w.updatedAt, actor: ME, verb: 'disabled', target: ref('workflow', w.id), projectId: w.projectId,
        summary: `Disabled “${w.name}” after the Drive upload failed`,
      })
    }
  }

  for (const s of sessions) {
    add({
      at: s.createdAt, actor: ME, verb: 'created', target: ref('session', s.id), projectId: s.projectId,
      summary: `Started coding session “${s.title}” with Forge`,
    })
    if (s.status === 'merged' && s.pr) {
      add({
        at: s.updatedAt, actor: ME, verb: 'merged', target: ref('session', s.id), projectId: s.projectId,
        summary: `Merged PR #${s.pr.number} “${s.pr.title}”`, meta: { pr: s.pr.number },
      })
    }
  }

  const runById = new Map(runs.map((r) => [r.id, r]))
  for (const a of approvals) {
    const run = runById.get(a.runId)
    const projectId = run?.projectId ?? null
    if (a.status === 'pending') {
      const requester = a.requestedBy.type === 'agent' ? agentName(a.requestedBy.id) : workflowName(a.requestedBy.id)
      add({
        at: a.createdAt, actor: a.requestedBy, verb: 'requested', target: ref('approval', a.id), projectId,
        summary: `${requester} requested approval: ${a.title}`, meta: { runId: a.runId, capability: a.capability },
      })
    } else if (a.resolvedAt) {
      const verb = a.status === 'approved' ? 'approved' : 'rejected'
      add({
        at: a.resolvedAt, actor: ME, verb, target: ref('approval', a.id), projectId,
        summary: `${verb === 'approved' ? 'Approved' : 'Rejected'}: ${a.title}`,
        meta: { runId: a.runId, capability: a.capability, ...(a.resolution?.note ? { note: a.resolution.note } : {}) },
      })
    }
  }

  for (const run of runs) {
    if (run.kind === 'chat') continue
    const meta = { status: run.status, tokens: run.usage.inputTokens + run.usage.outputTokens, costUsd: run.usage.costUsd, simulated: true }
    const actor: ActorRef = run.workflowId
      ? { type: 'workflow', id: run.workflowId }
      : run.agentId
        ? { type: 'agent', id: run.agentId }
        : ME
    const who = run.workflowId ? workflowName(run.workflowId) : agentName(run.agentId)
    if (run.status === 'running' || run.status === 'waiting') {
      const byUser = run.initiator.type === 'user'
      add({
        at: run.startedAt ?? run.createdAt, actor: byUser ? ME : actor, verb: 'started', target: ref('run', run.id), projectId: run.projectId,
        summary: byUser ? `Started “${run.title}” with ${who}` : `${who} started “${run.title}”`, meta,
      })
      continue
    }
    const at = run.endedAt ?? run.createdAt
    if (run.status === 'succeeded') {
      add({ at, actor, verb: 'completed', target: ref('run', run.id), projectId: run.projectId, summary: `${who} completed “${run.title}”`, meta })
    } else if (run.status === 'failed') {
      add({
        at, actor, verb: 'failed', target: ref('run', run.id), projectId: run.projectId,
        summary: `“${run.title}” failed: ${run.error ?? 'unknown error'}`, meta,
      })
    } else if (run.status === 'cancelled') {
      const byApproval = run.steps.some((s) => s.status === 'skipped' && s.approvalId)
      add({
        at, actor: byApproval ? actor : ME, verb: 'cancelled', target: ref('run', run.id), projectId: run.projectId,
        summary: byApproval ? `${who} stopped “${run.title}” after an approval was rejected` : `Cancelled “${run.title}”`, meta,
      })
    }
  }

  return events
    .sort((a, b) => a.at - b.at || (a.summary < b.summary ? -1 : a.summary > b.summary ? 1 : 0))
    .map((e, i) => ({ id: `act_seed_${String(i + 1).padStart(3, '0')}`, ...e }))
}

/** Graph edges for ops entities: provenance of runs and sessions, outputs, workflow membership. */
export function buildLinks(runs: Run[], sessions: CodeSession[]): Link[] {
  const links: Omit<Link, 'id'>[] = []
  const add = (from: EntityRef, to: EntityRef, rel: LinkRel, createdAt: number) => links.push({ from, to, rel, createdAt })
  for (const run of runs) {
    const self = ref('run', run.id)
    if (run.origin && run.origin.kind !== 'workflow') add(self, run.origin, 'derived_from', run.createdAt)
    if (run.workflowId) add(self, ref('workflow', run.workflowId), 'part_of', run.createdAt)
    for (const output of run.outputs) add(self, output, 'produced', run.endedAt ?? run.createdAt)
  }
  for (const s of sessions) {
    if (s.taskId) add(ref('session', s.id), ref('task', s.taskId), 'derived_from', s.createdAt)
  }
  return links.map((l, i) => ({ id: `lnk_seed_${String(i + 1).padStart(3, '0')}`, ...l }))
}
