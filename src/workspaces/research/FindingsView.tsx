import { memo, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Copy, Ellipsis, ListChecks, Pin, PinOff, Plus, SquareTerminal, Trash2, BookPlus, X } from 'lucide-react'
import { addFinding, entityRoute, removeFinding, saveFindingSnippet, togglePinFinding } from '@/core/services'
import type { Finding, ID, Investigation, Source } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, Checkbox, IconButton, Menu, SegmentedControl, SimBadge, Textarea, copyText, toast } from '@/ui'
import { sendFindingsToCode, taskFromFinding } from './actions'
import { MakeTasksDialog, type TaskCandidate } from './MakeTasksDialog'
import { ConfidenceMeter, QuietLine } from './parts'

/*
 * Findings (§6.5): claims with a 3-tick confidence meter and their `[n]` sources. Pin keeps a finding
 * when the report is regenerated; Make task, Send to Code and Save snippet hand it off. Select several
 * to send them to Code or make tasks together; add your own at the end.
 */

export interface FindingsViewProps {
  inv: Investigation
  sources: readonly Source[]
  onSelectSource: (id: ID) => void
  running?: boolean
}

export function FindingsView({ inv, sources, onSelectSource, running }: FindingsViewProps) {
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<ID>>(new Set())
  const [tasksOpen, setTasksOpen] = useState(false)
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources])
  const numberOf = useMemo(() => new Map(inv.sourceIds.map((id, i) => [id, i + 1])), [inv.sourceIds])
  const pickedFindings = inv.findings.filter((f) => picked.has(f.id))
  const candidates = useMemo<TaskCandidate[]>(
    () => pickedFindings.map((f) => ({ id: f.id, text: f.text, section: `Finding ${inv.findings.indexOf(f) + 1} · ${f.confidence} confidence` })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, inv.findings],
  )
  const toggle = (id: ID, on: boolean) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const stopSelecting = () => {
    setSelecting(false)
    setPicked(new Set())
  }

  return (
    <section aria-label="Findings" className="flex flex-col gap-3">
      {inv.findings.length > 0 && (
        <div className="flex min-w-0 items-center gap-2">
          <p className="type-caption min-w-0 flex-1 text-ink-3">
            {inv.findings.filter((f) => f.pinned).length > 0 ? 'Pinned findings stay when the report is regenerated.' : 'Pin a finding to keep it when the report is regenerated.'}
          </p>
          {selecting ? (
            <Button size="sm" variant="ghost" leadingIcon={X} onClick={stopSelecting}>
              Done
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setSelecting(true)}>
              Select
            </Button>
          )}
        </div>
      )}

      {inv.findings.length === 0 ? (
        <QuietLine>{running ? 'Findings appear once Scout has read the sources.' : 'No findings yet. Add your own below.'}</QuietLine>
      ) : (
        <ol className="flex flex-col divide-y divide-line border-y border-line" aria-label="Findings">
          {inv.findings.map((f, i) => (
            <FindingItem
              key={f.id}
              inv={inv}
              finding={f}
              index={i}
              byId={byId}
              numberOf={numberOf}
              onSelectSource={onSelectSource}
              selecting={selecting}
              picked={picked.has(f.id)}
              onPick={toggle}
            />
          ))}
        </ol>
      )}

      {selecting && (
        <div className="sticky bottom-0 z-(--z-sticky) -mx-1 flex flex-wrap items-center gap-2 rounded-md border border-line bg-overlay px-3 py-2 shadow-e1" role="toolbar" aria-label="Selected findings">
          <span className="type-body-sm min-w-0 flex-1 text-ink-2">
            {picked.size ? `${picked.size} selected` : 'Select findings to hand off'}
          </span>
          <Button size="sm" variant="ghost" leadingIcon={ListChecks} disabled={!picked.size} onClick={() => setTasksOpen(true)}>
            Make tasks
          </Button>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={SquareTerminal}
            disabled={!picked.size}
            onClick={() => {
              sendFindingsToCode(inv, pickedFindings)
              stopSelecting()
            }}
          >
            Send to Code
          </Button>
        </div>
      )}

      <AddFinding inv={inv} sources={sources} numberOf={numberOf} />
      <MakeTasksDialog open={tasksOpen} onOpenChange={setTasksOpen} inv={inv} candidates={candidates} heading="Tasks from findings" />
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ item

