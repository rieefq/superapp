import { memo, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ShieldCheck } from 'lucide-react'
import { useDB, type Tables } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions'
import { entityRoute, updateAgent } from '@/core/services'
import { useSettings } from '@/core/settings'
import type { Agent, Autonomy, Capability, CapabilityGrant } from '@/core/types'
import { AgentMark, Button, DynamicIcon, RadioGroup, Switch, Tag, toast } from '@/ui'
import { cn } from '@/lib/cn'
import {
  AUTONOMY_LABEL,
  AUTONOMY_OPTIONS,
  alwaysAllowGrants,
  capabilitiesByRisk,
  grantsWithoutAlways,
  policyRows,
  RISK_SHORT,
  toggleAlwaysAsk,
  type PolicyRow,
} from '../logic'
import { BlockRow, Group, InlineLink, Row, SectionBody, SettingRow, useMarkSaved, useSaveSetting } from '../parts'
import { getSection } from '../sections'

/**
 * Permissions & safety (§6.12): default autonomy with a live explanation from the real permission
 * policy, the always-ask list, confirm-destructive, and every “Always allow” grant with Revoke.
 */
export default function PermissionsSection() {
  const safety = useSettings((s) => s.safety)
  const save = useSaveSetting()

  return (
    <SectionBody lead={getSection('permissions')!.lead}>
      <Group label="Default policy">
        <BlockRow
          id="autonomy"
          label="Default autonomy"
          hint="How much runs may do before they ask you. Agents and coding sessions can set their own; this applies to the rest."
        >
          {({ labelId, hintId }) => (
            <RadioGroup
              variant="cards"
              aria-labelledby={labelId}
              aria-describedby={hintId}
              value={safety.defaultAutonomy}
              onValueChange={(defaultAutonomy: Autonomy) => save('autonomy', 'Default autonomy', 'safety', { defaultAutonomy })}
              options={AUTONOMY_OPTIONS.map((o) => ({ value: o.value, label: o.label, description: o.effect }))}
              className="grid gap-2 sm:grid-cols-3"
            />
          )}
        </BlockRow>
        <BlockRow
          id="always-ask"
          label="Always ask"
          hint="These always wait for your approval, whatever an agent’s autonomy or grants. “Always allow” is hidden on their approval cards."
          aside={<span className="type-meta text-ink-3">{safety.alwaysAsk.length} of {Object.keys(CAPABILITIES).length}</span>}
        >
          {({ labelId, hintId }) => <AlwaysAskChips selected={safety.alwaysAsk} labelledBy={labelId} describedBy={hintId} />}
        </BlockRow>
        <SettingRow
          id="confirm-destructive"
          label="Confirm destructive actions"
          hint="Ask before deleting a single item. Resetting the demo world or erasing everything always needs a typed confirmation."
        >
          <Switch
            checked={safety.confirmDestructive}
            onCheckedChange={(confirmDestructive) => save('confirm-destructive', 'Confirm destructive actions', 'safety', { confirmDestructive })}
          />
        </SettingRow>
      </Group>

      <PolicyPreview />

      <AlwaysAllowList />
    </SectionBody>
  )
}

// ------------------------------------------------------------------------------------------------ always ask

