import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import { useInspectEntity } from '@/app/templates'
import type { EntityRef } from '@/core/types'

const CARD = '[data-card]'

/**
 * Keyboard for a card grid (§3.11, §8.5): one tab stop for the whole grid (roving), ←/→ move to the
 * previous/next card, ↑/↓ to the nearest card in the row above/below (across sections), Home/End jump,
 * ⏎ opens (the card is a link), Space inspects the card's entity (`data-inspect`).
 */
export function useGridKeys(container: RefObject<HTMLElement | null>): { onKeyDown: (e: KeyboardEvent<HTMLElement>) => void } {
  const inspect = useInspectEntity()
  const lastFocused = useRef<string | null>(null)

  const cards = useCallback(() => Array.from(container.current?.querySelectorAll<HTMLElement>(CARD) ?? []), [container])

  // Roving tab stop: the last focused card (or the first) is the only card in the tab order.
  useEffect(() => {
    const all = cards()
    if (!all.length) return
    const current = all.find((c) => c.matches(':focus')) ?? all.find((c) => c.dataset.card === lastFocused.current) ?? all[0]
    for (const c of all) c.tabIndex = c === current ? 0 : -1
  })

  const focus = (el: HTMLElement | undefined) => {
    if (!el) return
    for (const c of cards()) c.tabIndex = c === el ? 0 : -1
    lastFocused.current = el.dataset.card ?? null
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  }

  const vertical = (from: HTMLElement, all: HTMLElement[], dir: 1 | -1): HTMLElement | undefined => {
    const r = from.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const rows = all
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => (dir === 1 ? rect.top > r.top + 4 : rect.top < r.top - 4))
    if (!rows.length) return undefined
    const targetTop = dir === 1 ? Math.min(...rows.map((x) => x.rect.top)) : Math.max(...rows.map((x) => x.rect.top))
    const row = rows.filter((x) => Math.abs(x.rect.top - targetTop) < 4)
    return row.sort((a, b) => Math.abs(a.rect.left + a.rect.width / 2 - cx) - Math.abs(b.rect.left + b.rect.width / 2 - cx))[0]?.el
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const all = cards()
    const target = (e.target as HTMLElement).closest<HTMLElement>(CARD)
    const i = target ? all.indexOf(target) : -1
    if (i < 0) return
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        focus(all[Math.min(all.length - 1, i + 1)])
        break
      case 'ArrowLeft':
        e.preventDefault()
        focus(all[Math.max(0, i - 1)])
        break
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        const next = vertical(all[i], all, e.key === 'ArrowDown' ? 1 : -1)
        if (next) focus(next)
        break
      }
      case 'Home':
        e.preventDefault()
        focus(all[0])
        break
      case 'End':
        e.preventDefault()
        focus(all[all.length - 1])
        break
      case ' ': {
        const ref = all[i].dataset.inspect
        if (!ref) return
        e.preventDefault()
        const at = ref.indexOf(':')
        inspect({ kind: ref.slice(0, at) as EntityRef['kind'], id: ref.slice(at + 1) })
        break
      }
    }
  }

  return { onKeyDown }
}
