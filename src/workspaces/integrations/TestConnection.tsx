import { Activity } from 'lucide-react'
import { useMinuteNow } from '@/core/analytics'
import { diagnoseConnection, useConnectionTest, type ConnectionDiagnosis } from '@/core/services/integrations'
import type { IntegrationDef } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { Button, LiveBadge, SimBadge, StatusGlyph } from '@/ui'
import { testDescription } from './copy'

function durationText(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** One test result: what happened, the provider's own words, the exact fix, and how it was tested. */
export function TestResult({ result, compact }: { result: ConnectionDiagnosis; compact?: boolean }) {
  useMinuteNow()
  return (
    <div className={cn('flex min-w-0 gap-2.5', !compact && 'rounded-sm border px-3 py-2.5', !compact && (result.ok ? 'border-line bg-raised' : 'border-fail/40 bg-fail-tint/40'))}>
      <span className="pt-[3px]">
        {result.ok ? <StatusGlyph shape="check" tone="done" word="Working" /> : <StatusGlyph shape="cross" tone="fail" word="Failed" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={cn('type-body-sm break-words text-pretty', result.ok ? 'text-ink' : 'text-fail-ink')}>{result.message}</p>
        {result.providerMessage && result.providerMessage !== result.message && (
          <p className="type-caption break-words text-ink-2">
            Provider said: <span className="type-mono-sm text-ink">“{result.providerMessage}”</span>
          </p>
        )}
        {!result.ok && result.fix && (
          <p className="type-caption text-pretty text-ink-2">
            <span className="font-medium text-ink">Fix: </span>
            {result.fix}
          </p>
        )}
        <p className="type-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3">
          {result.live ? <LiveBadge size="xs" /> : <SimBadge size="xs" />}
          {result.request && <span className="min-w-0 truncate">{result.request}</span>}
          <span aria-hidden>·</span>
          <span>{durationText(result.durationMs)}</span>
          <span aria-hidden>·</span>
          <span>{timeAgo(result.at)}</span>
        </p>
      </div>
    </div>
  )
}

/**
 * "Test connection" (§6.11): a real tiny request for Anthropic, OpenAI-compatible (/models) and
 * GitHub (rate limit); a labeled simulated handshake for everything else. The last result shows
 * under the button and is announced politely.
 */
export function TestConnection({ def, enabled, showButton = true, className }: {
  def: IntegrationDef
  enabled: boolean
  /** The detail page puts the button in its header; the section then shows what a test does and the result. */
  showButton?: boolean
  className?: string
}) {
  const { result, running } = useConnectionTest(def.id)
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {showButton ? (
          <Button size="sm" variant="secondary" leadingIcon={Activity} loading={running} disabled={!enabled} onClick={() => void diagnoseConnection(def.id)}>
            Test connection
          </Button>
        ) : (
          <h3 className="type-caption font-medium text-ink-2">Connection test</h3>
        )}
        <span className="type-caption text-ink-3">{enabled ? testDescription(def) : `Connect ${def.name} to test it.`}</span>
      </div>
      <div role="status" aria-live="polite" className="min-w-0">
        {running ? (
          <p className="type-caption text-ink-3">{def.support === 'live' ? `Contacting ${def.id === 'openai-compatible' ? 'your endpoint' : def.name}…` : 'Running a simulated handshake…'}</p>
        ) : result ? (
          <TestResult result={result} />
        ) : null}
      </div>
    </div>
  )
}
