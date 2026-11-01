import { useRef, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { AnimatePresence, motion, type PanInfo } from 'motion/react'
import { CircleCheck, Info, OctagonAlert, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useHotkey } from '@/ui/hooks/useHotkey'
import { useBreakpointUp } from '@/ui/hooks/useMediaQuery'
import { useReducedMotion } from '@/ui/hooks/useReducedMotion'
import { Button } from './Button'
import { IGNORE_OUTSIDE_ATTR } from './layers'
import { DUR, EASE_SETTLE } from './motion'
import { Portal } from './Portal'
import { useSingletonHost } from './singleton'
import { Spinner } from './Spinner'

export type ToastTone = 'neutral' | 'success' | 'error' | 'info' | 'warning' | 'loading'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** Reuse an id to update a toast in place (e.g. loading → success). */
  id?: string
  title?: ReactNode
  description?: ReactNode
  tone?: ToastTone
  /** ms before auto-dismiss. Infinity keeps it until dismissed. Defaults depend on tone. */
  duration?: number
  action?: ToastAction
  /** Show the close button. Default true. */
  dismissible?: boolean
  onDismiss?: () => void
}

export interface ToastRecord {
  id: string
  title?: ReactNode
  description?: ReactNode
  tone: ToastTone
  duration: number
  action?: ToastAction
  dismissible: boolean
  onDismiss?: () => void
  createdAt: number
  /** Bumped on update so the host can re-announce. */
  version: number
}

export interface ToastState {
  toasts: ToastRecord[]
  paused: boolean
}

export const MAX_TOASTS = 4

const DEFAULT_DURATION: Record<ToastTone, number> = {
  neutral: 4000,
  success: 4000,
  info: 5000,
  warning: 6500,
  error: 8000,
  loading: Infinity,
}

export const toastStore = createStore<ToastState>(() => ({ toasts: [], paused: false }))

interface Timer {
  handle: ReturnType<typeof setTimeout> | null
  remaining: number
  startedAt: number
}
const timers = new Map<string, Timer>()
let counter = 0

function clearTimer(id: string) {
  const t = timers.get(id)
  if (t?.handle) clearTimeout(t.handle)
  timers.delete(id)
}

function startTimer(id: string, duration: number) {
  clearTimer(id)
  if (!Number.isFinite(duration)) return
  const paused = toastStore.getState().paused
  const timer: Timer = { handle: null, remaining: duration, startedAt: Date.now() }
  if (!paused) timer.handle = setTimeout(() => dismissToast(id), duration)
  timers.set(id, timer)
}

function resolveDuration(opts: ToastOptions, tone: ToastTone): number {
  if (opts.duration !== undefined) return opts.duration
  return DEFAULT_DURATION[tone] + (opts.action ? 2000 : 0)
}

function upsert(opts: ToastOptions): string {
  const id = opts.id ?? `toast-${++counter}`
  const tone = opts.tone ?? 'neutral'
  const duration = resolveDuration(opts, tone)
  const existing = toastStore.getState().toasts.find((t) => t.id === id)
  const record: ToastRecord = {
    id,
    title: opts.title,
    description: opts.description,
    tone,
    duration,
    action: opts.action,
    dismissible: opts.dismissible ?? true,
    onDismiss: opts.onDismiss,
    createdAt: existing?.createdAt ?? Date.now(),
    version: (existing?.version ?? 0) + 1,
  }
  toastStore.setState((s) => {
    const list = existing ? s.toasts.map((t) => (t.id === id ? record : t)) : [...s.toasts, record]
    // Over the limit: drop the oldest that are not loading.
    const overflow = list.length - MAX_TOASTS
    if (overflow <= 0) return { toasts: list }
    const drop = new Set(list.filter((t) => t.tone !== 'loading' && t.id !== id).slice(0, overflow).map((t) => t.id))
    drop.forEach(clearTimer)
    return { toasts: list.filter((t) => !drop.has(t.id)) }
  })
  startTimer(id, duration)
  return id
}

/** Remove a toast (or all toasts when no id). */
export function dismissToast(id?: string): void {
  const { toasts } = toastStore.getState()
  const gone = id ? toasts.filter((t) => t.id === id) : toasts
  if (!gone.length) return
  gone.forEach((t) => clearTimer(t.id))
  toastStore.setState((s) => ({ toasts: id ? s.toasts.filter((t) => t.id !== id) : [] }))
  gone.forEach((t) => t.onDismiss?.())
}

