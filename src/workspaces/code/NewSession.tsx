import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { SquareTerminal } from 'lucide-react'
import { StartPanel } from '@/app/components'
import { Stage, StageHeader } from '@/app/templates'
import { db } from '@/core/db'
import { fileInstruction } from './logic'
import { useGo } from './hooks'

/**
 * New coding session (`/code/new`, §6.3): the inline Start form for a coding session (§5.4.11) —
 * title, instruction, project, Context Line, repository, branches, linked task, agent, approval policy,
 * model, budget cap and the ReadBack. `?repo=`, `?task=`, `?path=` (a file to start from) and `?brief=`
 * prefill it.
 */
export function NewSession() {
  const navigate = useGo()
  const [params] = useSearchParams()
  // Read once: the form owns its fields after it opens.
  const [prefill] = useState(() => {
    const out: Record<string, unknown> = {}
    const repo = params.get('repo')
    const task = params.get('task')
    const path = params.get('path')
    const brief = params.get('brief')
    if (repo && db.get('repos', repo)) out.repoId = repo
    if (task && db.get('tasks', task)) {
      out.taskId = task
      out.projectId = db.get('tasks', task)?.projectId ?? null
    }
    if (path) out.brief = fileInstruction(path)
    else if (brief) out.brief = brief
    return out
  })
  const close = () => navigate(prefill.repoId && params.get('path') ? `/code/repos/${encodeURIComponent(String(prefill.repoId))}?path=${encodeURIComponent(params.get('path') ?? '')}` : '/code')
  return (
    <Stage
      scroll={false}
      padded={false}
      header={<StageHeader title="New coding session" leading={<SquareTerminal aria-hidden className="mr-1 size-4 text-ink-3" strokeWidth={1.75} />} backTo="/code" />}
    >
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col px-4 pt-5 md:px-6 md:pt-6">
        <StartPanel variant="inline" kind="session" prefill={prefill} onClose={close} className="min-h-0 flex-1 [&>footer]:-mx-4 [&>footer]:md:-mx-6" />
      </div>
    </Stage>
  )
}
