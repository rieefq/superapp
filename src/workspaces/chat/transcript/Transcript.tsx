import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowDown } from 'lucide-react'
import { SelectionActions, useDerived, type DerivedItem } from '@/app/components'
import { announce } from '@/app/shell/Announcer'
import { useInspectEntity } from '@/app/templates'
import { useIsGenerating } from '@/core/ai'
import { useDB, type Tables } from '@/core/db'
import { refKey, type EntityRef, type ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/ui'
import { placeAfterMessages } from '../logic/commands'
import { draftKey, useChatUi } from '../state'
import { useLiveLocation } from '../useLiveLocation'
import { DerivedItemView } from './parts'
import { Turn } from './Turns'

/**
 * The transcript (§6.2): turns in order, items made from the conversation in time order, the
 * selection toolbar, `?m=` scroll-and-highlight, and stick-to-bottom while an answer streams
 * (auto-scroll pauses when you scroll up; "Jump to latest" brings you back). Grows downward only.
 */

const NO_IDS: ID[] = []

export const Transcript = memo(function Transcript({ threadId }: { threadId: ID }) {
  const ids = useDB((s: Tables) => s.threads[threadId]?.messageIds) ?? NO_IDS
  const roles = useDB(useShallow((s: Tables) => ids.map((id) => s.messages[id]?.role ?? 'user')))
  const times = useDB(useShallow((s: Tables) => ids.map((id) => s.messages[id]?.createdAt ?? 0)))
  const busy = useIsGenerating(threadId)
  const contentRef = useRef<HTMLDivElement>(null)
  const { away, jump, release } = useStickToBottom(contentRef, threadId)
  const reduced = useReducedMotion()

  const lastAnswer = lastIndexOf(roles, 'assistant')
  const lastPrompt = lastIndexOf(roles, 'user')

  // "Answer complete" for screen readers when a reply finishes (the token stream is never announced).
  const wasBusy = useRef(busy)
  useEffect(() => {
    if (wasBusy.current && !busy) announce('Answer complete')
    wasBusy.current = busy
  }, [busy])

  // Work made from the conversation itself, placed after the message it followed.
  const made = useMadeFromThread(threadId)
  const placed = useMemo(
    () =>
      placeAfterMessages(
        ids.map((id, i) => ({ id, createdAt: times[i] })),
        made,
      ),
    [ids, times, made],
  )

  useHighlightFromUrl(contentRef, threadId, release)

  // The selection toolbar acts on the message the selection starts in.
  const selectionSource = useSelectionSource(contentRef)
  const askFollowUp = useCallback(
    (text: string) => {
      const quoted = text
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')
      const ui = useChatUi.getState()
      const key = draftKey(threadId)
      const current = ui.drafts[key] ?? ''
      ui.setDraft(key, `${quoted}\n\n${current}`.replace(/\n{3,}$/, '\n\n'))
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLTextAreaElement>('#main [data-composer-input]')
        input?.focus()
        input?.setSelectionRange(input.value.length, input.value.length)
      })
    },
    [threadId],
  )

  // J/K or ↓/↑ move between turns while a turn has focus; Space inspects it.
  const inspect = useInspectEntity()
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName !== 'ARTICLE' || e.metaKey || e.ctrlKey || e.altKey) return
    const turns = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('article[data-message-id]') ?? [])
    const i = turns.indexOf(target)
    const move = (to: number) => {
      const el = turns[Math.max(0, Math.min(turns.length - 1, to))]
      el?.focus({ preventScroll: true })
      el?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
    }
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault()
      move(i + 1)
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(i - 1)
    } else if (e.key === ' ') {
      e.preventDefault()
      const id = target.getAttribute('data-message-id')
      if (id) inspect({ kind: 'message', id })
    }
  }

  return (
    <div
      ref={contentRef}
      onKeyDown={onKeyDown}
      aria-label="Conversation"
      aria-busy={busy || undefined}
      className="@container relative flex flex-1 flex-col pb-2"
    >
      {placed.get('')?.length ? <PlacedItems items={placed.get('')!} /> : null}
      {ids.map((id, i) => (
        <Turn key={id} id={id} threadId={threadId} isLastAnswer={i === lastAnswer} isLastPrompt={i === lastPrompt} busy={busy} after={placed.get(id)} />
      ))}
      {selectionSource && <SelectionActions containerRef={contentRef} source={selectionSource} onAsk={askFollowUp} aria-label="Selected text" />}
      <div className={cn('pointer-events-none sticky bottom-3 z-(--z-sticky) mt-auto flex justify-center transition-opacity duration-(--dur-2)', away ? 'opacity-100' : 'opacity-0')}>
        <button
          type="button"
          tabIndex={away ? 0 : -1}
          aria-hidden={!away}
          onClick={jump}
          className={cn(
            'type-caption inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong bg-overlay pr-3 pl-2 font-medium text-ink-2 shadow-e1 transition-colors duration-(--dur-1) hover:text-ink',
            away && 'pointer-events-auto',
          )}
        >
          <ArrowDown aria-hidden className="size-3.5" strokeWidth={1.75} />
          {busy ? 'Jump to latest · writing' : 'Jump to latest'}
        </button>
      </div>
    </div>
  )
})