export interface FindingItemProps {
  inv: Investigation
  finding: Finding
  index: number
  byId: ReadonlyMap<ID, Source>
  numberOf: ReadonlyMap<ID, number>
  onSelectSource: (id: ID) => void
  selecting?: boolean
  picked?: boolean
  onPick?: (id: ID, on: boolean) => void
  /** Board column: no hand-off menu. */
  compact?: boolean
}

export const FindingItem = memo(function FindingItem({ inv, finding: f, index, byId, numberOf, onSelectSource, selecting, picked, onPick, compact }: FindingItemProps) {
  const navigate = useNavigate()
  const menu = [
    { id: 'task', label: 'Make task', icon: ListChecks, description: 'Review it in the Start sheet', onSelect: () => taskFromFinding(inv, f) },
    { id: 'code', label: 'Send to Code', icon: SquareTerminal, onSelect: () => sendFindingsToCode(inv, [f]) },
    {
      id: 'snippet',
      label: 'Save snippet',
      icon: BookPlus,
      description: 'Save it to Knowledge with its sources',
      onSelect: () => {
        const item = saveFindingSnippet(inv.id, f.id)
        if (item) toast({ tone: 'success', title: 'Saved to Knowledge', description: 'Retrievable in every composer from now on.', action: { label: 'Open', onClick: () => navigate(entityRoute({ kind: 'knowledge', id: item.id })) } })
      },
    },
    {
      id: 'copy',
      label: 'Copy',
      icon: Copy,
      onSelect: () => void copyText(f.text).then((ok) => toast(ok ? { title: 'Finding copied' } : { tone: 'error', title: 'Couldn’t copy the finding' })),
    },
    { type: 'separator' as const },
    {
      id: 'remove',
      label: 'Remove',
      icon: Trash2,
      danger: true,
      onSelect: () => {
        removeFinding(inv.id, f.id)
        toast({ title: 'Finding removed', action: { label: 'Undo', onClick: () => addFinding(inv.id, f.text, f.sourceIds, f.confidence) } })
      },
    },
  ]
  return (
    <li className={cn('group/finding flex min-w-0 gap-3 py-3', picked && 'bg-accent-tint/60')}>
      {selecting ? (
        <Checkbox checked={!!picked} onCheckedChange={(v) => onPick?.(f.id, v)} aria-label={`Select finding ${index + 1}`} className="mt-0.5 shrink-0" />
      ) : (
        <span aria-hidden className="type-meta w-4 shrink-0 pt-0.5 text-right text-ink-3 tabular">
          {index + 1}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <ConfidenceMeter confidence={f.confidence} />
          {f.pinned && (
            <span className="type-meta inline-flex items-center gap-1 text-ink-3">
              <Pin aria-hidden className="size-3" strokeWidth={1.75} />
              Pinned
            </span>
          )}
        </div>
        <p className={cn('text-pretty text-ink', compact ? 'type-body-sm' : 'type-body')}>{f.text}</p>
        {f.sourceIds.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-1.5 pt-0.5">
            {f.sourceIds.map((sid) => {
              const s = byId.get(sid)
              return s ? <SourceRefChip key={sid} source={s} n={numberOf.get(sid)} onSelect={onSelectSource} /> : null
            })}
          </div>
        ) : (
          <span className="type-caption text-ink-3">No sources cited — treat as an open question.</span>
        )}
      </div>
      {!selecting && (
        <div className="flex shrink-0 items-start gap-0.5">
          {!compact && (
            <IconButton
              icon={ListChecks}
              label="Create a task from this finding"
              size="sm"
              onClick={() => taskFromFinding(inv, f)}
              className="opacity-0 group-hover/finding:opacity-100 group-focus-within/finding:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            />
          )}
          <IconButton
            icon={f.pinned ? PinOff : Pin}
            label={f.pinned ? 'Unpin this finding' : 'Pin this finding — it stays when the report is regenerated'}
            size="sm"
            active={!!f.pinned}
            onClick={() => togglePinFinding(inv.id, f.id)}
            className={cn(!f.pinned && 'opacity-0 group-hover/finding:opacity-100 group-focus-within/finding:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100')}
          />
          {!compact && (
            <Menu
              items={menu}
              aria-label={`Finding ${index + 1} actions`}
              placement="bottom-end"
              trigger={
                <IconButton
                  icon={Ellipsis}
                  label={`More actions for finding ${index + 1}`}
                  size="sm"
                  className="opacity-0 group-hover/finding:opacity-100 group-focus-within/finding:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
                />
              }
            />
          )}
        </div>
      )}
    </li>
  )
})

/** `[3] Pricing — Tidewell SIM`: a source reference; click shows the source in Inspector › Item. */
export const SourceRefChip = memo(function SourceRefChip({ source: s, n, onSelect }: { source: Source; n?: number; onSelect: (id: ID) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(s.id)}
      aria-label={`Source ${n ?? ''}: ${s.title}${s.simulated ? ', simulated' : ''}`}
      className={cn(
        'relative inline-flex h-[22px] max-w-[260px] min-w-0 items-center gap-1.5 rounded-sm border pr-1 pl-1.5 text-xs font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink',
        s.simulated ? 'border-dashed border-line-input' : 'border-line-strong',
        s.status === 'discarded' && 'text-ink-3 line-through decoration-ink-4',
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']",
      )}
    >
      {n !== undefined && <span className="type-meta shrink-0 text-ink-3">[{n}]</span>}
      <span className="min-w-0 truncate">{s.title}</span>
      {s.simulated && <SimBadge noTooltip />}
    </button>
  )
})

