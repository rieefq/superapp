import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { create } from 'zustand'
import { ListChecks, Play } from 'lucide-react'
import { Composer, ProjectPicker, ReadBackLine, useReadBack, type ReadBackData } from '@/app/components'
import { getModel } from '@/core/ai/models'
import { useScope } from '@/core/context'
import { db, useDB, useRow, type Tables } from '@/core/db'
import { PRIORITY_LABEL, PRIORITY_RANK, TASK_STATUS_LABEL, agentExecutorModel, assignTask, createTask, getAgentTemplate, runAgent } from '@/core/services'
import type { Agent, EntityRef, ID, Priority, Task } from '@/core/types'
import { cn } from '@/lib/cn'
import { shortCode } from '@/lib/id'
import { Button, Dialog, Field, HUE_FILL, Input, KbdCombo, SearchField, SegmentedControl, Select, TaskGlyph, Textarea, toast } from '@/ui'

/**
 * Give an agent work (§6.4, §8.1): an instruction (“Run now”) or a task (“Assign task”, pick an
 * open task or create one → assignTask). ⏎ starts it and takes you to the run; ⌘⏎ starts it in the
 * background and you stay. One dialog for the roster, the agent page, the Inspector lens and ⌘K.
 */

export type GiveWorkMode = 'instruction' | 'task'

interface GiveWorkState {
  agentId: ID | null
  mode: GiveWorkMode
  /** Prefilled instruction (e.g. the template's example after creating an agent). */
  draft?: string
  /** Mounted hosts; only the first renders the dialog (the Agents views and the Inspector lens both mount one). */
  hosts: string[]
}

const useGiveWorkStore = create<GiveWorkState>(() => ({ agentId: null, mode: 'instruction', hosts: [] }))

/** Open the dialog from anywhere (the host is mounted once per Agents view). */
export function openGiveWork(agentId: ID, mode: GiveWorkMode = 'instruction', draft?: string): void {
  useGiveWorkStore.setState({ agentId, mode, draft })
}

export function closeGiveWork(): void {
  useGiveWorkStore.setState({ agentId: null })
}

/** The ReadBack for an agent run, naming the simulator that will actually execute it. */
export function useAgentReadBack(agent: Agent | undefined, projectId: ID | null, title?: string): ReadBackData {
  const data = useReadBack({ kind: 'agent', agentId: agent?.id ?? null, projectId, title })
  const executor = agent ? getModel(agentExecutorModel(agent)) : undefined
  return useMemo(() => (executor ? { ...data, model: { label: executor.label, simulated: executor.simulated } } : data), [data, executor])
}

export function GiveWorkHost() {
  const hostId = useId()
  const { agentId, mode, draft } = useGiveWorkStore()
  const primary = useGiveWorkStore((s) => s.hosts[0] === hostId)
  useEffect(() => {
    useGiveWorkStore.setState((s) => ({ hosts: [...s.hosts, hostId] }))
    return () => useGiveWorkStore.setState((s) => ({ hosts: s.hosts.filter((h) => h !== hostId) }))
  }, [hostId])
  const agent = useRow('agents', agentId)
  const open = primary && !!agentId && !!agent
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && closeGiveWork()}
      size="lg"
      title={agent ? (mode === 'instruction' ? `Run ${agent.name} now` : `Assign a task to ${agent.name}`) : undefined}
      description={agent ? `${agent.role} · agent runs are simulated in this build` : undefined}
    >
      {agent && <GiveWorkBody key={`${agent.id}:${mode}`} agent={agent} mode={mode} draft={draft} />}
    </Dialog>
  )
}

