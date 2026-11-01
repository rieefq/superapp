import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowUpRight, ChevronDown, CornerDownLeft, MessageSquare, ScanSearch } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { HoldButton, matchedTerms } from '@/app/components'
import { StageHeader } from '@/app/templates'
import { sendMessage } from '@/core/ai'
import { leadPassage, MAX_CONTEXT_DOCS } from '@/core/ai/chatContext'
import { useContextStore, useScope } from '@/core/context'
import { db, useDB, type Tables } from '@/core/db'
import { highlightText, retrieveKnowledge, search, warmSearchIndex } from '@/core/search'
import { UNSCOPED_ITEM_FACTOR } from '@/core/search/retrieval'
import { AI_AVAILABILITY_LABEL, plainText, usageOf } from '@/core/services'
import { useSettings } from '@/core/settings'
import type { ID, KnowledgeItem } from '@/core/types'
import { Button, EmptyState, HUE_FILL, Input, Kbd, Menu, TickMeter, Tooltip, toast, type MenuItem } from '@/ui'
import { cn } from '@/lib/cn'
import { Highlight, KnowledgeTile } from './parts'
import { KnowledgeScreen, usePhone } from './screen'

/**
 * Retrieval lab: "What would the AI retrieve?" Runs the same local retrieval a chat turn uses (BM25 over
 * ~700-character passages, project scoping, Available to AI) for a question and shows the passages with
 * their scores — held and project-memory items first, then retrieved ones, capped like a chat turn.
 * Nothing is sent to a model.
 */

export type LabReason = 'held' | 'memory' | 'retrieved'

export interface LabEntry {
  item: KnowledgeItem
  passage: string
  /** BM25 score; null for held/memory items with no matching passage (their opening is read instead). */
  score: number | null
  reason: LabReason
}

export interface LabResult {
  read: LabEntry[]
  /** Next best passages that a chat turn would not read (beyond the cap). */
  beyond: LabEntry[]
  /** Matching items that are never read automatically (Available to AI: Never / When cited). */
  withheld: KnowledgeItem[]
  /** Items retrieval could consider in this scope. */
  eligible: number
  ms: number
}

const BEYOND = 4

/** Pure: what a new chat turn would read for `question` (mirrors the chat context assembly). */
export function runRetrievalLab(
  question: string,
  opts: { projectId: ID | null; held: readonly ID[]; memory: readonly ID[]; autoRetrieve: boolean },
): LabResult {
  const t0 = performance.now()
  const q = question.trim()
  const knowledge = db.all('knowledge')
  const eligible = knowledge.filter(
    (k) => k.aiAvailability !== 'never' && (!opts.projectId || !k.projectIds.length || k.projectIds.includes(opts.projectId)),
  ).length
  if (!q) return { read: [], beyond: [], withheld: [], eligible, ms: 0 }

  const explicitIds = [...new Set([...opts.held, ...opts.memory])].filter((id) => {
    const k = db.get('knowledge', id)
    return !!k && k.aiAvailability !== 'never'
  })
  const explicitHits = explicitIds.length ? retrieveKnowledge(q, { ids: explicitIds, limit: explicitIds.length }) : []
  const explicit: LabEntry[] = explicitIds.map((id) => {
    const hit = explicitHits.find((h) => h.item.id === id)
    const item = hit?.item ?? db.get('knowledge', id)!
    return { item, passage: hit?.passage.trim() || leadPassage(item), score: hit?.score ?? null, reason: opts.held.includes(id) ? 'held' : 'memory' }
  })
  const taken = new Set(explicitIds)
  const auto: LabEntry[] = opts.autoRetrieve
    ? retrieveKnowledge(q, { projectId: opts.projectId, limit: MAX_CONTEXT_DOCS + BEYOND + explicitIds.length })
        .filter((r) => !taken.has(r.item.id) && r.passage.trim())
        .map((r) => ({ item: r.item, passage: r.passage.trim(), score: r.score, reason: 'retrieved' as const }))
    : []
  const all = [...explicit, ...auto]
  const shown = new Set(all.map((e) => e.item.id))
  const withheld = search(q, { kinds: ['knowledge'], limit: 40 })
    .map((r) => db.get('knowledge', r.ref.id))
    .filter((k): k is KnowledgeItem => !!k && !shown.has(k.id) && (k.aiAvailability === 'never' || k.aiAvailability === 'cited'))
    .slice(0, 5)
  return {
    read: all.slice(0, MAX_CONTEXT_DOCS),
    beyond: all.slice(MAX_CONTEXT_DOCS, MAX_CONTEXT_DOCS + BEYOND),
    withheld,
    eligible,
    ms: performance.now() - t0,
  }
}

const REASON_LABEL: Record<LabReason, string> = {
  held: 'Held',
  memory: 'Project memory',
  retrieved: 'Retrieved',
}

