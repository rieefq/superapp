import { useMemo } from 'react'
import { INSIGHT_RANGES, minuteCeil, rangeLabel, rangeToken, RUN_KINDS, useMinuteNow, type ProviderFilter, type RangeDays } from '@/core/analytics'
import { useDB, type Tables } from '@/core/db'
import type { Project, RunKind } from '@/core/types'
import { useShallow } from 'zustand/react/shallow'
import { HUE_FILL, RUN_KIND_ICON, SegmentedControl, Select, type SelectOption } from '@/ui'
import { cn } from '@/lib/cn'
import { KIND_LABEL, windowLabel } from './logic'
import { useInsightsFilters } from './state'

/**
 * The Insights filter row (§6.10): range · project (follows the scope; current or all) · kind ·
 * provider (All · Live · Simulated), plus the window it covers. Lives in the URL.
 */
export function FilterBar({ showProvider = true, showKind = true }: { showProvider?: boolean; showKind?: boolean }) {
  const { filters, setRange, setProvider, setKind, setProject, scope } = useInsightsFilters()
  const now = minuteCeil(useMinuteNow())
  const projects = useDB(
    useShallow((s: Tables) =>
      Object.values(s.projects)
        .filter((p) => p.status !== 'archived' || p.id === filters.projectId)
        .sort((a, b) => Number(b.id === scope) - Number(a.id === scope) || a.name.localeCompare(b.name)),
    ),
  )
  const scopeProject = useDB((s: Tables) => (scope ? s.projects[scope] : undefined))
  const projectOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: 'All work' },
      ...projects.map((p: Project) => ({ value: p.id, label: p.name, meta: p.id === scope ? 'Scope' : undefined })),
    ],
    [projects, scope],
  )
  const kindOptions = useMemo<SelectOption[]>(
    () => [{ value: 'all', label: 'All kinds' }, ...RUN_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k], icon: RUN_KIND_ICON[k] }))],
    [],
  )
  const projectValue = filters.projectId ?? 'all'
  const from = now - filters.rangeDays * 86_400_000
  const selectedProject = projects.find((p) => p.id === filters.projectId)

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <SegmentedControl<string>
          size="sm"
          aria-label="Range"
          value={rangeToken(filters.rangeDays)}
          onValueChange={(v) => setRange(INSIGHT_RANGES.find((d) => rangeToken(d) === v) ?? (7 as RangeDays))}
          options={INSIGHT_RANGES.map((d) => ({ value: rangeToken(d), label: rangeToken(d) }))}
        />
        <Select
          size="sm"
          aria-label="Project"
          value={projectValue}
          options={projectOptions}
          onValueChange={(v) => {
            if (v === 'all') setProject(scope ? 'all' : 'scope')
            else setProject(v === scope ? 'scope' : v)
          }}
          renderValue={(o) => (
            <span className="flex min-w-0 items-center gap-2">
              {selectedProject ? (
                <span aria-hidden className={cn('size-2.5 shrink-0 rounded-[3px]', HUE_FILL[selectedProject.hue])} />
              ) : (
                <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] border border-line-input" />
              )}
              <span className="max-w-[180px] truncate">{o.label}</span>
            </span>
          )}
          className="w-[200px]"
        />
        {showKind && (
          <Select
            size="sm"
            aria-label="Run kind"
            value={filters.kind ?? 'all'}
            options={kindOptions}
            onValueChange={(v) => setKind(v === 'all' ? null : (v as RunKind))}
            className="w-[148px]"
          />
        )}
        {showProvider && (
          <SegmentedControl<ProviderFilter>
            size="sm"
            aria-label="Provider"
            value={filters.provider}
            onValueChange={setProvider}
            options={[
              { value: 'all', label: 'All' },
              { value: 'live', label: 'Live' },
              { value: 'simulated', label: 'Simulated' },
            ]}
          />
        )}
        <span className="type-meta ml-auto pl-2 text-ink-3" title={rangeLabel(filters.rangeDays)}>
          {windowLabel(from, now, filters.rangeDays)}
        </span>
      </div>
      {filters.followsScope && scopeProject && (
        <p role="status" className="type-caption flex min-h-6 items-center gap-1.5 text-ink-3">
          <span aria-hidden className={cn('size-2.5 rounded-[3px]', HUE_FILL[scopeProject.hue])} />
          <span className="truncate">
            Filtered to <span className="text-ink-2">{scopeProject.name}</span>
          </span>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={() => setProject('all')}
            className="shrink-0 rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink"
          >
            Show all
          </button>
        </p>
      )}
    </div>
  )
}
