import { useCallback, useRef } from 'react'
import { Route, Routes, useMatch, useNavigate, useSearchParams } from 'react-router'
import { WorkspaceScreen, Stage, StageHeader } from '@/app/templates'
import { useDB, type Tables } from '@/core/db'
import { Button, EmptyState } from '@/ui'
import { AssetView } from './AssetView'
import { ContactSheet } from './ContactSheet'
import { StudioListPane } from './ListPane'
import type { Place } from './logic'
import type { PromptBarHandle } from './PromptBar'
import { useStudioView, withParam } from './view'

/**
 * Studio (§6.8, Library template): the list pane (places, kinds, boards) beside either the contact
 * sheet (`/studio?board=&kind=`) or an asset (`/studio/:assetId`). Phones push from the boards list
 * to the contact sheet to the asset.
 */
export default function StudioWorkspace() {
  const view = useStudioView()
  const navigate = useNavigate()
  const assetMatch = useMatch('/studio/:assetId')
  const assetId = assetMatch?.params.assetId ? decodeURIComponent(assetMatch.params.assetId) : null
  const asset = useDB((s: Tables) => (assetId ? s.assets[assetId] : undefined))
  const bar = useRef<PromptBarHandle | null>(null)
  const setBar = useCallback((h: PromptBarHandle | null) => {
    bar.current = h
  }, [])

  // On an asset page the list highlights the asset's board (or All assets).
  const activePlace: Place | null = assetId
    ? asset
      ? asset.boardId
        ? { type: 'board', id: asset.boardId }
        : { type: 'all' }
      : null
    : view.place

  const onNew = () => {
    if (!assetId && bar.current) {
      bar.current.focus()
      return
    }
    navigate(withParam(view.href({ place: activePlace ?? { type: 'all' } }), 'compose', '1'))
  }

  // Phones: the boards list is its own screen (?places=1); the contact sheet is the workspace root.
  const [params] = useSearchParams()
  const phoneView = !assetId && params.get('places') === '1' ? 'list' : 'stage'

  return (
    <WorkspaceScreen list={<StudioListPane activePlace={activePlace} onNew={onNew} />} phoneView={phoneView}>
      <Routes>
        <Route index element={<ContactSheet composeRef={setBar} />} />
        <Route path=":assetId" element={<AssetView />} />
        <Route path="*" element={<StudioNotFound />} />
      </Routes>
    </WorkspaceScreen>
  )
}

function StudioNotFound() {
  const navigate = useNavigate()
  return (
    <Stage header={<StageHeader title="Not found" />}>
      <EmptyState
        title="Nothing lives at this address"
        description="Studio has the contact sheet at /studio and each asset at /studio/<id>."
        actions={<Button onClick={() => navigate('/studio')}>Open Studio</Button>}
        className="py-16"
      />
    </Stage>
  )
}
