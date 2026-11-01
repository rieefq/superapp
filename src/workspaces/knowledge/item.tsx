import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ArrowUpRight,
  BookMarked,
  ChevronDown,
  ChevronLeft,
  Copy,
  CopyPlus,
  FileText,
  FolderInput,
  Layers,
  Link2,
  ListChecks,
  MessageSquare,
  PenLine,
  Shuffle,
  Telescope,
  Trash2,
} from 'lucide-react'
import { CollectionPicker, HoldButton, ProjectPicker, TurnIntoMenu } from '@/app/components'
import { attachRun, openStartSheet, useShellStore } from '@/app/shell/store'
import { StageHeader, useShellLayout } from '@/app/templates'
import { useRegisterCommands } from '@/app/commands/registry'
import { useScope } from '@/core/context'
import { useDB, useRow, type Tables } from '@/core/db'
import { actorName, AI_AVAILABILITY_LABEL, KNOWLEDGE_KIND_META, updateKnowledge, useKnowledgeUsage } from '@/core/services'
import { useSettings } from '@/core/settings'
import type { EntityRef, ID, KnowledgeItem } from '@/core/types'
import {
  Button,
  Dialog,
  EmptyState,
  EntityChip,
  Field,
  IconButton,
  Markdown,
  Menu,
  ProvenanceLine,
  SimBadge,
  Tooltip,
  toast,
  useHotkey,
  type MenuItem,
} from '@/ui'
import { cn } from '@/lib/cn'
import { formatBytes, formatDateTime, timeAgo } from '@/lib/format'
import { shortCode } from '@/lib/id'
import { addToProjectMemory, askAbout, deleteWithConfirm, duplicate, setAvailability } from './actions'
import { ConnectionsSection } from './connections'
import { EditorBar, EditorBody, useNoteEditor } from './editor'
import { countWords, isImage, isIndexed } from './model'
import { lastLibraryHref } from './nav'
import { AVAILABILITY_EFFECT, AVAILABILITY_OPTIONS, KnowledgeTile, NotIndexedTag, originWords } from './parts'
import { AvailabilityControl, CollectionControl, ProjectsControl, TagsControl } from './properties'
import { KnowledgeScreen } from './screen'

const kref = (id: ID): EntityRef => ({ kind: 'knowledge', id })

/**
 * The editor session survives `/knowledge/new` → `/knowledge/<id>` (the draft turned into an item on its
 * first words) and resets for any other change of item.
 */
function useSessionKey(itemId: string): [string, (createdId: ID) => void] {
  const ref = useRef({ id: itemId, n: 0, created: null as ID | null })
  const cur = ref.current
  if (itemId !== cur.id) {
    const continued = cur.id === 'new' && itemId === cur.created
    ref.current = { id: itemId, n: continued ? cur.n : cur.n + 1, created: null }
  }
  return [String(ref.current.n), (id) => (ref.current.created = id)]
}

/** `/knowledge/:knowledgeId` (reader and editor) and `/knowledge/new` (a draft note). */
export function ItemRoute() {
  const { itemId = '' } = useParams()
  const [key, markCreated] = useSessionKey(itemId)
  return <ItemView key={key} itemId={itemId} onCreated={markCreated} />
}

