import { memo, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { useSettings } from '@/core/settings'
import { scopesFor, updateScope, type IntegrationStatus } from '@/core/services/integrations'
import type { Capability, GrantMode, IntegrationConnection, IntegrationDef } from '@/core/types'
import { DynamicIcon, LiveBadge, SegmentedControl, SimBadge, toast } from '@/ui'
import { GRANT_LABEL, alwaysAskNote, policyExplanation } from './logic'
import { RiskChip } from './parts'

const MODES: GrantMode[] = ['allow', 'ask', 'deny']

/** GitHub mixes a live capability (reads) with simulated ones (writes, pull requests). */
function capabilitySimulated(def: IntegrationDef, capability: Capability): boolean | undefined {
  if (def.id !== 'github') return undefined
  return capability !== 'repo.read'
}

const PermissionRow = memo(function PermissionRow({ def, capability, mode, alwaysAsk }: { def: IntegrationDef; capability: Capability; mode: GrantMode; alwaysAsk: boolean }) {
  const info = CAPABILITIES[capability]
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const simulated = capabilitySimulated(def, capability)
  const change = (next: GrantMode) => {
    if (next === mode) return
    try {
      updateScope(def.id, capability, next)
      setSaved(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setSaved(false), 1800)
    } catch (err) {
      toast.error('Couldn’t change the permission', { description: err instanceof Error ? err.message : String(err) })
    }
  }
  const labelId = `perm-${def.id}-${capability.replace('.', '-')}`
  return (
    <li className="flex flex-col gap-2 border-b border-line py-3.5 last:border-b-0" data-capability={capability}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <DynamicIcon name={info.icon} aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.5} />
          <span id={labelId} className="type-body-sm min-w-0 truncate font-medium text-ink">
            {info.label}
          </span>
          <RiskChip risk={info.risk} />
          {simulated === true && <SimBadge size="xs" />}
          {simulated === false && <LiveBadge size="xs" />}
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="type-meta text-ink-3" role="status">
              Saved ✓
            </span>
          )}
          <SegmentedControl
            size="sm"
            aria-label={`${info.label} through ${def.name}`}
            value={mode}
            onValueChange={change}
            options={MODES.map((m) => ({ value: m, label: GRANT_LABEL[m] }))}
          />
        </div>
      </div>
      <p className="type-caption text-pretty text-ink-3">{info.description}</p>
      <p className="type-caption text-pretty text-ink-2">{policyExplanation(def.name, capability, mode)}</p>
      {alwaysAsk && mode !== 'deny' && (
        <p className="type-caption flex items-start gap-1.5 text-pretty text-ink-2">
          <span aria-hidden className="pt-px text-[10px] leading-4 text-attn">
            ◆
          </span>
          <span>
            {alwaysAskNote(capability)}{' '}
            <Link to="/settings/permissions" className="text-ink underline decoration-line-input underline-offset-2 hover:decoration-ink">
              Safety settings
            </Link>
          </span>
        </p>
      )}
    </li>
  )
})

/**
 * The permission matrix (§6.11): each capability the service provides × Allow · Ask · Deny, with its
 * risk, what it means and the global always-ask note. Saves instantly (activity is recorded by the
 * service); the policy is evaluated for every run step that uses this integration.
 */
export function Permissions({ def, connection, status }: { def: IntegrationDef; connection: IntegrationConnection | undefined; status: IntegrationStatus }) {
  const alwaysAsk = useSettings((s) => s.safety.alwaysAsk)
  const scopes = scopesFor(def.id, connection)
  const connected = status === 'connected' || status === 'error' || status === 'connecting'
  return (
    <div className="flex flex-col">
      <p className="type-caption pb-1 text-pretty text-ink-3">
        {connected
          ? `What runs may do through ${def.name}. Each agent’s own abilities and your safety settings still apply; Deny always wins.`
          : `Set these before connecting — they apply as soon as ${def.name} is connected.`}
      </p>
      <ul aria-label={`${def.name} permissions`}>
        {scopes.map((s) => (
          <PermissionRow key={s.capability} def={def} capability={s.capability} mode={s.mode} alwaysAsk={alwaysAsk.includes(s.capability)} />
        ))}
      </ul>
    </div>
  )
}
