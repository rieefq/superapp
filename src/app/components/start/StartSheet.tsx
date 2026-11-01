import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown, Plus, X } from 'lucide-react'
import type { StartKind } from '@/app/shell/store'
import { suggestTitle } from '@/core/ai'
import { pickAgentForInstruction } from '@/core/assist/agents'
import { investigationTitle } from '@/core/sim/research'
import { pickRepoForScope } from '@/core/assist/repos'
import { useContextStore } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { CODE_AGENT_ID, describeSource, KIND_META, resolveEntity, useEntity } from '@/core/services'
import { getSettings } from '@/core/settings'
import type { Autonomy, EntityRef, ID, Priority, ResearchDepth } from '@/core/types'
import { shortCode } from '@/lib/id'
import { cn } from '@/lib/cn'
import {
  Button,
  Dialog,
  Field,
  Input,
  Menu,
  SegmentedControl,
  Select,
  Sheet,
  SimBadge,
  Textarea,
  Tooltip,
  toast,
  useBreakpointUp,
} from '@/ui'
import { ContextLine } from '../context/ContextLine'
import { useComposerContext, type ComposerContext } from '../context/useComposerContext'
import { AgentPicker, CollectionPicker, EntityPicker, ProjectPicker, RepoPicker, WorkflowPicker } from '../pickers/pickers'
import { Picker, PickerTrigger, type PickerOption } from '../pickers/Picker'
import { ReadBack, useReadBack, type ReadBackData } from '../readback/ReadBack'
import { formatCost, type ReadBackKind } from '../readback/plan'
import { AUTONOMY_OPTIONS, START_KIND_META, START_KINDS, STUDIO_KINDS, type StudioKind } from './kinds'
import { capRun, startEvents, startWork, validateStart, type StartForm, type StartResult } from './submit'

export interface StartSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: StartKind
  /** The entity this work comes from (Turn into…): attached as context; the result links back to it. */
  source?: EntityRef
  /** Prefilled fields: title, brief (or question/instruction/prompt), projectId, agentId, repoId, workflowId,
   * taskId, depth, angles, priority, assignee, collectionId, tags, studioKind, boardId, autonomy. */
  prefill?: Record<string, unknown>
  /** Opened with ⌘⏎: the primary action starts in the background. */
  background?: boolean
  /** Called after the work is started or created. */
  onStarted?: (result: StartResult, opts: { background: boolean }) => void
}

/**
 * The Start sheet (§5.4.11, §3.10): the one surface for starting delegated work and every Turn into.
 * A 480px right sheet (full screen on phones).
 */
export function StartSheet({ open, onOpenChange, ...rest }: StartSheetProps) {
  const wide = useBreakpointUp('md')
  // Each opening starts from fresh fields.
  const [session, setSession] = useState(0)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) setSession((n) => n + 1)
    wasOpen.current = open
  }, [open])
  const source = useEntity(rest.source ?? { kind: 'project', id: '' })
  const sourceLabel = rest.source && source.exists ? source.title : null
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      side="right"
      size="md"
      aria-label={sourceLabel ? `Turn into from ${sourceLabel}` : 'Start'}
      className={cn(!wide && 'inset-0! w-full! rounded-none! border-0!')}
      bodyClassName="px-0 py-0"
      header={<span className="sr-only">Start</span>}
      hideClose
    >
      {open && session > 0 && <StartPanel key={session} {...rest} onClose={() => onOpenChange(false)} variant="sheet" />}
    </Sheet>
  )
}

export interface StartPanelProps extends Omit<StartSheetProps, 'open' | 'onOpenChange'> {
  /** 'inline' renders inside a stage (new Code session, new investigation brief) without the kind picker. */
  variant?: 'sheet' | 'inline'
  onClose?: () => void
  className?: string
}

// ------------------------------------------------------------------------------------------------ form

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const clipText = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