function ResultEntry({ entry, rank, top, question, dim }: { entry: LabEntry; rank: number; top: number; question: string; dim?: boolean }) {
  const navigate = useNavigate()
  const meta = useDB((s: Tables) => {
    const c = entry.item.collectionId ? s.collections[entry.item.collectionId]?.name : undefined
    const p = entry.item.projectIds.map((id) => s.projects[id]?.name).filter(Boolean).join(', ')
    return [c, p].filter(Boolean).join(' · ')
  })
  const text = useMemo(() => {
    const plain = plainText(entry.passage).replace(/\n{2,}/g, '\n').trim()
    return plain.length > 640 ? `${plain.slice(0, 639).trimEnd()}…` : plain
  }, [entry.passage])
  const ranges = useMemo(() => highlightText(text, question), [text, question])
  const terms = useMemo(() => matchedTerms(text, ranges, 4), [text, ranges])
  return (
    <li className={cn('group/lab relative grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 gap-y-2 py-4', dim && 'opacity-60')}>
      <span className="type-meta pt-0.5 text-right text-ink-3 tabular">{rank}</span>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <KnowledgeTile item={entry.item} size={18} />
          <button
            type="button"
            onClick={() => navigate(`/knowledge/${encodeURIComponent(entry.item.id)}`)}
            className="type-body-sm min-w-0 truncate text-left font-semibold text-ink hover:underline hover:decoration-line-input hover:underline-offset-2"
          >
            {entry.item.title}
          </button>
          <span className="type-meta shrink-0 rounded-xs border border-line px-1 text-ink-3">{REASON_LABEL[entry.reason]}</span>
          <span className="flex-1" />
          <span className="flex shrink-0 items-center gap-2">
            {entry.score === null ? (
              <Tooltip content="No passage matched the question, so the item’s opening is read instead.">
                <span className="type-meta text-ink-3">no match · opening read</span>
              </Tooltip>
            ) : (
              <>
                <span className="type-meta text-ink-2 tabular" aria-label={`Score ${entry.score.toFixed(1)}`}>
                  {entry.score.toFixed(1)}
                </span>
                <TickMeter value={entry.score} max={top || 1} width={64} label="Score relative to the top passage" thresholds={{ attn: 9, fail: 9 }} />
              </>
            )}
          </span>
        </div>
        {meta && <p className="type-meta -mt-1 truncate text-ink-3">{meta}</p>}
        <blockquote className="type-body-sm border-l-2 border-line-strong pl-3 whitespace-pre-line text-pretty text-ink-2">
          <Highlight text={text} ranges={ranges} />
        </blockquote>
        <div className="flex flex-wrap items-center gap-2">
          {terms.length > 0 && <span className="type-meta text-ink-3">Matches: {terms.join(', ')}</span>}
          <span className="flex-1" />
          <span className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover/lab:opacity-100 md:group-focus-within/lab:opacity-100">
            <HoldButton entity={{ kind: 'knowledge', id: entry.item.id }} size="xs" />
            <Button size="xs" variant="ghost" leadingIcon={ArrowUpRight} onClick={() => navigate(`/knowledge/${encodeURIComponent(entry.item.id)}`)}>
              Open
            </Button>
          </span>
        </div>
      </div>
    </li>
  )
}

/** Three example questions from the most-used items' topics (distinct). */
function exampleQuestions(s: Tables): string[] {
  const ranked = Object.values(s.knowledge)
    .filter((k) => k.aiAvailability !== 'never' && k.tags.length)
    .map((k) => ({ k, n: usageOf(s.runs, k.id).runIds.length }))
    .sort((a, b) => b.n - a.n || b.k.updatedAt - a.k.updatedAt)
  const out: string[] = []
  for (const { k } of ranked) {
    const topic = k.tags.find((t) => !out.some((q) => q.includes(t.replace(/-/g, ' '))))
    if (!topic) continue
    out.push(`What do we know about ${topic.replace(/-/g, ' ')}?`)
    if (out.length === 3) break
  }
  return out
}

/** "In All work ▾" — the project retrieval is scoped to (a project's items rank first; others are left out). */
function ScopeMenu({ value, onChange }: { value: ID | null; onChange: (id: ID | null) => void }) {
  const projects = useDB(useShallow((s: Tables) => Object.values(s.projects).filter((p) => p.status === 'active' || p.status === 'paused' || p.id === value).sort((a, b) => a.name.localeCompare(b.name))))
  const current = projects.find((p) => p.id === value)
  return (
    <Menu
      aria-label="Scope retrieval to a project"
      items={[
        { type: 'label', label: 'Retrieve for' },
        { type: 'radio', id: 'all', label: 'All work', description: 'Every item, no project ranking', checked: !value, onSelect: () => onChange(null) },
        ...projects.map((p): MenuItem => ({ type: 'radio', id: p.id, label: p.name, checked: value === p.id, onSelect: () => onChange(p.id) })),
      ]}
      trigger={
        <Button size="xs" variant="ghost" trailingIcon={ChevronDown} className="text-ink-2">
          {current ? (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={cn('size-2.5 rounded-[3px]', HUE_FILL[current.hue])} />
              {current.name}
            </span>
          ) : (
            'All work'
          )}
        </Button>
      }
    />
  )
}

