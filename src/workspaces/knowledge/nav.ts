import { parseLibraryParams } from './model'

/**
 * Light helpers shared by the manifest (eager) and the views: where `N` goes and the system file picker.
 */

/** `N` and "+ New note": a draft that becomes an item on the first words, filed in the collection in view. */
export function newNoteHref(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
  pathname: string = typeof window === 'undefined' ? '' : window.location.pathname,
): string {
  if (pathname.replace(/\/+$/, '') !== '/knowledge') return '/knowledge/new'
  const section = parseLibraryParams(new URLSearchParams(search)).section
  return section.type === 'collection' && section.id ? `/knowledge/new?collection=${encodeURIComponent(section.id)}` : '/knowledge/new'
}

/**
 * Open the system file picker (works from ⌘K: the click stays inside the user's gesture) and hand the
 * chosen files over. Nothing happens when the picker is cancelled.
 */
export function pickFiles(onFiles: (files: File[]) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.style.display = 'none'
  input.setAttribute('data-knowledge-picker', '')
  const done = () => input.remove()
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? [])
    done()
    if (files.length) onFiles(files)
  })
  input.addEventListener('cancel', done)
  document.body.appendChild(input)
  input.click()
}

/** Where "back" goes from an item (phones, Done on an empty draft, after a delete): the library view last shown. */
let lastLibrary = '/knowledge'

export function rememberLibrary(href: string): void {
  lastLibrary = href
}

export function lastLibraryHref(): string {
  return lastLibrary
}
