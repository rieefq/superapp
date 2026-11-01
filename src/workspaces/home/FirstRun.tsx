import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { X } from 'lucide-react'
import { useModels } from '@/core/ai'
import { useCount } from '@/core/db'
import { updateSettings } from '@/core/settings'
import { AtriumMark, Button, IconButton, KbdCombo, useReducedMotion } from '@/ui'

/**
 * First run (§6.1, settings.onboarded = false): a three-line boot log that types out over 600ms (static
 * under reduced motion) with the real knowledge count, three primer cards and [Connect a model].
 * Dismissing it sets `onboarded`.
 */
export function FirstRun() {
  const navigate = useNavigate()
  const reduced = useReducedMotion()
  const knowledge = useCount('knowledge')
  const live = useModels().some((m) => !m.model.simulated && m.available)
  const lines = [
    { text: `knowledge · ${knowledge} item${knowledge === 1 ? '' : 's'} indexed`, mark: '✓' },
    { text: live ? 'simulator ready — a live model is connected too' : 'simulator ready — answers are simulated until you connect a model' },
    { text: live ? 'model key found — live answers are available' : 'no model key — Integrations › Anthropic to connect' },
  ]
  const total = lines.reduce((n, l) => n + l.text.length + (l.mark ? l.mark.length + 1 : 0) + 2, 0)
  const [shown, setShown] = useState(reduced ? Number.MAX_SAFE_INTEGER : 0)

  // Type the log out over 600ms (no caret, no sound — just the reveal).
  useEffect(() => {
    if (reduced) {
      setShown(Number.MAX_SAFE_INTEGER)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 600)
      setShown(Math.round(p * total))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [reduced, total])

  let budget = shown
  const dismiss = () => updateSettings('onboarded', true)

  return (
    <section aria-label="Welcome to Atrium" className="relative rounded-md border border-line bg-raised">
      <div className="flex items-start gap-4 px-5 pt-5">
        <AtriumMark size="lg" wordmark />
        <span className="flex-1" />
        <IconButton icon={X} label="Dismiss the welcome" size="sm" onClick={dismiss} className="-mt-1 -mr-2" />
      </div>
      <pre aria-label="Boot log" className="type-mono-sm mt-4 px-5 whitespace-pre-wrap text-ink-2">
        {lines.map((l, i) => {
          const full = l.mark ? `${l.text} ${l.mark}` : l.text
          const visible = full.slice(0, Math.max(0, budget))
          budget -= full.length + 2
          return (
            <span key={i} className="block min-h-[18px]">
              <span aria-hidden className="mr-2 text-ink-4">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="sr-only">{full}</span>
              <span aria-hidden>
                {visible.endsWith('✓') ? (
                  <>
                    {visible.slice(0, -1)}
                    <span className="text-done-ink">✓</span>
                  </>
                ) : (
                  visible
                )}
              </span>
            </span>
          )
        })}
      </pre>
      <ul className="mt-5 grid gap-px border-t border-line bg-line sm:grid-cols-3">
        <Primer title="Projects scope" keys="p">
          Pick a project and every list, composer and new run works inside it. Its memory rides along.
        </Primer>
        <Primer title="Run in background" keys="mod+enter">
          Start work and stay where you are. It joins the Run Line and lands back here when it ends.
        </Primer>
        <Primer title="Needs you" keys="shift+1" display="!">
          Approvals and reviews wait here. Everything else arrives as a quiet update.
        </Primer>
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        {!live && (
          <Button variant="secondary" size="sm" onClick={() => navigate('/integrations/anthropic')}>
            Connect a model
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Got it
        </Button>
        <span className="type-caption ml-auto text-ink-3">Everything you see is stored in this browser.</span>
      </div>
    </section>
  )
}

function Primer({ title, keys, display, children }: { title: string; keys: string; display?: string; children: string }) {
  return (
    <li className="flex flex-col gap-1.5 bg-raised px-5 py-4">
      <span className="flex items-center justify-between gap-2">
        <span className="type-body-sm font-semibold text-ink">{title}</span>
        {display ? (
          <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-line bg-sunken px-1 font-mono text-2xs text-ink-3 shadow-[inset_0_-1px_0_var(--line)]">
            {display}
          </kbd>
        ) : (
          <KbdCombo combo={keys} />
        )}
      </span>
      <span className="type-caption text-pretty text-ink-3">{children}</span>
    </li>
  )
}
