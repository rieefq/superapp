import { useMemo } from 'react'
import { Navigate, Outlet, Route, Routes, useMatch, useOutletContext, useSearchParams } from 'react-router'
import { useShellLayout, WorkspaceScreen } from '@/app/templates'
import { getIntegration } from '@/core/integrations/catalog'
import { useConnectionsList, type IntegrationListItem } from '@/core/services/integrations'
import { CatalogView } from './Catalog'
import { IntegrationCard } from './cards'
import { Stage, StageHeader } from '@/app/templates'
import { IconButton, MonogramMark, SearchField, SimBadge, Tooltip } from '@/ui'
import { Link } from 'react-router'
import { X } from 'lucide-react'
import { CategoryPane } from './CategoryPane'
import { DetailView } from './Detail'
import { paneCounts, parseFilter, type CatalogFilter, type PaneCounts } from './logic'

interface FrameContext {
  items: IntegrationListItem[]
  counts: PaneCounts
}

/**
 * The Library frame (§6.0, §6.11): the category list pane stays mounted while the stage switches
 * between the catalog and a detail. Phones: the catalog fills the screen (its filters become a chip
 * row) and a detail pushes over it with a back button.
 */
function Frame() {
  console.log('[int-debug] Frame', window.location.pathname, useMatch('/integrations/:integrationId')?.params.integrationId)
  const items = useConnectionsList()
  const counts = useMemo(() => paneCounts(items), [items])
  const match = useMatch('/integrations/:integrationId')
  const [params] = useSearchParams()
  const phone = useShellLayout().formFactor === 'phone'
  const id = match?.params.integrationId
  const def = getIntegration(id)
  const filterKey = params.toString()
  const active = useMemo<CatalogFilter | null>(() => {
    if (!id) return parseFilter(new URLSearchParams(filterKey))
    if (id === 'simulator') return { kind: 'category', category: 'models' }
    return def ? { kind: 'category', category: def.category } : null
  }, [id, def, filterKey])
  const context = useMemo<FrameContext>(() => ({ items, counts }), [items, counts])
  return (
    <WorkspaceScreen list={phone && !id ? undefined : <CategoryPane active={active} counts={counts} />} phoneView="stage">
      <Outlet context={context} />
    </WorkspaceScreen>
  )
}

function CatalogRoute() {
  console.log('[int-debug] CatalogRoute', window.location.pathname)
  const { items, counts } = useOutletContext<FrameContext>()
  const t = new URLSearchParams(window.location.search).get('t')
  if (t === 'trivial') return <h1>Trivial catalog {items.length} {counts.all}</h1>
  if (t === 'stage') return <Stage header={<StageHeader title="Stage only" />}>hello</Stage>
  if (t === 'stagenoheader') return <Stage>stage no header</Stage>
  if (t === 'header') return <div><StageHeader title="Header only" /></div>
  if (t === 'cards') return <div><h1>Cards</h1><ul>{items.slice(0, 3).map((i) => <IntegrationCard key={i.def.id} def={i.def} connection={i.connection} status={i.status} />)}</ul></div>
  if (t === 'tooltip') return <div><h1>Tooltip</h1><Tooltip content="tip"><button type="button">x</button></Tooltip></div>
  if (t === 'badge') return <div><h1>Badge</h1><SimBadge /></div>
  if (t === 'link') return <div><h1>Link</h1><Link to="/integrations/slack">slack</Link></div>
  if (t === 'mark') return <div><h1>Mark</h1><MonogramMark text="SL" hue="rose" variant="ring" /></div>
  if (t === 'iconbutton') return <div><h1>IconButton</h1><IconButton icon={X} label="Close" /></div>
  if (t === 'search') return <div><h1>Search</h1><SearchField value="" onValueChange={() => {}} /></div>
  return <CatalogView items={items} counts={counts} />
}

function TrivialDetail() {
  return <h1>Trivial detail</h1>
}

/** Integrations (§6.11): connect services, govern what agents may do with them, see how they are used. */
export default function IntegrationsWorkspace() {
  return (
    <Routes>
      <Route element={<Frame />}>
        <Route index element={<CatalogRoute />} />
        <Route path=":integrationId" element={<TrivialDetail />} />
        <Route path="*" element={<Navigate to="/integrations" replace />} />
      </Route>
    </Routes>
  )
}