function GiveWorkBody({ agent, mode, draft }: { agent: Agent; mode: GiveWorkMode; draft?: string }) {
  const unavailable = agent.status !== 'active'
  return (
    <div className="flex flex-col gap-4 pb-2">
      <SegmentedControl
        size="sm"
        aria-label="Give work as"
        value={mode}
        onValueChange={(m) => useGiveWorkStore.setState({ mode: m as GiveWorkMode })}
        options={[
          { value: 'instruction', label: 'Instruction', icon: Play },
          { value: 'task', label: 'Task', icon: ListChecks },
        ]}
        className="self-start"
      />
      {unavailable && (
        <p role="alert" className="type-body-sm rounded-sm border border-line-strong bg-raised px-3 py-2 text-ink-2">
          {agent.name} is {agent.status === 'paused' ? 'paused' : 'archived'} and takes no new work.{' '}
          {agent.status === 'paused' ? 'Resume it on its page first.' : 'Restore it from the roster first.'}
        </p>
      )}
      {mode === 'instruction' ? <InstructionForm agent={agent} draft={draft} disabled={unavailable} /> : <TaskForm agent={agent} disabled={unavailable} />}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ instruction

/** Start a run and land it: ⏎ goes to the run, ⌘⏎ stays with a toast (§8.1). */
export function useStartAgentRun(agent: Agent) {
  const navigate = useNavigate()
  return (instruction: string, opts: { background: boolean; projectId: ID | null; context: EntityRef[] }) => {
    const run = runAgent(agent.id, {
      instruction,
      projectId: opts.projectId,
      context: opts.context,
    })
    closeGiveWork()
    const route = `/agents/${encodeURIComponent(agent.id)}?run=${encodeURIComponent(run.id)}`
    if (opts.background) {
      toast({ title: `Started in background · ${shortCode(run.id)}`, description: `${agent.name} · ${run.title}`, action: { label: 'Open', onClick: () => navigate(route) } })
    } else navigate(route)
    return run
  }
}

function InstructionForm({ agent, draft, disabled }: { agent: Agent; draft?: string; disabled: boolean }) {
  const scope = useScope()
  const start = useStartAgentRun(agent)
  const readBack = useAgentReadBack(agent, scope)
  const example = getAgentTemplate(agent.template)?.exampleInstruction
  const [value, setValue] = useState(draft ?? '')
  return (
    <Composer
      placeholder={example ? `What should ${agent.name} do? e.g. ${example}` : `What should ${agent.name} do?`}
      value={value}
      onValueChange={setValue}
      backgroundable
      submitLabel="Run"
      autoFocus
      showModel={false}
      disabled={disabled}
      readBack={<ReadBackLine data={readBack} />}
      contextOptions={{ label: `Agents · ${agent.name}` }}
      aria-label={`Instruction for ${agent.name}`}
      onSubmit={(text, meta) => {
        start(text, { background: meta.background, projectId: meta.context.projectId, context: meta.context.all })
      }}
    />
  )
}

// ------------------------------------------------------------------------------------------------ task

const OPEN = new Set<Task['status']>(['backlog', 'todo', 'in_progress', 'review'])

function TaskForm({ agent, disabled }: { agent: Agent; disabled: boolean }) {
  const navigate = useNavigate()
  const scope = useScope()
  const [tab, setTab] = useState<'pick' | 'new'>('pick')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<ID | null>(null)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState<ID | null>(scope)
  const [priority, setPriority] = useState<Priority>('medium')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tasksTable = useDB((s: Tables) => s.tasks)
  const projects = useDB(useShallow((s: Tables) => Object.fromEntries(Object.values(s.projects).map((p) => [p.id, `${p.name}\u0000${p.hue}`]))))

  const tasks = useMemo(() => {
    const q = query.trim().toLowerCase()
    return Object.values(tasksTable)
      .filter((t) => OPEN.has(t.status) && (!scope || t.projectId === scope) && (!q || t.title.toLowerCase().includes(q)))
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || b.updatedAt - a.updatedAt)
      .slice(0, 50)
  }, [tasksTable, scope, query])

  const pickedTask = picked ? tasksTable[picked] : undefined
  const ready = tab === 'pick' ? !!pickedTask : !!title.trim()
  const readBack = useAgentReadBack(agent, tab === 'pick' ? (pickedTask?.projectId ?? scope) : projectId, tab === 'pick' ? pickedTask?.title : title || undefined)

  useEffect(() => setError(null), [tab, picked, title])

  const submit = (background: boolean) => {
    if (disabled || busy) return
    setBusy(true)
    try {
      let taskId: ID
      let runId: ID | undefined
      if (tab === 'pick') {
        if (!picked) throw new Error('Pick a task to assign.')
        const result = assignTask(picked, { type: 'agent', id: agent.id })
        if (!result) throw new Error('That task no longer exists.')
        taskId = result.task.id
        runId = result.run?.id ?? result.task.runIds[result.task.runIds.length - 1]
      } else {
        if (!title.trim()) throw new Error('Give the task a title.')
        const task = createTask({ title: title.trim(), projectId, priority, description: description.trim() || undefined, assignee: { type: 'agent', id: agent.id } })
        taskId = task.id
        runId = db.get('tasks', task.id)?.runIds.at(-1)
      }
      closeGiveWork()
      const task = db.get('tasks', taskId)
      const route = runId ? `/agents/${encodeURIComponent(agent.id)}?run=${encodeURIComponent(runId)}` : `/agents/${encodeURIComponent(agent.id)}`
      if (background || !runId) {
        toast({
          title: runId ? `${agent.name} started on “${task?.title ?? 'the task'}”` : `Assigned to ${agent.name}`,
          description: runId ? `${shortCode(runId)} · the task moves to Review when the run finishes` : undefined,
          action: { label: 'Open', onClick: () => navigate(route) },
        })
      } else navigate(route)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !(e.target instanceof HTMLTextAreaElement && !(e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      submit(e.metaKey || e.ctrlKey)
    }
  }

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <SegmentedControl
        size="sm"
        aria-label="Task"
        value={tab}
        onValueChange={(v) => setTab(v as 'pick' | 'new')}
        options={[
          { value: 'pick', label: 'Pick a task' },
          { value: 'new', label: 'New task' },
        ]}
        className="self-start"
      />
      {tab === 'pick' ? (
        <div className="flex flex-col gap-2">
          <SearchField size="sm" value={query} onValueChange={setQuery} placeholder={scope ? 'Search open tasks in this project' : 'Search open tasks'} aria-label="Search open tasks" autoFocus />
          {tasks.length === 0 ? (
            <p className="type-body-sm rounded-sm border border-line px-3 py-4 text-center text-ink-3">
              {query ? `No open tasks match “${query}”.` : 'No open tasks here.'}{' '}
              <button type="button" className="text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink" onClick={() => setTab('new')}>
                Create one
              </button>
            </p>
          ) : (
            <div role="radiogroup" aria-label="Open tasks" className="flex max-h-[min(320px,40vh)] flex-col gap-px overflow-y-auto rounded-sm border border-line p-1">
              {tasks.map((t) => {
                const project = t.projectId ? projects[t.projectId]?.split('\u0000') : undefined
                const assignee = t.assignee?.type === 'agent' ? db.get('agents', t.assignee.id)?.name : t.assignee ? 'you' : undefined
                const checked = picked === t.id
                return (
                  <label
                    key={t.id}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2.5 py-1.5 transition-colors duration-(--dur-1)',
                      'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-2 has-[input:focus-visible]:outline-(--focus-ring)',
                      checked ? 'bg-accent-tint' : 'hover:bg-hover',
                    )}
                  >
                    <input type="radio" name="give-work-task" value={t.id} checked={checked} onChange={() => setPicked(t.id)} className="sr-only" />
                    <TaskGlyph status={t.status} decorative />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn('type-body-sm truncate', checked ? 'font-medium text-ink' : 'text-ink-2')}>{t.title}</span>
                      <span className="type-caption flex min-w-0 items-center gap-1.5 truncate text-ink-3">
                        {project && <span aria-hidden className={cn('size-2 shrink-0 rounded-[2px]', HUE_FILL[project[1] as keyof typeof HUE_FILL])} />}
                        <span className="truncate">
                          {[project?.[0] ?? 'No project', TASK_STATUS_LABEL[t.status], PRIORITY_LABEL[t.priority], assignee ? `assigned to ${assignee}` : undefined].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </span>
                    {checked && <span className="type-meta shrink-0 text-ink-2">Selected</span>}
                  </label>
                )
              })}
            </div>
          )}
          {pickedTask?.assignee && !(pickedTask.assignee.type === 'agent' && pickedTask.assignee.id === agent.id) && (
            <p className="type-caption text-ink-3">This task is assigned to someone else; assigning it moves it to {agent.name}.</p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" required className="sm:col-span-2">
            <Input value={title} onValueChange={setTitle} placeholder={`What should ${agent.name} take on?`} autoFocus />
          </Field>
          <Field label="Project">
            <ProjectPicker value={projectId} onChange={setProjectId} allowNone />
          </Field>
          <Field label="Priority">
            <Select<Priority>
              value={priority}
              onValueChange={setPriority}
              options={(['urgent', 'high', 'medium', 'low', 'none'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
            />
          </Field>
          <Field label="Description" optional className="sm:col-span-2">
            <Textarea value={description} onValueChange={setDescription} autosize minRows={2} maxRows={6} placeholder="What “done” looks like" />
          </Field>
        </div>
      )}
      <ReadBackLine data={readBack} />
      {error && (
        <p role="alert" className="type-caption text-fail-ink">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <span className="type-caption mr-auto hidden items-center gap-1.5 text-ink-3 sm:flex pointer-coarse:hidden">
          <KbdCombo combo="enter" variant="plain" /> assign and open · <KbdCombo combo="mod+enter" variant="plain" /> in the background
        </span>
        <Button variant="ghost" onClick={closeGiveWork}>
          Cancel
        </Button>
        <Button variant="secondary" disabled={disabled || busy || !ready} onClick={() => submit(true)}>
          Assign in background
        </Button>
        <Button variant="primary" loading={busy} disabled={disabled || !ready} onClick={() => submit(false)}>
          Assign
        </Button>
      </div>
    </div>
  )
}