function initialForm(kind: StartKind, source: EntityRef | undefined, prefill: Record<string, unknown> | undefined): StartForm {
  const p = prefill ?? {}
  const s = useDB.getState()
  const scope = useContextStore.getState().scopeProjectId
  let described: { title: string; text: string } | null = null
  if (source) {
    try {
      described = describeSource(source)
    } catch {
      described = null
    }
  }
  const sourceProject = source ? (source.kind === 'project' ? source.id : (resolveEntity(source).projectId ?? null)) : null
  const projectId = 'projectId' in p ? ((p.projectId as ID | null) ?? null) : (sourceProject ?? scope)
  const brief = str(p.brief) ?? str(p.question) ?? str(p.instruction) ?? str(p.prompt) ?? (described ? clipText(described.text, 1500) : '')
  const forge = s.agents[CODE_AGENT_ID]
  const project = projectId ? s.projects[projectId] : undefined
  return {
    kind,
    title: str(p.title) ?? described?.title ?? '',
    brief,
    projectId,
    depth: (str(p.depth) as ResearchDepth | undefined) ?? 'standard',
    angles: Array.isArray(p.angles) ? (p.angles as unknown[]).filter((a): a is string => typeof a === 'string') : [],
    repoId: str(p.repoId) ?? pickRepoForScope(project ?? projectId, Object.values(s.repos)),
    linkedTaskId: str(p.taskId) ?? (source?.kind === 'task' ? source.id : null),
    autonomy: (str(p.autonomy) as Autonomy | undefined) ?? forge?.autonomy ?? getSettings().safety.defaultAutonomy,
    agentId: str(p.agentId) ?? (kind === 'session' ? (forge?.status === 'active' ? CODE_AGENT_ID : null) : (pickAgentForInstruction(brief, Object.values(s.agents))?.agentId ?? null)),
    workflowId: str(p.workflowId) ?? (source?.kind === 'workflow' ? source.id : null),
    assignee: (str(p.assignee) as StartForm['assignee'] | undefined) ?? 'me',
    priority: (str(p.priority) as Priority | undefined) ?? 'none',
    due: str(p.due) ?? '',
    milestoneId: str(p.milestoneId) ?? null,
    collectionId: str(p.collectionId) ?? null,
    tags: Array.isArray(p.tags) ? (p.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
    studioKind: (str(p.studioKind) as StudioKind | undefined) ?? 'document',
    boardId: str(p.boardId) ?? null,
    capUsd: null,
  }
}

/** The title the work will get when the title field is empty (as the services derive it). */
function readBackTitle(form: StartForm): string | undefined {
  if (form.kind === 'workflow') return form.workflowId ? useDB.getState().workflows[form.workflowId]?.name : undefined
  if (form.kind === 'agent') return form.brief.trim() ? clipText(form.brief.trim().split('\n')[0] ?? '', 60) : undefined
  const brief = form.brief.trim()
  if (!brief) return undefined
  if (form.kind === 'research') return investigationTitle(brief)
  return suggestTitle(brief) ?? clipText(brief.split('\n')[0] ?? '', 60)
}

const READBACK_KIND: Record<StartKind, ReadBackKind> = {
  task: 'task',
  research: 'research',
  session: 'session',
  agent: 'agent',
  workflow: 'workflow',
  note: 'note',
  studio: 'studio',
}

/** Context summary for the ReadBack: "Project memory 3 · Held 2 · Message “…”". */
function contextSummary(ctx: ComposerContext, resolveTitle: (r: EntityRef) => string): ReadBackData['context'] {
  const parts: string[] = []
  const memory = ctx.entries.find((e) => e.group === 'project' && e.on)
  if (memory && ctx.project) parts.push(`Project memory ${ctx.project.pinnedRefs.length}`)
  const held = ctx.refs.held.length
  if (held) parts.push(`Held ${held}`)
  const attached = ctx.refs.attached
  if (attached.length) {
    const first = attached[0]
    parts.push(`${KIND_META[first.kind].label} “${clipText(resolveTitle(first), 36)}”${attached.length > 1 ? ` +${attached.length - 1}` : ''}`)
  }
  if (ctx.refs.likely.length) parts.push(`Likely ${ctx.refs.likely.length}`)
  return { parts, tokens: ctx.tokens }
}

/** The Start form (sheet or inline). */
export function StartPanel({ kind: initialKind, source, prefill, background = false, onStarted, onClose, variant = 'sheet', className }: StartPanelProps) {
  const navigate = useNavigate()
  const [form, setForm] = useState<StartForm>(() => initialForm(initialKind, source, prefill))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [budgetPrompt, setBudgetPrompt] = useState<null | { background: boolean; run: boolean }>(null)
  const meta = START_KIND_META[form.kind]
  const set = <K extends keyof StartForm>(key: K, value: StartForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setError(null)
  }
  const sourceEntity = useEntity(source ?? { kind: 'project', id: '' })
  const formId = useId()

  // Kind-specific defaults when switching kinds.
  const changeKind = (k: StartKind) => {
    setForm((f) => {
      const next = { ...f, kind: k }
      if (k === 'agent' && (!f.agentId || f.agentId === CODE_AGENT_ID)) {
        next.agentId = pickAgentForInstruction(f.brief, Object.values(useDB.getState().agents))?.agentId ?? null
      }
      if (k === 'session') {
        const forge = useDB.getState().agents[CODE_AGENT_ID]
        next.agentId = forge?.status === 'active' ? CODE_AGENT_ID : f.agentId
      }
      return next
    })
    setError(null)
  }

  // Workflow runs take the workflow's own project.
  const workflow = useDB((s: Tables) => (form.workflowId ? s.workflows[form.workflowId] : undefined))
  const effectiveProject = form.kind === 'workflow' ? (workflow?.projectId ?? null) : form.projectId

  // Context Line: the source (and anything attached where the work was started) rides along as Attached;
  // the brief feeds Likely retrieval.
  const initialAttached = useMemo(() => {
    const extra = Array.isArray(prefill?.attached) ? (prefill.attached as EntityRef[]).filter((r) => r && typeof r.kind === 'string' && typeof r.id === 'string') : []
    return [...(source ? [source] : []), ...extra]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const ctx = useComposerContext({ projectId: effectiveProject, initialAttached })
  useEffect(() => {
    if (form.kind === 'research' || form.kind === 'agent' || form.kind === 'session' || form.kind === 'studio') ctx.setDraft(form.brief)
    else ctx.setDraft('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.brief, form.kind])

  const runs = meta.runs || (form.kind === 'task' && form.assignee !== 'me')
  const actingAgent = form.kind === 'research' ? 'agt_scout' : form.kind === 'task' ? (form.assignee !== 'me' ? form.assignee : null) : form.agentId
  const readBack = useReadBack({
    kind: READBACK_KIND[form.kind],
    title: form.title.trim() || readBackTitle(form) || undefined,
    projectId: effectiveProject,
    agentId: actingAgent,
    autonomy: form.kind === 'session' ? form.autonomy : undefined,
    repoId: form.repoId,
    workflowId: form.workflowId,
    studioKind: form.studioKind,
    context: contextSummary(ctx, (r) => resolveEntity(r).title),
    capUsd: form.capUsd,
  })

  const primaryLabel = runs ? (background ? 'Start in background' : 'Start') : 'Create'
  const canCreateWithoutRunning = form.kind === 'research' || (form.kind === 'task' && form.assignee !== 'me')

  const finish = (result: StartResult, bg: boolean) => {
    if (result.runId && form.capUsd) capRun(result.runId, form.capUsd)
    onStarted?.(result, { background: bg })
    startEvents.emit('started', { ...result, background: bg })
    onClose?.()
    if (bg) {
      const handle = result.runId ? shortCode(result.runId) : shortCode(result.ref.id)
      toast({
        tone: 'neutral',
        title: result.runId ? `Started in background · ${handle}` : `Created · ${handle}`,
        action: { label: 'Open', onClick: () => navigate(result.route) },
      })
    } else {
      navigate(result.route)
    }
  }

  const doStart = (bg: boolean, run: boolean) => {
    const problem = validateStart(form, { run })
    if (problem) {
      setError(problem)
      return
    }
    setSubmitting(true)
    try {
      const result = startWork({ ...form, projectId: effectiveProject }, source, { run })
      finish(result, bg || !run ? bg : false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const submit = (bg: boolean, run = true) => {
    const startsRun = run && runs
    const budget = readBack.budget
    if (startsRun && budget && budget.ratio !== null && budget.ratio >= 1) {
      setBudgetPrompt({ background: bg, run })
      return
    }
    doStart(bg, run)
  }

  const onFormKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit(runs ? true : background)
    }
  }
  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit(background)
  }

  const heading = source ? (
    <>
      {meta.noun} <span className="font-normal text-ink-3">from</span> <span className="font-normal">“{clipText(sourceEntity.title, 48)}”</span>
    </>
  ) : (
    `New ${meta.noun.toLowerCase()}`
  )

  return (
    <form
      id={formId}
      onSubmit={onFormSubmit}
      onKeyDown={onFormKeyDown}
      aria-label={source ? 'Turn into' : 'Start'}
      className={cn('flex h-full min-h-0 flex-col', className)}
    >
      {variant === 'sheet' && (
        <header className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="type-label text-ink-3">{source ? 'Turn into' : 'Start'}</span>
            <h2 className="type-title-2 text-ink text-balance">{heading}</h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mt-1 -mr-1.5 grid size-8 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
          >
            <X aria-hidden className="size-4" strokeWidth={1.75} />
          </button>
        </header>
      )}

      <div className={cn('flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 pb-5', variant === 'inline' && 'px-0')}>
        {variant === 'sheet' && <KindPicker value={form.kind} onChange={changeKind} />}

        <div className="flex flex-col gap-4">
          {meta.title && (
            <Field label="Title">
              <Input value={form.title} onValueChange={(v) => set('title', v)} placeholder={meta.titlePlaceholder ?? 'Short and specific'} />
            </Field>
          )}
          {form.kind !== 'workflow' && (
            <Field label={meta.briefLabel}>
              <Textarea
                value={form.brief}
                onValueChange={(v) => set('brief', v)}
                placeholder={meta.briefPlaceholder}
                autosize
                minRows={form.kind === 'task' ? 2 : 3}
                maxRows={10}
                data-autofocus={!meta.title || form.kind === 'research' ? '' : undefined}
                className="type-body"
              />
            </Field>
          )}
          {form.kind === 'workflow' && (
            <Field label="Workflow">
              <WorkflowPicker value={form.workflowId} onChange={(id) => set('workflowId', id)} />
            </Field>
          )}
          {form.kind !== 'workflow' ? (
            <Field label="Project">
              <ProjectPicker value={form.projectId} onChange={(id) => set('projectId', id)} />
            </Field>
          ) : (
            workflow && (
              <p className="type-caption text-ink-3">
                Runs in {workflow.projectId ? (useDB.getState().projects[workflow.projectId]?.name ?? 'its project') : 'no project'}, the workflow’s own project.
              </p>
            )
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Context</span>
            {ctx.entries.length ? (
              <div className="rounded-sm border border-line px-2 py-1">
                <ContextLine context={ctx} wrap />
              </div>
            ) : (
              <p className="type-caption text-ink-3">Nothing rides along. Hold items or pick a project to add context.</p>
            )}
          </div>
        </div>

        <KindFields form={form} set={set} source={source} />

        {runs && (
          <RunSettings form={form} set={set} model={readBack.model} />
        )}

        {runs && (
          <section aria-labelledby={`${formId}-readback`} className="rounded-md border border-line bg-sunken px-3.5 py-3">
            <h3 id={`${formId}-readback`} className="sr-only">
              Read back
            </h3>
            <ReadBack data={readBack} />
          </section>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        {error && (
          <p role="alert" className="type-caption w-full text-fail-ink">
            {error}
          </p>
        )}
        {canCreateWithoutRunning && (
          <Button variant="ghost" size="md" disabled={submitting} onClick={() => submit(false, false)} className="-ml-2">
            Create without running
          </Button>
        )}
        <span className="flex-1" />
        {variant === 'inline' && onClose && (
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
        {runs ? (
          <span className="inline-flex items-stretch">
            <Button type="submit" variant="primary" loading={submitting} kbd={background ? 'mod+enter' : 'enter'} className="rounded-r-none">
              {primaryLabel}
            </Button>
            <Menu
              placement="top-end"
              aria-label="Start options"
              items={[
                { label: 'Start and open', shortcut: 'enter', onSelect: () => submit(false) },
                { label: 'Start in background', shortcut: 'mod+enter', onSelect: () => submit(true) },
              ]}
              trigger={
                <button
                  type="button"
                  aria-label="More start options"
                  className="relative inline-grid h-8 w-7 place-items-center rounded-r-sm border-l border-inverse-ink/15 bg-inverse text-inverse-ink transition-colors duration-(--dur-1) hover:bg-inverse/88 pointer-coarse:after:absolute pointer-coarse:after:-inset-2 pointer-coarse:after:content-['']"
                >
                  <ChevronDown aria-hidden className="size-3.5" strokeWidth={2} />
                </button>
              }
            />
          </span>
        ) : (
          <Button type="submit" variant="primary" loading={submitting} kbd="enter">
            Create
          </Button>
        )}
      </footer>

      <Dialog
        open={!!budgetPrompt}
        onOpenChange={(o) => !o && setBudgetPrompt(null)}
        role="alertdialog"
        size="sm"
        title={
          readBack.budget
            ? `Monthly budget reached (${formatCost(readBack.budget.spentUsd)} of ${formatCost(readBack.budget.monthlyUsd)}). Run anyway?`
            : 'Monthly budget reached. Run anyway?'
        }
        description={
          readBack.cost
            ? `This run adds about est. ${formatCost(readBack.cost.usd)}.${readBack.budget?.includesEstimates ? ' Simulated runs spend no money; their estimates count because “Count simulated estimates” is on in Settings › Budgets.' : ''}`
            : undefined
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setBudgetPrompt(null)
                onClose?.()
                navigate('/settings/budgets')
              }}
              className="mr-auto"
            >
              Open budgets
            </Button>
            <Button variant="secondary" data-autofocus onClick={() => setBudgetPrompt(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const p = budgetPrompt
                setBudgetPrompt(null)
                if (p) doStart(p.background, p.run)
              }}
            >
              Run anyway
            </Button>
          </>
        }
      />
    </form>
  )
}

// ------------------------------------------------------------------------------------------------ kind picker

function KindPicker({ value, onChange }: { value: StartKind; onChange: (k: StartKind) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const index = START_KINDS.indexOf(value)
  const move = (i: number) => {
    const n = START_KINDS.length
    const next = (i + n) % n
    onChange(START_KINDS[next])
    refs.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-0.5 rounded-sm border border-line bg-sunken p-[3px]">
      {START_KINDS.map((k, i) => {
        const m = START_KIND_META[k]
        const Icon = m.icon
        const selected = k === value
        return (
          <button
            key={k}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(k)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                move(index + 1)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                move(index - 1)
              }
            }}
            className={cn(
              'inline-flex h-8 flex-[1_0_auto] items-center justify-center gap-1.5 rounded-[4px] border px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-(--dur-1) ease-standard focus-visible:outline-offset-1',
              selected ? 'border-line-strong bg-raised text-ink shadow-inset' : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span>{m.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ kind fields

type Setter = <K extends keyof StartForm>(key: K, value: StartForm[K]) => void

function KindFields({ form, set, source }: { form: StartForm; set: Setter; source?: EntityRef }) {
  switch (form.kind) {
    case 'research':
      return <ResearchFields form={form} set={set} />
    case 'session':
      return <SessionFields form={form} set={set} source={source} />
    case 'agent':
      return (
        <Field label="Agent">
          <AgentPicker value={form.agentId} onChange={(id) => set('agentId', id)} />
        </Field>
      )
    case 'task':
      return <TaskFields form={form} set={set} />
    case 'note':
      return <NoteFields form={form} set={set} />
    case 'studio':
      return <StudioFields form={form} set={set} />
    default:
      return null
  }
}

function Group({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 border-t border-line pt-5">{children}</div>
}

function ResearchFields({ form, set }: { form: StartForm; set: Setter }) {
  const github = useDB((s: Tables) => s.connections.github?.status === 'connected')
  return (
    <Group>
      <Field label="Depth">
        <SegmentedControl<ResearchDepth>
          value={form.depth}
          onValueChange={(v) => set('depth', v)}
          options={[
            { value: 'quick', label: 'Quick' },
            { value: 'standard', label: 'Standard' },
            { value: 'deep', label: 'Deep' },
          ]}
        />
      </Field>
      <Field label="Angles" optional hint="Leave empty and Scout plans its own angles from the question.">
        <ChipsInput values={form.angles} onChange={(v) => set('angles', v)} placeholder="Add an angle and press ⏎" />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-2">Sources</span>
        <ul className="flex flex-wrap gap-1.5" aria-label="Sources this research reads">
          <SourceChip label="Knowledge" live />
          <SourceChip label="Uploads" live />
          {github && <SourceChip label="GitHub" live />}
          <SourceChip label="Web" />
        </ul>
        <p className="type-caption text-ink-3">Web results are simulated in this build.</p>
      </div>
    </Group>
  )
}

function SourceChip({ label, live }: { label: string; live?: boolean }) {
  return (
    <li
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-sm border pr-1 pl-2 text-xs font-medium text-ink-2',
        live ? 'border-line-strong' : 'sim-hatch border-dashed border-line-input',
      )}
    >
      {label}
      {live ? (
        <span className="type-meta-caps rounded-xs border border-line-input px-1 text-[10px] leading-[14px] text-ink-2">LIVE</span>
      ) : (
        <SimBadge size="xs" label="SIM" />
      )}
    </li>
  )
}

function SessionFields({ form, set, source }: { form: StartForm; set: Setter; source?: EntityRef }) {
  const repo = useDB((s: Tables) => (form.repoId ? s.repos[form.repoId] : undefined))
  const slug = (form.title.trim() || form.brief.trim() || 'change')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const linkedLocked = !!source
  const policy = AUTONOMY_OPTIONS.find((o) => o.value === form.autonomy)
  return (
    <Group>
      <Field label="Repository">
        <RepoPicker value={form.repoId} onChange={(id) => set('repoId', id)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Base branch">
          <Input value={repo?.defaultBranch ?? '—'} readOnly className="font-mono text-xs" aria-readonly />
        </Field>
        <Field label="Branch">
          <Tooltip content="Named automatically from the title when the session starts.">
            <Input value={`atrium/${slug || 'change'}`} readOnly className="font-mono text-xs" aria-readonly />
          </Tooltip>
        </Field>
      </div>
      {!linkedLocked && (
        <Field label="Linked task" optional>
          <EntityPicker
            kinds={['task']}
            value={form.linkedTaskId ? { kind: 'task', id: form.linkedTaskId } : null}
            onChange={(r) => set('linkedTaskId', r.id)}
            placeholder="No linked task"
          />
        </Field>
      )}
      <Field label="Agent">
        <AgentPicker value={form.agentId} onChange={(id) => set('agentId', id)} />
      </Field>
      <Field label="Approval policy" hint={policy?.effect}>
        <SegmentedControl<Autonomy> value={form.autonomy} onValueChange={(v) => set('autonomy', v)} options={AUTONOMY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} fullWidth />
      </Field>
    </Group>
  )
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'none', label: 'No priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

function AssigneePicker({ value, onChange }: { value: StartForm['assignee']; onChange: (v: StartForm['assignee']) => void }) {
  const agents = useDB(useShallow((s: Tables) => Object.values(s.agents).filter((a) => a.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name))))
  const name = getSettings().profile.name
  const options = useMemo<PickerOption[]>(
    () => [
      { value: 'me', label: `${name} (you)`, group: 'People' },
      ...agents.map((a) => ({
        value: a.id,
        label: a.name,
        description: a.status === 'paused' ? 'Paused — resume it in Agents to give it work' : a.role,
        group: 'Agents',
        disabled: a.status === 'paused',
        keywords: a.role,
      })),
    ],
    [agents, name],
  )
  const current = value === 'me' ? `${name} (you)` : agents.find((a) => a.id === value)?.name
  return (
    <Picker
      label="Assignees"
      placeholder="Assign to…"
      options={options}
      value={value}
      onSelect={onChange}
      trigger={(p) => (
        <PickerTrigger {...p}>{current ?? 'Choose'}</PickerTrigger>
      )}
    />
  )
}

function TaskFields({ form, set }: { form: StartForm; set: Setter }) {
  const milestones = useDB(useShallow((s: Tables) => (form.projectId ? (s.projects[form.projectId]?.milestones ?? []) : [])))
  return (
    <Group>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Assignee" hint={form.assignee !== 'me' ? 'The agent starts on it right away.' : undefined}>
          <AssigneePicker value={form.assignee} onChange={(v) => set('assignee', v)} />
        </Field>
        <Field label="Priority">
          <Select<Priority> value={form.priority} onValueChange={(v) => set('priority', v)} options={PRIORITIES} />
        </Field>
        <Field label="Due" optional>
          <Input type="date" value={form.due} onValueChange={(v) => set('due', v)} />
        </Field>
        <Field label="Milestone" optional>
          <Select
            value={form.milestoneId ?? '__none__'}
            onValueChange={(v) => set('milestoneId', v === '__none__' ? null : v)}
            disabled={!milestones.length}
            options={[{ value: '__none__', label: milestones.length ? 'No milestone' : 'No milestones' }, ...milestones.map((m) => ({ value: m.id, label: m.title }))]}
          />
        </Field>
      </div>
    </Group>
  )
}

function NoteFields({ form, set }: { form: StartForm; set: Setter }) {
  return (
    <Group>
      <Field label="Collection" optional>
        <CollectionPicker value={form.collectionId} onChange={(id) => set('collectionId', id)} />
      </Field>
      <Field label="Tags" optional>
        <ChipsInput values={form.tags} onChange={(v) => set('tags', v)} placeholder="Add a tag and press ⏎" />
      </Field>
    </Group>
  )
}

function StudioFields({ form, set }: { form: StartForm; set: Setter }) {
  const boards = useDB(useShallow((s: Tables) => Object.values(s.boards).filter((b) => !form.projectId || b.projectId === form.projectId || !b.projectId)))
  return (
    <Group>
      <Field label="Kind">
        <SegmentedControl<StudioKind> value={form.studioKind} onValueChange={(v) => set('studioKind', v)} options={STUDIO_KINDS.map((k) => ({ value: k.value, label: k.label, icon: k.icon }))} fullWidth />
      </Field>
      {(form.studioKind === 'image' || form.studioKind === 'video') && (
        <p className="type-caption -mt-2 text-ink-3">Simulated preview — no {form.studioKind === 'image' ? 'image' : 'video'} model was called.</p>
      )}
      <Field label="Board" optional>
        <Select
          value={form.boardId ?? '__none__'}
          onValueChange={(v) => set('boardId', v === '__none__' ? null : v)}
          options={[{ value: '__none__', label: 'No board' }, ...boards.map((b) => ({ value: b.id, label: b.name }))]}
        />
      </Field>
    </Group>
  )
}

function RunSettings({ form, set, model }: { form: StartForm; set: Setter; model: ReadBackData['model'] }) {
  const [capText, setCapText] = useState(form.capUsd ? String(form.capUsd) : '')
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_148px] gap-3 border-t border-line pt-5">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-2">Model</span>
        <div className="flex h-(--control-h) min-w-0 items-center gap-2 rounded-sm border border-dashed border-line-input px-2.5">
          {model?.simulated && <SimBadge size="xs" label="SIM" />}
          <span className="truncate text-sm text-ink">{model?.label ?? 'Simulator'}</span>
        </div>
        <p className="type-caption text-ink-3">Delegated runs use the local simulator in this build — no model is called.</p>
      </div>
      <Field label="Budget cap" optional hint="Stops the run at this est. cost.">
        <Input
          inputMode="decimal"
          prefix="$"
          value={capText}
          placeholder="0.50"
          onValueChange={(v) => {
            const clean = v.replace(/[^0-9.]/g, '')
            setCapText(clean)
            const n = Number(clean)
            set('capUsd', clean && Number.isFinite(n) && n > 0 ? n : null)
          }}
          aria-label="Budget cap for this run in dollars"
        />
      </Field>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ chips input

function ChipsInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v || values.includes(v)) return
    onChange([...values, v])
    setDraft('')
  }
  return (
    <div className="flex min-h-(--control-h) flex-wrap items-center gap-1.5 rounded-sm border border-line-input bg-sunken px-1.5 py-1 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--focus-ring)">
      {values.map((v) => (
        <span key={v} className="inline-flex h-[22px] items-center gap-1 rounded-sm border border-line-strong bg-raised pr-0.5 pl-2 text-xs font-medium text-ink-2">
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="grid size-4 place-items-center rounded-xs text-ink-3 hover:bg-press hover:text-ink"
          >
            <X aria-hidden className="size-3" strokeWidth={2} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && !draft && values.length) {
            onChange(values.slice(0, -1))
          }
        }}
        onBlur={add}
        placeholder={values.length ? '' : placeholder}
        aria-label={placeholder}
        className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-ink-3 pointer-coarse:text-[16px]"
      />
      {draft.trim() && (
        <button type="button" onClick={add} aria-label="Add" className="grid size-6 place-items-center rounded-xs text-ink-3 hover:bg-hover hover:text-ink">
          <Plus aria-hidden className="size-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

