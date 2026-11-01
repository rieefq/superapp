import { lazy, Suspense, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { PageTemplate } from '@/app/templates'
import { useHomeSummary } from '@/core/analytics'
import { useContextStore, useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { useSettings } from '@/core/settings'
import { HUE_FILL } from '@/ui'
import { cn } from '@/lib/cn'
import { FirstRun } from './FirstRun'
import { HomeComposer } from './HomeComposer'
import { NextUp } from './NextUp'
import { computeNeedsYou, landedNotifications, sentenceInput, stateSentence } from './logic'
import { SectionSkeleton } from './skeleton'
import { StatusLine } from './StatusLine'

// The columns load after the sentence and composer (their chunk shows skeleton rows meanwhile).
const Columns = lazy(() => import('./Columns'))

/**
 * Home (§6.1): start anything, clear what needs you, see what is moving, pick up where you left off.
 * Not a dashboard: no charts, no KPI tiles. Page template, max 1120, 32px top padding.
 */
export default function HomeWorkspace() {
  const onboarded = useSettings((s) => s.onboarded)
  // Files dropped anywhere on Home attach to the hero composer.
  const stageRef = useRef<HTMLDivElement>(null)
  const scope = useScope()
  const project = useDB((s: Tables) => (scope ? s.projects[scope] : undefined))
  const summary = useHomeSummary({ projectId: scope })

  // The sentence is derived from data, never generated: needs you → in flight → landed → quiet.
  const tables = useDB(useShallow((s: Tables) => ({ approvals: s.approvals, sessions: s.sessions, tasks: s.tasks, notifications: s.notifications })))
  const { needs, sentence } = useMemo(() => {
    const s = useDB.getState()
    const needs = computeNeedsYou(s, scope)
    const landed = landedNotifications(s, scope).length
    return { needs, sentence: stateSentence(sentenceInput(s, needs, summary.activeRuns, landed)) }
  }, [tables, scope, summary.activeRuns])

  return (
    <PageTemplate width="home" className="pb-16 md:pb-16">
      <div ref={stageRef} className="flex w-full flex-col" data-home-state={sentence.state}>
        {!onboarded && (
          <div className="mb-8">
            <FirstRun />
          </div>
        )}
        <StatusLine needsYou={needs.count} />
        <h1 className="type-display mt-3 max-w-[22ch] text-balance text-ink sm:max-w-none" data-testid="home-sentence">
          {sentence.text}
        </h1>
        <div className="mt-6 md:mt-7">
          <HomeComposer dropTarget={stageRef} />
        </div>
        {sentence.state === 'quiet' && <NextUp />}
        {project && (
          <p className="type-caption mt-8 -mb-4 flex items-center gap-2 text-ink-3" role="status">
            <span aria-hidden className={cn('size-2.5 rounded-[3px]', HUE_FILL[project.hue])} />
            Filtered to <span className="text-ink-2">{project.name}</span>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={() => useContextStore.getState().setScope(null)}
              className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink"
            >
              Show all
            </button>
          </p>
        )}
        <Suspense fallback={<ColumnsSkeleton />}>
          <Columns />
        </Suspense>
      </div>
    </PageTemplate>
  )
}

function ColumnsSkeleton() {
  return (
    <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" aria-busy aria-label="Loading">
      <div className="flex flex-col gap-10">
        <SectionSkeleton rows={2} tall />
        <SectionSkeleton rows={3} />
      </div>
      <div className="flex flex-col gap-10">
        <SectionSkeleton rows={3} tall />
      </div>
    </div>
  )
}