function ItemView({ itemId, onCreated }: { itemId: string; onCreated: (id: ID) => void }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const isNew = itemId === 'new'
  const item = useRow('knowledge', isNew ? null : itemId)
  const scope = useScope()
  const layout = useShellLayout()
  const phone = layout.formFactor === 'phone'
  const editing = isNew || params.get('edit') === '1'
  const draftCollection = isNew ? params.get('collection') : null
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const sideBySide = !phone && layout.docking.stageWidth >= 1000

  const editor = useNoteEditor({
    item,
    isNew,
    collectionId: draftCollection,
    projectId: scope,
    onCreated: (id) => {
      onCreated(id)
      navigate(`/knowledge/${encodeURIComponent(id)}?edit=1`, { replace: true })
    },
  })

  // Inspector › Item opens by default in the reader at ≥1440 (once; the user's choice is remembered after).
  useEffect(() => {
    if (isNew || !item) return
    const st = useShellStore.getState()
    if (st.inspector.knowledge === undefined && window.innerWidth >= 1440) st.setInspector('knowledge', { open: true, tab: 'item' })
  }, [isNew, item])

  const setEditing = (on: boolean) => {
    if (!on) editor.flush()
    if (isNew && !on) {
      // Nothing was written, so nothing was created: go back to the library.
      navigate(lastLibraryHref())
      return
    }
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (on) next.set('edit', '1')
        else next.delete('edit')
        return next
      },
      { replace: true },
    )
  }

  const singleKeys = useSettings((s) => s.appearance.singleKeyShortcuts)
  useHotkey('e', () => setEditing(true), { enabled: singleKeys && !editing && !!item })
  useHotkey('escape', () => setEditing(false), { enabled: editing, allowInInputs: true, preventDefault: false })
  useHotkey(
    'h',
    () => toast({ title: 'Set to Never', description: 'Items that are never available to AI can’t be held. Change Available to AI first.' }),
    { enabled: singleKeys && item?.aiAvailability === 'never' },
  )

  useRegisterCommands(
    'knowledge.item',
    item
      ? [
          { id: 'knowledge.item.edit', title: `Edit “${item.title}”`, icon: PenLine, group: 'Knowledge', shortcut: 'E', run: (ctx) => { ctx.close(); setEditing(true) } },
          { id: 'knowledge.item.ask', title: `Ask about “${item.title}”`, icon: MessageSquare, group: 'Knowledge', keywords: ['chat', 'question'], run: (ctx) => { ctx.close(); askAbout(kref(item.id), navigate) } },
          { id: 'knowledge.item.research', title: `Research from “${item.title}”`, icon: Telescope, group: 'Knowledge', run: (ctx) => { ctx.close(); openStartSheet('research', { source: kref(item.id) }) } },
          { id: 'knowledge.item.task', title: `Make a task from “${item.title}”`, icon: ListChecks, group: 'Knowledge', run: (ctx) => { ctx.close(); openStartSheet('task', { source: kref(item.id) }) } },
          { id: 'knowledge.item.duplicate', title: `Duplicate “${item.title}”`, icon: CopyPlus, group: 'Knowledge', run: (ctx) => { ctx.close(); duplicate(item.id, navigate) } },
        ]
      : [],
  )

  if (!isNew && !item) return <MissingItem />

  const header = (
    <ItemHeader
      item={item}
      isNew={isNew}
      editing={editing}
      onEdit={() => setEditing(true)}
      onRenamed={editor.lockTitle}
    />
  )

  return (
    <KnowledgeScreen
      header={header}
      primary={item ? kref(item.id) : null}
      measure={editing && sideBySide ? 1280 : 'doc'}
      toolbar={editing ? <EditorBar editor={editor} mode={mode} onMode={setMode} sideBySide={sideBySide} isNew={isNew} onDone={() => setEditing(false)} /> : undefined}
    >
      {editing ? (
        <EditorBody
          editor={editor}
          mode={mode}
          sideBySide={sideBySide}
          autoFocus
          placeholder={isNew ? 'Start with a title on the first line. Markdown works — # headings, - lists, **bold**.' : undefined}
        />
      ) : (
        item && <Reader item={item} onEdit={() => setEditing(true)} />
      )}
    </KnowledgeScreen>
  )
}

// ------------------------------------------------------------------------------------------------ header