export function RetrievalLab() {
  const navigate = useNavigate()
  const phone = usePhone()
  const [params, setParams] = useSearchParams()
  const scope = useScope()
  const [projectId, setProjectId] = useState<ID | null>(scope)
  const autoRetrieve = useSettings((s) => s.ai.autoRetrieve)
  const pinned = useContextStore((s) => s.pinned)
  const knowledge = useDB((s: Tables) => s.knowledge)
  const project = useDB((s: Tables) => (projectId ? s.projects[projectId] : undefined))
  const examples = useDB((s: Tables) => exampleQuestions(s).join('\n')).split('\n').filter(Boolean)
  const [draft, setDraft] = useState(params.get('q') ?? '')
  const [question, setQuestion] = useState(draft)

  useEffect(() => warmSearchIndex(), [])
  // Live, debounced; the URL keeps the question (replace — typing is not history).
  useEffect(() => {
    const t = setTimeout(() => {
      setQuestion(draft)
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (draft.trim()) next.set('q', draft)
          else next.delete('q')
          return next
        },
        { replace: true },
      )
    }, 220)
    return () => clearTimeout(t)
  }, [draft, setParams])

  const held = useMemo(() => pinned.filter((p) => p.ref.kind === 'knowledge').map((p) => p.ref.id), [pinned])
  const memory = useMemo(() => (project ? project.pinnedRefs.filter((r) => r.kind === 'knowledge').map((r) => r.id) : []), [project])
  const result = useMemo(
    () => runRetrievalLab(question, { projectId, held, memory, autoRetrieve }),
    // `knowledge` re-runs the lab when items change.
    [question, projectId, held, memory, autoRetrieve, knowledge], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const top = Math.max(0, ...[...result.read, ...result.beyond].map((e) => e.score ?? 0))
  const q = question.trim()

  const ask = async () => {
    if (!q) return
    try {
      const retrievedRefs = result.read.filter((e) => e.reason === 'retrieved').map((e) => ({ kind: 'knowledge' as const, id: e.item.id }))
      const res = await sendMessage({ text: q, projectId, retrievedRefs })
      navigate(`/chat/${encodeURIComponent(res.threadId)}`)
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t start the conversation', description: err instanceof Error ? err.message : String(err) })
    }
  }

  const header = <StageHeader title="Retrieval lab" leading={<ScanSearch aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />} hideInspectorToggle={phone} />

  return (
    <KnowledgeScreen header={header} measure={880}>
      <div className="flex flex-col gap-6">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setQuestion(draft)
          }}
        >
          <div className="flex flex-col gap-1">
            <h2 className="type-title-2 text-ink">What would the AI retrieve?</h2>
            <p className="type-body-sm text-pretty text-ink-2">
              Ask a question and see the passages a new chat turn would read, with their scores. This runs the same local retrieval every composer uses — nothing is sent to a model.
            </p>
          </div>
          <Input
            size="lg"
            icon={ScanSearch}
            value={draft}
            onValueChange={setDraft}
            placeholder="Ask a question…"
            aria-label="Question"
            autoFocus={!phone}
            data-search-input
            suffix={<Kbd className="pointer-coarse:hidden">⏎</Kbd>}
          />
          <div className="type-caption flex flex-wrap items-center gap-x-3 gap-y-2 text-ink-3">
            <span className="flex items-center gap-1.5">
              In
              <ScopeMenu value={projectId} onChange={setProjectId} />
            </span>
            <span aria-hidden>·</span>
            <span>{held.length ? `${held.length} held item${held.length === 1 ? '' : 's'} ride along` : 'Nothing held'}</span>
            <span aria-hidden>·</span>
            <span>
              Auto-retrieve {autoRetrieve ? 'on' : 'off'}
              {!autoRetrieve && ' — only held and project-memory items are read'}
            </span>
          </div>
        </form>

        {!q ? (
          <div className="flex flex-col gap-4 rounded-md border border-line px-5 py-5">
            <p className="type-body-sm text-ink-2">
              Retrieval can draw on <span className="text-ink tabular">{result.eligible}</span> item{result.eligible === 1 ? '' : 's'}
              {project ? ` in ${project.name} (and items without a project)` : ''}. Try:
            </p>
            <div className="flex flex-wrap gap-2">
              {examples.map((ex) => (
                <Button key={ex} size="sm" variant="secondary" leadingIcon={CornerDownLeft} onClick={() => setDraft(ex)}>
                  {ex}
                </Button>
              ))}
            </div>
            <HowItWorks project={project?.name} />
          </div>
        ) : result.read.length === 0 ? (
          <EmptyState
            icon={ScanSearch}
            title="Nothing would be retrieved"
            description={`No passage in Knowledge matches “${q}”${project ? ` in ${project.name}` : ''}. The answer would draw only on the conversation itself.`}
          />
        ) : (
          <section aria-labelledby="lab-read" className="flex flex-col">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line pb-2">
              <h3 id="lab-read" className="type-label text-ink-3">
                A chat turn would read
              </h3>
              <span className="type-meta text-ink-3 tabular" role="status">
                {result.read.length} passage{result.read.length === 1 ? '' : 's'} · {result.eligible} items eligible · {result.ms < 1 ? '<1' : result.ms.toFixed(0)} ms
              </span>
              <span className="flex-1" />
              <Button size="sm" variant="secondary" leadingIcon={MessageSquare} onClick={() => void ask()}>
                Ask this in Chat
              </Button>
            </div>
            <ol className="flex flex-col divide-y divide-line">
              {result.read.map((e, i) => (
                <ResultEntry key={e.item.id} entry={e} rank={i + 1} top={top} question={q} />
              ))}
            </ol>
            {result.beyond.length > 0 && (
              <>
                <h3 className="type-label border-y border-line py-2 text-ink-3">
                  Next best — beyond the {MAX_CONTEXT_DOCS}-passage limit of a chat turn
                </h3>
                <ol className="flex flex-col divide-y divide-line">
                  {result.beyond.map((e, i) => (
                    <ResultEntry key={e.item.id} entry={e} rank={MAX_CONTEXT_DOCS + i + 1} top={top} question={q} dim />
                  ))}
                </ol>
              </>
            )}
          </section>
        )}

        {q && result.withheld.length > 0 && (
          <section aria-labelledby="lab-withheld" className="flex flex-col gap-2">
            <h3 id="lab-withheld" className="type-label text-ink-3">
              Also matches — not read automatically
            </h3>
            <ul className="flex flex-col">
              {result.withheld.map((k) => (
                <li key={k.id} className="flex min-h-9 items-center gap-2.5 py-1">
                  <KnowledgeTile item={k} size={18} />
                  <button type="button" onClick={() => navigate(`/knowledge/${encodeURIComponent(k.id)}`)} className="type-body-sm min-w-0 truncate text-left text-ink-2 hover:text-ink">
                    {k.title}
                  </button>
                  <span className="type-meta shrink-0 text-ink-3">Available to AI: {AI_AVAILABILITY_LABEL[k.aiAvailability ?? 'always']}</span>
                  <span className="flex-1" />
                  {k.aiAvailability === 'cited' && <HoldButton entity={{ kind: 'knowledge', id: k.id }} size="xs" />}
                </li>
              ))}
            </ul>
            <p className="type-caption text-ink-3">“When cited” items are read only when held, attached or @-mentioned. “Never” items are never read.</p>
          </section>
        )}

        {q && result.read.length > 0 && <HowItWorks project={project?.name} />}
      </div>
    </KnowledgeScreen>
  )
}

