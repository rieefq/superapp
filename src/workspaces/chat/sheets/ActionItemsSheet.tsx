import { useEffect, useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ListChecks } from 'lucide-react'
import { ProjectPicker } from '@/app/components'
import { db } from '@/core/db'
import { toTask } from '@/core/services'
import type { ID, Thread } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, Checkbox, EmptyState, Field, Sheet, Textarea, toast, useBreakpointUp } from '@/ui'
import { turnInto } from '../actions'
import { actionItemsFor } from '../logic/actionItems'

/**
 * "Tasks from action items" (§6.2 thread-level Turn into, journey 4): a review sheet listing the
 * action items found in the latest answer that has them — all checked, each title editable — then
 * one task per checked item through the toTask handoff, so every task carries its origin message and
 * shows as a chip under it.
 */
export function ActionItemsSheet({ thread, open, onOpenChange }: { thread: Thread; open: boolean; onOpenChange: (open: boolean) => void }) {
  const wide = useBreakpointUp('md')
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      side="right"
      size="md"
      aria-label="Tasks from action items"
      className={cn(!wide && 'inset-0! w-full! rounded-none! border-0!')}
      bodyClassName="px-0 py-0"
      header={<span className="sr-only">Tasks from action items</span>}
      hideClose
    >
      {open && <Review thread={thread} onClose={() => onOpenChange(false)} />}
    </Sheet>
  )
}

interface Row {
  key: string
  title: string
  on: boolean
}

function Review({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const navigate = useNavigate()
  const formId = useId()
  const found = useMemo(() => actionItemsFor(thread.messageIds.map((id) => db.get('messages', id))), [thread.messageIds])
  const [rows, setRows] = useState<Row[]>(() => (found?.items ?? []).map((title, i) => ({ key: `${i}`, title, on: true })))
  const [projectId, setProjectId] = useState<ID | null>(thread.projectId)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [rows, projectId])
  const chosen = rows.filter((r) => r.on && r.title.trim())

  const create = () => {
    if (!found || !chosen.length) {
      setError('Pick at least one item with a title.')
      return
    }
    const source = { kind: 'message' as const, id: found.messageId }
    let made = 0
    try {
      for (const r of chosen) {
        toTask(source, { title: r.title.trim(), projectId })
        made++
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      if (!made) return
    }
    onClose()
    const project = projectId ? db.get('projects', projectId) : undefined
    toast({
      tone: 'success',
      title: `Created ${made} ${made === 1 ? 'task' : 'tasks'}${project ? ` in ${project.name}` : ''}`,
      description: 'Each one links back to the answer it came from.',
      action: { label: 'Open', onClick: () => navigate(project ? `/projects/${encodeURIComponent(project.id)}/tasks` : '/projects/my-tasks') },
    })
  }

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault()
        create()
      }}
      className="flex h-full min-h-0 flex-col"
      aria-label="Tasks from action items"
    >
      <header className="flex shrink-0 flex-col gap-1 px-5 pt-5 pb-4">
        <span className="type-label text-ink-3">Turn into</span>
        <h2 className="type-title-2 text-balance text-ink">Tasks from action items</h2>
        <p className="type-body-sm text-ink-3">
          {found ? 'Found in the latest answer that lists them. Rule-based, not AI: edit or uncheck anything before creating.' : 'From the answers in this conversation.'}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 pb-5">
        {found ? (
          <>
            <fieldset className="flex flex-col gap-1">
              <legend className="type-label mb-2 flex w-full items-center justify-between text-ink-3">
                <span>
                  Items · {chosen.length} of {rows.length}
                </span>
                <button
                  type="button"
                  className="type-caption rounded-xs font-medium tracking-normal text-ink-3 normal-case hover:text-ink"
                  onClick={() => setRows((rs) => rs.map((r) => ({ ...r, on: !rs.every((x) => x.on) })))}
                >
                  {rows.every((r) => r.on) ? 'Uncheck all' : 'Check all'}
                </button>
              </legend>
              {rows.map((r, i) => (
                <div key={r.key} className="flex min-h-10 items-start gap-2.5 rounded-sm px-1 py-1 hover:bg-hover">
                  <span className="flex h-8 shrink-0 items-center">
                    <Checkbox
                      checked={r.on}
                      onCheckedChange={(on) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, on } : x)))}
                      aria-label={`Create a task for item ${i + 1}`}
                    />
                  </span>
                  <Textarea
                    value={r.title}
                    onValueChange={(title) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, title: title.replace(/\n/g, ' ') } : x)))}
                    onKeyDown={(e) => {
                      // One line per task: Enter creates (the form submits), it never adds a line.
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        e.currentTarget.form?.requestSubmit()
                      }
                    }}
                    autosize
                    minRows={1}
                    maxRows={4}
                    aria-label={`Title of item ${i + 1}`}
                    className={cn(
                      'type-body-sm min-h-8 min-w-0 flex-1 resize-none rounded-sm border-transparent bg-transparent px-1.5 py-1.5 text-ink shadow-none hover:border-line focus:border-line-input focus:bg-raised',
                      !r.on && 'text-ink-3 line-through decoration-ink-4',
                    )}
                  />
                </div>
              ))}
            </fieldset>
            <Field label="Project">
              <ProjectPicker value={projectId} onChange={setProjectId} />
            </Field>
            <p className="type-caption text-ink-3">Tasks are assigned to you. Assign one to an agent from its project later.</p>
          </>
        ) : (
          <EmptyState
            compact
            icon={ListChecks}
            title="No action items found"
            description="None of the answers has a checklist, numbered steps or a “Next steps” list. Ask for next steps, or make one task by hand."
            actions={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  onClose()
                  turnInto('task', { kind: 'thread', id: thread.id })
                }}
              >
                Make one task
              </Button>
            }
          />
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        {error && (
          <p role="alert" className="type-caption w-full text-fail-ink">
            {error}
          </p>
        )}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {found && (
          <Button type="submit" variant="primary" kbd="enter" disabled={!chosen.length}>
            {chosen.length ? `Create ${chosen.length} ${chosen.length === 1 ? 'task' : 'tasks'}` : 'Create tasks'}
          </Button>
        )}
      </footer>
    </form>
  )
}
