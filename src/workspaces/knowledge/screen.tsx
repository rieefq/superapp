import { useCallback, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Library } from 'lucide-react'
import { Stage, WorkspaceScreen, useShellLayout, type StageMeasure } from '@/app/templates'
import type { EntityRef } from '@/core/types'
import { IconButton, Sheet } from '@/ui'
import { newNoteHref } from './nav'
import { KnowledgeListPane, KnowledgeSections } from './pane'

export function useNewNote(): () => void {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(() => navigate(newNoteHref(location.search, location.pathname)), [navigate, location.search, location.pathname])
}

/**
 * Local correction for StageHeader's renamable title: its button is `-mx-1.5 px-1.5 max-w-full`, so
 * its max width resolves against an h1 that excludes the 12px of padding and every title truncates
 * early ("Prod…"). Allowing the 12px back fixes it without touching the shared template.
 */
export const STAGE_TITLE_FIX = '[&_h1>button]:max-w-[calc(100%+0.75rem)]'

export function usePhone(): boolean {
  return useShellLayout().formFactor === 'phone'
}

export interface KnowledgeScreenProps {
  header?: ReactNode
  toolbar?: ReactNode
  composer?: ReactNode
  primary?: EntityRef | null
  measure?: StageMeasure
  scroll?: boolean
  bodyClassName?: string
  children: ReactNode
}

/**
 * The Knowledge frame: the Library template (§6.0) — list pane | stage — with a docked composer where a
 * view has one (Ask this collection). Phones show the stage; the sections open from a Browse sheet.
 */
export function KnowledgeScreen({ header, toolbar, composer, primary, measure = 'full', scroll, bodyClassName, children }: KnowledgeScreenProps) {
  const phone = usePhone()
  const newNote = useNewNote()
  return (
    <WorkspaceScreen list={phone ? undefined : <KnowledgeListPane onNewNote={newNote} />} phoneView="stage">
      <Stage header={header} toolbar={toolbar} composer={composer} primary={primary} measure={measure} scroll={scroll} bodyClassName={bodyClassName}>
        {children}
      </Stage>
    </WorkspaceScreen>
  )
}

/** Phones: the list pane's sections in a bottom sheet (collections, smart filters, tags, the lab). */
export function BrowseButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton icon={Library} label="Browse collections and filters" size="sm" onClick={() => setOpen(true)} className="-ml-1" />
      <Sheet open={open} onOpenChange={setOpen} side="bottom" title="Knowledge" size="md">
        <div className="-mx-2 pb-2">
          <KnowledgeSections onNavigate={() => setOpen(false)} />
        </div>
      </Sheet>
    </>
  )
}
