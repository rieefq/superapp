import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useNavigate } from 'react-router'
import { Check, Plus, RotateCcw, X } from 'lucide-react'
import { Composer, ProjectPicker, ReadBackLine, useComposerContext, useReadBack, type ComposerContext, type ComposerSubmitMeta } from '@/app/components'
import { estimateReferenceCost } from '@/core/ai'
import { useScope } from '@/core/context'
import { db, useRow } from '@/core/db'
import { KIND_META, RESEARCH_AGENT_ID, createInvestigation, resolveEntity, startInvestigation, updateInvestigation } from '@/core/services'
import { DEPTH_DESCRIPTION, deriveAngles, depthExpectation, investigationTitle } from '@/core/sim/research'
import type { EntityRef, ID, Investigation, ResearchDepth } from '@/core/types'
import { cn } from '@/lib/cn'
import { shortCode } from '@/lib/id'
import { Button, IconButton, KbdCombo, LiveBadge, SegmentedControl, SimBadge, Tooltip, formatCost, toast, useDebounced } from '@/ui'
import { useSimSpeed } from './hooks'
import { formatDurationRange, formatRange, midTokens } from './logic'

/**
 * The research brief (§6.5 New brief): the question (20px) in a navigating Composer whose Context Line
 * shows exactly what rides along, then depth with its expectations, editable angles, sources and
 * project, a ReadBack line, **Start research ⏎** (⌘⏎ in the background) and **Save draft**.
 * Used for new investigations and for drafts.
 */

export interface NewBriefProps {
  /** Edit and start an existing draft. */
  draft?: Investigation
  /** Prefill for the question (`/research/new?q=`). */
  initialQuestion?: string
  autoFocus?: boolean
  /** Examples under the composer while the question is empty. */
  examples?: readonly string[]
  /** Where files dropped on the stage attach. */
  dropTarget?: RefObject<HTMLElement | null>
}

type Sources = { knowledge: boolean; web: boolean }

const DEPTHS: { value: ResearchDepth; label: string }[] = [
  { value: 'quick', label: 'Quick' },
  { value: 'standard', label: 'Standard' },
  { value: 'deep', label: 'Deep' },
]

/** "Project memory 3 · Held 2 · Message “…”" for the ReadBack (same shape as the Start sheet's). */
function contextParts(ctx: ComposerContext): string[] {
  const parts: string[] = []
  if (ctx.project && ctx.refs.projectMemory) parts.push(`Project memory ${ctx.project.pinnedRefs.length}`)
  if (ctx.refs.held.length) parts.push(`Held ${ctx.refs.held.length}`)
  const attached = ctx.refs.attached
  if (attached.length) {
    const first = attached[0]
    const title = resolveEntity(first).title
    parts.push(`${KIND_META[first.kind].label} “${title.length > 36 ? `${title.slice(0, 35)}…` : title}”${attached.length > 1 ? ` +${attached.length - 1}` : ''}`)
  }
  if (ctx.refs.likely.length) parts.push(`Likely ${ctx.refs.likely.length}`)
  return parts
}

