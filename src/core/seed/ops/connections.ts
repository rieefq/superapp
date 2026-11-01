import type { Agent, Capability, GrantMode, IntegrationConnection, Run, Workflow } from '@/core/types'
import type { Clock } from './time'

interface ConnectionDef {
  id: string
  mode: 'live' | 'simulated'
  account: string
  scopes: [Capability, GrantMode][]
  config: Record<string, string>
  connectedDaysAgo: number
  status?: IntegrationConnection['status']
  error?: string
}

/**
 * Connected integrations. Only GitHub is live (public repositories via the REST API);
 * everything else is simulated and says so. No model-provider connections: they need keys.
 */
const DEFS: ConnectionDef[] = [
  {
    id: 'github', mode: 'live', account: 'public access', connectedDaysAgo: 41, config: {},
    scopes: [['repo.read', 'allow'], ['repo.write', 'ask'], ['repo.pull_request', 'ask']],
  },
  {
    id: 'sandbox', mode: 'simulated', account: 'Simulated sandbox (node 22)', connectedDaysAgo: 41,
    config: { image: 'node:22', timeoutMinutes: '15' }, scopes: [['shell.execute', 'ask']],
  },
  {
    id: 'slack', mode: 'simulated', account: 'northwind.slack.example', connectedDaysAgo: 39,
    config: { workspace: 'Northwind Labs', defaultChannel: '#product' }, scopes: [['messages.send', 'ask']],
  },
  {
    id: 'gmail', mode: 'simulated', account: 'support@northwind.example', connectedDaysAgo: 38,
    config: { mailbox: 'support@northwind.example' }, scopes: [['files.read', 'allow'], ['messages.send', 'ask']],
  },
  {
    id: 'google-calendar', mode: 'simulated', account: 'morgan@northwind.example', connectedDaysAgo: 36,
    config: { calendar: 'Product team' }, scopes: [['calendar.manage', 'ask']],
  },
  {
    id: 'notion', mode: 'simulated', account: 'northwind.notion.example', connectedDaysAgo: 58,
    config: { spaces: 'Product, Engineering' }, scopes: [['knowledge.read', 'allow'], ['knowledge.write', 'allow'], ['files.read', 'allow']],
  },
  {
    id: 'linear', mode: 'simulated', account: 'northwind.linear.example', connectedDaysAgo: 38,
    config: { team: 'SUP' }, scopes: [['tasks.manage', 'allow']],
  },
  {
    id: 'web-search', mode: 'simulated', account: 'Simulated web corpus', connectedDaysAgo: 48,
    config: {}, scopes: [['web.search', 'allow'], ['web.browse', 'allow']],
  },
  {
    id: 'google-drive', mode: 'simulated', account: 'morgan@northwind.example', connectedDaysAgo: 16,
    config: { folder: 'Marketing / Lumen launch' }, scopes: [['files.read', 'allow'], ['files.write', 'ask']],
  },
  {
    id: 'image-gen', mode: 'simulated', account: 'Procedural previews', connectedDaysAgo: 33,
    config: { style: 'procedural' }, scopes: [['media.generate', 'allow']],
  },
  {
    id: 'postgres', mode: 'simulated', account: 'analytics-replica.northwind.example:5432/atlas', connectedDaysAgo: 27,
    config: { host: 'analytics-replica.northwind.example', port: '5432', database: 'atlas', readOnly: 'true' },
    scopes: [['data.query', 'allow']],
  },
  {
    id: 'jira', mode: 'simulated', account: 'northwind.atlassian.example', connectedDaysAgo: 47,
    config: { site: 'northwind.atlassian.example', project: 'ESC' }, scopes: [['tasks.manage', 'allow']],
    status: 'error', error: 'Token expired — reconnect to resume syncing',
  },
]

/** Usage per integration, counted from the steps that actually executed in seeded runs. */
function usageFrom(runs: Run[]): Map<string, { count: number; last: number }> {
  const usage = new Map<string, { count: number; last: number }>()
  for (const run of runs) {
    for (const step of run.steps) {
      if (!step.integrationId || (step.status !== 'done' && step.status !== 'failed')) continue
      const at = step.endedAt ?? step.startedAt ?? run.createdAt
      const cur = usage.get(step.integrationId) ?? { count: 0, last: 0 }
      usage.set(step.integrationId, { count: cur.count + 1, last: Math.max(cur.last, at) })
    }
  }
  return usage
}

export function buildConnections(clock: Clock, runs: Run[], agents: Agent[], workflows: Workflow[]): IntegrationConnection[] {
  const usage = usageFrom(runs)
  return DEFS.map((def) => {
    const used = usage.get(def.id)
    const usedBy = [
      ...agents.filter((a) => a.capabilities.some((g) => g.integrationId === def.id)).map((a) => a.id),
      ...workflows.filter((w) => w.nodes.some((n) => n.integrationId === def.id) || w.trigger.integrationId === def.id).map((w) => w.id),
    ]
    const connection: IntegrationConnection = {
      id: def.id,
      status: def.status ?? 'connected',
      mode: def.mode,
      account: def.account,
      scopes: def.scopes.map(([capability, mode]) => ({ capability, mode })),
      config: def.config,
      usageCount: used?.count ?? 0,
      connectedAt: clock.day(def.connectedDaysAgo, 10 + (def.connectedDaysAgo % 7), (def.connectedDaysAgo * 7) % 60),
      usedBy,
    }
    if (used) connection.lastUsedAt = used.last
    if (def.error) connection.error = def.error
    return connection
  })
}