// ------------------------------------------------------------------------------------------------ add

function AddFinding({ inv, sources, numberOf }: { inv: Investigation; sources: readonly Source[]; numberOf: ReadonlyMap<ID, number> }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [confidence, setConfidence] = useState<Finding['confidence']>('medium')
  const [cited, setCited] = useState<Set<ID>>(new Set())
  const usable = sources.filter((s) => s.status !== 'discarded')
  const reset = () => {
    setText('')
    setConfidence('medium')
    setCited(new Set())
  }
  const submit = () => {
    const f = addFinding(inv.id, text, [...cited], confidence)
    if (!f) return
    toast({ title: 'Finding added' })
    reset()
    setOpen(false)
  }
  if (!open) {
    return (
      <div>
        <Button size="sm" variant="ghost" leadingIcon={Plus} onClick={() => setOpen(true)} className="-ml-2">
          Add a finding
        </Button>
      </div>
    )
  }
  return (
    <form
      aria-label="Add a finding"
      className="flex flex-col gap-3 rounded-md border border-line bg-raised p-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          setOpen(false)
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          submit()
        }
      }}
    >
      <Textarea value={text} onValueChange={setText} autosize minRows={2} maxRows={8} placeholder="What did you conclude?" aria-label="Finding" autoFocus />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="type-label text-ink-3">Confidence</span>
        <SegmentedControl<Finding['confidence']>
          size="sm"
          value={confidence}
          onValueChange={setConfidence}
          aria-label="Confidence"
          options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ]}
        />
      </div>
      {usable.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="type-label text-ink-3">Cites</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sources this finding cites">
            {usable.map((s) => {
              const on = cited.has(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setCited((cur) => {
                      const next = new Set(cur)
                      if (on) next.delete(s.id)
                      else next.add(s.id)
                      return next
                    })
                  }
                  className={cn(
                    'inline-flex h-[22px] max-w-[220px] min-w-0 items-center gap-1.5 rounded-sm border px-1.5 text-xs font-medium transition-colors duration-(--dur-1)',
                    on ? 'border-ink bg-accent-tint text-ink' : cn('text-ink-3 hover:text-ink', s.simulated ? 'border-dashed border-line-input' : 'border-line-strong'),
                  )}
                >
                  <span className="type-meta shrink-0">[{numberOf.get(s.id) ?? '–'}]</span>
                  <span className="min-w-0 truncate">{s.title}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            reset()
            setOpen(false)
          }}
        >
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!text.trim()} kbd="mod+enter">
          Add finding
        </Button>
      </div>
    </form>
  )
}
