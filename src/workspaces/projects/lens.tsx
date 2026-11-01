import { useShallow } from 'zustand/react/shallow'
import { Check, Crosshair } from 'lucide-react'
import type { LensModule, LensProps } from '@/app/lens/types'
import { switchScope } from '@/app/shell/scope'
import { formatTokenCount } from '@/app/components'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { nextMilestone, PRIORITY_LABEL, TASK_STATUS_LABEL, useProject, useProjectSignal, useTask } from '@/core/services'
import { plainText } from '@/core/services/serviceHelpers'
import type { Project, Task } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, PriorityGlyph, TickMeter } from '@/ui'
import { PROJECT_STATUS_WORD } from './logic'
import { useMemoryBreakdown } from './memory'
import { ActorMark, DueText, RunLine, SignalCounts, TaskStatusGlyph, useActorName, useTaskSignal } from './parts'
import { MilestoneSquare } from './task/fields'
import { TaskPanel } from './task/TaskPanel'

/**
 * Lens renderers for the kinds Projects owns (§5.4.8): `project` and `task`. The panel is the body of
 * Inspector › Item (the task panel is the task drawer); the card is the hover card / ⌘K preview.
 */

// ------------------------------------------------------------------------------------------------ project

function useTaskCounts(projectId: string) {
  return useDB(
    useShallow((s: Tables) => {
      let done = 0
      let total = 0
      let review = 0
      for (const t of Object.values(s.tasks)) {
        if (t.projectId !== projectId || t.status === 'cancelled') continue
        total++
        if (t.status === 'done') done++
        else if (t.status === 'review') review++
      }
      return { done, total, open: total - done, review }
    }),
  )
}

function ProjectFacts({ project, compact }: { project: Project; compact?: boolean }) {
  const counts = useTaskCounts(project.id)
  const signal = useProjectSignal(project.id)
  const next = nextMilestone(project)
  return (
    <div className={cn('flex flex-col', compact ? 'gap-2' : 'gap-3')}>
      <div className="flex items-center gap-3">
        <TickMeter value={counts.done} max={Math.max(1, counts.total)} label="Tasks done" valueText={`${counts.done} of ${counts.total} tasks done`} thresholds={{ attn: 2, fail: 3 }} className="flex-1" />
        <span className="type-meta shrink-0 text-ink-3 tabular">
          {counts.done}/{counts.total} done
        </span>
      </div>
      <div className="type-meta flex min-w-0 items-center gap-1.5 text-ink-3">
        {next ? (
          <>
            <MilestoneSquare size={8} />
            <span className="min-w-0 truncate text-ink-2">{next.title}</span>
            {next.dueAt !== undefined && <DueText dueAt={next.dueAt} className="ml-auto pl-2" />}
          </>
        ) : (
          <span>{project.milestones.length ? 'Every milestone is done' : 'No milestones'}</span>
        )}
      </div>
      {(signal.running > 0 || signal.needsYou > 0 || counts.review > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SignalCounts running={signal.running} needsYou={signal.needsYou} />
          {counts.review > 0 && <span className="type-meta text-ink-3">{counts.review} in review</span>}
        </div>
      )}
    </div>
  )
}

function ProjectLensPanel({ entity }: LensProps) {
  const project = useProject(entity.id)
  const scope = useScope()
  if (!project) return null
  const inScope = scope === project.id
  return (
    <div className="flex flex-col gap-3.5 px-4 py-3.5">
      {project.goal && (
        <div className="flex flex-col gap-1">
          <h3 className="type-label text-ink-3">Goal</h3>
          <p className="type-body-sm text-pretty text-ink">{project.goal}</p>
        </div>
      )}
      {project.description && <p className="type-body-sm line-clamp-4 text-pretty text-ink-2">{project.description}</p>}
      <ProjectFacts project={project} />
      <MemoryLine project={project} />
      {project.status !== 'archived' && (
        <div>
          <Button size="sm" variant={inScope ? 'secondary' : 'ghost'} leadingIcon={inScope ? Check : Crosshair} aria-pressed={inScope} onClick={() => switchScope(inScope ? null : project.id)}>
            {inScope ? 'In scope' : 'Work in this project'}
          </Button>
        </div>
      )}
    </div>
  )
}

function MemoryLine({ project }: { project: Project }) {
  const memory = useMemoryBreakdown(project.id)
  return (
    <p className="type-meta text-ink-3">
      Memory: {project.pinnedRefs.length} {project.pinnedRefs.length === 1 ? 'item' : 'items'}
      {project.instructions ? ' · instructions' : ''} · ~{formatTokenCount(memory.total)} tok in every run here
    </p>
  )
}

function ProjectLensCard({ entity }: LensProps) {
  const project = useProject(entity.id)
  if (!project) return null
  return (
    <div className="flex flex-col gap-2.5">
      <p className="type-caption line-clamp-2 text-pretty text-ink-2">{project.goal || project.description || 'No goal yet.'}</p>
      {project.status !== 'active' && <span className="type-meta text-ink-3">{PROJECT_STATUS_WORD[project.status]}</span>}
      <ProjectFacts project={project} compact />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ task

function TaskFacts({ task }: { task: Task }) {
  const signal = useTaskSignal(task)
  const assignee = useActorName(task.assignee)
  const done = task.subtasks.filter((s) => s.done).length
  return (
    <div className="flex flex-col gap-2">
      <div className="type-caption flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <TaskStatusGlyph task={task} decorative />
          {TASK_STATUS_LABEL[task.status]}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <PriorityGlyph priority={task.priority} decorative />
          {PRIORITY_LABEL[task.priority]}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ActorMark actor={task.assignee} size={14} live={signal.live} />
          {assignee}
        </span>
      </div>
      {(task.dueAt !== undefined || task.subtasks.length > 0 || task.labels.length > 0) && (
        <div className="type-meta flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-ink-3">
          {task.dueAt !== undefined && <DueText dueAt={task.dueAt} done={task.status === 'done'} />}
          {task.subtasks.length > 0 && (
            <span className="tabular">
              {done}/{task.subtasks.length} subtasks
            </span>
          )}
          {task.labels.slice(0, 3).map((l) => (
            <span key={l}>#{l}</span>
          ))}
        </div>
      )}
      {signal.activeRunId && <RunLine runId={signal.activeRunId} size="xs" />}
    </div>
  )
}

function TaskLensCard({ entity }: LensProps) {
  const task = useTask(entity.id)
  if (!task) return null
  const excerpt = task.description ? plainText(task.description).replace(/\s+/g, ' ').trim() : ''
  return (
    <div className="flex flex-col gap-2">
      <TaskFacts task={task} />
      {excerpt && <p className="type-caption line-clamp-2 text-pretty text-ink-3">{excerpt}</p>}
    </div>
  )
}

export const lenses: LensModule['lenses'] = {
  project: { panel: ProjectLensPanel, card: ProjectLensCard },
  task: { panel: TaskPanel, card: TaskLensCard },
}
