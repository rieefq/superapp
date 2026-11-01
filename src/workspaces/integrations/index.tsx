import { useMemo } from 'react'
import { Navigate, Outlet, Route, Routes, useMatch, useOutletContext, useSearchParams } from 'react-router'
import { useShellLayout, WorkspaceScreen } from '@/app/templates'
import { getIntegration } from '@/core/integrations/catalog'
import { useConnectionsList, type IntegrationListItem } from '@/core/services/integrations'
import { CatalogView } from './Catalog'
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
  const { items, counts } = useOutletContext<FrameContext>()
  return <CatalogView items={items} counts={counts} />
}

/** Integrations (§6.11): connect services, govern what agents may do with them, see how they are used. */
export default function IntegrationsWorkspace() {
  return (
    <Routes>
      <Route element={<Frame />}>
        <Route index element={<CatalogRoute />} />
        <Route path=":integrationId" element={<DetailView />} />
        <Route path="*" element={<Navigate to="/integrations" replace />} />
      </Route>
    </Routes>
  )
}
