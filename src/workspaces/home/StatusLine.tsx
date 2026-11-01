import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { useShellStore } from '@/app/shell/store'
import { getModelInfo } from '@/core/ai'
import { useMinuteNow } from '@/core/analytics'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { useSettings } from '@/core/settings'
import { cn } from '@/lib/cn'
import { Tooltip } from '@/ui'
import { SimBadge } from '@/app/components/sig'
import { spendToday, statusDate } from './logic'

const ESTIMATE = 'Estimated at reference pricing; no money was spent.'

/**
 * Home's status line (§6.1, meta-caps, ink-3):
 * `ATLAS PORTAL V2 · SUN 1 NOV · 3 RUNNING · 2 NEED YOU · $0.42 TODAY · [SIM] SIMULATOR`.
 * Counts lead to the work: running → Agents, need you → the Needs-you popover, spend → Insights.
 */
export function StatusLine({ needsYou }: { needsYou: number }) {
  const navigate = useNavigate()
  const scope = useScope()
  const now = useMinuteNow()
  const projectName = useDB((s: Tables) => (scope ? s.projects[scope]?.name : undefined))
  const running = useDB((s: Tables) => {
    let n = 0
    for (const r of Object.values(s.runs)) if ((r.status === 'running' || r.status === 'queued') && (!scope || r.projectId === scope)) n++
    return n
  })
  // Spend moves with run usage; recompute when costs change, not on every step.
  const costs = useDB(
    useShallow((s: Tables) => {
      const out: Record<string, number> = {}
      for (const r of Object.values(s.runs)) if (r.usage.costUsd) out[r.id] = r.usage.costUsd
      return out
    }),
  )
  const spend = useMemo(() => spendToday(useDB.getState(), Date.now(), scope), [costs, now, scope])
  const modelId = useSettings((s) => s.ai.defaultModelId)
  const model = getModelInfo(modelId)
  const setNeedsYouOpen = useShellStore((s) => s.setNeedsYouOpen)
  const setNeedsYouTab = useShellStore((s) => s.setNeedsYouTab)

  const money = `${spend.estimated ? 'est. ' : ''}$${spend.usd < 0.01 && spend.usd > 0 ? spend.usd.toFixed(3) : spend.usd.toFixed(2)} today`
  return (
    <p className="type-meta-caps flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ink-3" aria-label="Status">
      {projectName && (
        <>
          <span className="text-ink-2">{projectName}</span>
          <Dot />
        </>
      )}
      <time dateTime={new Date(now).toISOString().slice(0, 10)}>{statusDate(now)}</time>
      <Dot />
      <Token onClick={() => navigate('/agents?status=running')} label="Open running work in Agents">
        {running} running
      </Token>
      <Dot />
      <Token
        onClick={() => {
          setNeedsYouTab('needs')
          setNeedsYouOpen(true)
        }}
        label="Open Needs you"
        className={needsYou > 0 ? 'text-attn-ink' : undefined}
      >
        {needsYou} need you
      </Token>
      <Dot />
      {spend.estimated ? (
        <Tooltip content={ESTIMATE}>
          <Token onClick={() => navigate('/insights')} label={`Spend today, ${money}. Open Insights`}>
            {money}
          </Token>
        </Tooltip>
      ) : (
        <Token onClick={() => navigate('/insights')} label={`Spend today, ${money}. Open Insights`}>
          {money}
        </Token>
      )}
      <Dot />
      <span className="inline-flex items-center gap-1.5">
        {model?.simulated !== false && <SimBadge size="xs" label="SIM" />}
        {model?.simulated === false ? model.label : 'Simulator'}
      </span>
    </p>
  )
}

function Dot() {
  return (
    <span aria-hidden className="text-ink-4">
      ·
    </span>
  )
}

function Token({ children, onClick, label, className }: { children: React.ReactNode; onClick: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn('rounded-xs uppercase transition-colors duration-(--dur-1) hover:text-ink focus-visible:outline-offset-2', className)}
    >
      {children}
    </button>
  )
}
