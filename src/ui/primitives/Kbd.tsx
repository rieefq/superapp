import { useMemo, type HTMLAttributes, type Ref } from 'react'
import { cn } from '@/lib/cn'
import { formatCombo, isMacPlatform, parseCombo } from '@/ui/hooks/hotkeys'

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  ref?: Ref<HTMLElement>
  size?: 'sm' | 'md'
  /** 'inverse' for use on ink-inverted surfaces (primary buttons, tooltips). */
  tone?: 'default' | 'inverse'
}

const KBD_SIZE = {
  sm: 'h-[18px] min-w-[18px] px-1 text-2xs',
  md: 'h-5 min-w-5 px-1.5 text-xs',
}

/** A single key cap. */
export function Kbd({ size = 'sm', tone = 'default', className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xs font-mono leading-none font-medium tracking-normal',
        KBD_SIZE[size],
        tone === 'default'
          ? 'border border-line bg-sunken text-ink-3 shadow-[inset_0_-1px_0_var(--line)]'
          : 'bg-inverse-ink/12 text-inverse-ink/70',
        className,
      )}
      {...props}
    />
  )
}

const SPOKEN_MAC: Record<string, string> = { '⌘': 'Command', '⇧': 'Shift', '⌥': 'Option', '⌃': 'Control', '↵': 'Return', '⌫': 'Delete', '⇥': 'Tab' }
const SPOKEN: Record<string, string> = { '↑': 'Up arrow', '↓': 'Down arrow', '←': 'Left arrow', '→': 'Right arrow', Esc: 'Escape', Ctrl: 'Control', Del: 'Delete' }

function spoken(parts: string[]): string {
  return parts.map((p) => SPOKEN_MAC[p] ?? SPOKEN[p] ?? p).join(' ')
}

export interface KbdComboProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** 'mod+k', 'shift+?', 'escape'; space-separated steps for sequences: 'g c'. */
  combo: string
  /** 'keys': individual key caps. 'plain': compact text (menus, tooltips). */
  variant?: 'keys' | 'plain'
  size?: 'sm' | 'md'
  tone?: 'default' | 'inverse'
  /** Force platform (gallery/tests); defaults to auto-detection. */
  mac?: boolean
}

/** A shortcut rendered for the current platform: 'mod+k' → ⌘ K on macOS, Ctrl K elsewhere. */
export function KbdCombo({ combo, variant = 'keys', size = 'sm', tone = 'default', mac, className, ...props }: KbdComboProps) {
  const isMac = mac ?? isMacPlatform()
  const steps = useMemo(() => combo.trim().split(/\s+/).map((s) => formatCombo(parseCombo(s), isMac)), [combo, isMac])
  const label = steps.map(spoken).join(', then ')

  if (variant === 'plain') {
    return (
      <kbd
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 font-mono text-2xs leading-none tracking-wide',
          tone === 'default' ? 'text-ink-4' : 'text-inverse-ink/60',
          className,
        )}
        {...props}
      >
        <span className="sr-only">{label}</span>
        {steps.map((parts, i) => (
          <span key={i} aria-hidden className={cn('inline-flex items-center', isMac ? 'gap-px' : 'gap-0.5')}>
            {parts.map((p, j) => (
              <span key={j} className="inline-flex items-center">
                {!isMac && j > 0 && <span className="pr-0.5 opacity-60">+</span>}
                {p}
              </span>
            ))}
          </span>
        ))}
      </kbd>
    )
  }

  return (
    <kbd className={cn('inline-flex shrink-0 items-center gap-1 font-sans', className)} {...props}>
      <span className="sr-only">{label}</span>
      {steps.map((parts, i) => (
        <span key={i} aria-hidden className="inline-flex items-center gap-0.5">
          {i > 0 && <span className={cn('px-0.5 text-2xs', tone === 'default' ? 'text-ink-4' : 'text-inverse-ink/50')}>then</span>}
          {parts.map((p, j) => (
            <Kbd key={j} size={size} tone={tone}>
              {p}
            </Kbd>
          ))}
        </span>
      ))}
    </kbd>
  )
}
