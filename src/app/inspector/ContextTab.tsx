import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useDB } from '@/core/db'
import { usePinned, useScope } from '@/core/context'
import { estimateTokens } from '@/core/ai'
import { useEntity } from '@/core/services'
import { useSettings } from '@/core/settings'
import { startOfLocalMonth } from '@/core/analytics'
import type { EntityRef, Project } from '@/core/types'
import { refKey } from '@/core/types'
import { EntityChip, Switch, TickMeter, formatCost } from '@/ui'
import { cn } from '@/lib/cn'
import { toggleContextRef, toggleMemoryPart, useShellStore } from '../shell/store'
import { estimateRefTokens, formatTokenEstimate } from '../shell/scope'
import { useInspectedRef } from './ItemTab'

const AUTONOMY_NOTE = {
  supervised: 'Asks before every action that changes something.',
  balanced: 'Asks before medium- and high-risk actions.',
  autonomous: 'Asks only before high-risk actions.',
} as const

/**
 * Inspector › Context (§3.5): the context chain for the current composer or selection — project
 * memory with include toggles, Held, Attached, Likely and Retrieved items with token estimates, the
 * project's month-to-date spend against budget, and the default autonomy.
 */
export function ContextTab() {
  const composer = useShellStore((s) => s.composerContext)
  const selected = useInspectedRef()
  const scope = useScope()
  const pinned = usePinned()
  const projectId = composer?.projectId !== undefined ? composer.projectId : scope
  const project = useDB((s) => (projectId ? s.projects[projectId] : undefined))
  const selectedThread = useDB((s) => (selected?.kind === 'thread' ? s.threads[selected.id] : undefined))
  const selectedRun = useDB((s) => (selected?.kind === 'run' ? s.runs[selected.id] : undefined))
  const attachedRunId = useShellStore((s) => s.attachedRunId)
  const attachedRun = useDB((s) => (attachedRunId ? s.runs[attachedRunId] : undefined))

  const off = useMemo(() => new Set((composer?.off ?? []).map(refKey)), [composer?.off])
  const memoryOff = new Set(composer?.memoryOff ?? [])
  const held = composer?.held ?? pinned.map((p) => p.ref)
  // Without a composer, starting work from the selection attaches it (and a thread's own context).
  const attached = composer?.attached ?? (selectedThread ? selectedThread.contextRefs : selected && selected.kind !== 'run' ? [selected] : [])
  const likely = composer?.likely ?? []
  const retrievedFrom = selectedRun ?? attachedRun
  const retrieved = useMemo(() => {
    if (!retrievedFrom) return [] as EntityRef[]
    const seen = new Set<string>()
    const out: EntityRef[] = []
    for (const st of retrievedFrom.steps) for (const r of st.refs ?? []) {
      const k = refKey(r)
      if (!seen.has(k)) {
        seen.add(k)
        out.push(r)
      }
    }
    return out
  }, [retrievedFrom])

  const memoryRefs = project?.pinnedRefs ?? []
  const goalTokens = project?.goal ? estimateTokens(project.goal) : 0
  const instructionTokens = project?.instructions ? estimateTokens(project.instructions) : 0
  const count = (refs: EntityRef[]) => refs.filter((r) => !off.has(refKey(r))).reduce((n, r) => n + estimateRefTokens(r), 0)
  const total =
    (memoryOff.has('goal') ? 0 : goalTokens) +
    (memoryOff.has('instructions') ? 0 : instructionTokens) +
    count(memoryRefs) +
    count(held) +
    count(attached) +
    count(likely)

  const label = composer?.label ?? (selected ? undefined : 'the next AI action')

  return (
    <div className="flex flex-col">
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-4 pt-3.5 pb-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="type-label text-ink-3">Context for</span>
          {label ? <span className="type-title-3 truncate">{label}</span> : selected ? <SelectedTitle entity={selected} /> : null}
        </div>
        <span className="type-meta shrink-0 text-ink-2" title="Estimated tokens the model would receive from the items switched on below">
          {formatTokenEstimate(total)}
        </span>
      </header>

      <Section title="Project memory" action={project ? <Link to={`/projects/${encodeURIComponent(project.id)}/memory`} className="type-caption text-ink-2 underline decoration-line-input underline-offset-2 hover:decoration-ink">Edit</Link> : undefined}>
        {project ? (
          <ProjectMemory project={project} memoryOff={memoryOff} off={off} goalTokens={goalTokens} instructionTokens={instructionTokens} />
        ) : (
          <Empty>No project in scope. Switch project (P) to include its goal, instructions and memory.</Empty>
        )}
      </Section>

      <Section title="Held" count={held.length}>
        {held.length ? <RefList refs={held} off={off} /> : <Empty>Nothing held. Press H on an item to hold it.</Empty>}
      </Section>

      <Section title="Attached" count={attached.length}>
        {attached.length ? <RefList refs={attached} off={off} /> : <Empty>Nothing attached to this action.</Empty>}
      </Section>

      {likely.length > 0 && (
        <Section title="Likely" count={likely.length}>
          <RefList refs={likely} off={off} dim />
        </Section>
      )}

      {retrieved.length > 0 && (
        <Section title="Retrieved" count={retrieved.length} note="What the run actually read (its Saw list).">
          <RefList refs={retrieved} off={off} readOnly />
        </Section>
      )}

      <Budget project={project} />
      <Autonomy />
    </div>
  )
}

