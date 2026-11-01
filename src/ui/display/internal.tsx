/**
 * Internal building blocks shared by the display, chart and art tracks. Not exported from
 * the public barrel (A1's primitives own the public Button/Tooltip/Spinner API).
 */
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import './display.css'

/* ------------------------------------------------------------------------------------------ */
/* Clipboard                                                                                  */
/* ------------------------------------------------------------------------------------------ */

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** Copy text; `copied` flips true for a moment after success. */
export function useCopy(resetMs = 1600) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = useCallback(
    async (text: string) => {
      const ok = await writeClipboard(text)
      if (!ok) return false
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), resetMs)
      return true
    },
    [resetMs],
  )
  return { copied, copy }
}

/* ------------------------------------------------------------------------------------------ */
/* Tool button (quiet, text-or-icon)                                                          */
/* ------------------------------------------------------------------------------------------ */

export interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode
  /** Accessible name. Shown as text unless `iconOnly`. */
  label: string
  iconOnly?: boolean
  pressed?: boolean
  size?: 'sm' | 'md'
}

/** Quiet ghost button used inside component headers (copy, wrap, view toggles). */
export function ToolButton({ icon, label, iconOnly, pressed, size = 'sm', className, children, ...props }: ToolButtonProps) {
  const btn = (
    <button
      type="button"
      aria-label={iconOnly ? label : undefined}
      aria-pressed={pressed}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm font-sans text-ink-3 select-none',
        'transition-[background-color,color] duration-(--dur-1) ease-settle',
        'hover:bg-hover hover:text-ink active:bg-press disabled:pointer-events-none disabled:opacity-40',
        'aria-pressed:bg-hover aria-pressed:text-ink',
        size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
        iconOnly ? (size === 'sm' ? 'w-7' : 'w-8') : 'px-2',
        'pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        '[&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {icon}
      {!iconOnly && <span>{children ?? label}</span>}
    </button>
  )
  return iconOnly ? <Tip content={label}>{btn}</Tip> : btn
}

/* ------------------------------------------------------------------------------------------ */
/* Tooltip (portal, fixed position, flips and clamps to the viewport)                         */
/* ------------------------------------------------------------------------------------------ */

type TipChildProps = {
  onPointerEnter?: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave?: (e: ReactPointerEvent<HTMLElement>) => void
  onFocus?: (e: FocusEvent<HTMLElement>) => void
  onBlur?: (e: FocusEvent<HTMLElement>) => void
  'aria-describedby'?: string
}

export interface TipProps {
  content: ReactNode
  children: ReactElement<TipChildProps>
  delay?: number
  side?: 'top' | 'bottom'
  /** Extra classes for the bubble (e.g. width). */
  className?: string
  /** Link the bubble as the trigger's description (off when the label already says it). */
  describe?: boolean
}

export function Tip({ content, children, delay = 380, side = 'top', className, describe = false }: TipProps) {
  const id = useId()
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (!anchor) return
    const hide = () => setAnchor(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchor])

  const p = children.props
  const trigger = cloneElement(children, {
    'aria-describedby': describe ? cn(p['aria-describedby'], anchor ? id : undefined) || undefined : p['aria-describedby'],
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => {
      p.onPointerEnter?.(e)
      if (e.pointerType === 'touch') return
      const el = e.currentTarget
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setAnchor(el.getBoundingClientRect()), delay)
    },
    onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => {
      p.onPointerLeave?.(e)
      window.clearTimeout(timer.current)
      setAnchor(null)
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      p.onFocus?.(e)
      if (e.currentTarget.matches(':focus-visible')) setAnchor(e.currentTarget.getBoundingClientRect())
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      p.onBlur?.(e)
      window.clearTimeout(timer.current)
      setAnchor(null)
    },
  })
  return (
    <>
      {trigger}
      {anchor && content != null && createPortal(<TipBubble id={id} anchor={anchor} side={side} className={className}>{content}</TipBubble>, document.body)}
    </>
  )
}

function TipBubble({ id, anchor, side, className, children }: { id: string; anchor: DOMRect; side: 'top' | 'bottom'; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const gap = 6
    let y = side === 'top' ? anchor.top - h - gap : anchor.bottom + gap
    if (side === 'top' && y < 4) y = anchor.bottom + gap
    if (side === 'bottom' && y + h > window.innerHeight - 4) y = anchor.top - h - gap
    const x = Math.min(Math.max(4, anchor.left + anchor.width / 2 - w / 2), window.innerWidth - w - 4)
    setPos({ x, y })
  }, [anchor, side])
  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
      className={cn(
        'atr-fade pointer-events-none fixed z-(--z-tooltip) max-w-72 rounded-sm bg-inverse px-2 py-1 font-sans text-xs text-inverse-ink shadow-e1',
        className,
      )}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Small marks                                                                                */
/* ------------------------------------------------------------------------------------------ */

/** Blinking streaming caret (zero layout width). */
export function Caret({ className }: { className?: string }) {
  return <span aria-hidden className={cn('atr-caret', className)} />
}

/** Shimmering placeholder bar. */
export function SkeletonBar({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden style={style} className={cn('atr-skeleton block h-2.5 rounded-xs', className)} />
}

/** 12px ring spinner in the live color. */
export function MiniSpinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? 'status' : undefined} aria-label={label} className={cn('inline-flex size-3 shrink-0', className)}>
      <svg viewBox="0 0 16 16" className="atr-spin size-full" aria-hidden>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
        <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  )
}

/** Honest "simulated" label drawn with the hatch motif. */
export function SimTag({ children = 'Simulated', className }: { children?: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'sim-hatch inline-flex h-5 items-center gap-1 rounded-xs border border-line px-1.5 font-mono text-2xs tracking-[0.04em] text-sim-ink',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Mono uppercase system kicker. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-2xs font-medium tracking-[0.08em] text-ink-3 uppercase', className)}>{children}</span>
}

/* ------------------------------------------------------------------------------------------ */
/* Segmented toggle (view switches inside component headers)                                  */
/* ------------------------------------------------------------------------------------------ */

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  iconOnly = false,
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly SegmentOption<T>[]
  iconOnly?: boolean
  /** Accessible name for the group. */
  label: string
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex shrink-0 items-center gap-px rounded-sm border border-line p-px', className)}>
      {options.map((o) => {
        const active = o.value === value
        const btn = (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-label={iconOnly ? o.label : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-6 items-center justify-center gap-1 rounded-[4px] font-sans text-xs transition-[background-color,color] duration-(--dur-1) ease-settle',
              'pointer-coarse:min-h-10 pointer-coarse:min-w-10 [&_svg]:size-3.5',
              iconOnly ? 'w-6' : 'px-2',
              active ? 'bg-press text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink',
            )}
          >
            {o.icon}
            {!iconOnly && o.label}
          </button>
        )
        return iconOnly ? (
          <Tip key={o.value} content={o.label}>
            {btn}
          </Tip>
        ) : (
          btn
        )
      })}
    </div>
  )
}
