import { useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { ArrowUpRight, Check } from 'lucide-react'
import { useModels, useModelAvailability, type ModelAvailability } from '@/core/ai'
import { updateSettings, useSettings } from '@/core/settings'
import { Button } from '@/ui'
import { SimBadge } from '@/ui/signature'
import { cn } from '@/lib/cn'
import { ShellPopover } from './overlays'

/** Provider chip + default-model menu (§3.2, §3.9). */
export function ProviderChip({ showLabel }: { showLabel: boolean }) {
  const [open, setOpen] = useState(false)
  const modelId = useSettings((s) => s.ai.defaultModelId)
  const check = useModelAvailability(modelId)
  const model = check.model
  const simulated = model?.simulated ?? false
  const keyError = !check.available && !simulated
  const name = model?.label ?? 'Unknown model'
  const aria = keyError ? `Default model ${name}: key error. Change model` : `Default model: ${name}${simulated ? ' (simulated)' : ''}. Change model`

  return (
    <ShellPopover
      open={open}
      onOpenChange={setOpen}
      title="Default model"
      width={320}
      trigger={(props, state) => (
        <button
          type="button"
          {...(props as object)}
          aria-label={aria}
          className={cn(
            'flex h-7 max-w-[220px] min-w-0 items-center gap-1.5 rounded-sm px-2 transition-colors duration-(--dur-1) ease-standard',
            'text-ink-2 hover:bg-hover hover:text-ink active:bg-press',
            state.open && 'bg-hover text-ink',
          )}
        >
          {keyError ? (
            <>
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-fail" />
              <span className="type-caption font-medium text-fail-ink">Key error</span>
            </>
          ) : simulated ? (
            <>
              <SimBadge size="xs" />
              {showLabel && <span className="type-caption truncate font-medium">Simulator</span>}
            </>
          ) : (
            <>
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink-2" />
              <span className="type-caption truncate font-medium">{name}</span>
            </>
          )}
        </button>
      )}
    >
      {({ close }) => <ModelMenu modelId={modelId} close={close} />}
    </ShellPopover>
  )
}

function ModelMenu({ modelId, close }: { modelId: string; close: () => void }) {
  const navigate = useNavigate()
  const models = useModels()
  const listRef = useRef<HTMLDivElement>(null)
  const groups: { label: string; items: ModelAvailability[] }[] = [
    { label: 'Simulator', items: models.filter((m) => m.model.providerId === 'simulator') },
    { label: 'Anthropic', items: models.filter((m) => m.model.providerId === 'anthropic') },
    { label: 'OpenAI-compatible', items: models.filter((m) => m.model.providerId === 'openai-compatible') },
  ].filter((g) => g.items.length)

  const choose = (m: ModelAvailability) => {
    if (!m.available) return
    updateSettings('ai', { defaultModelId: m.model.id })
    close()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const radios = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"])') ?? [])
    if (!radios.length) return
    e.preventDefault()
    const i = radios.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? radios.length - 1 : e.key === 'ArrowDown' ? (i + 1) % radios.length : (i - 1 + radios.length) % radios.length
    radios[next]?.focus()
  }

  const goConnect = (to: string) => {
    close()
    navigate(to)
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div ref={listRef} role="radiogroup" aria-label="Default model" onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {groups.map((g, gi) => (
          <div key={g.label} role="group" aria-label={g.label} className={cn(gi > 0 && 'mt-1 border-t border-line pt-1')}>
            <div className="type-label px-2.5 pt-2 pb-1 text-ink-3">{g.label}</div>
            {g.items.map((m) => {
              const checked = m.model.id === modelId
              const disabled = !m.available
              const needsKey = disabled && m.model.providerId === 'anthropic'
              const needsEndpoint = disabled && m.model.providerId === 'openai-compatible'
              return (
                <div key={m.model.id} className="flex items-center gap-1">
                  <div
                    role="radio"
                    aria-checked={checked}
                    aria-disabled={disabled || undefined}
                    tabIndex={checked || (!disabled && !groups.some((x) => x.items.some((y) => y.model.id === modelId))) ? 0 : -1}
                    title={disabled ? m.reason : undefined}
                    onClick={() => choose(m)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        choose(m)
                      }
                    }}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2.5 rounded-sm px-2.5 py-1.5 outline-none transition-colors duration-(--dur-1)',
                      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)',
                      disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-hover',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'grid size-3.5 shrink-0 place-items-center rounded-full border',
                        checked ? 'border-ink bg-ink text-inverse-ink' : 'border-line-input',
                        disabled && 'opacity-45',
                      )}
                    >
                      {checked && <span className="size-1.5 rounded-full bg-inverse-ink" />}
                    </span>
                    <span className={cn('flex min-w-0 flex-1 flex-col', disabled && 'opacity-55')}>
                      <span className="type-body-sm flex items-center gap-1.5 font-medium text-ink">
                        <span className="truncate">{m.model.label}</span>
                        {m.model.simulated && <SimBadge size="xs" />}
                      </span>
                      <span className="type-caption truncate text-ink-3">{m.model.description}</span>
                    </span>
                  </div>
                  {needsKey && (
                    <Button size="xs" variant="ghost" className="shrink-0" onClick={() => goConnect('/integrations/anthropic')}>
                      Add key
                    </Button>
                  )}
                  {needsEndpoint && (
                    <Button size="xs" variant="ghost" className="shrink-0" onClick={() => goConnect('/integrations/openai-compatible')}>
                      Set up
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <footer className="flex shrink-0 flex-col gap-1 border-t border-line p-1.5">
        <button
          type="button"
          onClick={() => goConnect('/integrations/anthropic')}
          className="type-body-sm flex h-8 items-center gap-2 rounded-sm px-2.5 text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
        >
          <ArrowUpRight aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />
          Connect a model…
        </button>
        <p className="type-caption flex gap-2 px-2.5 pt-1 pb-1.5 text-ink-3">
          <Check aria-hidden className="mt-0.5 size-3 shrink-0" strokeWidth={2} />
          Simulator answers are generated locally. No model is called.
        </p>
      </footer>
    </div>
  )
}
