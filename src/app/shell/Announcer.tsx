import { useEffect, useState } from 'react'
import { createEmitter } from '@/lib/emitter'

const events = createEmitter<{ say: { text: string; assertive: boolean } }>()

/**
 * Announce a sentence to screen readers through the shell's single polite live region (§8.5):
 * "Needs you: Forge wants to run the test suite", "Research ‘…’ finished", "Answer complete".
 * Use `assertive` only when the user's own foreground action failed.
 */
export function announce(text: string, opts: { assertive?: boolean } = {}): void {
  events.emit('say', { text, assertive: !!opts.assertive })
}

export function Announcer() {
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  useEffect(
    () =>
      events.on('say', ({ text, assertive: urgent }) => {
        // Clear first so repeating the same sentence is announced again.
        const set = urgent ? setAssertive : setPolite
        set('')
        requestAnimationFrame(() => set(text))
      }),
    [],
  )
  return (
    <div className="sr-only">
      <div aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </div>
  )
}