function AlwaysAskChips({ selected, labelledBy, describedBy }: { selected: readonly Capability[]; labelledBy: string; describedBy?: string }) {
  const save = useSaveSetting()
  const ordered = useMemo(() => capabilitiesByRisk(), [])
  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} className="flex flex-wrap gap-1.5">
      {ordered.map((capability) => {
        const info = CAPABILITIES[capability]
        const on = selected.includes(capability)
        return (
          <Tag
            key={capability}
            size="md"
            selectable
            selected={on}
            title={`${info.description} Risk: ${info.risk}.`}
            onSelectedChange={(next) => save('always-ask', 'Always ask', 'safety', { alwaysAsk: toggleAlwaysAsk(selected, capability, next) })}
          >
            {info.label}
          </Tag>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ policy preview

/** What a run with no agent overrides may do right now, from `evaluatePermission`. */
function PolicyPreview() {
  const safety = useSettings((s) => s.safety)
  const rows = useMemo(() => policyRows(safety), [safety])
  const always = rows.filter((r) => r.alwaysAsk)
  const autonomyAsks = rows.filter((r) => !r.alwaysAsk && r.decision.outcome === 'ask')
  const allowed = rows.filter((r) => r.decision.outcome === 'allow')
  const effect = AUTONOMY_OPTIONS.find((o) => o.value === safety.defaultAutonomy)?.effect ?? ''
  return (
    <Group
      label="What runs may do"
      id="policy"
      aside={
        <span className="type-meta text-ink-3">
          {AUTONOMY_LABEL[safety.defaultAutonomy]} · asks before {always.length + autonomyAsks.length} of {rows.length}
        </span>
      }
      footnote="An agent’s own grants and a connected service’s permissions apply on top of this. Hover a capability for the exact reason."
    >
      <Row className="flex flex-col gap-3">
        <h3 className="type-body-sm flex items-center gap-1.5 font-medium text-attn-ink">
          Asks you <span aria-hidden>◆</span>
          <span className="type-meta font-normal text-ink-3">{always.length + autonomyAsks.length}</span>
        </h3>
        {always.length > 0 && <PolicyGroup caption="In your always-ask list" rows={always} />}
        {autonomyAsks.length > 0 && <PolicyGroup caption={`${AUTONOMY_LABEL[safety.defaultAutonomy]}: ${effect.charAt(0).toLowerCase()}${effect.slice(1)}`} rows={autonomyAsks} />}
        {always.length + autonomyAsks.length === 0 && <p className="text-xs text-ink-3">Nothing. Every capability runs without asking.</p>}
      </Row>
      <Row className="flex flex-col gap-3">
        <h3 className="type-body-sm flex items-center gap-1.5 font-medium text-ink-2">
          Runs on its own
          <span className="type-meta font-normal text-ink-3">{allowed.length}</span>
        </h3>
        {allowed.length > 0 ? (
          <PolicyGroup rows={allowed} />
        ) : (
          <p className="text-xs text-ink-3">Nothing. Every capability waits for your approval.</p>
        )}
      </Row>
    </Group>
  )
}

const PolicyGroup = memo(function PolicyGroup({ caption, rows }: { caption?: string; rows: PolicyRow[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {caption && <p className="text-xs text-ink-3 text-pretty">{caption}</p>}
      <ul className="flex flex-wrap gap-1.5" aria-label={caption ?? 'Capabilities'}>
        {rows.map((r) => (
          <li key={r.capability} title={`${r.decision.reason}.`} className="type-caption inline-flex h-[22px] items-center gap-1.5 rounded-xs border border-line px-2 text-ink-2">
            <DynamicIcon name={CAPABILITIES[r.capability].icon} aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
            {r.label}
            <span className={cn('type-meta-caps text-[10px] tracking-[0.04em]', r.risk === 'high' ? 'text-fail-ink' : 'text-ink-3')}>
              <span className="sr-only">, risk </span>
              {RISK_SHORT[r.risk]}
            </span>
            <span className="sr-only">. {r.decision.reason}.</span>
          </li>
        ))}
      </ul>
    </div>
  )
})

// ------------------------------------------------------------------------------------------------ always allow

/** Agents holding at least one "Always allow" grant (re-renders only when those agents change). */
function useAgentsWithAlwaysAllow(): Agent[] {
  return useDB(
    useShallow((s: Tables) => Object.values(s.agents).filter((a) => a.capabilities.some((g) => g.always === true && g.mode === 'allow'))),
  )
}

function AlwaysAllowList() {
  const agents = useAgentsWithAlwaysAllow()
  const groups = useMemo(() => alwaysAllowGrants(agents), [agents])
  const count = groups.reduce((n, g) => n + g.grants.length, 0)
  return (
    <Group
      label="Always allowed"
      id="always-allow"
      aside={count > 0 ? <span className="type-meta text-ink-3">{count} {count === 1 ? 'grant' : 'grants'}</span> : undefined}
      footnote={count > 0 ? 'Revoking sends the capability back to asking. Global always-ask settings win over these grants.' : undefined}
    >
      {groups.length === 0 ? (
        <Row className="flex items-start gap-3 py-4">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md border border-line bg-raised text-ink-3 shadow-inset">
            <ShieldCheck className="size-4" strokeWidth={1.5} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium text-ink">No standing permissions</p>
            <p className="text-xs text-ink-3 text-pretty">
              Choose “Always allow” on an approval card and the agent stops asking for that capability. Each one is listed here, so you can take
              it back.
            </p>
            <InlineLink to="/agents/roster" className="mt-1">
              Review agents and their permissions
            </InlineLink>
          </div>
        </Row>
      ) : (
        groups.map(({ agent, grants }) => <AgentGrantsRow key={agent.id} agent={agent} grants={grants} />)
      )}
    </Group>
  )
}

const AgentGrantsRow = memo(function AgentGrantsRow({ agent, grants }: { agent: Agent; grants: CapabilityGrant[] }) {
  const navigate = useNavigate()
  const mark = useMarkSaved()
  const alwaysAsk = useSettings((s) => s.safety.alwaysAsk)
  const agentPath = entityRoute({ kind: 'agent', id: agent.id })

  const revoke = (grant: CapabilityGrant) => {
    const label = CAPABILITIES[grant.capability].label.toLowerCase()
    const previous = agent.capabilities
    try {
      updateAgent(agent.id, { capabilities: grantsWithoutAlways(agent, grant.capability, grant.integrationId) })
      mark('always-allow', 'Always allowed')
      toast.success(`${agent.name} will ask before it can ${label}`, {
        description: 'Revoked “Always allow”.',
        duration: 8000,
        action: { label: 'Undo', onClick: () => updateAgent(agent.id, { capabilities: previous }) },
      })
    } catch (err) {
      toast.error('Couldn’t revoke the permission', {
        description: err instanceof Error ? err.message : String(err),
        action: { label: 'Retry', onClick: () => revoke(grant) },
      })
    }
  }

  return (
    <Row className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <AgentMark seed={agent.sigil} hue={agent.hue} size={24} />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <button
            type="button"
            onClick={() => navigate(agentPath)}
            className="truncate rounded-xs text-sm font-medium text-ink underline-offset-2 hover:underline"
          >
            {agent.name}
          </button>
          <span className="truncate text-xs text-ink-3">{agent.role}</span>
        </div>
        <span className="type-meta shrink-0 text-ink-3">{AUTONOMY_LABEL[agent.autonomy]}</span>
      </div>
      <ul className="flex flex-col gap-1 pl-[34px]" aria-label={`${agent.name}’s always-allowed capabilities`}>
        {grants.map((g) => {
          const info = CAPABILITIES[g.capability]
          const via = g.integrationId ? (getIntegration(g.integrationId)?.name ?? g.integrationId) : null
          return (
            <li key={`${g.capability}|${g.integrationId ?? ''}`} className="flex min-h-8 items-center gap-2.5">
              <DynamicIcon name={info.icon} aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
                {info.label}
                {via && <span className="text-ink-3"> · via {via}</span>}
                {alwaysAsk.includes(g.capability) && <span className="text-ink-3"> · still asks: it’s in your always-ask list</span>}
              </span>
              <span className={cn('type-meta-caps shrink-0', info.risk === 'high' ? 'text-fail-ink' : 'text-ink-3')}>{RISK_SHORT[info.risk]}</span>
              <Button size="sm" variant="ghost" onClick={() => revoke(g)} aria-label={`Revoke: always allow ${agent.name} to ${info.label.toLowerCase()}`}>
                Revoke
              </Button>
            </li>
          )
        })}
      </ul>
    </Row>
  )
})
