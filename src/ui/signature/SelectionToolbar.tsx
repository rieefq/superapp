import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCopy, useReducedMotion } from '@/ui/hooks'
import { Portal, floatingMotion } from '@/ui/primitives'

export interface SelectionAction {
  id: string
  label: string
  icon?: LucideIcon
  /** Receives the selected text (trimmed) and the live range. */
  onSelect: (text: string, range: Range) => void
}

export interface SelectionToolbarProps {
  /** Only selections inside this element show the toolbar (a transcript, report or document). */
  containerRef: RefObject<HTMLElement | null>
  /** Ask about this · Research · Make task · Save snippet … (Copy is appended unless `copy={false}`). */
  actions: readonly SelectionAction[]
  copy?: boolean
  /** ms after the selection settles (default 150). */
  delay?: number
  /** Minimum selected characters (default 2). */
  minLength?: number
  'aria-label'?: string
}

interface Anchor {
  text: string
  range: Range
  rect: { top: number; bottom: number; left: number; width: number }
}

const GAP = 8
const EDGE = 8

function readSelection(container: HTMLElement | null, minLength: number): Anchor | null {
  const sel = typeof window === 'undefined' ? null : window.getSelection()
  if (!container || !sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const text = sel.toString().trim()
  if (text.length < minLength) return null
  const rects = range.getClientRects()
  const first = rects[0] ?? range.getBoundingClientRect()
  const box = range.getBoundingClientRect()
  return { text, range, rect: { top: first.top, bottom: box.bottom, left: box.left, width: box.width } }
}

/**
 * A 32px toolbar that appears 150ms after text is selected inside `containerRef` (docs/DESIGN.md §5.4.15),
 * above the selection (below when there is no room). Presentational: actions are passed in.
 * Clicking keeps the selection; Shift+F10 (or the Menu key) moves focus into it; ←/→ move between
 * actions; Escape dismisses.
 */
export function SelectionToolbar({ containerRef, actions, copy = true, delay = 150, minLength = 2, ...aria }: SelectionToolbarProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const reduced = useReducedMotion()
  const { copy: copyText, copied } = useCopy(1200)

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setAnchor(null)
  }, [])

  useEffect(() => {
    const onChange = () => {
      clearTimeout(timer.current)
      const next = readSelection(containerRef.current, minLength)
      if (!next) {
        // Focus inside the toolbar keeps it open (keyboard use); otherwise it goes away.
        if (!barRef.current?.contains(document.activeElement)) setAnchor(null)
        return
      }
      timer.current = setTimeout(() => setAnchor(readSelection(containerRef.current, minLength)), delay)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      document.removeEventListener('selectionchange', onChange)
      clearTimeout(timer.current)
    }
  }, [containerRef, delay, minLength])

  // Follow the selection on scroll and resize; Escape dismisses.
  useEffect(() => {
    if (!anchor) return
    const reread = () => setAnchor((a) => (a ? (readSelection(containerRef.current, minLength) ?? null) : a))
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') hide()
      // Keyboard path to the actions: Shift+F10 or the Menu key (the platform's context-menu keys).
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
        e.preventDefault()
        barRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    window.addEventListener('scroll', reread, true)
    window.addEventListener('resize', reread)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', reread, true)
      window.removeEventListener('resize', reread)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, containerRef, minLength, hide])

  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null)
      return
    }
    const el = barRef.current
    const w = el?.offsetWidth ?? 0
    const h = el?.offsetHeight ?? 32
    const above = anchor.rect.top - h - GAP
    const top = above >= EDGE ? above : anchor.rect.bottom + GAP
    const left = Math.min(Math.max(EDGE, anchor.rect.left + anchor.rect.width / 2 - w / 2), window.innerWidth - w - EDGE)
    setPos({ top, left })
  }, [anchor])

  const all: SelectionAction[] = copy
    ? [
        ...actions,
        {
          id: 'copy',
          label: copied ? 'Copied' : 'Copy',
          icon: copied ? Check : Copy,
          onSelect: (text) => void copyText(text),
        },
      ]
    : [...actions]

  const run = (action: SelectionAction) => {
    const current = readSelection(containerRef.current, minLength) ?? anchor
    if (!current) return
    action.onSelect(current.text, current.range)
    if (action.id !== 'copy') hide()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(barRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]
      next?.focus()
    }
  }

  const preset = floatingMotion('top', reduced)
  return (
    <AnimatePresence>
      {anchor && (
        <Portal>
          <motion.div
            ref={barRef}
            role="toolbar"
            aria-label={aria['aria-label'] ?? 'Selection actions'}
            aria-orientation="horizontal"
            aria-keyshortcuts="Shift+F10"
            initial={preset.initial}
            animate={preset.animate}
            exit={preset.exit}
            transition={preset.transition}
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={onKeyDown}
            className={cn(
              'fixed top-0 left-0 z-(--z-popover) flex h-8 items-center gap-0.5 rounded-sm border border-line bg-overlay px-0.5 shadow-e1',
              !pos && 'invisible',
            )}
            style={pos ? { top: pos.top, left: pos.left } : undefined}
          >
            {all.map((a, i) => {
              const Icon = a.icon
              return (
                <button
                  key={a.id}
                  type="button"
                  tabIndex={i === 0 ? 0 : -1}
                  onClick={() => run(a)}
                  className={cn(
                    'type-caption inline-flex h-7 shrink-0 items-center gap-1.5 rounded-xs px-2 font-medium text-ink-2 transition-colors duration-(--dur-1) ease-standard',
                    'hover:bg-hover hover:text-ink active:bg-press focus-visible:outline-offset-0 pointer-coarse:h-10',
                  )}
                >
                  {Icon && <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />}
                  {a.label}
                </button>
              )
            })}
          </motion.div>
        </Portal>
      )}
    </AnimatePresence>
  )
}
