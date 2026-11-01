import { memo, useMemo, useRef, useState, type RefObject } from 'react'
import { useNavigate } from 'react-router'
import { ArrowUpRight, BookPlus, Check, Download, Eye, ListChecks, MessagesSquare, PenLine, RefreshCw } from 'lucide-react'
import { DerivedRow, HoldButton, LandedCard, useDerived, useScopedKey } from '@/app/components'
import { attachRun } from '@/app/shell/store'
import { useRow } from '@/core/db'
import { entityRoute, saveReportToKnowledge, updateReport } from '@/core/services'
import { isRunActive, type ID, type Investigation, type Source } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, EntityChip, Markdown, ProvenanceLine, SimBadge, Textarea, Tooltip, confirm, toast, type Citation } from '@/ui'
import { discussInChat, exportReport } from './actions'
import { MakeTasksDialog } from './MakeTasksDialog'
import { citedSimulatedCount, openQuestions } from './logic'
import { SectionLabel } from './parts'

/*
 * Report (§6.5 Done): the report in the document voice at the 720 measure, `[n]` citations as mono
 * superscripts (hover previews the source, click shows it in Inspector › Item), the simulated-sources
 * banner, the Colophon, Save to Knowledge (idempotent, then a link), Hold, Discuss in Chat, Make tasks,
 * Export Markdown — and what the report led to.
 */

/** The report body without the title and question lines the masthead already shows. */
export function reportBody(report: string): string {
  const lines = report.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (/^#\s+/.test(lines[i] ?? '')) {
    i++
    while (i < lines.length && !lines[i].trim()) i++
    if (/^\*\*Question:\*\*/.test(lines[i] ?? '')) i++
  }
  return lines.slice(i).join('\n').trim()
}

export interface ReportViewProps {
  inv: Investigation
  sources: readonly Source[]
  /** The investigation's latest run. */
  runId?: ID
  /** A run is working on the investigation (editing waits for it). */
  busy: boolean
  onSelectSource: (id: ID) => void
  /** S / H fire while focus is inside this element. */
  hotkeyScope: RefObject<HTMLElement | null>
}

export const ReportView = memo(function ReportView({ inv, sources, runId, busy, onSelectSource, hotkeyScope }: ReportViewProps) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const report = inv.report ?? ''
  const body = useMemo(() => reportBody(report), [report])
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources])
  const citations = useMemo<Citation[]>(
    () =>
      inv.sourceIds.flatMap((id, i) => {
        const s = byId.get(id)
        if (!s) return []
        const title = s.kind === 'knowledge' ? `${s.title} · your knowledge` : `${s.title}${s.simulated ? ' · simulated source' : ''}`
        return [{ index: i + 1, title, href: s.simulated || s.kind === 'knowledge' ? (s.domain ? `https://${s.domain}` : undefined) : s.url, onClick: () => onSelectSource(id) }]
      }),
    [inv.sourceIds, byId, onSelectSource],
  )
  const simulatedCited = useMemo(() => citedSimulatedCount(inv, sources), [inv, sources])
  const questions = useMemo(() => openQuestions(report).map((q) => ({ id: q.id, text: q.text, section: q.section })), [report])

  return (
    <article aria-label="Report" className="flex flex-col">
      {simulatedCited > 0 && (
        <div className="mb-5 flex items-start gap-2.5 rounded-sm border border-dashed border-line-input bg-sim-tint px-3 py-2" role="note">
          <SimBadge className="mt-px" />
          <p className="type-body-sm text-ink-2">
            Cites {simulatedCited} simulated source{simulatedCited === 1 ? '' : 's'} — not fetched from the web.
          </p>
        </div>
      )}

      {editing ? (
        <ReportEditor inv={inv} onDone={() => setEditing(false)} />
      ) : (
        <Markdown prose="doc" citations={citations} className="[&>*:first-child]:mt-0">
          {body || '_The report is empty._'}
        </Markdown>
      )}

      <div className="mt-8 flex flex-col gap-3 border-t border-line pt-3">
        <ReportColophon runId={runId} simulatedCited={simulatedCited} />
        {!editing && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Report actions">
            <SaveReportButton inv={inv} hotkeyScope={hotkeyScope} />
            <HoldButton entity={{ kind: 'investigation', id: inv.id }} hotkeyScope={hotkeyScope} />
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={MessagesSquare}
              onClick={() => {
                const thread = discussInChat(inv.id)
                if (thread) navigate(`/chat/${thread}`)
              }}
            >
              Discuss in Chat
            </Button>
            <Button size="sm" variant="ghost" leadingIcon={ListChecks} onClick={() => setTasksOpen(true)}>
              Make tasks
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={Download}
              onClick={() => {
                const { fileName } = exportReport(inv)
                toast({ title: `Exported ${fileName}` })
              }}
            >
              Export .md
            </Button>
            <span className="flex-1" />
            <Tooltip content={busy ? 'Wait for the run to finish before editing' : 'Edit the Markdown'}>
              <span>
                <Button size="sm" variant="ghost" leadingIcon={PenLine} disabled={busy} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </span>
            </Tooltip>
          </div>
        )}
      </div>

      <LedTo inv={inv} className="mt-8" />
      <MakeTasksDialog open={tasksOpen} onOpenChange={setTasksOpen} inv={inv} candidates={questions} />
    </article>
  )
})

