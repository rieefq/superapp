import type { CapabilityRow } from '@/app/components'
import { db } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES, evaluatePermission } from '@/core/permissions'
import { guardedAction } from '@/core/runs/factories/workflow'
import { soleAgentId } from '@/core/services/workflows'
import type { Capability, PermissionDecision, Workflow } from '@/core/types'

/**
 * What a workflow can do, read the way its runs behave (src/core/runs/factories/workflow.ts):
 * actions are checked against the live permission policy (allowed · asks you · blocked); an action
 * right after an approval step is decided there; reads by agents, transforms and the trigger never
 * ask. Rows are shaped like the ReadBack's CapabilityRow so the shared ReadBack can show them.
 */

export interface WorkflowCapability extends CapabilityRow {
  /** Short text for the summary line: "Post to #product". */
  short: string
  /** The node(s) this row is about. */
  nodeIds: string[]
}

const WORD = { allow: 'allowed', ask: 'asks you', deny: 'blocked' } as const

/** Atrium's own knowledge and tasks are real; everything else in a workflow run is simulated. */
const LOCAL: ReadonlySet<Capability> = new Set(['knowledge.read', 'knowledge.write', 'tasks.manage'])

export function workflowCapabilities(wf: Pick<Workflow, 'nodes' | 'edges'>): WorkflowCapability[] {
  const agentId = soleAgentId(wf)
  const reads: WorkflowCapability[] = []
  const acts: WorkflowCapability[] = []
  const covered = new Map<string, string>()
  for (const n of wf.nodes) {
    if (n.type !== 'approval') continue
    const g = guardedAction(n, wf.nodes, wf.edges)
    if (g) covered.set(g.id, n.label)
  }
  const seenReads = new Map<string, WorkflowCapability>()

  for (const n of wf.nodes) {
    if (n.type === 'action') {
      const def = getIntegration(n.integrationId)
      const capability = n.capability ?? def?.capabilities[0]
      if (!capability) continue
      const conn = n.integrationId ? db.get('connections', n.integrationId) : undefined
      const simulated = def ? def.support === 'simulated' || !LOCAL.has(capability) : !LOCAL.has(capability)
      let decision: PermissionDecision
      if (n.integrationId && conn?.status !== 'connected') decision = { outcome: 'deny', reason: `${def?.name ?? n.integrationId} is not connected` }
      else if (covered.has(n.id)) decision = { outcome: 'ask', reason: `You decide at the “${covered.get(n.id)}” step` }
      else decision = evaluatePermission({ capability, risk: CAPABILITIES[capability].risk, agentId, integrationId: n.integrationId })
      acts.push({ capability, integrationId: n.integrationId, simulated, label: n.label, short: n.label, decision, word: WORD[decision.outcome], nodeIds: [n.id] })
      continue
    }
    if (n.type === 'approval' && !guardedAction(n, wf.nodes, wf.edges)) {
      acts.push({
        capability: n.capability ?? 'workflows.run',
        simulated: false,
        label: n.label,
        short: n.label,
        decision: { outcome: 'ask', reason: 'An approval step always asks you' },
        word: 'asks you',
        nodeIds: [n.id],
      })
      continue
    }
    if ((n.type === 'agent' || n.type === 'transform' || n.type === 'trigger') && n.capability) {
      const key = `${n.capability}:${n.integrationId ?? ''}`
      const prev = seenReads.get(key)
      if (prev) {
        prev.nodeIds.push(n.id)
        continue
      }
      const def = getIntegration(n.integrationId)
      const label = CAPABILITIES[n.capability].label
      const row: WorkflowCapability = {
        capability: n.capability,
        integrationId: n.integrationId,
        simulated: !LOCAL.has(n.capability) || def?.support === 'simulated',
        label: def ? `${label} · ${def.name}` : label,
        short: label,
        decision: { outcome: 'allow', reason: n.type === 'agent' ? 'Agent steps work within the agent’s own permissions and don’t ask' : 'Reads and reshaping steps don’t ask' },
        word: 'allowed',
        nodeIds: [n.id],
      }
      seenReads.set(key, row)
      reads.push(row)
    }
  }
  // Reads first, then what the workflow does in the world.
  return [...reads, ...acts]
}