function HowItWorks({ project }: { project?: string }) {
  return (
    <details className="group/how rounded-md border border-line px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
      <summary className="type-body-sm flex cursor-pointer list-none items-center gap-2 font-medium text-ink-2 hover:text-ink">
        <span aria-hidden className="type-meta text-ink-3 transition-transform duration-(--dur-2) group-open/how:rotate-90">
          ›
        </span>
        How retrieval works
      </summary>
      <ul className="type-body-sm mt-3 flex list-disc flex-col gap-1.5 pl-5 text-pretty text-ink-2 marker:text-ink-4">
        <li>Every item is split into passages of about 700 characters and ranked with BM25 over its text, title and tags — in your browser.</li>
        <li>
          Held items and the project’s memory are read first. Then the best-matching passages, up to {MAX_CONTEXT_DOCS} per chat turn.
        </li>
        <li>
          {project ? `In ${project}, its` : 'In a project, its'} items rank normally, items without a project count at {Math.round(UNSCOPED_ITEM_FACTOR * 100)}%, and other projects’ items are left out.
        </li>
        <li>Available to AI decides the rest: “When cited” items are read only when you hold, attach or @-mention them; “Never” items are never read.</li>
        <li>After a run, its Saw list shows exactly what it read, and each item counts the runs that used it.</li>
      </ul>
    </details>
  )
}
