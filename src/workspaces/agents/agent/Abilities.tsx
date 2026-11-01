import { useMemo } from 'react'
import { Link } from 'react-router'
import { ChevronDown, Ellipsis, Lock, Plus, Trash2 } from 'lucide-react'
import { CAPABILITIES, CAPABILITY_LIST } from '@/core/permissions'
import type { Agent, Capability, CapabilityGrant, GrantMode, Hue } from '@/core/types'
import { getIntegration } from '@/core/integrations/catalog'
import { cn } from '@/lib/cn'
import { Button, DynamicIcon, IconButton, LiveBadge, Menu, MonogramMark, SegmentedControl, SimBadge, StatusGlyph, Tooltip, type MenuItem } from '@/ui'
import { decisionWord, defaultIntegration, providersFor, type AbilityRow, useAbilityRows } from '../abilities'
import { RISK_GROUP_LABEL, groupByRisk } from '../logic'

const MODES: { value: GrantMode; label: string }[] = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask' },
  { value: 'deny', label: 'Deny' },
]

export interface AbilitiesEditorProps {
  /** The agent the decisions are evaluated for (a saved agent, or a draft with the grants applied). */
  agent: Agent
  onChange: (grants: CapabilityGrant[]) => void
  className?: string
}

/**
 * The Abilities matrix (§6.4 Configure): rows grouped by risk; Allow · Ask · Deny; the providing
 * integration with LIVE/SIM and its connection (with a link to connect it); rows forced by
 * Settings › always-ask locked with the reason; "Always allow" grants shown distinctly with Revoke;
 * and the effective decision of the live permission policy.
 */
