import { useCallback, useSyncExternalStore } from 'react'

/** Live CSS media query match. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  const getSnapshot = useCallback(
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    [query],
  )
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/**
 * Breakpoints (min-width, px), matching the Tailwind theme (DESIGN §4.12). 'base' is everything below sm.
 * Layout ranges: phone < md · tablet md · laptop lg · desktop xl · large 2xl · wide 3xl.
 */
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1440, '3xl': 1920 } as const
export type Breakpoint = 'base' | keyof typeof BREAKPOINTS

const ORDER: Breakpoint[] = ['base', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']

/** The current breakpoint: 'base' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'. */
export function useBreakpoint(): Breakpoint {
  const sm = useMediaQuery(`(min-width: ${BREAKPOINTS.sm}px)`)
  const md = useMediaQuery(`(min-width: ${BREAKPOINTS.md}px)`)
  const lg = useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`)
  const xl = useMediaQuery(`(min-width: ${BREAKPOINTS.xl}px)`)
  const xxl = useMediaQuery(`(min-width: ${BREAKPOINTS['2xl']}px)`)
  const xxxl = useMediaQuery(`(min-width: ${BREAKPOINTS['3xl']}px)`)
  return xxxl ? '3xl' : xxl ? '2xl' : xl ? 'xl' : lg ? 'lg' : md ? 'md' : sm ? 'sm' : 'base'
}

/** True at or above the breakpoint: `useBreakpointUp('md')`. */
export function useBreakpointUp(bp: Exclude<Breakpoint, 'base'>): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[bp]}px)`)
}

/** Compare breakpoints: `breakpointAtLeast(bp, 'md')`. */
export function breakpointAtLeast(current: Breakpoint, min: Breakpoint): boolean {
  return ORDER.indexOf(current) >= ORDER.indexOf(min)
}

/** True when the primary pointer is coarse (touch). */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)')
}