function ItemHeader({ item, isNew, editing, onEdit, onRenamed }: { item?: KnowledgeItem; isNew: boolean; editing: boolean; onEdit: () => void; onRenamed: () => void }) {
  const navigate = useNavigate()
  const layout = useShellLayout()
  const phone = layout.formFactor === 'phone'
  const compact = phone || layout.docking.stageWidth < 860
  const [moving, setMoving] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const projects = useDB((s: Tables) => s.projects)
  const back = phone ? <IconButton icon={ChevronLeft} label="Back to Knowledge" size="sm" onClick={() => navigate(lastLibraryHref())} className="-ml-1.5" /> : null

  if (!item) {
    return <StageHeader title="New note" leading={back ?? <KnowledgeTile item={{ kind: 'note', simulated: false }} size={20} />} hideInspectorToggle={phone} />
  }
  const ref = kref(item.id)
  const never = item.aiAvailability === 'never'
  const memoryTargets = item.projectIds.filter((p) => projects[p])
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: `${what} copied` })
    } catch {
      toast({ tone: 'error', title: `Couldn’t copy the ${what.toLowerCase()}` })
    }
  }

  const menu: MenuItem[] = [
    { id: 'move', label: 'Move to collection…', icon: FolderInput, onSelect: () => setMoving(true) },
    memoryTargets.length === 1
      ? { id: 'memory', label: `Add to ${projects[memoryTargets[0]].name} memory`, icon: BookMarked, onSelect: () => addToProjectMemory(item.id, memoryTargets[0]) }
      : { id: 'memory', label: 'Add to project memory…', icon: BookMarked, onSelect: () => setMemoryOpen(true) },
    { type: 'separator' },
    { id: 'research', label: 'Research from this', icon: Telescope, onSelect: () => openStartSheet('research', { source: ref }) },
    { id: 'task', label: 'Make a task', icon: ListChecks, onSelect: () => openStartSheet('task', { source: ref }) },
    { id: 'duplicate', label: 'Duplicate', icon: CopyPlus, onSelect: () => duplicate(item.id, navigate) },
    { type: 'separator' },
    { id: 'link', label: 'Copy link', icon: Link2, onSelect: () => void copy(`${window.location.origin}/knowledge/${item.id}`, 'Link') },
    { id: 'handle', label: 'Copy handle', icon: Copy, onSelect: () => void copy(shortCode(item.id), 'Handle') },
    { type: 'separator' },
    {
      id: 'delete',
      label: 'Delete…',
      icon: Trash2,
      danger: true,
      onSelect: async () => {
        const ok = await deleteWithConfirm([item.id])
        if (ok) navigate(lastLibraryHref(), { replace: true })
      },
    },
  ]

  const hold = never ? (
    <Tooltip content="Set to Never — items that are never available to AI can’t be held.">
      <span>
        {compact ? (
          <IconButton icon={Layers} label="Hold (unavailable: set to Never)" size="sm" disabled />
        ) : (
          <Button size="sm" variant="ghost" leadingIcon={Layers} disabled>
            Hold
          </Button>
        )}
      </span>
    </Tooltip>
  ) : (
    <HoldButton entity={ref} iconOnly={compact} />
  )

  const actions = editing ? (
    hold
  ) : compact ? (
    <>
      <IconButton icon={PenLine} label="Edit" shortcut="e" size="sm" onClick={onEdit} />
      {hold}
      <IconButton icon={MessageSquare} label="Ask about this" size="sm" onClick={() => askAbout(ref, navigate)} />
      <TurnIntoMenu entity={ref} trigger={<IconButton icon={Shuffle} label="Turn into…" shortcut="t" size="sm" />} />
    </>
  ) : (
    <>
      <Button size="sm" variant="ghost" leadingIcon={PenLine} kbd="e" onClick={onEdit}>
        Edit
      </Button>
      {hold}
      <Button size="sm" variant="ghost" leadingIcon={MessageSquare} onClick={() => askAbout(ref, navigate)}>
        Ask about this
      </Button>
      <TurnIntoMenu entity={ref} />
    </>
  )

  return (
    <>
      <StageHeader
        title={item.title}
        onRename={(title) => {
          updateKnowledge(item.id, { title })
          onRenamed()
        }}
        leading={back ?? <KnowledgeTile item={item} size={20} />}
        status={item.simulated ? <SimBadge /> : undefined}
        actions={actions}
        menu={isNew ? undefined : menu}
      />
      <MoveDialog open={moving} onOpenChange={setMoving} item={item} />
      <MemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} item={item} />
    </>
  )
}

function MoveDialog({ open, onOpenChange, item }: { open: boolean; onOpenChange: (open: boolean) => void; item: KnowledgeItem }) {
  const [value, setValue] = useState<ID | null>(item.collectionId)
  useEffect(() => {
    if (open) setValue(item.collectionId)
  }, [open, item.collectionId])
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Move to collection"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              updateKnowledge(item.id, { collectionId: value })
              onOpenChange(false)
              toast({ tone: 'success', title: value ? 'Moved' : 'Removed from its collection' })
            }}
          >
            Move
          </Button>
        </>
      }
    >
      <Field label="Collection">
        <CollectionPicker value={value} onChange={setValue} />
      </Field>
    </Dialog>
  )
}

