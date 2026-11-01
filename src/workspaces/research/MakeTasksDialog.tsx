import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ProjectPicker } from '@/app/components'
import { useDB, type Tables } from '@/core/db'
import { createTask, entityRoute } from '@/core/services'
import type { ActorRef, ID, Investigation } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, Checkbox, Dialog, Field, Select, toast } from '@/ui'
import { taskTitle } from './logic'

/**
 * Make tasks (§6.5): a review sheet of candidate tasks — the report's open questions, next steps and
 * recommendations, or selected findings — with checkboxes, editable titles, a project and an assignee.
 * Each task is created with the investigation as its origin (a `derived_from` link and activity).
 */

export interface TaskCandidate {
  id: string
  text: string
  /** Where it came from ("Open questions & next steps", "Finding 2"). */
  section?: string
}

export interface MakeTasksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  inv: Investigation
  candidates: readonly TaskCandidate[]
  /** "Tasks from open questions" · "Tasks from findings". */
  heading?: string
}

export function MakeTasksDialog({ open, onOpenChange, inv, candidates, heading = 'Tasks from open questions' }: MakeTasksDialogProps) {
  const navigate = useNavigate()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [projectId, setProjectId] = useState<ID | null>(inv.projectId)
  const [assignee, setAssignee] = useState<string>('me')
  const agents = useDB(useShallow((s: Tables) => Object.values(s.agents).filter((a) => a.status === 'active').sort((a, b) => a.name.localeCompare(b.name))))
  const profileName = 'You'

  // Fresh selection every time the sheet opens.
  useEffect(() => {
    if (!open) return
    setChecked(new Set(candidates.map((c) => c.id)))
    setTitles(Object.fromEntries(candidates.map((c) => [c.id, taskTitle(c.text)])))
    setProjectId(inv.projectId)
    setAssignee('me')
  }, [open, candidates, inv.projectId])

  const count = candidates.filter((c) => checked.has(c.id) && (titles[c.id] ?? '').trim()).length
  const agentName = agents.find((a) => a.id === assignee)?.name
  const options = useMemo(
    () => [{ value: 'me', label: profileName, group: 'People' }, ...agents.map((a) => ({ value: a.id, label: a.name, description: a.role, group: 'Agents' }))],
    [agents],
  )

  const create = () => {
    const who: ActorRef = assignee === 'me' ? { type: 'user', id: 'usr_me' } : { type: 'agent', id: assignee }
    const made: ID[] = []
    try {
      for (const c of candidates) {
        const title = (titles[c.id] ?? '').trim()
        if (!checked.has(c.id) || !title) continue
        const task = createTask({
          title,
          description: `${c.text}\n\nFrom the investigation “${inv.title}”${c.section ? ` · ${c.section}` : ''}.`,
          projectId,
          assignee: who,
          origin: { kind: 'investigation', id: inv.id },
        })
        made.push(task.id)
      }
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t create the tasks', description: err instanceof Error ? err.message : String(err) })
      return
    }
    onOpenChange(false)
    if (!made.length) return
    const first = made[0]
    toast({
      tone: 'success',
      title: `Created ${made.length} task${made.length === 1 ? '' : 's'}`,
      description: assignee !== 'me' && agentName ? `${agentName} starts on ${made.length === 1 ? 'it' : 'them'} now.` : 'Each links back to this investigation.',
      action: { label: 'Open', onClick: () => navigate(projectId ? `/projects/${projectId}/tasks` : entityRoute({ kind: 'task', id: first })) },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={heading}
      description={`From “${inv.title}”. Uncheck what you don’t want; edit titles inline.`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={count === 0} onClick={create}>
            {count === 0 ? 'Create tasks' : `Create ${count} task${count === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {candidates.length === 0 ? (
          <p className="type-body-sm text-ink-3">This report lists no open questions, next steps or recommendations. Add a task from a finding instead.</p>
        ) : (
          <ul className="flex max-h-[min(46vh,420px)] flex-col overflow-y-auto overscroll-contain rounded-md border border-line" aria-label="Candidate tasks">
            {candidates.map((c) => {
              const on = checked.has(c.id)
              return (
                <li key={c.id} className="flex min-w-0 items-start gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                  <Checkbox
                    checked={on}
                    onCheckedChange={(v) =>
                      setChecked((cur) => {
                        const next = new Set(cur)
                        if (v) next.add(c.id)
                        else next.delete(c.id)
                        return next
                      })
                    }
                    aria-label={`Create “${titles[c.id] ?? c.text}”`}
                    className="mt-2"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <textarea
                      value={titles[c.id] ?? ''}
                      rows={1}
                      onChange={(e) => setTitles((t) => ({ ...t, [c.id]: e.target.value.replace(/\n/g, ' ') }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.preventDefault()
                      }}
                      aria-label="Task title"
                      disabled={!on}
                      className={cn(
                        'type-body-sm min-h-8 w-full min-w-0 resize-none rounded-sm border border-transparent bg-transparent px-1.5 py-[6px] text-ink outline-none transition-colors duration-(--dur-1) [field-sizing:content]',
                        'hover:border-line focus-visible:border-line-input focus-visible:bg-canvas disabled:text-ink-3 disabled:line-through pointer-coarse:text-[16px]',
                      )}
                    />
                    {c.section && <span className="type-meta px-1.5 text-ink-3">{c.section}</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Project">
            <ProjectPicker value={projectId} onChange={setProjectId} />
          </Field>
          <Field label="Assignee" hint={assignee !== 'me' && agentName ? `${agentName} starts each task right away.` : undefined}>
            <Select value={assignee} onValueChange={setAssignee} options={options} aria-label="Assignee" />
          </Field>
        </div>
      </div>
    </Dialog>
  )
}