// ------------------------------------------------------------------------------------------------ colophon

function ReportColophon({ runId, simulatedCited }: { runId?: ID; simulatedCited: number }) {
  const run = useRow('runs', runId)
  if (run && !isRunActive(run.status)) {
    return <ProvenanceLine run={run} onViewRun={() => attachRun(run.id, 'research')} />
  }
  if (run) return <p className="type-meta text-ink-3">The run is still working; its provenance appears when it ends.</p>
  return (
    <p className="type-meta flex flex-wrap items-center gap-x-1.5 text-ink-3">
      {simulatedCited > 0 && <SimBadge />}
      <span>Part of the demo data · no run is recorded for this report</span>
    </p>
  )
}

// ------------------------------------------------------------------------------------------------ save to knowledge

/**
 * Save to Knowledge for a report (`saveReportToKnowledge`): idempotent — once saved it reads
 * "In Knowledge" and opens the item; when the report changed since, it offers to update the copy.
 */
export function SaveReportButton({ inv, hotkeyScope, size = 'sm', variant = 'ghost' }: { inv: Investigation; hotkeyScope?: RefObject<HTMLElement | null>; size?: 'xs' | 'sm' | 'md'; variant?: 'ghost' | 'secondary' }) {
  const navigate = useNavigate()
  const knowledge = useRow('knowledge', inv.knowledgeId)
  const stale = !!knowledge && !!inv.report?.trim() && !knowledge.content.includes(inv.report.trim())
  const save = () => {
    if (knowledge) {
      navigate(entityRoute({ kind: 'knowledge', id: knowledge.id }))
      return
    }
    try {
      const item = saveReportToKnowledge(inv.id)
      if (!item) {
        toast({ tone: 'error', title: 'Nothing to save yet', description: 'The report appears once Scout has drafted it.' })
        return
      }
      toast({ tone: 'success', title: 'Saved to Knowledge', description: 'Retrievable in every composer from now on.', action: { label: 'Open', onClick: () => navigate(entityRoute({ kind: 'knowledge', id: item.id })) } })
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t save to Knowledge', description: err instanceof Error ? err.message : String(err) })
    }
  }
  const update = async () => {
    const ok = await confirm({
      title: 'Update the Knowledge copy?',
      description: 'The copy in Knowledge is replaced with the current report. Edits made to the copy itself are replaced too.',
      confirmLabel: 'Update copy',
    })
    if (!ok) return
    saveReportToKnowledge(inv.id)
    toast({ tone: 'success', title: 'Knowledge copy updated' })
  }
  useScopedKey(hotkeyScope, 's', save)
  if (knowledge) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button size={size} variant={variant} leadingIcon={Check} trailingIcon={ArrowUpRight} aria-keyshortcuts="s" onClick={save} aria-label={`In Knowledge: ${knowledge.title}. Open it`}>
          In Knowledge
        </Button>
        {stale && (
          <Button size={size} variant="ghost" leadingIcon={RefreshCw} onClick={() => void update()}>
            Update copy
          </Button>
        )}
      </span>
    )
  }
  return (
    <Button size={size} variant={variant} leadingIcon={BookPlus} aria-keyshortcuts="s" disabled={!inv.report?.trim()} onClick={save}>
      Save to Knowledge
    </Button>
  )
}

