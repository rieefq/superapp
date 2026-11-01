import { useSyncExternalStore } from 'react'

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/** True when the element accepts text input (input, textarea, select, contenteditable, role=textbox). */
export function isTypingTarget(target: EventTarget | Element | null | undefined): boolean {
  if (!target || !(target instanceof Element)) return false
  const el = target as HTMLElement
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(((el as HTMLInputElement).type || 'text').toLowerCase())
  const role = el.getAttribute('role')
  return role === 'textbox' || role === 'searchbox'
}

function subscribe(onChange: () => void): () => void {
  document.addEventListener('focusin', onChange)
  document.addEventListener('focusout', onChange)
  return () => {
    document.removeEventListener('focusin', onChange)
    document.removeEventListener('focusout', onChange)
  }
}

const getSnapshot = () => isTypingTarget(document.activeElement)
const getServerSnapshot = () => false

/** Live: is keyboard focus currently in a text field? */
export function useIsTyping(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
