import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, Check, type LucideIcon } from 'lucide-react'
import { announce } from '@/app/shell/Announcer'
import { updateSettings } from '@/core/settings'
import type { Settings } from '@/core/types'
import { Field } from '@/ui'
import { cn } from '@/lib/cn'

/*
 * Building blocks for the Settings sections (§6.12): a section lead, labelled groups of hairline rows
 * (the design system's settings-row pattern: Field `layout="inline"` inside a bordered list), and the
 * inline "✓ Saved" that confirms every instant save.
 */

// ------------------------------------------------------------------------------------------------ saved feedback

interface SavedState {
  id: string
  at: number
}

const MarkContext = createContext<(id: string, label?: string) => void>(() => {})
const SavedContext = createContext<SavedState | null>(null)

const SAVED_MS = 2200

/** Holds which row saved last; rows show "✓ Saved" next to their label for ~2 seconds. */
export function SavedProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<SavedState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mark = useCallback((id: string, label?: string) => {
    setSaved({ id, at: Date.now() })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaved(null), SAVED_MS)
    announce(label ? `${label} saved` : 'Saved')
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <MarkContext.Provider value={mark}>
      <SavedContext.Provider value={saved}>{children}</SavedContext.Provider>
    </MarkContext.Provider>
  )
}

/** `mark(rowId, label)`: show "✓ Saved" on that row and announce it politely. */
export function useMarkSaved(): (id: string, label?: string) => void {
  return useContext(MarkContext)
}

type SettingsPatch<K extends keyof Settings> = Settings[K] extends object ? Partial<Settings[K]> : Settings[K]

/** Save a settings patch at once and confirm it on the row: `save('theme', 'Theme', 'appearance', { theme })`. */
export function useSaveSetting() {
  const mark = useMarkSaved()
  return useCallback(
    <K extends keyof Settings>(rowId: string, label: string, section: K, patch: SettingsPatch<K>) => {
      updateSettings(section, patch)
      mark(rowId, label)
    },
    [mark],
  )
}

