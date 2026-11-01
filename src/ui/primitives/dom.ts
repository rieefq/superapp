/** Scroll `el` into view within `container` only (never scrolls the page). */
export function scrollIntoViewWithin(container: HTMLElement | null, el: HTMLElement | null, margin = 4): void {
  if (!container || !el || !container.contains(el)) return
  const c = container.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  if (r.top < c.top + margin) container.scrollTop -= c.top + margin - r.top
  else if (r.bottom > c.bottom - margin) container.scrollTop += r.bottom - (c.bottom - margin)
}
