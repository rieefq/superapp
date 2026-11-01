import { memo, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Ban, ListFilter, Plus, RotateCcw } from 'lucide-react'
import { ListRows } from '@/app/templates'
import { addSource, discardSource, restoreSource } from '@/core/services'
import type { ID, Investigation, Source } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import { Button, Dialog, Field, IconButton, Input, Menu, SearchField, SimBadge, Tabs, Textarea, toast, useReducedMotion } from '@/ui'
import { sourceOrigin, sourceStats, type SourceOrigin } from './logic'
import { CredibilityMeter, QuietLine, SourceKindTile, SourceOriginTag, SourceStatus } from './parts'

/*
 * Sources (§6.5): every source with its number in the report, kind, domain, a 5-tick credibility
 * meter, status and origin (SIM for simulated web results, LIVE "Your knowledge" for retrieved items,
 * "Added by you"). Filters, discard/restore (Undo), add a source by hand. Selecting a source opens
 * its panel in Inspector › Item (the source drawer).
 */

type StatusFilter = 'all' | 'cited' | 'read' | 'queued' | 'discarded'
type OriginFilter = 'all' | SourceOrigin

const ORIGIN_LABEL: Record<OriginFilter, string> = { all: 'All origins', knowledge: 'Your knowledge', web: 'Simulated web', manual: 'Added by you' }

export interface SourcesViewProps {
  inv: Investigation
  sources: readonly Source[]
  selectedId: ID | null
  readingIds: ReadonlySet<ID>
  onSelect: (id: ID) => void
}

export function SourcesView({ inv, sources, selectedId, readingIds, onSelect }: SourcesViewProps) {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [origin, setOrigin] = useState<OriginFilter>('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const stats = useMemo(() => sourceStats(sources), [sources])
  const numberOf = useMemo(() => new Map(inv.sourceIds.map((id, i) => [id, i + 1])), [inv.sourceIds])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const statusOk = (s: Source) =>
      status === 'all'
        ? s.status !== 'discarded'
        : status === 'queued'
          ? s.status === 'queued' || s.status === 'reading'
          : s.status === status
    return sources.filter((s) => {
      if (!statusOk(s)) return false
      if (origin !== 'all' && sourceOrigin(s) !== origin) return false
      if (q && !`${s.title} ${s.domain ?? ''} ${s.author ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [sources, status, origin, query])

  return (
    <section aria-label="Sources" className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
        <Tabs<StatusFilter>
          variant="pill"
          size="sm"
          aria-label="Filter by status"
          value={status}
          onValueChange={setStatus}
          items={(
            [
              { value: 'all', label: 'All', count: stats.active },
              { value: 'cited', label: 'Cited', count: stats.cited },
              { value: 'read', label: 'Read', count: stats.read },
              { value: 'queued', label: 'Queued', count: stats.queued },
              { value: 'discarded', label: 'Discarded', count: stats.discarded },
            ] as const
          ).filter((t) => t.value === 'all' || t.value === status || t.count > 0)}
          className="min-w-0"
        />
        <span className="flex-1" />
        <Menu
          aria-label="Filter by origin"
          placement="bottom-end"
          items={(['all', 'knowledge', 'web', 'manual'] as const).map((o) => ({ type: 'radio' as const, label: ORIGIN_LABEL[o], checked: origin === o, onSelect: () => setOrigin(o) }))}
          trigger={
            <Button size="sm" variant="ghost" leadingIcon={ListFilter} aria-label={`Origin: ${ORIGIN_LABEL[origin]}`}>
              {origin === 'all' ? 'Origin' : ORIGIN_LABEL[origin]}
            </Button>
          }
        />
        <Button size="sm" variant="secondary" leadingIcon={Plus} onClick={() => setAdding(true)}>
          Add source
        </Button>
      </div>
      {sources.length > 6 && (
        <SearchField size="sm" value={query} onValueChange={setQuery} placeholder="Filter sources by title, domain or author" aria-label="Filter sources" />
      )}
      {stats.simulated > 0 && (
        <p className="type-caption flex items-center gap-2 text-ink-3">
          <SimBadge />
          Web results are simulated in this build: {stats.simulated} source{stats.simulated === 1 ? ' is a fictional publication' : 's are fictional publications'} generated locally. No page was fetched.
        </p>
      )}

      {sources.length === 0 ? (
        <QuietLine>{inv.status === 'running' ? 'Sources appear here as Scout finds them.' : 'No sources matched. Widen the sources or rephrase.'}</QuietLine>
      ) : shown.length === 0 ? (
        <div className="flex items-center gap-2 py-1">
          <QuietLine>No sources match these filters.</QuietLine>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setStatus('all')
              setOrigin('all')
              setQuery('')
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <SourceList sources={shown} numberOf={numberOf} selectedId={selectedId} readingIds={readingIds} onSelect={onSelect} />
      )}

      <AddSourceDialog open={adding} onOpenChange={setAdding} inv={inv} onAdded={onSelect} />
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ list

export interface SourceListProps {
  sources: readonly Source[]
  numberOf: ReadonlyMap<ID, number>
  selectedId: ID | null
  readingIds: ReadonlySet<ID>
  onSelect: (id: ID) => void
  /** Board column: tighter rows, no author line. */
  compact?: boolean
  /** Animate rows that arrive while the list is on screen (streaming). */
  animateNew?: boolean
}

/** Source rows with the list keyboard (↑↓, Home/End, ⏎ selects, Space inspects). */
export function SourceList({ sources, numberOf, selectedId, readingIds, onSelect, compact, animateNew }: SourceListProps) {
  const reduced = useReducedMotion()
  const [initial] = useState(() => new Set(sources.map((s) => s.id)))
  return (
    <ListRows label="Sources" className="gap-0 py-0">
      <AnimatePresence initial={false}>
        {sources.map((s) => {
          const fresh = animateNew && !initial.has(s.id) && !reduced
          return (
            <motion.div key={s.id} role="listitem" initial={fresh ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
              <SourceRow source={s} n={numberOf.get(s.id)} selected={selectedId === s.id} reading={readingIds.has(s.id)} onSelect={onSelect} compact={compact} />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </ListRows>
  )
}

const SourceRow = memo(function SourceRow({ source: s, n, selected, reading, onSelect, compact }: {
  source: Source
  n?: number
  selected: boolean
  reading: boolean
  onSelect: (id: ID) => void
  compact?: boolean
}) {
  const discarded = s.status === 'discarded'
  const toggle = () => {
    if (discarded) {
      restoreSource(s.id)
      return
    }
    discardSource(s.id)
    toast({ title: `Discarded “${s.title.length > 48 ? `${s.title.slice(0, 47)}…` : s.title}”`, description: 'It no longer counts toward findings or the report.', action: { label: 'Undo', onClick: () => restoreSource(s.id) } })
  }
  const meta = [
    s.kind === 'knowledge' ? null : s.domain,
    compact ? null : s.author,
    !compact && s.publishedAt ? formatDate(s.publishedAt, { month: 'short', year: 'numeric' }) : null,
  ].filter(Boolean)
  return (
    <div className={cn('group/src relative flex min-w-0 items-stretch rounded-sm transition-colors duration-(--dur-1)', selected ? 'bg-accent-tint' : 'hover:bg-hover')}>
      <button
        type="button"
        data-list-row=""
        data-inspect={`source:${s.id}`}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${n ? `Source ${n}: ` : ''}${s.title}${discarded ? ' (discarded)' : ''}`}
        onClick={() => onSelect(s.id)}
        className={cn(
          'flex min-w-0 flex-1 items-start gap-3 rounded-sm py-2.5 pr-2 pl-2 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)',
          compact && 'py-2',
        )}
      >
        <span aria-hidden className="type-meta w-5 shrink-0 pt-[3px] text-right text-ink-3 tabular">
          {n ?? '–'}
        </span>
        <span className="pt-px">
          <SourceKindTile source={s} size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn('type-body-sm line-clamp-2 text-pretty', discarded ? 'text-ink-3 line-through decoration-ink-4' : 'font-medium text-ink')}>{s.title}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <SourceOriginTag source={s} compact={compact && sourceOrigin(s) !== 'knowledge'} />
            {meta.length > 0 && <span className="type-meta min-w-0 truncate text-ink-3">{meta.join(' · ')}</span>}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
          <CredibilityMeter source={s} />
          <SourceStatus status={s.status} reading={reading} />
        </span>
      </button>
      <span className="flex shrink-0 items-start pt-2 pr-1">
        <IconButton
          icon={discarded ? RotateCcw : Ban}
          label={discarded ? `Restore “${s.title}”` : `Discard “${s.title}”`}
          size="sm"
          onClick={toggle}
          className="opacity-0 group-hover/src:opacity-100 group-focus-within/src:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 data-[pressed]:opacity-100"
        />
      </span>
    </div>
  )
})

