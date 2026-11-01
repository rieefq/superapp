import { useRef, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import type { EntityRef } from '@/core/types'
import { IconButton, useReducedMotion } from '@/ui'
import { cn } from '@/lib/cn'
import { WorkspaceScreen } from './WorkspaceScreen'
import { Stage, type StageMeasure } from './Stage'

/*
 * The five templates (§6.0). Every workspace is one of these inside the shell frame
 * (list pane | stage | Inspector). They compose WorkspaceScreen + Stage; pass a <ListPane> as `list`
 * and a <StageHeader> as `header`. See README.md in this folder.
 */

// ------------------------------------------------------------------------------------------------ Page

export interface PageTemplateProps {
  /** Centered column width: Home 1120 · Insights 1280 · Projects index 1280. */
  width?: 'home' | 'insights' | number
  header?: ReactNode
  /** The object the page shows (for Inspector › Item and the tab title). */
  primary?: EntityRef | null
  children: ReactNode
  className?: string
}

/** Page: a centered column, no list pane (Home, Insights, the Projects index). */
export function PageTemplate({ width = 'home', header, primary, children, className }: PageTemplateProps) {
  const measure: StageMeasure = width
  return (
    <WorkspaceScreen>
      <Stage header={header} primary={primary} measure={measure} bodyClassName={cn('md:py-8', className)}>
        {children}
      </Stage>
    </WorkspaceScreen>
  )
}

// ------------------------------------------------------------------------------------------------ Session

export interface SessionTemplateProps {
  /** The list pane (threads, investigations, sessions…). */
  list: ReactNode
  header?: ReactNode
  /** Docked composer under the transcript. */
  composer?: ReactNode
  primary?: EntityRef | null
  /** Reading cap: 'chat' (712px) for transcripts, 'doc' for reports. Default 'chat'. */
  measure?: StageMeasure
  /** Phones: 'stage' once an item is open, 'list' at the workspace root. */
  phoneView?: 'list' | 'stage'
  children: ReactNode
  bodyRef?: Ref<HTMLDivElement>
}

/** Session: list pane + stage (header, scrolling body, docked composer) — Chat, Research, Code, agent detail. */
export function SessionTemplate({ list, header, composer, primary, measure = 'chat', phoneView, children, bodyRef }: SessionTemplateProps) {
  return (
    <WorkspaceScreen list={list} phoneView={phoneView}>
      <Stage header={header} composer={composer} primary={primary} measure={measure} bodyRef={bodyRef}>
        {children}
      </Stage>
    </WorkspaceScreen>
  )
}

// ------------------------------------------------------------------------------------------------ Board

export interface BoardTemplateProps {
  header?: ReactNode
  /** The 40px filter row (status, kind, agent filters; view switch). */
  filters?: ReactNode
  /** Optional list pane (sections). */
  list?: ReactNode
  primary?: EntityRef | null
  phoneView?: 'list' | 'stage'
  /** A banded DataTable or a card grid. Full width; tables manage their own padding. */
  children: ReactNode
  /** Pad the body (card grids) or not (tables bleed to the edges). Default true. */
  padded?: boolean
}

/** Board: a stage with a 40px filter row over a banded DataTable or card grid — Agents › Runs, Roster. */
export function BoardTemplate({ header, filters, list, primary, phoneView, children, padded = true }: BoardTemplateProps) {
  return (
    <WorkspaceScreen list={list} phoneView={phoneView}>
      <Stage header={header} toolbar={filters} primary={primary} padded={padded}>
        {children}
      </Stage>
    </WorkspaceScreen>
  )
}

// ------------------------------------------------------------------------------------------------ Canvas

export interface CanvasDrawer {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  /** Height in px (default 280). */
  height?: number
}

export interface CanvasTemplateProps {
  list?: ReactNode
  header?: ReactNode
  /** Floating toolbar, centered at the top of the canvas. */
  toolbar?: ReactNode
  /** Bottom drawer (run overlay, logs, node details). */
  drawer?: CanvasDrawer
  primary?: EntityRef | null
  phoneView?: 'list' | 'stage'
  /** The full-bleed canvas (e.g. @xyflow). It fills the stage body and manages its own panning. */
  children: ReactNode
}

/** Canvas: list pane + full-bleed canvas with a floating toolbar and a bottom drawer — Workflows. */
export function CanvasTemplate({ list, header, toolbar, drawer, primary, phoneView, children }: CanvasTemplateProps) {
  return (
    <WorkspaceScreen list={list} phoneView={phoneView}>
      <Stage header={header} primary={primary} scroll={false} padded={false}>
        <div className="relative flex h-full min-h-0 flex-col">
          <div className="relative min-h-0 flex-1">
            {children}
            {toolbar && (
              <div className="pointer-events-none absolute inset-x-0 top-3 z-(--z-sticky) flex justify-center px-3">
                <div className="pointer-events-auto flex h-9 items-center gap-1 rounded-md border border-line bg-overlay px-1.5 shadow-e1">{toolbar}</div>
              </div>
            )}
          </div>
          {drawer && <BottomDrawer drawer={drawer} />}
        </div>
      </Stage>
    </WorkspaceScreen>
  )
}

function BottomDrawer({ drawer }: { drawer: CanvasDrawer }) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const height = drawer.height ?? 280
  return (
    <AnimatePresence initial={false}>
      {drawer.open && (
        <motion.section
          ref={ref}
          aria-label={typeof drawer.title === 'string' ? drawer.title : 'Details'}
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={{ height, opacity: 1 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { height: 0, opacity: 0, transition: { duration: 0.2 } }}
          transition={{ duration: reduced ? 0.12 : 0.24, ease: [0.2, 0, 0, 1] }}
          className="flex shrink-0 flex-col overflow-hidden border-t border-line bg-canvas"
        >
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-4">
            <h2 className="type-body-sm min-w-0 flex-1 truncate font-semibold text-ink">{drawer.title}</h2>
            <IconButton icon={X} label="Close" size="sm" onClick={() => drawer.onOpenChange(false)} />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{drawer.children}</div>
        </motion.section>
      )}
    </AnimatePresence>
  )
}

// ------------------------------------------------------------------------------------------------ Library

export interface LibraryTemplateProps {
  /** Collections, filters or sections. */
  list: ReactNode
  header?: ReactNode
  /** The search / view row above the content (40px). */
  toolbar?: ReactNode
  primary?: EntityRef | null
  phoneView?: 'list' | 'stage'
  /** Reading cap when showing a detail (e.g. a document: 'doc'). Default 'full'. */
  measure?: StageMeasure
  children: ReactNode
}

/** Library: list pane (collections, filters or sections) + search and list/grid, or a detail — Knowledge, Studio, Integrations, Settings. */
export function LibraryTemplate({ list, header, toolbar, primary, phoneView, measure = 'full', children }: LibraryTemplateProps) {
  return (
    <WorkspaceScreen list={list} phoneView={phoneView}>
      <Stage header={header} toolbar={toolbar} primary={primary} measure={measure}>
        {children}
      </Stage>
    </WorkspaceScreen>
  )
}