function SelectedTitle({ entity }: { entity: EntityRef }) {
  const e = useEntity(entity)
  return <span className="type-title-3 truncate">{e.title}</span>
}

function Section({ title, count, note, action, children }: { title: string; count?: number; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-b border-line px-4 py-3.5">
      <div className="flex items-center gap-2">
        <h3 className="type-label text-ink-3">{title}</h3>
        {count !== undefined && <span className="type-meta text-ink-3">{count}</span>}
        <span className="flex-1" />
        {action}
      </div>
      {note && <p className="type-caption -mt-1 text-ink-3">{note}</p>}
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="type-caption text-ink-3">{children}</p>
}

function ToggleRow({ on, onChange, label, tokens, children, readOnly }: { on: boolean; onChange?: () => void; label: string; tokens: number; children: ReactNode; readOnly?: boolean }) {
  return (
    <div className="flex min-h-8 items-center gap-2.5">
      <div className={cn('min-w-0 flex-1', !on && 'line-through decoration-ink-4 opacity-55')}>{children}</div>
      <span className={cn('type-meta shrink-0 tabular-nums', on ? 'text-ink-3' : 'text-ink-4 line-through')}>{formatTokenEstimate(tokens)}</span>
      {!readOnly && onChange && <Switch size="sm" checked={on} onCheckedChange={onChange} aria-label={`Include ${label}`} />}
    </div>
  )
}

function RefList({ refs, off, dim, readOnly }: { refs: EntityRef[]; off: Set<string>; dim?: boolean; readOnly?: boolean }) {
  return (
    <div className="flex flex-col">
      {refs.map((r) => (
        <RefRow key={refKey(r)} entity={r} on={!off.has(refKey(r))} dim={dim} readOnly={readOnly} />
      ))}
    </div>
  )
}

function RefRow({ entity, on, dim, readOnly }: { entity: EntityRef; on: boolean; dim?: boolean; readOnly?: boolean }) {
  const e = useEntity(entity)
  return (
    <ToggleRow on={on} onChange={() => toggleContextRef(entity)} label={e.title} tokens={estimateRefTokens(entity)} readOnly={readOnly}>
      <span className={cn('inline-flex max-w-full', dim && 'opacity-70')}>
        <EntityChip entity={entity} size="sm" />
      </span>
    </ToggleRow>
  )
}

function ProjectMemory({
  project,
  memoryOff,
  off,
  goalTokens,
  instructionTokens,
}: {
  project: Project
  memoryOff: Set<string>
  off: Set<string>
  goalTokens: number
  instructionTokens: number
}) {
  return (
    <div className="flex flex-col gap-1">
      {project.goal && (
        <ToggleRow on={!memoryOff.has('goal')} onChange={() => toggleMemoryPart('goal')} label="the project goal" tokens={goalTokens}>
          <p className="type-body-sm line-clamp-2 text-ink-2">
            <span className="text-ink-3">Goal · </span>
            {project.goal}
          </p>
        </ToggleRow>
      )}
      {project.instructions && (
        <ToggleRow on={!memoryOff.has('instructions')} onChange={() => toggleMemoryPart('instructions')} label="the project instructions" tokens={instructionTokens}>
          <p className="type-body-sm line-clamp-2 text-ink-2">
            <span className="text-ink-3">Instructions · </span>
            {project.instructions}
          </p>
        </ToggleRow>
      )}
      {project.pinnedRefs.map((r) => (
        <RefRow key={refKey(r)} entity={r} on={!off.has(refKey(r))} />
      ))}
      {!project.goal && !project.instructions && !project.pinnedRefs.length && <Empty>This project has no memory yet.</Empty>}
    </div>
  )
}

function Budget({ project }: { project?: Project }) {
  const budget = useSettings((s) => s.safety.monthlyBudgetUsd)
  const countSim = useSettings((s) => s.safety.countSimulatedSpend)
  const key = useDB((s) => {
    const month = startOfLocalMonth(Date.now())
    let live = 0
    let sim = 0
    for (const r of Object.values(s.runs)) {
      if ((r.startedAt ?? r.createdAt) < month) continue
      if (project && r.projectId !== project.id) continue
      if (r.simulated) sim += r.usage.costUsd
      else live += r.usage.costUsd
    }
    return `${live.toFixed(4)}|${sim.toFixed(4)}`
  })
  const [live, sim] = key.split('|').map(Number)
  const counted = live + (countSim ? sim : 0)
  return (
    <section aria-label="Spend" className="flex flex-col gap-2.5 border-b border-line px-4 py-3.5">
      <h3 className="type-label text-ink-3">{project ? `${project.name} · this month` : 'All work · this month'}</h3>
      {budget > 0 ? (
        <div className="flex flex-col gap-1.5">
          <TickMeter value={counted} max={budget} label="Month-to-date spend against the monthly budget" valueText={`${formatCost(counted)} of $${budget}`} />
          <div className="type-meta flex items-center justify-between text-ink-3">
            <span className={cn(counted >= budget ? 'text-fail-ink' : counted >= budget * 0.8 ? 'text-attn-ink' : 'text-ink-2')}>{formatCost(counted)} live</span>
            <span>of ${budget} this month</span>
          </div>
        </div>
      ) : (
        <p className="type-caption text-ink-3">No monthly budget set.</p>
      )}
      {sim > 0 && (
        <p className="type-caption text-ink-3">
          Plus {formatCost(sim, { est: true })} of simulated work {countSim ? '(counted toward the budget)' : '(not counted toward the budget)'}. No money was spent on it.
        </p>
      )}
    </section>
  )
}

function Autonomy() {
  const autonomy = useSettings((s) => s.safety.defaultAutonomy)
  return (
    <section aria-label="Default autonomy" className="flex flex-col gap-1 px-4 py-3.5">
      <h3 className="type-label text-ink-3">Default autonomy</h3>
      <p className="type-body-sm text-ink">
        {autonomy.charAt(0).toUpperCase() + autonomy.slice(1)} <span className="text-ink-3">· {AUTONOMY_NOTE[autonomy]}</span>
      </p>
      <Link to="/settings/permissions" className="type-caption w-fit text-ink-2 underline decoration-line-input underline-offset-2 hover:decoration-ink">
        Change in Settings
      </Link>
    </section>
  )
}