function MemoryDialog({ open, onOpenChange, item }: { open: boolean; onOpenChange: (open: boolean) => void; item: KnowledgeItem }) {
  const scope = useScope()
  const [value, setValue] = useState<ID | null>(item.projectIds[0] ?? scope)
  useEffect(() => {
    if (open) setValue(item.projectIds[0] ?? scope)
  }, [open, item.projectIds, scope])
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add to project memory"
      description="Project memory is read in every new run of that project."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!value}
            onClick={() => {
              if (value) addToProjectMemory(item.id, value)
              onOpenChange(false)
            }}
          >
            Add to memory
          </Button>
        </>
      }
    >
      <Field label="Project">
        <ProjectPicker value={value} onChange={setValue} allowNone={false} />
      </Field>
    </Dialog>
  )
}

function MissingItem() {
  const navigate = useNavigate()
  return (
    <KnowledgeScreen header={<StageHeader title="Not found" />}>
      <EmptyState
        icon={FileText}
        title="This item isn’t in Knowledge"
        description="It may have been deleted, or the link is wrong. Everything else is still in the library."
        actions={
          <Button variant="primary" onClick={() => navigate('/knowledge')}>
            Back to Knowledge
          </Button>
        }
      />
    </KnowledgeScreen>
  )
}

// ------------------------------------------------------------------------------------------------ reader

function MetaDot() {
  return <span aria-hidden>·</span>
}

/** "Available to AI: Always ▾" — a menu with the three settings and what each does. */
function AvailabilityMenu({ item }: { item: KnowledgeItem }) {
  const value = item.aiAvailability ?? 'always'
  return (
    <Menu
      aria-label="Available to AI"
      items={[
        { type: 'label', label: 'Available to AI' },
        ...AVAILABILITY_OPTIONS.map(
          (o): MenuItem => ({ type: 'radio', id: o.value, label: o.label, description: AVAILABILITY_EFFECT[o.value], checked: value === o.value, onSelect: () => setAvailability(item.id, o.value) }),
        ),
      ]}
      trigger={
        <button type="button" className="inline-flex items-center gap-0.5 rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
          Available to AI: {AI_AVAILABILITY_LABEL[value]}
          <ChevronDown aria-hidden className="size-3" strokeWidth={2} />
        </button>
      }
    />
  )
}

function Reader({ item, onEdit }: { item: KnowledgeItem; onEdit: () => void }) {
  const kind = KNOWLEDGE_KIND_META[item.kind] ?? KNOWLEDGE_KIND_META.note
  const words = useMemo(() => countWords(item.content), [item.content])
  const origin = useDB((s: Tables) => originWords(s, item)?.label)
  const usage = useKnowledgeUsage(item.id)
  const producedBy = useDB((s: Tables) => {
    for (const l of Object.values(s.links)) if (l.rel === 'produced' && l.to.kind === 'knowledge' && l.to.id === item.id && l.from.kind === 'run') return l.from.id
    return undefined
  })
  const run = useRow('runs', producedBy)

  return (
    <article className="flex flex-col gap-6" aria-label={item.title}>
      <header className="flex flex-col gap-3">
        <p className="type-meta flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">
          <span className="text-ink-2">{isImage(item) ? 'Image' : kind.label}</span>
          {origin && (
            <>
              <MetaDot />
              <span>from {origin}</span>
            </>
          )}
          <MetaDot />
          <span className="tabular">
            {words.toLocaleString('en-US')} word{words === 1 ? '' : 's'}
          </span>
          <MetaDot />
          <time dateTime={new Date(item.updatedAt).toISOString()} title={formatDateTime(item.updatedAt)}>
            Updated {timeAgo(item.updatedAt)}
          </time>
          {usage.count > 0 && (
            <>
              <MetaDot />
              <span className="tabular">
                used by {usage.count} run{usage.count === 1 ? '' : 's'}
              </span>
            </>
          )}
          <MetaDot />
          <AvailabilityMenu item={item} />
          {item.simulated && <SimBadge />}
          {!isIndexed(item) && <NotIndexedTag />}
        </p>
        <TagsControl item={item} />
      </header>

      {item.kind === 'link' && item.source.url && <LinkCard url={item.source.url} />}
      {item.file?.previewUrl && isImage(item) && (
        <figure className="flex flex-col gap-2">
          <img src={item.file.previewUrl} alt={item.title} className="max-h-[480px] w-auto max-w-full self-start rounded-md border border-line bg-sunken object-contain" />
          <figcaption className="type-meta text-ink-3">
            Preview stored with the item · {item.file.name} · {formatBytes(item.file.size)}
          </figcaption>
        </figure>
      )}

      <div className={cn('relative min-w-0', item.simulated && 'pl-5')}>
        {item.simulated && <span aria-hidden className="sim-band absolute inset-y-0 left-0 rounded-[1px]" />}
        {item.content.trim() ? (
          <Markdown prose="doc">{item.content}</Markdown>
        ) : (
          <EmptyState
            compact
            icon={PenLine}
            title="This note is empty"
            description="Write something and it becomes searchable and retrievable."
            actions={
              <Button size="sm" variant="secondary" leadingIcon={PenLine} onClick={onEdit}>
                Edit
              </Button>
            }
          />
        )}
        {item.simulated && (
          <ProvenanceLine
            className="mt-4"
            run={run}
            simulated
            modelLabel={run ? undefined : 'Simulator'}
            onViewRun={run ? () => attachRun(run.id, 'knowledge') : undefined}
          />
        )}
      </div>

      <hr className="border-line" />
      <AboutSection item={item} />
      <hr className="border-line" />
      <ConnectionsSection id={item.id} />
    </article>
  )
}