/** The inline confirmation after a row's label (decorative: the live region announces it). */
export function SavedMark({ id }: { id: string }) {
  const saved = useContext(SavedContext)
  if (saved?.id !== id) return null
  return (
    <span key={saved.at} aria-hidden className="settings-saved type-meta ml-2 inline-flex translate-y-px items-center gap-1 align-baseline font-normal text-ink-3">
      <style href="atrium-settings-saved" precedence="default">{`
@keyframes atrium-settings-saved-in { from { opacity: 0 } to { opacity: 1 } }
.settings-saved { animation: atrium-settings-saved-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both; }
`}</style>
      <Check className="size-3 text-done" strokeWidth={2.5} />
      Saved
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ layout

/** The section body: a lead sentence, then groups 32px apart. */
export function SectionBody({ lead, children }: { lead: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 pb-12">
      <p className="type-body max-w-[60ch] text-ink-2 text-pretty">{lead}</p>
      {children}
    </div>
  )
}

export interface GroupProps {
  /** `label` kicker above the rows (sentence case; the role uppercases it). */
  label: string
  /** Anchor for the whole group (`#always-allow`). */
  id?: string
  /** Right-aligned next to the label (a link, a count). */
  aside?: ReactNode
  /** One line under the rows. */
  footnote?: ReactNode
  /** No bordered list: the children draw their own frame. */
  bare?: boolean
  children: ReactNode
  className?: string
}

/** A labelled group of hairline-separated rows in a bordered list. */
export function Group({ label, id, aside, footnote, bare, children, className }: GroupProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      id={id ? `setting-${id}` : undefined}
      data-setting={id}
      className={cn('flex scroll-mt-6 flex-col gap-2', className)}
    >
      <div className="flex min-h-5 items-end justify-between gap-3 px-0.5">
        <h2 id={headingId} className="type-label text-ink-3">
          {label}
        </h2>
        {aside && <div className="type-caption flex shrink-0 items-center gap-2 text-ink-3">{aside}</div>}
      </div>
      {bare ? children : <div className="flex flex-col divide-y divide-line rounded-md border border-line">{children}</div>}
      {footnote && <p className="type-caption px-0.5 text-ink-3 text-pretty">{footnote}</p>}
    </section>
  )
}

const ROW = 'scroll-mt-6 px-4 py-3 transition-colors duration-(--dur-3) ease-standard data-[flash]:bg-accent-tint'

export interface SettingRowProps {
  /** Anchor (`#theme`) and the key its "Saved" mark listens to. */
  id: string
  label: string
  hint?: ReactNode
  error?: ReactNode
  /** The control (right-aligned; full width under the label on phones). */
  children: ReactNode
  className?: string
}

/**
 * One setting: label and hint on the left, the control on the right (Field `layout="inline"`, so ids,
 * aria-describedby and aria-invalid are wired). Below 640px the control drops under the label.
 */
export function SettingRow({ id, label, hint, error, children, className }: SettingRowProps) {
  return (
    <div id={`setting-${id}`} data-setting={id} className={cn(ROW, className)}>
      <Field
        layout="inline"
        label={
          <>
            {label}
            <SavedMark id={id} />
          </>
        }
        hint={hint}
        error={error}
        className="gap-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-2.5 max-sm:[&>div:last-child]:w-full"
      >
        {children}
      </Field>
    </div>
  )
}

export interface BlockRowProps {
  id: string
  label: string
  hint?: ReactNode
  /** Right of the label (a count, a link). */
  aside?: ReactNode
  /** Render the control with the label/hint ids for aria-labelledby / aria-describedby. */
  children: (ids: { labelId: string; hintId?: string }) => ReactNode
  className?: string
}

/** A setting whose control needs the full width (chips, swatches, radio cards): label and hint, then the control. */
export function BlockRow({ id, label, hint, aside, children, className }: BlockRowProps) {
  const labelId = useId()
  const hintId = useId()
  return (
    <div id={`setting-${id}`} data-setting={id} className={cn(ROW, 'flex flex-col gap-3', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5 pt-px">
          <span id={labelId} className="text-sm font-medium text-ink">
            {label}
            <SavedMark id={id} />
          </span>
          {hint && (
            <p id={hintId} className="text-xs text-ink-3 text-pretty">
              {hint}
            </p>
          )}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
      {children({ labelId, hintId: hint ? hintId : undefined })}
    </div>
  )
}

/** A plain row inside a group (status lines, notes, entity rows). */
export function Row({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id ? `setting-${id}` : undefined} data-setting={id} className={cn(ROW, className)}>
      {children}
    </div>
  )
}

/** "Manage keys in Integrations →": a cross-workspace link in the Atrium link style. */
export function InlineLink({ to, children, className, icon: Icon = ArrowUpRight }: { to: string; children: ReactNode; className?: string; icon?: LucideIcon }) {
  return (
    <Link
      to={to}
      className={cn(
        'type-caption inline-flex w-fit items-center gap-1 rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 transition-colors duration-(--dur-1) hover:text-ink hover:decoration-ink',
        className,
      )}
    >
      {children}
      <Icon aria-hidden className="size-3 shrink-0" strokeWidth={2} />
    </Link>
  )
}

/** Dotted leader between a label and its value (the ReadBack and Resume motif). */
export function Leader() {
  return <span aria-hidden className="mb-[3px] min-w-3 flex-1 self-end border-b border-dotted border-line-input" />
}

// ------------------------------------------------------------------------------------------------ drafts

export interface DraftOptions<T> {
  /** The stored value, as text. */
  stored: string
  /** Validate text: a value to save, or an error to show. */
  check: (text: string) => { ok: true; value: T } | { ok: false; error: string }
  /** Save a valid value (called on every valid edit: settings save instantly). */
  commit: (value: T) => void
  /** Confirm the save once typing pauses. */
  onSettled?: () => void
}

/**
 * A text draft that saves while you type when valid, shows the error when not, and goes back to the
 * value it had when you started editing if you leave it invalid. Follows outside changes (⌘K,
 * another tab) while not focused.
 */
export function useDraft<T>({ stored, check, commit, onSettled }: DraftOptions<T>) {
  const [text, setText] = useState(stored)
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)
  const atFocus = useRef(stored)
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dirty = useRef(false)

  useEffect(() => {
    if (!focused.current) {
      setText(stored)
      setError(null)
    }
  }, [stored])
  useEffect(() => () => clearTimeout(settle.current), [])

  const flushSettled = useCallback(() => {
    clearTimeout(settle.current)
    if (dirty.current) {
      dirty.current = false
      onSettled?.()
    }
  }, [onSettled])

  return useMemo(
    () => ({
      value: text,
      error,
      onValueChange: (next: string) => {
        setText(next)
        const result = check(next)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setError(null)
        commit(result.value)
        dirty.current = true
        clearTimeout(settle.current)
        settle.current = setTimeout(flushSettled, 700)
      },
      onFocus: () => {
        focused.current = true
        atFocus.current = stored
      },
      onBlur: () => {
        focused.current = false
        if (!check(text).ok) {
          // Leaving it invalid restores what it was before this edit (including partial saves made while typing).
          const restored = check(atFocus.current)
          setText(atFocus.current)
          setError(null)
          if (restored.ok) commit(restored.value)
          dirty.current = false
        }
        flushSettled()
      },
    }),
    [text, error, check, commit, flushSettled, stored],
  )
}