export function NewBrief({ draft, initialQuestion, autoFocus, examples, dropTarget }: NewBriefProps) {
  const navigate = useNavigate()
  const scope = useScope()
  const formId = useId()
  const [question, setQuestion] = useState(draft?.question ?? initialQuestion ?? '')
  const [depth, setDepth] = useState<ResearchDepth>(draft?.depth ?? 'standard')
  const [projectId, setProjectId] = useState<ID | null>(draft ? draft.projectId : scope)
  const [sources, setSources] = useState<Sources>({ knowledge: draft?.sources?.knowledge ?? true, web: draft?.sources?.web ?? true })
  const [sourceHint, setSourceHint] = useState(false)
  const [customAngles, setCustomAngles] = useState<string[] | null>(draft?.angles.length ? draft.angles : null)
  const [saving, setSaving] = useState(false)
  const project = useRow('projects', projectId)
  const speed = useSimSpeed()

  // A new brief follows the scope until the project is picked by hand.
  const pickedProject = useRef(!!draft)
  useEffect(() => {
    if (!pickedProject.current) setProjectId(scope)
  }, [scope])

  // Angles are suggested from the question until you edit them.
  const settled = useDebounced(question, 350)
  const suggested = useMemo(
    () => (settled.trim().length >= 8 ? deriveAngles(settled, depth === 'quick' ? 3 : 4, { projectName: project?.name }) : []),
    [settled, depth, project?.name],
  )
  const angles = customAngles ?? suggested

  const ctx = useComposerContext({ projectId, label: draft ? `Research · ${draft.title}` : 'Research · New investigation' })
  const expectation = depthExpectation(depth, { knowledge: sources.knowledge, web: sources.web, angles: angles.length || undefined, context: ctx.refs.all.length > 0 })
  const tokens = midTokens(expectation) + ctx.tokens
  const usd = estimateReferenceCost(Math.round(tokens * 0.7), Math.round(tokens * 0.3))
  const readBackBase = useReadBack({
    kind: 'research',
    title: question.trim() ? investigationTitle(question) : undefined,
    projectId,
    agentId: RESEARCH_AGENT_ID,
    context: { parts: contextParts(ctx), tokens: ctx.tokens },
  })
  // The ReadBack's cost follows the chosen depth (the same estimate as the depth line).
  const readBack = useMemo(() => ({ ...readBackBase, cost: { usd, tokens, simulated: true, basedOn: 0 } }), [readBackBase, usd, tokens])

  const toggleSource = (key: keyof Sources) => {
    const next = { ...sources, [key]: !sources[key] }
    if (!next.knowledge && !next.web) {
      setSourceHint(true)
      return
    }
    setSourceHint(false)
    setSources(next)
  }

  const resetForm = () => {
    setQuestion('')
    setCustomAngles(null)
    setSourceHint(false)
  }

  const finalAngles = () => angles.map((a) => a.trim()).filter(Boolean)

  const start = (text: string, meta: ComposerSubmitMeta) => {
    const q = text.trim()
    if (!q) throw new Error('Ask a question to start an investigation.')
    const context: EntityRef[] = meta.context.all
    const memory = meta.context.projectMemory
    let inv: Investigation
    if (draft) {
      updateInvestigation(draft.id, { question: q, title: draft.title === investigationTitle(draft.question) ? investigationTitle(q) : undefined, depth, angles: finalAngles(), projectId, sources })
      startInvestigation(draft.id, { context, memory })
      inv = draft
    } else {
      inv = createInvestigation({ question: q, depth, angles: finalAngles(), projectId, sources, context, memory, start: true })
    }
    const route = `/research/${inv.id}`
    if (meta.background) {
      const runIds = db.get('investigations', inv.id)?.runIds ?? []
      const latest = runIds[runIds.length - 1]
      resetForm()
      toast({ title: `Started in background · ${shortCode(latest ?? inv.id)}`, action: { label: 'Open', onClick: () => navigate(route) } })
    } else {
      navigate(route)
    }
  }

  const saveDraft = () => {
    const q = question.trim()
    if (!q) return
    setSaving(true)
    try {
      if (draft) {
        updateInvestigation(draft.id, { question: q, depth, angles: finalAngles(), projectId, sources })
        toast({ title: 'Draft saved' })
      } else {
        const inv = createInvestigation({ question: q, depth, angles: finalAngles(), projectId, sources, start: false })
        navigate(`/research/${inv.id}`)
        toast({ title: 'Draft saved', description: 'It waits under Drafts until you start it.' })
      }
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t save the draft', description: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  const settings = (
    <div className="mt-3 flex flex-col gap-3.5 border-t border-line pt-3.5" aria-label="Research settings" role="group">
      <BriefRow label="Depth" htmlFor={`${formId}-depth`}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <SegmentedControl<ResearchDepth> size="sm" value={depth} onValueChange={setDepth} options={DEPTHS} aria-label="Depth" className="self-start" />
          <p className="type-caption text-ink-3" id={`${formId}-depth`}>
            <span className="text-ink-2">{DEPTH_DESCRIPTION[depth]}</span>
            <span className="type-meta tabular">
              {' · '}
              {formatDurationRange(expectation.durationMs, speed)} · {formatRange(expectation.sources)} sources · {formatRange(expectation.findings)} findings ·{' '}
              <Tooltip content="Estimated at reference pricing; no money is spent.">
                <span tabIndex={0} className="rounded-xs outline-offset-1">
                  est. {formatCost(usd)}
                </span>
              </Tooltip>
            </span>
          </p>
        </div>
      </BriefRow>
      <BriefRow label="Angles">
        <AnglesEditor
          angles={angles}
          custom={customAngles !== null}
          hasQuestion={question.trim().length >= 8}
          onChange={setCustomAngles}
          onReset={() => setCustomAngles(null)}
        />
      </BriefRow>
      <BriefRow label="Sources">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sources this research reads">
            <SourceToggle label="Knowledge" on={sources.knowledge} onToggle={() => toggleSource('knowledge')} hint="Your knowledge base and uploads, searched locally" />
            <SourceToggle label="Web" simulated on={sources.web} onToggle={() => toggleSource('web')} hint="Simulated results from fictional publications" />
          </div>
          <p className={cn('type-caption', sourceHint ? 'text-fail-ink' : 'text-ink-3')} role={sourceHint ? 'alert' : undefined}>
            {sourceHint ? 'Keep at least one source on.' : 'Web results are simulated in this build.'}
          </p>
        </div>
      </BriefRow>
      <BriefRow label="Project">
        <ProjectPicker
          value={projectId}
          variant="chip"
          aria-label="Project"
          onChange={(id) => {
            pickedProject.current = true
            setProjectId(id)
          }}
          className="-ml-2"
        />
      </BriefRow>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <Composer
        context={ctx}
        value={question}
        onValueChange={setQuestion}
        placeholder="What do you want to find out?"
        aria-label="Research question"
        size="hero"
        backgroundable
        submitLabel="Start research"
        showModel={false}
        autoFocus={autoFocus}
        dropTarget={dropTarget}
        below={settings}
        readBack={<ReadBackLine data={readBack} />}
        onSubmit={start}
        className="[&_textarea]:text-xl [&_textarea]:leading-7 [&_textarea]:tracking-[-0.005em]"
      />
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <p className="type-caption hidden min-w-0 flex-1 items-center gap-1.5 text-ink-3 sm:flex pointer-coarse:hidden">
          <KbdCombo combo="enter" variant="plain" /> starts it here
          <span aria-hidden>·</span>
          <KbdCombo combo="mod+enter" variant="plain" /> in the background
        </p>
        <Button size="sm" variant="ghost" onClick={saveDraft} disabled={!question.trim()} loading={saving} className="ml-auto">
          Save draft
        </Button>
      </div>
      {!question.trim() && !draft && examples && examples.length > 0 && (
        <div className="flex flex-col gap-2 pt-1">
          <span className="type-label text-ink-3">Try</span>
          <ul className="flex flex-col gap-1">
            {examples.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => {
                    setQuestion(q)
                    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#main [data-composer-input]')?.focus())
                  }}
                  className="type-body-sm group/ex -mx-2 flex w-[calc(100%+16px)] min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
                >
                  <span aria-hidden className="text-ink-4 group-hover/ex:text-ink-3">↳</span>
                  <span className="min-w-0 flex-1 text-pretty">{q}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ parts

function BriefRow({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-[64px_minmax(0,1fr)]">
      <span className="type-label pt-0 text-ink-3 sm:pt-[7px]" aria-describedby={htmlFor}>
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function SourceToggle({ label, on, onToggle, simulated, hint }: { label: string; on: boolean; onToggle: () => void; simulated?: boolean; hint: string }) {
  return (
    <Tooltip content={hint}>
      <button
        type="button"
        aria-pressed={on}
        onClick={onToggle}
        className={cn(
          'relative inline-flex h-7 items-center gap-1.5 rounded-sm border pr-1.5 pl-2 text-xs font-medium transition-colors duration-(--dur-1)',
          simulated ? 'border-dashed border-line-input' : 'border-line-strong',
          simulated && on && 'sim-hatch',
          on ? 'text-ink' : 'text-ink-3 line-through decoration-ink-4',
          !simulated && on && 'bg-raised',
          'hover:text-ink',
          "pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']",
        )}
      >
        <span aria-hidden className={cn('grid size-3.5 place-items-center rounded-[3px] border', on ? 'border-ink bg-ink text-inverse-ink' : 'border-line-input')}>
          {on && <Check className="size-2.5" strokeWidth={3} />}
        </span>
        {label}
        {simulated ? <SimBadge noTooltip /> : <LiveBadge noTooltip />}
      </button>
    </Tooltip>
  )
}

/** Editable angles: suggested from the question until you change them; ⏎ adds the next one. */
function AnglesEditor({ angles, custom, hasQuestion, onChange, onReset }: {
  angles: string[]
  custom: boolean
  hasQuestion: boolean
  onChange: (angles: string[]) => void
  onReset: () => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const focusAt = (i: number) => requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLInputElement>('input')[i]?.focus())
  const edit = (i: number, value: string) => onChange(angles.map((a, j) => (j === i ? value : a)))
  const remove = (i: number) => {
    onChange(angles.filter((_, j) => j !== i))
    focusAt(Math.max(0, i - 1))
  }
  const add = (at = angles.length) => {
    if (angles.length >= 8) return
    onChange([...angles.slice(0, at), '', ...angles.slice(at)])
    focusAt(at)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      add(i + 1)
    } else if (e.key === 'Backspace' && !angles[i] && angles.length > 0) {
      e.preventDefault()
      remove(i)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {angles.length > 0 ? (
        <ol ref={listRef} className="flex flex-col" aria-label="Angles">
          {angles.map((a, i) => (
            <li key={i} className="group/angle flex min-h-8 min-w-0 items-center gap-2">
              <span aria-hidden className="type-meta w-4 shrink-0 text-right text-ink-3 tabular">
                {i + 1}
              </span>
              <input
                value={a}
                onChange={(e) => edit(i, e.target.value)}
                onKeyDown={(e) => onKey(e, i)}
                placeholder="Describe an angle to look into"
                aria-label={`Angle ${i + 1}`}
                className={cn(
                  'type-body-sm h-8 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1.5 text-ink outline-none transition-colors duration-(--dur-1) placeholder:text-ink-3',
                  'hover:border-line focus-visible:border-line-input focus-visible:bg-canvas pointer-coarse:text-[16px]',
                  !custom && 'text-ink-2',
                )}
              />
              <IconButton icon={X} label={`Remove angle ${i + 1}`} size="xs" onClick={() => remove(i)} className="opacity-0 group-hover/angle:opacity-100 group-focus-within/angle:opacity-100 pointer-coarse:opacity-100" />
            </li>
          ))}
        </ol>
      ) : (
        <p className="type-caption py-1.5 text-ink-3">{hasQuestion ? 'No angles — Scout plans its own from the question.' : 'Angles appear as you write the question — or add your own.'}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Button size="xs" variant="ghost" leadingIcon={Plus} onClick={() => add()} disabled={angles.length >= 8} className="-ml-1.5">
          Add an angle
        </Button>
        {custom ? (
          <Button size="xs" variant="ghost" leadingIcon={RotateCcw} onClick={onReset}>
            Use suggested angles
          </Button>
        ) : (
          angles.length > 0 && <span className="type-caption text-ink-3">Suggested from your question</span>
        )}
      </div>
    </div>
  )
}
