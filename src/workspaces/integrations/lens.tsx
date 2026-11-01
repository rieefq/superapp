import { useNavigate } from 'react-router'
import { Activity, ArrowUpRight } from 'lucide-react'
import type { LensModule, LensProps } from '@/app/lens/types'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { diagnoseConnection, scopesFor, useConnection, useConnectionTest, useIntegrationUsage, type IntegrationStatus } from '@/core/services/integrations'
import type { GrantMode } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import { Button, EntityChip } from '@/ui'
import { SIMULATED_LINE, whatsReal, whatsRealBody } from './copy'
import { GRANT_LABEL, categoryLabel, isConnectedLike, statusWord, usageLine } from './logic'
import { ModeBadge, RiskChip, StatusMark } from './parts'
import { TestResult } from './TestConnection'

/*
 * Lens renderers for `integration` (docs/DESIGN.md §5.4.8): `panel` is the Inspector › Item body
 * (the shell adds the header, Links and History), `card` is the hover card / ⌘K preview body.
 */

const MODE_TEXT: Record<GrantMode, string> = { allow: 'text-ink-2', ask: 'text-attn-ink', deny: 'text-ink-3' }

function StatusLine({ status, word, detail }: { status: IntegrationStatus; word: string; detail?: string }) {
  return (
    <p className="type-caption flex min-w-0 items-center gap-1.5">
      <StatusMark status={status} />
      <span className={cn('shrink-0 font-medium', status === 'error' ? 'text-fail-ink' : 'text-ink-2')}>{word}</span>
      {detail && <span className="min-w-0 truncate text-ink-3">· {detail}</span>}
    </p>
  )
}

function IntegrationPanel({ entity }: LensProps) {
  const navigate = useNavigate()
  const def = getIntegration(entity.id)
  const connection = useConnection(entity.id)
  const usage = useIntegrationUsage(entity.id)
  const { result, running } = useConnectionTest(entity.id)
  if (!def) return null
  const status: IntegrationStatus = connection?.status ?? 'available'
  const connected = isConnectedLike(status)
  const detail =
    status === 'error'
      ? connection?.error
      : connected && connection?.account
        ? `${connection.account}${connection.connectedAt ? ` · since ${formatDate(connection.connectedAt)}` : ''}`
        : undefined
  const scopes = scopesFor(def.id, connection)
  const usedBy = [...usage.agents.map((a) => ({ kind: 'agent' as const, id: a.id })), ...usage.workflows.map((w) => ({ kind: 'workflow' as const, id: w.id }))]
  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ModeBadge support={def.support} />
          <span className="type-caption text-ink-3">{categoryLabel(def.category)}</span>
        </div>
        <StatusLine status={status} word={statusWord(def, status)} detail={detail} />
        <p className="type-caption line-clamp-3 text-pretty text-ink-2">{def.support === 'simulated' ? `${SIMULATED_LINE} ${whatsRealBody(def)}` : whatsReal(def)}</p>
      </div>

      {scopes.length > 0 && (
        <section aria-label="Permissions" className="flex flex-col gap-1.5">
          <h3 className="type-label text-ink-3">Permissions</h3>
          <ul className="flex flex-col gap-1">
            {scopes.map((s) => (
              <li key={s.capability} className="type-caption flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate text-ink">{CAPABILITIES[s.capability].label}</span>
                <RiskChip risk={CAPABILITIES[s.capability].risk} />
                <span aria-hidden className="mb-[3px] min-w-3 flex-1 self-end border-b border-dotted border-line-input" />
                <span className={cn('shrink-0 font-medium', MODE_TEXT[s.mode])}>{GRANT_LABEL[s.mode]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {def.category !== 'models' && (
        <section aria-label="Used by" className="flex flex-col gap-1.5">
          <h3 className="type-label text-ink-3">Used by</h3>
          {usedBy.length ? (
            <div className="flex flex-wrap gap-1.5">
              {usedBy.map((r) => (
                <EntityChip key={`${r.kind}:${r.id}`} entity={r} size="sm" />
              ))}
            </div>
          ) : (
            <p className="type-caption text-ink-3">No agents or workflows use it yet.</p>
          )}
          <p className="type-meta text-ink-3">{usageLine(usage.usageCount, usage.lastUsedAt)}</p>
        </section>
      )}

      {result && !running && <TestResult result={result} compact />}

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" leadingIcon={Activity} loading={running} disabled={!connected || status === 'connecting'} onClick={() => void diagnoseConnection(def.id)}>
          Test connection
        </Button>
        <Button size="sm" variant="ghost" trailingIcon={ArrowUpRight} onClick={() => navigate(`/integrations/${def.id}`)}>
          Manage
        </Button>
      </div>
    </div>
  )
}

function IntegrationCardLens({ entity }: LensProps) {
  const def = getIntegration(entity.id)
  const connection = useConnection(entity.id)
  if (!def) return null
  const status: IntegrationStatus = connection?.status ?? 'available'
  const connected = isConnectedLike(status)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ModeBadge support={def.support} />
        <span className="type-caption text-ink-3">{categoryLabel(def.category)}</span>
      </div>
      <StatusLine status={status} word={statusWord(def, status)} detail={status === 'error' ? connection?.error : connected ? connection?.account : undefined} />
      <p className="type-caption line-clamp-2 text-pretty text-ink-2">{def.description}</p>
      {def.capabilities.length > 0 && (
        <p className="type-meta truncate text-ink-3">{def.capabilities.map((c) => CAPABILITIES[c].label).join(' · ')}</p>
      )}
      {connection && connected && <p className="type-meta text-ink-3">{usageLine(connection.usageCount, connection.lastUsedAt)}</p>}
    </div>
  )
}

export const lenses: LensModule['lenses'] = {
  integration: { panel: IntegrationPanel, card: IntegrationCardLens },
}