function lastIndexOf<T>(list: readonly T[], value: T): number {
  for (let i = list.length - 1; i >= 0; i--) if (list[i] === value) return i
  return -1
}

function PlacedItems({ items }: { items: readonly DerivedItem[] }) {
  return (
    <div className="mb-6 flex flex-col gap-1.5 @min-[600px]:ml-[72px]">
      {items.map((item) => (
        <DerivedItemView key={refKey(item.ref)} item={item} />
      ))}
    </div>
  )
}


// ------------------------------------------------------------------------------------------------ made from the thread

interface PlacedDerived extends DerivedItem {
  at: number
}

/** Things made from the conversation as a whole, with when they were made. */
function useMadeFromThread(threadId: ID): PlacedDerived[] {
  const source = useMemo<EntityRef>(() => ({ kind: 'thread', id: threadId }), [threadId])
  const all = useDerived(source)
  // The conversation's own chat turns are runs that point back at it; they are the transcript, not work made from it.
  const items = useMemo(() => all.filter((i) => !(i.ref.kind === 'run' && i.run?.kind === 'chat')), [all])
  const keys = useMemo(() => items.map((i) => refKey(i.ref)), [items])
  const times = useDB(
    useShallow((s: Tables) =>
      keys.map((key) => {
        for (const l of Object.values(s.links)) {
          if (l.rel === 'derived_from' && l.to.kind === 'thread' && l.to.id === threadId && refKey(l.from) === key) return l.createdAt
        }
        return 0
      }),
    ),
  )
  return useMemo(() => items.map((item, i) => ({ ...item, at: item.run?.createdAt ?? times[i] ?? 0 })), [items, times])
}

// ------------------------------------------------------------------------------------------------ scrolling

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

const STICK_GAP = 72
const AWAY_GAP = 320

/**
 * Keep the newest text in view while it streams, unless you scrolled up to read (then a "Jump to
 * latest" chip appears). Opening a thread starts at the bottom.
 */
function useStickToBottom(contentRef: RefObject<HTMLDivElement | null>, resetKey: string) {
  const stick = useRef(true)
  const [away, setAway] = useState(false)
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    const scroller = scrollParent(contentRef.current)
    if (!scroller) return
    stick.current = true
    setAway(false)
    scroller.scrollTop = scroller.scrollHeight
  }, [contentRef, resetKey])

  useEffect(() => {
    const content = contentRef.current
    const scroller = scrollParent(content)
    if (!content || !scroller) return
    const onScroll = () => {
      const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      stick.current = gap < STICK_GAP
      setAway(gap > AWAY_GAP)
    }
    const ro = new ResizeObserver(() => {
      if (stick.current) scroller.scrollTop = scroller.scrollHeight
      else onScroll()
    })
    ro.observe(content)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    // A message sent from the composer always brings the latest into view.
    const unsub = useDB.subscribe((s, prev) => {
      const ids = s.threads[resetKey]?.messageIds
      const before = prev.threads[resetKey]?.messageIds
      if (ids && before && ids.length > before.length) stick.current = true
    })
    return () => {
      ro.disconnect()
      scroller.removeEventListener('scroll', onScroll)
      unsub()
    }
  }, [contentRef, resetKey])

  const jump = useCallback(() => {
    const scroller = scrollParent(contentRef.current)
    if (!scroller) return
    stick.current = true
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }, [contentRef, reduced])

  /** Stop following the bottom (e.g. before scrolling to a linked message). */
  const release = useCallback(() => {
    stick.current = false
  }, [])

  return { away, jump, release }
}

/** `?m=<message>`: scroll to it and highlight it once (§2.6). */
function useHighlightFromUrl(contentRef: RefObject<HTMLDivElement | null>, threadId: ID, release: () => void) {
  const target = new URLSearchParams(useLiveLocation().search).get('m')
  const setHighlight = useChatUi((s) => s.setHighlight)
  useEffect(() => {
    if (!target) return
    const el = contentRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(target)}"]`)
    if (!el) return
    release()
    const frame = requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center' })
      setHighlight(target)
    })
    const timer = setTimeout(() => setHighlight(null), 2600)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [target, threadId, contentRef, setHighlight, release])
}

/** The message a text selection starts in (the selection toolbar's source). */
function useSelectionSource(contentRef: RefObject<HTMLDivElement | null>): EntityRef | null {
  const [id, setId] = useState<ID | null>(null)
  useEffect(() => {
    const onChange = () => {
      const sel = window.getSelection()
      const node = sel && !sel.isCollapsed ? sel.anchorNode : null
      const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null
      const turn = el && contentRef.current?.contains(el) ? el.closest('[data-message-id]') : null
      const next = turn?.getAttribute('data-message-id') ?? null
      if (next) setId(next)
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [contentRef])
  return useMemo(() => (id ? { kind: 'message', id } : null), [id])
}
