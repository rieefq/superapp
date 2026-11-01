import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { SlidersHorizontal, X } from 'lucide-react'
import { AgentPicker, Composer, EntityPicker, ReadBackLine, RepoPicker, useComposerContext, useReadBack, type ComposerSubmitMeta } from '@/app/components'
import { pickRepoForScope } from '@/core/assist/repos'
import { useScope } from '@/core/context'
import { db, useDB, type Tables } from '@/core/db'
import { CODE_AGENT_ID, createSession } from '@/core/services'
import type { EntityRef, ID } from '@/core/types'
import { shortCode } from '@/lib/id'
import { IconButton, toast } from '@/ui'
import { useGo } from './hooks'

export interface StartComposerProps {
  /** Preselected repository (else the scope's repository, see pickRepoForScope). */
  repoId?: ID | null
  autoFocus?: boolean
  className?: string
}

function defaultAgent(): ID | null {
  const forge = db.get('agents', CODE_AGENT_ID)
  return forge?.status === 'active' ? forge.id : null
}

/**
 * Start a coding session from Code home (§6.3): a navigating composer — ⏎ starts and opens the session,
 * ⌘⏎ starts it in the background — with the repository, an optional linked task and the agent as
 * chips, the Context Line and the ReadBack line. "More options" opens the full inline Start form.
 */
export function StartComposer({ repoId: initialRepo, autoFocus, className }: StartComposerProps) {
  const navigate = useGo()
  const scope = useScope()
  const [repoId, setRepoId] = useState<ID | null>(() => initialRepo ?? pickRepoForScope(scope ? (db.get('projects', scope) ?? scope) : null, db.all('repos')))
  const [task, setTask] = useState<EntityRef | null>(null)
  const [agentId, setAgentId] = useState<ID | null>(defaultAgent)
  const repo = useDB((s: Tables) => (repoId ? s.repos[repoId] : undefined))
  const taskProject = useDB((s: Tables) => (task ? (s.tasks[task.id]?.projectId ?? null) : undefined))
  // The project the run uses: the linked task's, else the scope (the composer's project chip shows it).
  const projectId = taskProject !== undefined ? taskProject : scope
  const ctx = useComposerContext({ projectId, label: 'Code · New session', initialAttached: [] })
  const readBack = useReadBack({ kind: 'session', agentId, repoId, projectId })

  const start = (text: string, meta: ComposerSubmitMeta) => {
    if (!repo) throw new Error('Choose a repository first, or connect one.')
    const session = createSession({
      repoId: repo.id,
      prompt: text,
      projectId: meta.context.projectId,
      taskId: task?.id,
      agentId: agentId ?? undefined,
      contextRefs: meta.context.all,
    })
    setTask(null)
    const runId = session.turns[0]?.runId
    if (meta.background) {
      toast({
        title: `Started in background · ${runId ? shortCode(runId) : shortCode(session.id)}`,
        description: session.title,
        action: { label: 'Open', onClick: () => navigate(`/code/${encodeURIComponent(session.id)}`) },
      })
    } else {
      navigate(`/code/${encodeURIComponent(session.id)}`)
    }
  }

  const params = new URLSearchParams()
  if (repoId) params.set('repo', repoId)
  if (task) params.set('task', task.id)

  return (
    <div className={className}>
      <Composer
        context={ctx}
        backgroundable
        submitLabel="Start"
        showModel={false}
        autoFocus={autoFocus}
        placeholder="Describe a change — the agent plans it, edits a branch and asks before running anything"
        aria-label="Describe the change for a new coding session"
        above={
          <div className="-mt-1 mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
            <RepoPicker value={repoId} onChange={setRepoId} variant="chip" aria-label="Repository" />
            <EntityPicker kinds={['task']} value={task} onChange={setTask} variant="chip" placeholder="Link a task" aria-label="Linked task" projectId={scope} />
            {task && <IconButton icon={X} label="Unlink the task" size="xs" onClick={() => setTask(null)} />}
          </div>
        }
        agentSlot={<AgentPicker value={agentId} onChange={setAgentId} variant="chip" aria-label="Coding agent" />}
        readBack={<ReadBackLine data={readBack} />}
        reason={!repo ? 'Connect a repository first — a coding agent needs one to work in.' : undefined}
        disabled={!repo}
        onSubmit={start}
      />
      <div className="mt-2 flex items-center gap-3 pl-1">
        <Link
          to={`/code/new${params.size ? `?${params.toString()}` : ''}`}
          className="type-caption inline-flex items-center gap-1.5 rounded-xs text-ink-3 underline decoration-line-input underline-offset-2 transition-colors duration-(--dur-1) hover:text-ink hover:decoration-ink"
        >
          <SlidersHorizontal aria-hidden className="size-3.5" strokeWidth={1.75} />
          More options — branch, approval policy, budget
        </Link>
      </div>
    </div>
  )
}
