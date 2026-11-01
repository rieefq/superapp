import { Component, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Link2, Plug, SearchX, ShieldCheck } from 'lucide-react'
import { Stage, StageHeader, useShellLayout } from '@/app/templates'
import { useShellStore } from '@/app/shell/store'
import { useScope } from '@/core/context'
import { useDB } from '@/core/db'
import { INTEGRATION_CATEGORIES } from '@/core/integrations/catalog'
import type { IntegrationListItem } from '@/core/services/integrations'
import { Button, EmptyState, ErrorState, SearchField, Tag, toast, type MenuItem } from '@/ui'
import { cn } from '@/lib/cn'
import { IntegrationCard, ModelProviderCard, SimulatorCard } from './cards'
import { buildSections, catalogSummary, filterHref, filterTitle, parseFilter, sameFilter, type CatalogFilter, type CatalogSection, type PaneCounts } from './logic'
import { SectionHead } from './parts'
import { useGridKeys } from './useGridKeys'

/** Per-section error boundary: a failing section shows an ErrorState with Retry; the rest keeps working. */
export class SectionBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[integrations] ${this.props.name} failed`, error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <ErrorState
          compact
          title={`Couldn’t show ${this.props.name}`}
          message="Something in this section failed to draw. The rest of Integrations still works."
          details={this.state.error.stack ?? this.state.error.message}
          onRetry={() => this.setState({ error: null })}
          retryLabel="Retry"
        />
      )
    }
    return this.props.children
  }
}

function Grid({ children }: { children: ReactNode }) {
  return <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">{children}</ul>
}

function Cards({ items, models }: { items: IntegrationListItem[]; models?: boolean }) {
  return (
    <>
      {items.map(({ def, connection, status }) =>
        models ? (
          <ModelProviderCard key={def.id} def={def} connection={connection} status={status} />
        ) : (
          <IntegrationCard key={def.id} def={def} connection={connection} status={status} />
        ),
      )}
    </>
  )
}

function SectionView({ section, filter }: { section: CatalogSection; filter: CatalogFilter }) {
  const headId = `integrations-${section.id}`
  // In a single-section view the stage header already names it.
  const single = filter.kind !== 'all'
  const count = section.kind === 'models' ? section.items.length + (section.simulator ? 1 : 0) : section.items.length
  return (
    <section aria-labelledby={single ? undefined : headId} aria-label={single ? section.label : undefined}>
      {!single && <SectionHead id={headId} title={section.label} count={section.kind === 'models' ? undefined : count} />}
      <SectionBoundary name={section.label}>
        <Grid>
          {section.simulator && <SimulatorCard />}
          <Cards items={section.items} models={section.kind === 'models'} />
        </Grid>
      </SectionBoundary>
    </section>
  )
}

/** Phones: the list pane's filters as a scrolling chip row above the catalog. */
function PhoneFilters({ filter }: { filter: CatalogFilter }) {
  const navigate = useNavigate()
  const options: { filter: CatalogFilter; label: string }[] = [
    { filter: { kind: 'all' }, label: 'All' },
    { filter: { kind: 'connected' }, label: 'Connected' },
    ...INTEGRATION_CATEGORIES.map((c) => ({ filter: { kind: 'category', category: c.id } as CatalogFilter, label: c.label })),
  ]
  return (
    <div role="toolbar" aria-label="Filter integrations" className="no-scrollbar -mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4">
      {options.map((o) => (
        <Tag
          key={o.label}
          size="md"
          selectable
          selected={sameFilter(filter, o.filter)}
          onSelectedChange={() => navigate(filterHref(o.filter))}
          className="h-8 px-2.5 pointer-coarse:h-9"
        >
          {o.label}
        </Tag>
      ))}
    </div>
  )
}

/** The catalog stage (§6.11): AI models first, then Connected, then the catalog by category. */
export function CatalogView({ items, counts }: { items: IntegrationListItem[]; counts: PaneCounts }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const filter = useMemo(() => parseFilter(params), [params])
  const [query, setQuery] = useState('')
  const sections = useMemo(() => buildSections(items, filter, query), [items, filter, query])
  const layout = useShellLayout()
  const phone = layout.formFactor === 'phone'
  const scope = useScope()
  const scopeName = useDB((s) => (scope ? s.projects[scope]?.name : undefined))
  const setWhatsRealOpen = useShellStore((s) => s.setWhatsRealOpen)
  const gridRef = useRef<HTMLDivElement>(null)
  const { onKeyDown } = useGridKeys(gridRef)
  const title = filterTitle(filter)

  const menu: MenuItem[] = [
    { id: 'real', label: 'What’s real in this build', icon: ShieldCheck, onSelect: () => setWhatsRealOpen(true) },
    {
      id: 'link',
      label: 'Copy link',
      icon: Link2,
      onSelect: () => {
        navigator.clipboard
          .writeText(`${window.location.origin}${filterHref(filter)}`)
          .then(() => toast.success('Link copied'))
          .catch(() => toast.error('Couldn’t copy the link'))
      },
    },
  ]

  const empty = sections.length === 0
  return (
    <Stage
      header={<StageHeader title={title} menu={menu} />}
      toolbar={
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SearchField
            size="sm"
            value={query}
            onValueChange={setQuery}
            placeholder="Search integrations"
            aria-label="Search integrations"
            kbd="/"
            data-search-input
            className="w-full max-w-[360px]"
          />
          <span className="flex-1" />
          <span className="type-meta hidden shrink-0 text-ink-3 sm:inline" aria-live="polite">
            {catalogSummary(counts)}
          </span>
        </div>
      }
      measure="insights"
    >
      {phone && <PhoneFilters filter={filter} />}
      {scopeName && (
        <p className="type-caption -mt-1 mb-5 text-ink-3">
          Connections are shared by every project. Usage on each integration is filtered to <span className="text-ink-2">{scopeName}</span>.
        </p>
      )}
      {empty ? (
        query.trim() ? (
          <EmptyState
            icon={SearchX}
            title={`No integrations match “${query.trim()}”`}
            description="Try a service name, a category or an ability such as “send messages”."
            actions={
              <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                Show every integration
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Plug}
            title="Nothing connected yet"
            description="Connect a service so agents and workflows can use it. Simulated services connect instantly."
            actions={
              <Button size="sm" variant="primary" onClick={() => navigate('/integrations')}>
                Browse the catalog
              </Button>
            }
          />
        )
      ) : (
        <div ref={gridRef} onKeyDown={onKeyDown} className={cn('flex flex-col gap-10 pb-10')}>
          {sections.map((s) => (
            <SectionView key={s.id} section={s} filter={filter} />
          ))}
        </div>
      )}
    </Stage>
  )
}
