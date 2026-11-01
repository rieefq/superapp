import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { AgentPicker, ReadBack, useReadBack } from '@/app/components'
import { workspaceForPath } from '@/app/registry'
import { attachRun } from '@/app/shell/store'
import { useDB, type Tables } from '@/core/db'
import { assignTask, useAgent } from '@/core/services'
import type { ID } from '@/core/types'
import { shortCode } from '@/lib/id'
import { Button, Dialog, Field, toast, useHotkey } from '@/ui'

export interface AssignDialogProps {
  taskId: ID | null
  /** Preselected agent (from the assignee picker or a Members drop). */
  agentId?: ID | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the run once the agent has started. */
  onAssigned?: (runId: ID | undefined) => void
}

/**
 * Assign to agent (§6.9, §7.2): a ReadBack confirm — what will run, on which model, what the agent may
 * do and what it is likely to cost — then `assignTask`, which starts the agent's run. ⏎ assigns and
 * keeps you on the task (its run shows live there); ⌘⏎ assigns in the background.
 */
export function AssignDialog({ taskId, agentId: initialAgent, open, onOpenChange, onAssigned }: AssignDialogProps) {
  const location = useLocation()
  const task = useDB((s: Tables) => (taskId ? s.tasks[taskId] : undefined))
  const [agentId, setAgentId] = useState<ID | null>(initialAgent ?? null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setAgentId(initialAgent ?? (task?.assignee?.type === 'agent' ? task.assignee.id : null))
      setBusy(false)
    }
    // Reset when (re)opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAgent])
  const agent = useAgent(agentId)
  const readBack = useReadBack({ kind: 'agent', agentId, projectId: task?.projectId ?? null, title: task?.title })
  const primaryRef = useRef<HTMLButtonElement>(null)
  useHotkey('mod+enter', () => assign(true), { enabled: open })

  const assign = (background: boolean) => {
    if (!task || !agentId || busy) return
    setBusy(true)
    try {
      const result = assignTask(task.id, { type: 'agent', id: agentId })
      onOpenChange(false)
      const run = result?.run
      onAssigned?.(run?.id)
      const name = agent?.name ?? 'The agent'
      toast({
        title: run ? `${name} started “${task.title}”` : `${name} is already on “${task.title}”`,
        description: run
          ? `${shortCode(run.id)} · the task moves to Review when ${name} finishes. You approve the review.`
          : 'Its current run keeps going.',
        duration: background ? 8000 : 6000,
        action: run ? { label: background ? 'Open' : 'Watch the run', onClick: () => attachRun(run.id, workspaceForPath(location.pathname).id) } : undefined,
      })
    } catch (err) {
      setBusy(false)
      toast({ tone: 'error', title: `Couldn’t assign ${agent?.name ?? 'the agent'}`, description: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      initialFocus={initialAgent ? primaryRef : undefined}
      size="lg"
      title={agent ? `Assign to ${agent.name}` : 'Assign to an agent'}
      description={task ? `“${task.title}”` : undefined}
      footer={
        <>
          <span className="type-caption mr-auto hidden text-ink-3 sm:block">The agent starts right away.</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="secondary" kbd="mod+enter" disabled={!agentId || !task} onClick={() => assign(true)} className="max-sm:hidden">
            In background
          </Button>
          <Button ref={primaryRef} variant="primary" kbd="enter" disabled={!agentId || !task} loading={busy} onClick={() => assign(false)}>
            Assign and start
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-2 pb-1">
        <Field label="Agent">
          <AgentPicker
            value={agentId}
            onChange={(id) => {
              setAgentId(id)
              // Picking an agent moves focus to the primary action, so ⏎ assigns.
              requestAnimationFrame(() => primaryRef.current?.focus())
            }}
          />
        </Field>
        {agentId ? (
          <div className="rounded-md border border-line bg-sunken px-3.5 py-3">
            <ReadBack data={readBack} />
          </div>
        ) : (
          <p className="type-body-sm text-ink-3">Choose an agent to see what it will do, what it may do without asking, and the estimated cost.</p>
        )}
        <p className="type-caption text-ink-3">
          The task moves to In progress while the agent works, then to Review when it finishes. It never moves to Done by itself: you approve the review.
        </p>
      </div>
    </Dialog>
  )
}