// ------------------------------------------------------------------------------------------------ add a source

function AddSourceDialog({ open, onOpenChange, inv, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; inv: Investigation; onAdded: (id: ID) => void }) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reset = () => {
    setUrl('')
    setTitle('')
    setNotes('')
    setError(null)
  }
  const submit = () => {
    if (!url.trim() && !title.trim()) {
      setError('Add a link or a title.')
      return
    }
    const s = addSource(inv.id, { url, title, snippet: notes })
    if (!s) {
      setError('Couldn’t add the source: the investigation no longer exists.')
      return
    }
    onOpenChange(false)
    reset()
    toast({ title: 'Source added', description: 'It’s queued with your notes. Atrium doesn’t fetch pages in this build.' })
    onAdded(s.id)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
      title="Add a source"
      description="Keep a page, paper or document with this investigation. Atrium doesn’t fetch pages in this build: the source keeps the link and the notes you add."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" kbd="mod+enter" onClick={submit}>
            Add source
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
      >
        <Field label="Link" optional error={error ?? undefined}>
          <Input value={url} onValueChange={setUrl} placeholder="https://…" inputMode="url" data-autofocus="" />
        </Field>
        <Field label="Title" optional hint="Defaults to the domain.">
          <Input value={title} onValueChange={setTitle} placeholder="What it is" />
        </Field>
        <Field label="Your notes" optional hint="A summary or the passage that matters — findings can cite it.">
          <Textarea value={notes} onValueChange={setNotes} autosize minRows={3} maxRows={8} placeholder="Key points, quotes, numbers you checked yourself" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
