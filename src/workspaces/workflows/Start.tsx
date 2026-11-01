import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, Plus } from 'lucide-react'
import { ProjectPicker } from '@/app/components'
import { draftWorkflowFromText } from '@/core/assist'
import { useScope } from '@/core/context'
import { db } from '@/core/db'
import { createWorkflow } from '@/core/services/workflows'
import type { ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, Field, SimBadge, Textarea, toast } from '@/ui'
import { BLANK, getTemplate, TEMPLATES, type WorkflowTemplate } from './templates'

/**
 * Starting a workflow (docs/DESIGN.md §6.6): Describe it (a rule-based draft from your words — not
 * AI), one of the templates, or Blank. New workflows start off: you review them before they run on
 * their own.
 */

export interface DraftState {
  draftNotes?: string[]
  draftFrom?: string
}

function context() {
  return { agents: db.all('agents'), connections: db.all('connections'), runs: db.all('runs') }
}

export function useStartWorkflow() {
  const navigate = useNavigate()
  const open = (id: ID, state?: DraftState) => navigate(`/workflows/${encodeURIComponent(id)}`, state ? { state } : undefined)
  return {
    fromTemplate: (t: WorkflowTemplate, projectId: ID | null) => {
      const g = t.build(context())
      const wf = createWorkflow({ name: g.name, description: g.description, trigger: g.trigger, nodes: g.nodes, edges: g.edges, projectId, enabled: false })
      open(wf.id)
    },
    blank: (projectId: ID | null) => {
      const wf = createWorkflow({ name: 'Untitled workflow', projectId, enabled: false })
      open(wf.id)
    },
    describe: (text: string, projectId: ID | null) => {
      const draft = draftWorkflowFromText(text, context())
      const wf = createWorkflow({ name: draft.name, description: draft.description, trigger: draft.trigger, nodes: draft.nodes, edges: draft.edges, projectId, enabled: false })
      open(wf.id, { draftNotes: draft.notes, draftFrom: text.trim() })
    },
  }
}

const EXAMPLE = 'Every Monday at 9am, summarize last week’s project activity and ask me before posting it to #product.'

export function DescribeIt({ projectId, autoFocus, compact, initial }: { projectId: ID | null; autoFocus?: boolean; compact?: boolean; initial?: string }) {
  const [text, setText] = useState(initial ?? '')
  const start = useStartWorkflow()
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const value = text.trim()
    if (value.split(/\s+/).length < 3) {
      toast('Describe it in a few more words', { description: 'Say when it should start and what each step does.' })
      return
    }
    try {
      start.describe(value, projectId)
    } catch (error) {
      toast.error('Couldn’t draft a workflow from that', { description: error instanceof Error ? error.message : String(error) })
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label="Describe a workflow">
      <Field label="Describe it" hideLabel={compact} hint="Drafted by rules from your words — a template-based draft, not AI. You review every step before it runs.">
        <Textarea
          value={text}
          onValueChange={setText}
          placeholder={EXAMPLE}
          autosize
          minRows={compact ? 2 : 3}
          maxRows={8}
          autoFocus={autoFocus}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" trailingIcon={ArrowRight} kbd="mod+enter" disabled={!text.trim()}>
          Draft workflow
        </Button>
        {!text && (
          <button type="button" onClick={() => setText(EXAMPLE)} className="type-caption rounded-xs px-1 text-ink-3 underline decoration-line-input underline-offset-2 hover:text-ink">
            Use the example
          </button>
        )}
      </div>
    </form>
  )
}

export function TemplateCards({ projectId, className }: { projectId: ID | null; className?: string }) {
  const start = useStartWorkflow()
  return (
    <ul className={cn('grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]', className)} aria-label="Templates">
      {TEMPLATES.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => start.fromTemplate(t, projectId)}
            className="group flex h-full w-full flex-col gap-2 rounded-md border border-line bg-raised p-3 text-left transition-colors duration-(--dur-1) hover:border-line-strong hover:bg-hover"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-sm border border-line-strong bg-canvas">
                <t.icon className="size-3.5 text-ink-2" strokeWidth={1.75} />
              </span>
              <span className="type-body-sm min-w-0 flex-1 font-semibold text-ink">{t.name}</span>
              {t.simulated && <SimBadge size="xs" explanation="Uses simulated services: nothing leaves your browser." />}
            </span>
            <span className="type-caption text-pretty text-ink-2">{t.blurb}</span>
            <span className="type-meta mt-auto flex flex-wrap items-center gap-x-1 text-ink-3">
              {t.path.map((p, i) => (
                <span key={p} className="inline-flex items-center gap-1">
                  {i > 0 && <span aria-hidden>→</span>}
                  {p}
                </span>
              ))}
            </span>
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={() => start.blank(projectId)}
          className="flex h-full w-full flex-col gap-2 rounded-md border border-line p-3 text-left transition-colors duration-(--dur-1) hover:border-line-strong hover:bg-hover"
        >
          <span className="flex items-center gap-2">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-sm border border-line-strong">
              <Plus className="size-3.5 text-ink-2" strokeWidth={1.75} />
            </span>
            <span className="type-body-sm font-semibold text-ink">{BLANK.name}</span>
          </span>
          <span className="type-caption text-pretty text-ink-2">{BLANK.blurb}</span>
        </button>
      </li>
    </ul>
  )
}

/** /workflows/new: project, Describe it, templates and Blank. */
export function NewWorkflowStage({ describe, template }: { describe?: string; template?: string }) {
  const scope = useScope()
  const [projectId, setProjectId] = useState<ID | null>(scope)
  const start = useStartWorkflow()
  const created = useRef(false)
  // /workflows/new?template=… (⌘K) creates the workflow from that template right away.
  useEffect(() => {
    const t = getTemplate(template)
    if (!t || created.current) return
    created.current = true
    start.fromTemplate(t, scope)
  }, [template, scope, start])
  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8 px-4 py-6 md:px-6 md:py-8">
        <div className="flex flex-col gap-1.5">
          <p className="type-body text-ink-2">Automations that connect agents, your tools and Atrium’s own events. New workflows start off — turn one on after you’ve checked it.</p>
        </div>
        <Field label="Project" hint="Runs file into this project and use its memory.">
          <ProjectPicker value={projectId} onChange={setProjectId} />
        </Field>
        <section aria-labelledby="wf-describe" className="flex flex-col gap-2">
          <h2 id="wf-describe" className="type-label text-ink-3">
            Describe it
          </h2>
          <DescribeIt key={describe ?? ''} projectId={projectId} initial={describe} autoFocus compact />
        </section>
        <section aria-labelledby="wf-templates" className="flex flex-col gap-3">
          <h2 id="wf-templates" className="type-label text-ink-3">
            Start from a template
          </h2>
          <TemplateCards projectId={projectId} />
        </section>
      </div>
    </div>
  )
}
