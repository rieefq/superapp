import { useEffect, type ReactNode, type Ref } from 'react'
import type { EntityRef } from '@/core/types'
import { cn } from '@/lib/cn'
import { useShellStore } from '../shell/store'

/** Reading caps (§3.4): chat 712px · documents min(68ch, 720px) · Home 1120px · Insights 1280px. */
export type StageMeasure = 'chat' | 'doc' | 'home' | 'insights' | 'full' | number

const MEASURE: Record<Exclude<StageMeasure, number>, string> = {
  chat: 'max-w-[712px]',
  doc: 'max-w-[min(68ch,720px)]',
  home: 'max-w-[1120px]',
  insights: 'max-w-[1280px]',
  full: 'max-w-none',
}

export function measureClass(measure: StageMeasure): string {
  return typeof measure === 'number' ? '' : MEASURE[measure]
}

/**
 * Declare the stage's primary object for as long as the calling component is mounted (Inspector ›
 * Item shows it when nothing is selected; the tab title uses its name).
 */
export function useStagePrimary(ref: EntityRef | null | undefined): void {
  const kind = ref?.kind
  const id = ref?.id
  useEffect(() => {
    const st = useShellStore.getState()
    if (!kind || !id) return
    st.setStagePrimary({ kind, id })
    return () => {
      const cur = useShellStore.getState().stagePrimary
      if (cur && cur.kind === kind && cur.id === id) useShellStore.getState().setStagePrimary(null)
    }
  }, [kind, id])
}

export interface StageProps {
  /** The object this stage shows (thread, report, session…). */
  primary?: EntityRef | null
  /** Usually a `<StageHeader>`. */
  header?: ReactNode
  /** A 40px row under the header (filters, view switches). */
  toolbar?: ReactNode
  /** Docked composer, pinned to the bottom and capped to the same measure. */
  composer?: ReactNode
  /** Reading cap for the body and composer. Default 'full'. */
  measure?: StageMeasure
  /** Body scrolls (default). Off for canvases and editors that manage their own scrolling. */
  scroll?: boolean
  /** Body padding (default: 24px gutters, 16px on phones). Off for full-bleed bodies. */
  padded?: boolean
  bodyRef?: Ref<HTMLDivElement>
  bodyClassName?: string
  className?: string
  children?: ReactNode
}

/**
 * The stage (§3.4): header, scrolling body capped to a reading measure, and an optional docked composer.
 * Fluid width; the shell keeps it ≥640px whenever the Inspector is docked.
 */
export function Stage({ primary, header, toolbar, composer, measure = 'full', scroll = true, padded = true, bodyRef, bodyClassName, className, children }: StageProps) {
  useStagePrimary(primary)
  const cap = measureClass(measure)
  const capStyle = typeof measure === 'number' ? { maxWidth: measure } : undefined
  return (
    <section data-region="stage" aria-label="Stage" className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col', className)}>
      {header}
      {toolbar && <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-4 md:px-6">{toolbar}</div>}
      <div
        ref={bodyRef}
        className={cn('relative min-h-0 flex-1', scroll ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden')}
      >
        {padded ? (
          <div className={cn('mx-auto w-full px-4 py-5 md:px-6 md:py-6', cap, bodyClassName)} style={capStyle}>
            {children}
          </div>
        ) : (
          <div className={cn('h-full w-full', bodyClassName)}>{children}</div>
        )}
      </div>
      {composer && (
        <div data-composer-dock className="shrink-0 px-4 pt-2 pb-4 md:px-6">
          <div className={cn('mx-auto w-full', cap)} style={capStyle}>
            {composer}
          </div>
        </div>
      )}
    </section>
  )
}