function LinkCard({ url }: { url: string }) {
  let host = url
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    /* keep the raw address */
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-raised px-4 py-3">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="type-body-sm flex min-w-0 items-center gap-2 font-medium text-ink underline decoration-line-input underline-offset-2 hover:decoration-ink"
      >
        <Link2 aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
        <span className="truncate">{host}</span>
        <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={2} />
      </a>
      <p className="type-mono-sm truncate text-ink-3" title={url}>
        {url}
      </p>
      <p className="type-caption text-ink-3">Not fetched — Atrium saved the address and your notes. Open the page to read it.</p>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-8 items-start gap-x-4 gap-y-1 sm:grid-cols-[112px_minmax(0,1fr)]">
      <dt className="type-caption pt-1.5 text-ink-3">{label}</dt>
      <dd className="flex min-w-0 items-center pt-0.5">{children}</dd>
    </div>
  )
}

/** About this item: collection, projects, source (linking to its origin), author, dates, size, Available to AI. */
function AboutSection({ item }: { item: KnowledgeItem }) {
  const author = actorName(item.author)
  const agent = useDB((s: Tables) => (item.author.type === 'agent' ? s.agents[item.author.id] : undefined))
  const integration = item.source.type === 'integration' ? item.source.integrationId : undefined
  return (
    <section aria-labelledby="kn-about" className="flex flex-col gap-3">
      <h3 id="kn-about" className="type-label text-ink-3">
        About
      </h3>
      <dl className="flex flex-col gap-1.5">
        <Row label="Collection">
          <CollectionControl item={item} />
        </Row>
        <Row label="Projects">
          <ProjectsControl item={item} />
        </Row>
        <Row label="Source">
          {item.source.ref ? (
            <EntityChip entity={item.source.ref} showKind />
          ) : integration ? (
            <EntityChip entity={{ kind: 'integration', id: integration }} />
          ) : (
            <span className="type-body-sm text-ink-2">
              {item.source.type === 'upload' ? 'Uploaded from your computer — read locally' : item.source.url ? 'Saved link' : 'Added in Atrium'}
            </span>
          )}
        </Row>
        <Row label="Author">
          {agent ? <EntityChip entity={{ kind: 'agent', id: agent.id }} /> : <span className="type-body-sm text-ink-2">{author}</span>}
        </Row>
        <Row label="Created">
          <span className="type-meta pt-1 text-ink-2">{formatDateTime(item.createdAt)}</span>
        </Row>
        <Row label="Updated">
          <span className="type-meta pt-1 text-ink-2">
            {formatDateTime(item.updatedAt)} · {timeAgo(item.updatedAt)}
          </span>
        </Row>
        {item.file && (
          <Row label="File">
            <span className="type-meta pt-1 text-ink-2">
              {item.file.name} · {formatBytes(item.file.size)} · {item.file.mime}
            </span>
          </Row>
        )}
        <Row label="Handle">
          <span className="type-meta pt-1 text-ink-2">{shortCode(item.id)}</span>
        </Row>
        <Row label="Available to AI">
          <AvailabilityControl item={item} />
        </Row>
      </dl>
    </section>
  )
}