// ------------------------------------------------------------------------------------------------ editor

function ReportEditor({ inv, onDone }: { inv: Investigation; onDone: () => void }) {
  const [draft, setDraft] = useState(inv.report ?? '')
  const [preview, setPreview] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const dirty = draft !== (inv.report ?? '')
  const save = () => {
    updateReport(inv.id, draft)
    toast({ title: 'Report saved' })
    onDone()
  }
  const cancel = async () => {
    if (dirty && !(await confirm({ title: 'Discard your edits?', description: 'The report keeps its last saved version.', confirmLabel: 'Discard', tone: 'danger' }))) return
    onDone()
  }
  return (
    <div
      ref={ref}
      className="flex flex-col gap-3"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          save()
        }
      }}
    >
      <div className="flex items-center gap-2">
        <span className="type-label flex-1 text-ink-3">Editing the report</span>
        <Button size="xs" variant="ghost" leadingIcon={preview ? PenLine : Eye} onClick={() => setPreview((p) => !p)}>
          {preview ? 'Markdown' : 'Preview'}
        </Button>
      </div>
      {preview ? (
        <div className="rounded-md border border-line p-4">
          <Markdown prose="doc">{reportBody(draft) || '_Empty._'}</Markdown>
        </div>
      ) : (
        <Textarea value={draft} onValueChange={setDraft} mono autosize minRows={14} maxRows={40} aria-label="Report Markdown" autoFocus className="type-mono" />
      )}
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => void cancel()}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" kbd="mod+enter" disabled={!dirty} onClick={save}>
          Save report
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ led to

/** What the investigation led to: tasks, sessions, decks, knowledge, discussions (its own runs excluded). */
export function LedTo({ inv, className }: { inv: Investigation; className?: string }) {
  const items = useDerived({ kind: 'investigation', id: inv.id })
  const shown = items.filter((i) => !(i.ref.kind === 'run' && inv.runIds.includes(i.ref.id)) && !(i.run && inv.runIds.includes(i.run.id)))
  if (!shown.length) return null
  return (
    <section aria-labelledby={`ledto-${inv.id}`} className={cn('flex flex-col gap-1.5', className)}>
      <SectionLabel id={`ledto-${inv.id}`} count={shown.length}>
        Led to
      </SectionLabel>
      <div className="flex flex-col gap-1.5">
        {shown.map((item) =>
          item.run && !isRunActive(item.run.status) ? (
            <LandedCard key={`${item.ref.kind}:${item.ref.id}`} run={item.run} subject={item.ref.kind === 'run' ? undefined : item.ref} compact />
          ) : item.run ? (
            <DerivedRow key={`${item.ref.kind}:${item.ref.id}`} item={item} />
          ) : (
            <div key={`${item.ref.kind}:${item.ref.id}`} className="flex h-7 min-w-0 items-center gap-2 px-1.5">
              <span aria-hidden className="text-ink-4">↳</span>
              <EntityChip entity={item.ref} size="sm" showKind />
            </div>
          ),
        )}
      </div>
    </section>
  )
}
