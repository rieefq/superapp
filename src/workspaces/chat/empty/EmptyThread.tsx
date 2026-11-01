import { useMemo } from 'react'
import { Link } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { Columns2, FileText, Lightbulb, ListChecks, PenLine, Telescope, type LucideIcon } from 'lucide-react'
import { useShellStore } from '@/app/shell/store'
import { getModelInfo } from '@/core/ai'
import { useDB, type Tables } from '@/core/db'
import { resolveIn } from '@/core/services'
import { refKey, type EntityKind, type EntityRef, type ID } from '@/core/types'
import { EntityChip, SimBadge } from '@/ui'
import { deriveSuggestions, type Suggestion, type SuggestionKind } from '../logic/suggestions'

/**
 * The empty conversation (§6.2 States): "What are we working on?", four starters drawn from your own
 * work (each attaches the item it is about, so the Context Line shows what the answer will see), the
 * context you used recently, and — while the model is the Simulator — the honest line about it.
 */

const ICON: Record<SuggestionKind, LucideIcon> = {
  summarize: FileText,
  compare: Columns2,
  task: ListChecks,
  research: Telescope,
  draft: PenLine,
  plan: Lightbulb,
}

const RECENT_KINDS = new Set<EntityKind>(['knowledge', 'task', 'investigation', 'session', 'repo', 'asset', 'source', 'project', 'run'])
const RECENT_LIMIT = 6

export function EmptyThread({
  projectId,
  modelId,
  onUse,
  onAttach,
}: {
  projectId: ID | null
  modelId: string
  onUse: (suggestion: Suggestion) => void
  onAttach: (ref: EntityRef) => void
}) {
  const tables = useDB(
    useShallow((s: Tables) => ({ knowledge: s.knowledge, tasks: s.tasks, investigations: s.investigations, projects: s.projects })),
  )
  const suggestions = useMemo(() => deriveSuggestions(useDB.getState(), projectId), [tables, projectId])
  const recent = useRecentContext(projectId)
  const project = projectId ? tables.projects[projectId] : undefined
  const simulated = !!getModelInfo(modelId)?.simulated

  return (
    <div className="flex flex-1 flex-col justify-center py-4 md:py-8">
      <div className="flex flex-col gap-7">
        <header className="flex flex-col gap-1.5">
          <h2 className="type-title-2 text-balance text-ink">What are we working on?</h2>
          <p className="type-body-sm text-ink-3 text-pretty">
            {project ? (
              <>
                In <span className="text-ink-2">{project.name}</span>: its goal and memory ride along with every message.
              </>
            ) : (
              'Not in a project: pick one above to give the conversation its memory, or just ask.'
            )}
          </p>
        </header>

        <section aria-label="Suggestions">
          <ul className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((s) => {
              const Icon = ICON[s.kind]
              return (
                <li key={s.id} className="flex">
                  <button
                    type="button"
                    onClick={() => onUse(s)}
                    className="group/card flex w-full min-w-0 items-start gap-3 rounded-md border border-line bg-canvas p-3 text-left transition-colors duration-(--dur-1) ease-standard hover:border-line-strong hover:bg-hover"
                  >
                    <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-sm bg-raised text-ink-3 shadow-inset group-hover/card:text-ink-2">
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="type-body-sm line-clamp-2 font-medium text-ink text-pretty">{s.prompt}</span>
                      <span className="type-caption truncate text-ink-3">{s.meta}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        {recent.length > 0 && (
          <section aria-labelledby="chat-recent-context" className="flex flex-col gap-2">
            <h3 id="chat-recent-context" className="type-label flex items-center gap-2 text-ink-3">
              Recently used
              <span className="type-caption font-normal tracking-normal normal-case">· click to attach</span>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((ref) => (
                <EntityChip key={refKey(ref)} entity={ref} onActivate={onAttach} />
              ))}
            </div>
          </section>
        )}

        {simulated && (
          <p className="type-caption flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">
            <SimBadge />
            <span>Simulator — answers are simulated</span>
            <span aria-hidden>·</span>
            <Link to="/integrations/anthropic" className="text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
              Connect a model
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}

/** Items you opened or attached recently (shell recents first, then conversations' context), in scope first. */
function useRecentContext(projectId: ID | null): EntityRef[] {
  const recents = useShellStore((s) => s.recents)
  const keys = useDB(
    useShallow((s: Tables) => {
      const out: string[] = []
      const push = (r: EntityRef) => {
        const k = refKey(r)
        if (!RECENT_KINDS.has(r.kind) || out.includes(k)) return
        const e = resolveIn(s, r)
        if (!e.exists) return
        out.push(k)
      }
      for (const r of recents) push(r)
      const threads = Object.values(s.threads)
        .filter((t) => !t.archived && (!projectId || t.projectId === projectId))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8)
      for (const t of threads) for (const r of t.contextRefs) push(r)
      // In-scope items first, then the rest, keeping recency within each.
      const inScope = (k: string) => {
        if (!projectId) return 0
        const at = k.indexOf(':')
        const e = resolveIn(s, { kind: k.slice(0, at) as EntityKind, id: k.slice(at + 1) })
        return e.projectId === projectId ? 0 : 1
      }
      return out
        .map((k, i) => ({ k, i, w: inScope(k) }))
        .sort((a, b) => a.w - b.w || a.i - b.i)
        .slice(0, RECENT_LIMIT)
        .map((x) => x.k)
    }),
  )
  return useMemo(
    () =>
      keys.map((k) => {
        const at = k.indexOf(':')
        return { kind: k.slice(0, at) as EntityKind, id: k.slice(at + 1) }
      }),
    [keys],
  )
}
