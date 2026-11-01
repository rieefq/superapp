import { memo } from 'react'
import {
  Clapperboard, Cloud, Cpu, Database, HardDrive, LayoutGrid, ListChecks, MessageCircle, PenTool, Plug, Search, ShieldCheck, SquareCode,
  type LucideIcon,
} from 'lucide-react'
import { ListGroup, ListPane, ListRow, ListRows } from '@/app/templates'
import { useShellStore } from '@/app/shell/store'
import { INTEGRATION_CATEGORIES } from '@/core/integrations/catalog'
import type { IntegrationCategory } from '@/core/types'
import { StatusGlyph } from '@/ui'
import { filterHref, sameFilter, type CatalogFilter, type PaneCounts } from './logic'

export const CATEGORY_ICON: Record<IntegrationCategory, LucideIcon> = {
  models: Cpu,
  code: SquareCode,
  communication: MessageCircle,
  productivity: ListChecks,
  storage: HardDrive,
  data: Database,
  search: Search,
  design: PenTool,
  media: Clapperboard,
  cloud: Cloud,
}

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden className="size-4 text-ink-3" strokeWidth={1.5} />
}

/**
 * The list pane (§6.11, Library): the whole catalog, the Connected filter (with a fail glyph while a
 * connection is failing) and the ten categories. `active` is the filter the stage shows; on a detail
 * page it is the integration's category.
 */
export const CategoryPane = memo(function CategoryPane({ active, counts }: { active: CatalogFilter | null; counts: PaneCounts }) {
  const setWhatsRealOpen = useShellStore((s) => s.setWhatsRealOpen)
  const is = (f: CatalogFilter) => !!active && sameFilter(active, f)
  return (
    <ListPane
      title="Integrations"
      footer={
        <button
          type="button"
          onClick={() => setWhatsRealOpen(true)}
          className="type-caption flex h-10 w-full items-center gap-2 px-4 text-left text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
        >
          <ShieldCheck aria-hidden className="size-4" strokeWidth={1.5} />
          What’s real in this build
        </button>
      }
    >
      <ListRows label="Integration filters">
        <ListGroup label="Show">
          <ListRow
            to={filterHref({ kind: 'all' })}
            selected={is({ kind: 'all' })}
            leading={<RowIcon icon={LayoutGrid} />}
            title="All integrations"
            meta={counts.all}
          />
          <ListRow
            to={filterHref({ kind: 'connected' })}
            selected={is({ kind: 'connected' })}
            leading={<RowIcon icon={Plug} />}
            title="Connected"
            aria-label={`Connected, ${counts.connected}${counts.errors ? `, ${counts.errors} with errors` : ''}`}
            meta={
              <span className="inline-flex items-center gap-1.5">
                {counts.errors > 0 && <StatusGlyph shape="cross" tone="fail" size={11} word="Error" label={`${counts.errors} with errors`} />}
                {counts.connected}
              </span>
            }
          />
        </ListGroup>
        <ListGroup label="Categories">
          {INTEGRATION_CATEGORIES.map((c) => (
            <ListRow
              key={c.id}
              to={filterHref({ kind: 'category', category: c.id })}
              selected={is({ kind: 'category', category: c.id })}
              leading={<RowIcon icon={CATEGORY_ICON[c.id]} />}
              title={c.label}
              meta={counts.byCategory[c.id]}
            />
          ))}
        </ListGroup>
      </ListRows>
    </ListPane>
  )
})
