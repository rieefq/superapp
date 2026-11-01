import { useEffect } from 'react'
import { useDB } from '@/core/db'
import { cn } from '@/lib/cn'
import type { ActivityState } from './glyphMeta'
import './signature.css'

export type AtriumMarkState = ActivityState

/*
 * The Atrium mark (docs/DESIGN.md §5.4.1): circle (actors) · capsule (runs) · square (things that last).
 * The capsule is the activity LED: idle ink-3, working live and breathing, waiting attn and steady.
 */

const CAPSULE_FILL: Record<AtriumMarkState, string> = {
  idle: 'var(--ink-3)',
  working: 'var(--live)',
  waiting: 'var(--attn)',
}

const STATE_WORD: Record<AtriumMarkState, string> = {
  idle: 'idle',
  working: 'working',
  waiting: 'needs you',
}

export interface AtriumMarkProps {
  state?: AtriumMarkState
  /** 'sm' 42×16 (top bar) · 'lg' 63×24 (boot, About) · or a height in px. */
  size?: 'sm' | 'lg' | number
  /** Lowercase `atrium` wordmark next to the mark (boot screen and About only). */
  wordmark?: boolean
  /** Accessible name. Default "Atrium" plus the state when not idle. */
  label?: string
  className?: string
}

export function AtriumMark({ state = 'idle', size = 'sm', wordmark, label, className }: AtriumMarkProps) {
  const h = size === 'sm' ? 16 : size === 'lg' ? 24 : size
  const w = (h * 42) / 16
  const name = label ?? (state === 'idle' ? 'Atrium' : `Atrium, ${STATE_WORD[state]}`)
  const mark = (
    <svg
      viewBox="0 0 42 16"
      width={w}
      height={h}
      role={wordmark ? undefined : 'img'}
      aria-label={wordmark ? undefined : name}
      aria-hidden={wordmark ? true : undefined}
      className="block shrink-0 overflow-visible"
    >
      <circle cx="5" cy="8" r="5" fill="var(--ink-2)" />
      <rect
        x="13"
        y="3"
        width="16"
        height="10"
        rx="5"
        fill={CAPSULE_FILL[state]}
        className={cn('transition-[fill] duration-(--dur-3) ease-standard', state === 'working' && 'sig-breathe')}
      />
      {state === 'working' && <rect className="sig-rm-ring" x="11.5" y="1.5" width="19" height="13" rx="6.5" fill="none" stroke="var(--live)" strokeWidth="1" />}
      <rect x="32" y="3" width="10" height="10" rx="2.5" fill="var(--ink-2)" />
    </svg>
  )
  if (!wordmark) return <span className={cn('inline-flex shrink-0', className)}>{mark}</span>
  return (
    <span role="img" aria-label={name} className={cn('inline-flex shrink-0 items-center', className)} style={{ gap: Math.round(h * 0.45) }}>
      {mark}
      <span
        aria-hidden
        className="font-sans leading-none font-semibold text-ink select-none"
        style={{ fontSize: Math.round(h * 0.95), fontStretch: '90%', letterSpacing: '-0.01em' }}
      >
        atrium
      </span>
    </span>
  )
}

// ------------------------------------------------------------------ favicon

const faviconSvg = (capsule: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#121211"/><rect x="7" y="11" width="18" height="10" rx="5" fill="${capsule}"/></svg>`

const toDataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`

/** The three static favicons (32×32): idle, working, waiting. */
export const FAVICON_SVGS: Readonly<Record<AtriumMarkState, string>> = Object.freeze({
  idle: toDataUrl(faviconSvg('#959289')),
  working: toDataUrl(faviconSvg('#8fb1e6')),
  waiting: toDataUrl(faviconSvg('#e2ad45')),
})

/** Swap the tab favicon to the given state (creates the <link rel="icon"> if needed). No-op without a DOM. */
export function setFavicon(state: AtriumMarkState, doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc) return
  let link = doc.querySelector<HTMLLinkElement>('link[rel~="icon"][data-atrium-favicon]') ?? doc.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!link) {
    link = doc.createElement('link')
    link.rel = 'icon'
    doc.head.appendChild(link)
  }
  link.setAttribute('data-atrium-favicon', state)
  link.type = 'image/svg+xml'
  const href = FAVICON_SVGS[state]
  if (link.getAttribute('href') !== href) link.setAttribute('href', href)
}

/** Live activity of the whole workspace: waiting (any pending approval) › working (any running run) › idle. */
export function useActivityState(): AtriumMarkState {
  return useDB((s) => {
    for (const a of Object.values(s.approvals)) if (a.status === 'pending') return 'waiting'
    let working = false
    for (const r of Object.values(s.runs)) {
      if (r.status === 'waiting') return 'waiting'
      if (r.status === 'running') working = true
    }
    return working ? 'working' : 'idle'
  })
}

/** Keep the favicon in sync with a state (mount once in the shell: `useFavicon(useActivityState())`). */
export function useFavicon(state: AtriumMarkState): void {
  useEffect(() => {
    setFavicon(state)
  }, [state])
}
