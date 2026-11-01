import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { useSettings, useSettingsStore } from '@/core/settings'
import type { ThemePreference } from '@/core/types'
import { useMediaQuery } from '@/ui/hooks/useMediaQuery'

export type ResolvedTheme = 'dark' | 'light'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/** 'system' → the OS scheme right now. */
export function resolveTheme(pref: ThemePreference, systemLight: boolean): ResolvedTheme {
  if (pref === 'system') return systemLight ? 'light' : 'dark'
  return pref
}

/** Briefly add html.theme-transition so surfaces and text crossfade instead of snapping. */
function crossfade(apply: () => void) {
  const html = document.documentElement
  const reduce = html.getAttribute('data-motion') === 'reduce' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduce) {
    apply()
    return
  }
  html.classList.add('theme-transition')
  apply()
  window.setTimeout(() => html.classList.remove('theme-transition'), 260)
}

export interface ThemeProviderProps {
  children?: ReactNode
}

/**
 * Applies appearance settings to <html>: data-theme (with 'system' following the OS live), data-density and
 * data-motion; crossfades colors on theme switches; configures motion's reduced-motion handling to match.
 * Mount once at the app root.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const pref = useSettings((s) => s.appearance.theme)
  const density = useSettings((s) => s.appearance.density)
  const motionPref = useSettings((s) => s.appearance.reduceMotion)
  const systemLight = useMediaQuery(LIGHT_QUERY)
  const resolved = resolveTheme(pref, systemLight)
  const first = useRef(true)

  useLayoutEffect(() => {
    const html = document.documentElement
    if (html.getAttribute('data-theme') === resolved) {
      first.current = false
      return
    }
    const apply = () => html.setAttribute('data-theme', resolved)
    if (first.current) apply()
    else crossfade(apply)
    first.current = false
  }, [resolved])

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-density', density)
  }, [density])

  useLayoutEffect(() => {
    const html = document.documentElement
    if (motionPref === 'system') html.removeAttribute('data-motion')
    else html.setAttribute('data-motion', motionPref)
  }, [motionPref])

  // Keep the browser UI (scrollbars, form controls) in the same scheme.
  useEffect(() => {
    document.documentElement.style.colorScheme = resolved
  }, [resolved])

  return <MotionConfig reducedMotion={motionPref === 'reduce' ? 'always' : motionPref === 'full' ? 'never' : 'user'}>{children}</MotionConfig>
}

/** Current theme preference, what it resolves to, and a setter that persists to settings. */
export function useTheme(): { theme: ThemePreference; resolvedTheme: ResolvedTheme; setTheme: (theme: ThemePreference) => void } {
  const theme = useSettings((s) => s.appearance.theme)
  const systemLight = useMediaQuery(LIGHT_QUERY)
  // Same as updateSettings('appearance', { theme }) — called on the store for its generic typing.
  const setTheme = useCallback((next: ThemePreference) => useSettingsStore.getState().update('appearance', { theme: next }), [])
  return { theme, resolvedTheme: resolveTheme(theme, systemLight), setTheme }
}