/** Freeze auto-dismiss timers (pointer over / focus inside the region). */
export function pauseToasts(): void {
  if (toastStore.getState().paused) return
  const now = Date.now()
  timers.forEach((t) => {
    if (t.handle) {
      clearTimeout(t.handle)
      t.handle = null
      t.remaining = Math.max(0, t.remaining - (now - t.startedAt))
    }
  })
  toastStore.setState({ paused: true })
}

export function resumeToasts(): void {
  if (!toastStore.getState().paused) return
  toastStore.setState({ paused: false })
  const now = Date.now()
  timers.forEach((t, id) => {
    t.startedAt = now
    t.handle = setTimeout(() => dismissToast(id), Math.max(600, t.remaining))
  })
}

type Message = ReactNode
type ToneOptions = Omit<ToastOptions, 'tone' | 'title'>

interface ToastFn {
  (input: Message | ToastOptions, opts?: Omit<ToastOptions, 'title'>): string
  success: (title: Message, opts?: ToneOptions) => string
  error: (title: Message, opts?: ToneOptions) => string
  info: (title: Message, opts?: ToneOptions) => string
  warning: (title: Message, opts?: ToneOptions) => string
  loading: (title: Message, opts?: ToneOptions) => string
  update: (id: string, opts: Omit<ToastOptions, 'id'>) => string
  dismiss: (id?: string) => void
  promise: <T>(
    promise: Promise<T> | (() => Promise<T>),
    messages: {
      loading: Message
      success: Message | ((value: T) => Message)
      error: Message | ((error: unknown) => Message)
      description?: Message
    },
  ) => Promise<T>
}

function isOptions(input: unknown): input is ToastOptions {
  return typeof input === 'object' && input !== null && !('$$typeof' in input) && !Array.isArray(input)
}

/**
 * Show a toast: `toast('Saved')`, `toast('Saved', { description })`, `toast.success('Deployed', { description })`,
 * `const id = toast.loading('Exporting…'); toast.update(id, { tone: 'success', title: 'Exported' })`,
 * `toast.promise(save(), { loading: 'Saving…', success: 'Saved', error: 'Could not save' })`.
 * Returns the toast id. Needs a mounted <ToastHost/>.
 */
export const toast: ToastFn = Object.assign(
  (input: Message | ToastOptions, opts?: Omit<ToastOptions, 'title'>) => upsert(isOptions(input) ? { ...opts, ...input } : { ...opts, title: input }),
  {
  success: (title: Message, opts?: ToneOptions) => upsert({ ...opts, title, tone: 'success' }),
  error: (title: Message, opts?: ToneOptions) => upsert({ ...opts, title, tone: 'error' }),
  info: (title: Message, opts?: ToneOptions) => upsert({ ...opts, title, tone: 'info' }),
  warning: (title: Message, opts?: ToneOptions) => upsert({ ...opts, title, tone: 'warning' }),
  loading: (title: Message, opts?: ToneOptions) => upsert({ ...opts, title, tone: 'loading' }),
  update: (id: string, opts: Omit<ToastOptions, 'id'>) => {
    const existing = toastStore.getState().toasts.find((t) => t.id === id)
    return upsert({
      title: existing?.title,
      description: existing?.description,
      action: existing?.action,
      ...opts,
      tone: opts.tone ?? existing?.tone,
      id,
    })
  },
  dismiss: dismissToast,
  promise: <T,>(
    promise: Promise<T> | (() => Promise<T>),
    messages: {
      loading: Message
      success: Message | ((value: T) => Message)
      error: Message | ((error: unknown) => Message)
      description?: Message
    },
  ) => {
    const id = upsert({ title: messages.loading, description: messages.description, tone: 'loading' })
    const p = typeof promise === 'function' ? promise() : promise
    p.then(
      (value) => {
        const title = typeof messages.success === 'function' ? (messages.success as (v: T) => Message)(value) : messages.success
        upsert({ id, title, tone: 'success' })
      },
      (error: unknown) => {
        const title = typeof messages.error === 'function' ? (messages.error as (e: unknown) => Message)(error) : messages.error
        upsert({ id, title, tone: 'error' })
      },
    )
    return p
  },
  },
)

// ------------------------------------------------------------------------------------------------ host