export function AbilitiesEditor({ agent, onChange, className }: AbilitiesEditorProps) {
  const rows = useAbilityRows(agent)
  const grants = agent.capabilities
  const groups = useMemo(() => groupByRisk(grants, (c) => CAPABILITIES[c].risk), [grants])
  const byIndex = useMemo(() => new Map(rows.map((r) => [r.index, r])), [rows])
  const missing = CAPABILITY_LIST.filter((c) => !grants.some((g) => g.capability === c.id))

  const update = (index: number, patch: Partial<CapabilityGrant>) => {
    const next = grants.map((g, i) => {
      if (i !== index) return g
      const merged: CapabilityGrant = { ...g, ...patch }
      // "Always allow" only means something on an allow grant.
      if (merged.mode !== 'allow' || patch.always === false) delete merged.always
      if (!merged.integrationId) delete merged.integrationId
      return merged
    })
    onChange(next)
  }
  const remove = (index: number) => onChange(grants.filter((_, i) => i !== index))
  const add = (capability: Capability) => {
    const info = CAPABILITIES[capability]
    const integrationId = defaultIntegration(capability)
    onChange([...grants, { capability, mode: info.risk === 'low' ? 'allow' : 'ask', ...(integrationId ? { integrationId } : {}) }])
  }

  const addItems: MenuItem[] = (['low', 'medium', 'high'] as const).flatMap((risk) => {
    const list = missing.filter((c) => c.risk === risk)
    if (!list.length) return []
    return [
      { type: 'label' as const, label: RISK_GROUP_LABEL[risk] },
      ...list.map((c) => ({ id: c.id, label: c.label, description: c.description, onSelect: () => add(c.id) })),
    ]
  })

  return (
    <div className={cn('@container/abilities flex min-w-0 flex-col gap-3', className)}>
      {grants.length === 0 ? (
        <p className="type-body-sm rounded-md border border-line px-4 py-5 text-center text-ink-3">
          No abilities yet. {agent.name || 'This agent'} can only think and write a summary. Add what it may do.
        </p>
      ) : (
        <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line">
          <div aria-hidden className="type-label hidden grid-cols-[minmax(0,1fr)_190px_168px_140px_28px] items-center gap-3 border-b border-line bg-raised px-3 py-2 text-ink-3 @min-[760px]/abilities:grid">
            <span>Ability</span>
            <span>Provided by</span>
            <span>Access</span>
            <span>In practice</span>
            <span />
          </div>
          {groups.map((group) => (
            <section key={group.risk} aria-label={RISK_GROUP_LABEL[group.risk]} className="flex flex-col">
              <h4 className={cn('type-label border-b border-line px-3 py-1.5', group.risk === 'high' ? 'text-ink-2' : 'text-ink-3')}>{RISK_GROUP_LABEL[group.risk]}</h4>
              <ul className="flex flex-col">
                {group.items.map(({ index }) => {
                  const row = byIndex.get(index)
                  return row ? <AbilityRowView key={`${row.grant.capability}:${row.grant.integrationId ?? ''}`} row={row} onChange={(p) => update(index, p)} onRemove={() => remove(index)} /> : null
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <Menu
          items={addItems}
          aria-label="Add an ability"
          trigger={
            <Button size="sm" variant="ghost" leadingIcon={Plus} trailingIcon={ChevronDown} className="self-start">
              Add an ability
            </Button>
          }
        />
      )}
    </div>
  )
}

function ProviderCell({ row, onChange }: { row: AbilityRow; onChange: (p: Partial<CapabilityGrant>) => void }) {
  const { provider } = row
  const def = provider.id ? getIntegration(provider.id) : undefined
  const switchable = provider.options.length > 1
  const mark = def ? (
    <MonogramMark text={def.monogram || def.name} hue={(def.hue as Hue) ?? 'sky'} size={18} variant="ring" simulated={!provider.live} />
  ) : (
    <span aria-hidden className="grid size-[18px] shrink-0 place-items-center rounded-full border border-line-strong">
      <span className="size-1.5 rounded-full bg-ink-3" />
    </span>
  )
  const label = (
    <span className="flex min-w-0 items-center gap-1.5">
      {mark}
      <span className="type-body-sm min-w-0 truncate text-ink-2">{provider.name}</span>
      {provider.live ? <LiveBadge /> : <SimBadge />}
    </span>
  )
  const status =
    provider.status === 'local' ? (
      <span className="type-caption text-ink-3">In Atrium · real</span>
    ) : provider.status === 'connected' ? (
      <span className="type-caption text-ink-3">Connected</span>
    ) : provider.status === 'error' ? (
      <Link to={`/integrations/${provider.id}`} className="type-caption text-fail-ink underline decoration-fail/40 underline-offset-2 hover:decoration-fail">
        Error · Reconnect
      </Link>
    ) : (
      <Link to={`/integrations/${provider.id}`} className="type-caption text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink">
        Not connected · Connect
      </Link>
    )
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {switchable ? (
        <Menu
          aria-label={`Provider for ${row.info.label}`}
          items={provider.options.map((o) => ({
            type: 'radio' as const,
            id: o.id ?? 'atrium',
            label: `${o.name}${o.live ? '' : ' (simulated)'}`,
            checked: (o.id ?? undefined) === provider.id,
            onSelect: () => onChange({ integrationId: o.id }),
          }))}
          trigger={
            <button type="button" aria-label={`Provided by ${provider.name}. Change provider for ${row.info.label}`} className="-mx-1 flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-left hover:bg-hover">
              {label}
              <ChevronDown aria-hidden className="size-3 shrink-0 text-ink-3" strokeWidth={2} />
            </button>
          }
        />
      ) : (
        label
      )}
      {status}
    </div>
  )
}

function Effective({ row }: { row: AbilityRow }) {
  const d = row.decision
  return (
    <Tooltip content={`${d.reason}.`}>
      <span tabIndex={0} className={cn('type-caption inline-flex w-fit items-center gap-1.5 rounded-xs outline-offset-2', d.outcome === 'ask' ? 'text-attn-ink' : d.outcome === 'deny' ? 'text-ink-2' : 'text-ink-3')}>
        {d.outcome === 'ask' ? <StatusGlyph shape="diamond" tone="attn" size={10} decorative /> : d.outcome === 'deny' ? <StatusGlyph shape="slash" tone="ink-3" size={10} decorative /> : <StatusGlyph shape="check" tone="ink-3" size={10} decorative />}
        {decisionWord(d)}
      </span>
    </Tooltip>
  )
}

function AbilityRowView({ row, onChange, onRemove }: { row: AbilityRow; onChange: (p: Partial<CapabilityGrant>) => void; onRemove: () => void }) {
  const { grant, info } = row
  const providers = providersFor(grant.capability)
  const menu: MenuItem[] = [{ id: 'remove', label: 'Remove ability', icon: Trash2, danger: true, onSelect: onRemove }]
  return (
    <li
      data-ability={grant.capability}
      className="grid grid-cols-[minmax(0,1fr)_28px] gap-x-3 gap-y-2 border-b border-line px-3 py-3 last:border-b-0 @min-[760px]/abilities:grid-cols-[minmax(0,1fr)_190px_168px_140px_28px] @min-[760px]/abilities:items-center"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <DynamicIcon name={info.icon} className="mt-0.5 size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="type-body-sm font-medium text-ink">{info.label}</span>
          <span className="type-caption text-ink-3 text-pretty">{info.description}</span>
          {row.alwaysAsk && (
            <span className="type-caption inline-flex items-center gap-1 text-ink-2">
              <Lock aria-hidden className="size-3" strokeWidth={2} />
              Always asks:{' '}
              <Link to="/settings/permissions" className="underline decoration-line-input underline-offset-2 hover:text-ink">
                Settings › Permissions
              </Link>
            </span>
          )}
        </div>
      </div>
      <div className="col-start-2 row-start-1 flex justify-end @min-[760px]/abilities:col-start-5">
        <Menu items={menu} placement="bottom-end" aria-label={`Actions for ${info.label}`} trigger={<IconButton icon={Ellipsis} label={`More for ${info.label}`} size="xs" />} />
      </div>
      <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 pl-6.5 @min-[760px]/abilities:contents">
        <div className="min-w-0 @min-[760px]/abilities:col-start-2 @min-[760px]/abilities:row-start-1">
          {providers.length > 0 ? <ProviderCell row={row} onChange={onChange} /> : <span className="type-caption text-ink-3">No provider in this build</span>}
        </div>
        <div className="flex min-w-0 flex-col gap-1 @min-[760px]/abilities:col-start-3 @min-[760px]/abilities:row-start-1">
          <SegmentedControl
            size="sm"
            aria-label={`Access for ${info.label}`}
            value={grant.mode}
            onValueChange={(mode) => onChange({ mode: mode as GrantMode })}
            options={MODES.map((m) => ({ ...m, disabled: m.value === 'allow' && row.alwaysAsk && grant.mode !== 'allow' }))}
          />
          {grant.always && grant.mode === 'allow' && (
            <span className="type-caption inline-flex items-center gap-1.5 text-ink-2">
              <span className="rounded-xs border border-line-strong px-1 text-ink">Always allow</span>
              <button type="button" onClick={() => onChange({ always: false })} className="text-ink-3 underline decoration-line-input underline-offset-2 hover:text-ink">
                Revoke
              </button>
            </span>
          )}
        </div>
        <div className="min-w-0 @min-[760px]/abilities:col-start-4 @min-[760px]/abilities:row-start-1">
          <Effective row={row} />
        </div>
      </div>
    </li>
  )
}
