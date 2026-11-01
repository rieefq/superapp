import { useMemo, useRef } from 'react'
import { Unplug } from 'lucide-react'
import { useDB } from '@/core/db'
import { evaluatePermission } from '@/core/permissions'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { disconnectImpactIn, type DisconnectImpact } from '@/core/services/integrations'
import type { IntegrationDef } from '@/core/types'
import { AgentMark, Button, Dialog, DialogTitle, MonogramMark } from '@/ui'

function Blocked() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-ink-2">
      blocked <span aria-hidden>⊘</span>
    </span>
  )
}

function Leader() {
  return <span aria-hidden className="mb-[3px] min-w-3 flex-1 self-end border-b border-dotted border-line-input" />
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-x-3">
      <dt className="type-label pt-px text-ink-3">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1">{children}</dd>
    </div>
  )
}

/**
 * The ReadBack for disconnecting (§6.11): which agents and workflows lose this service (each use
 * re-evaluated with the real permission policy as "not connected" → blocked), what is kept and what
 * is removed from this browser.
 */
function ImpactReadBack({ def, impact }: { def: IntegrationDef; impact: DisconnectImpact }) {
  const agentRows = impact.agents.flatMap(({ agent, capabilities }) =>
    capabilities.map((capability) => {
      const decision = evaluatePermission({ capability, agentId: agent.id, integrationId: def.id }, { connection: null })
      return { key: `${agent.id}:${capability}`, agent, capability, decision }
    }),
  )
  const nothing = !agentRows.length && !impact.workflows.length && !impact.repos.length
  return (
    <dl aria-label="What changes" className="type-mono-sm flex flex-col gap-2.5 rounded-sm border border-line bg-sunken px-3 py-3 text-ink">
      <Row label="Disconnect">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          {def.name}
          <span className="text-ink-3">· {def.support === 'live' ? 'live' : 'simulated'}</span>
        </span>
      </Row>
      <Row label="Affects">
        {nothing && <span className="text-ink-3">No agents or workflows use it.</span>}
        {agentRows.map((r) => (
          <span key={r.key} className="flex min-w-0 items-baseline gap-2" title={r.decision.reason}>
            <AgentMark seed={r.agent.sigil} hue={r.agent.hue} size={12} className="self-center" />
            <span className="shrink-0">{r.agent.name}</span>
            <span className="min-w-0 truncate text-ink-3">{CAPABILITIES[r.capability].label}</span>
            <Leader />
            {r.decision.outcome === 'deny' ? <Blocked /> : <span className="shrink-0 text-ink-2">{r.decision.outcome === 'ask' ? 'asks you' : 'allowed'}</span>}
          </span>
        ))}
        {impact.workflows.map(({ workflow, nodes, trigger }) => (
          <span key={workflow.id} className="flex min-w-0 items-baseline gap-2">
            <MonogramMark text={workflow.name} hue={workflow.hue} size={12} className="self-center" />
            <span className="min-w-0 truncate" title={`${workflow.name} · ${trigger ? 'trigger' : `${nodes.length} ${nodes.length === 1 ? 'step' : 'steps'}`}`}>
              {workflow.name}
            </span>
            {!workflow.enabled && <span className="shrink-0 text-ink-3">off</span>}
            <Leader />
            <Blocked />
          </span>
        ))}
        {impact.repos.map((r) => (
          <span key={r.id} className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate">{r.fullName}</span>
            <Leader />
            <span className="shrink-0 text-ink-2">public reads only</span>
          </span>
        ))}
      </Row>
      <Row label="Keeps">
        <span className="text-ink-2">
          Permissions and history{impact.usageCount ? ` (${impact.usageCount} ${impact.usageCount === 1 ? 'use' : 'uses'})` : ''}, for when you reconnect.
        </span>
      </Row>
      {impact.secrets.length > 0 && (
        <Row label="Removes">
          <span className="text-ink-2">The {impact.secrets.map((s) => s.toLowerCase()).join(' and ')} stored in this browser.</span>
        </Row>
      )}
    </dl>
  )
}

/**
 * Disconnect, confirmed (§3.10 anatomy: 440px, title, body, Cancel first for destructive actions).
 * A custom dialog because the ReadBack is a block, which `confirm()`'s paragraph body can't hold.
 */
export function DisconnectDialog({ def, open, onOpenChange, onConfirm }: { def: IntegrationDef; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Read once per open (a snapshot is right for a confirmation).
  const impact = useMemo(() => (open ? disconnectImpactIn(useDB.getState(), def.id) : null), [open, def.id])
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      role="alertdialog"
      size="sm"
      className="max-w-[440px]"
      hideClose
      initialFocus={cancelRef}
      header={
        <div className="flex gap-3 px-5 pt-5 pb-2">
          <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-sm bg-fail-tint text-fail-ink">
            <Unplug className="size-4" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle className="type-title-3">Disconnect {def.name}?</DialogTitle>
            <p className="text-sm text-pretty text-ink-2">
              Runs that need {def.name} are blocked at that step until you reconnect.
            </p>
          </div>
        </div>
      }
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger-solid"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            Disconnect
          </Button>
        </>
      }
    >
      {impact && <ImpactReadBack def={def} impact={impact} />}
    </Dialog>
  )
}
