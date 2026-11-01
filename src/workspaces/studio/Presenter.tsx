import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, NotebookText, X } from 'lucide-react'
import type { Slide } from '@/core/types'
import { cn } from '@/lib/cn'
import { IconButton, Portal, SimBadge, useLayer, useOverlayFocus, useReducedMotion, useScrollLock, type ProceduralSpec } from '@/ui'
import { SlideView } from './previews'

/**
 * Present (§6.8): the deck full screen — the browser's fullscreen when it allows it, otherwise a
 * full-window layer. → / Space / PageDown next, ← / PageUp previous, Home / End, N toggles notes,
 * Esc exits. Tap the right or left half on touch. Controls fade after a moment of stillness.
 */
export interface PresenterProps {
  title: string
  slides: readonly Slide[]
  palette: readonly string[]
  spec?: ProceduralSpec
  start?: number
  simulated: boolean
  onClose: (lastIndex: number) => void
}

export function Presenter({ title, slides, palette, spec, start = 0, simulated, onClose }: PresenterProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(() => Math.max(0, Math.min(slides.length - 1, start)))
  const [notes, setNotes] = useState(false)
  const [idle, setIdle] = useState(false)
  const reduced = useReducedMotion()
  const indexRef = useRef(index)
  indexRef.current = index
  const enteredFullscreen = useRef(false)
  const closing = useRef(false)

  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    onClose(indexRef.current)
  }, [onClose])

  const layerId = useLayer({ open: true, modal: true, inside: [rootRef], onEscape: close })
  useOverlayFocus({ open: true, container: rootRef, trap: true, layerId })
  useScrollLock(true)

  // Ask for the browser's fullscreen; Esc in fullscreen exits it first, which also ends Present.
  useEffect(() => {
    const el = rootRef.current
    if (el?.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => {
          enteredFullscreen.current = true
        })
        .catch(() => {})
    }
    const onChange = () => {
      if (!document.fullscreenElement && enteredFullscreen.current) close()
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [close])

  const go = useCallback((delta: number) => setIndex((i) => Math.max(0, Math.min(slides.length - 1, i + delta))), [slides.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      // Space and Enter on a focused control activate that control.
      if ((e.key === ' ' || e.key === 'Enter') && (e.target as HTMLElement | null)?.closest?.('button')) return
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
          e.preventDefault()
          go(1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          e.preventDefault()
          go(-1)
          break
        case 'Home':
          e.preventDefault()
          setIndex(0)
          break
        case 'End':
          e.preventDefault()
          setIndex(slides.length - 1)
          break
        case 'n':
        case 'N':
          e.preventDefault()
          setNotes((n) => !n)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, slides.length])

  // Controls fade after 2.5s without pointer movement (always visible under reduced motion and on focus).
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), 2500)
    const wake = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), 2500)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  const slide = slides[index]
  if (!slide) return null
  return (
    <Portal>
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Presenting “${title}”`}
        data-layer=""
        data-studio-presenter=""
        tabIndex={-1}
        className="fixed inset-0 z-(--z-overlay) flex flex-col bg-black outline-none"
      >
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            go(e.clientX - rect.left > rect.width / 3 ? 1 : -1)
          }}
        >
          <div style={{ width: `min(100vw, calc((100dvh - ${notes ? 160 : 0}px) * 16 / 9))` }}>
            <SlideView key={slide.id} slide={slide} index={index} total={slides.length} palette={palette} spec={spec} />
          </div>
        </div>
        {notes && (
          <div className="h-[160px] shrink-0 overflow-y-auto border-t border-line bg-chrome px-6 py-4">
            <p className="type-label text-ink-3">Notes · slide {index + 1}</p>
            <p className="type-body mt-1 text-ink-2">{slide.notes?.trim() || 'No speaker notes on this slide.'}</p>
          </div>
        )}
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-4 transition-opacity duration-(--dur-3)',
            idle && !reduced && !notes ? 'opacity-0 focus-within:opacity-100' : 'opacity-100',
          )}
          style={notes ? { bottom: 160 } : undefined}
        >
          <div className="flex items-center gap-1 rounded-md border border-line bg-overlay px-1.5 py-1 shadow-e1">
            {simulated && <SimBadge size="xs" className="mx-1" />}
            <IconButton icon={ChevronLeft} label="Previous slide" shortcut="←" size="sm" onClick={() => go(-1)} disabled={index === 0} />
            <span className="type-meta min-w-14 text-center text-ink-2 tabular" aria-live="polite" aria-atomic="true">
              <span className="sr-only">Slide </span>
              {index + 1} / {slides.length}
              <span className="sr-only">: {slide.title}</span>
            </span>
            <IconButton icon={ChevronRight} label="Next slide" shortcut="→" size="sm" onClick={() => go(1)} disabled={index === slides.length - 1} />
            <span aria-hidden className="mx-1 h-4 w-px bg-line" />
            <IconButton icon={NotebookText} label={notes ? 'Hide notes' : 'Show notes'} shortcut="n" size="sm" active={notes} onClick={() => setNotes((n) => !n)} />
            <IconButton icon={X} label="Exit presentation" shortcut="esc" size="sm" onClick={close} />
          </div>
        </div>
      </div>
    </Portal>
  )
}