const TONE_ICON: Record<Exclude<ToastTone, 'neutral' | 'loading'>, { Icon: typeof Info; className: string; label: string }> = {
  success: { Icon: CircleCheck, className: 'text-done', label: 'Success' },
  error: { Icon: OctagonAlert, className: 'text-fail', label: 'Error' },
  warning: { Icon: TriangleAlert, className: 'text-attn', label: 'Warning' },
  info: { Icon: Info, className: 'text-accent', label: 'Info' },
}

export interface ToastHostProps {
  /** Hotkey that moves focus to the newest toast. Default 'f8'. */
  hotkey?: string
}

/**
 * Renders toasts: bottom-right stack on desktop (newest nearest the corner), top on mobile.
 * Hover or focus pauses timers; swipe right (or Escape on a focused toast) dismisses. Mount once.
 */
export function ToastHost({ hotkey = 'f8' }: ToastHostProps) {
  const active = useSingletonHost('toast')
  const toasts = useStore(toastStore, (s) => s.toasts)
  const desktop = useBreakpointUp('sm')
  const reduced = useReducedMotion()
  const regionRef = useRef<HTMLElement>(null)

  useHotkey(hotkey, () => {
    const items = regionRef.current?.querySelectorAll<HTMLElement>('[data-toast]')
    items?.[desktop ? items.length - 1 : 0]?.focus()
  }, { enabled: active && toasts.length > 0 })

  if (!active) return null
  const ordered = desktop ? toasts : [...toasts].reverse()

  return (
    <Portal>
      <section
        ref={regionRef}
        aria-label={`Notifications${toasts.length ? ` (${toasts.length})` : ''}`}
        {...{ [IGNORE_OUTSIDE_ATTR]: '' }}
        onPointerEnter={pauseToasts}
        onPointerLeave={resumeToasts}
        onFocus={pauseToasts}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resumeToasts()
        }}
        className={cn(
          'pointer-events-none fixed z-(--z-toast) flex flex-col',
          desktop ? 'right-4 bottom-4 w-[380px] max-w-[calc(100vw-32px)]' : 'inset-x-2 top-[max(8px,env(safe-area-inset-top))]',
        )}
      >
        <ol aria-live="polite" aria-relevant="additions text" className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {ordered.map((t) => (
              <ToastItem key={t.id} toast={t} desktop={desktop} reduced={reduced} />
            ))}
          </AnimatePresence>
        </ol>
      </section>
    </Portal>
  )
}

function ToastItem({ toast: t, desktop, reduced }: { toast: ToastRecord; desktop: boolean; reduced: boolean }) {
  const tone = t.tone !== 'neutral' && t.tone !== 'loading' ? TONE_ICON[t.tone] : null
  const enterY = desktop ? 12 : -12
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 90 || info.velocity.x > 500) dismissToast(t.id)
  }
  return (
    <motion.li
      layout={!reduced}
      data-toast=""
      role={t.tone === 'error' ? 'alert' : undefined}
      aria-atomic="true"
      tabIndex={0}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: enterY, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
      exit={reduced ? { opacity: 0, transition: { duration: DUR[1] } } : { opacity: 0, x: 24, scale: 0.98, transition: { duration: DUR[2] } }}
      transition={{ duration: DUR[3], ease: EASE_SETTLE }}
      drag={reduced || !t.dismissible ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.05, right: 0.7 }}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && t.dismissible) {
          e.stopPropagation()
          dismissToast(t.id)
        }
      }}
      className={cn(
        'pointer-events-auto relative flex w-full items-start gap-3 rounded-md border border-line bg-overlay py-3 pr-10 pl-3.5 text-ink shadow-e2',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        t.tone === 'loading' && 'pr-4',
      )}
    >
      {t.tone === 'loading' ? (
        <Spinner size={16} className="mt-0.5 text-live" label="In progress" />
      ) : tone ? (
        <tone.Icon role="img" aria-label={tone.label} className={cn('mt-0.5 size-4 shrink-0', tone.className)} strokeWidth={2} />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {t.title && <p className="text-sm leading-5 font-medium text-pretty">{t.title}</p>}
        {t.description && <p className="text-xs leading-[18px] text-ink-2 text-pretty">{t.description}</p>}
        {t.action && (
          <div className="mt-2 flex">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                t.action?.onClick()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </Button>
          </div>
        )}
      </div>
      {t.dismissible && t.tone !== 'loading' && (
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => dismissToast(t.id)}
          className="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-sm text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:size-9"
        >
          <X aria-hidden className="size-3.5" strokeWidth={2} />
        </button>
      )}
    </motion.li>
  )
}
