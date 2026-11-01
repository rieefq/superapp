import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { Dialog, DialogDescription, DialogTitle } from './Dialog'
import { Field } from './Field'
import { Input } from './Input'
import { hasHost, useSingletonHost } from './singleton'

export interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  /** Default 'Confirm' (prefer a verb: 'Delete', 'Disconnect'). */
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' uses the solid fail confirm button and focuses Cancel first. */
  tone?: 'default' | 'danger'
  /** Typed confirmation: the exact text the user must type to enable the confirm button. */
  requireText?: string
  icon?: LucideIcon
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number
  resolve: (ok: boolean) => void
}

export interface ConfirmState {
  /** Pending confirmations; the first one is on screen. */
  queue: ConfirmRequest[]
}

export const confirmStore = createStore<ConfirmState>(() => ({ queue: [] }))

let nextId = 1
let queueWithoutHost = false

/** Tests: queue requests even when no <ConfirmHost/> is mounted (instead of window.confirm). */
export function setConfirmFallback(mode: 'native' | 'queue'): void {
  queueWithoutHost = mode === 'queue'
}

/**
 * Ask the user to confirm. Resolves true on confirm, false on cancel/dismiss.
 *   if (await confirm({ title: 'Delete project?', tone: 'danger', confirmLabel: 'Delete' })) { … }
 * Needs a mounted <ConfirmHost/>; without one it falls back to window.confirm.
 */
export function confirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === 'string' ? { title: options } : options
  if (!queueWithoutHost && typeof window !== 'undefined' && !hasHost('confirm')) {
    const text = [opts.title, opts.description].filter((x) => typeof x === 'string').join('\n\n')
    return Promise.resolve(window.confirm(text || 'Are you sure?'))
  }
  return new Promise<boolean>((resolve) => {
    const request: ConfirmRequest = { ...opts, id: nextId++, resolve }
    confirmStore.setState((s) => ({ queue: [...s.queue, request] }))
  })
}

/** Settle a pending confirmation by id (the host calls this; also handy in tests). */
export function resolveConfirm(id: number, ok: boolean): void {
  const request = confirmStore.getState().queue.find((r) => r.id === id)
  if (!request) return
  confirmStore.setState((s) => ({ queue: s.queue.filter((r) => r.id !== id) }))
  request.resolve(ok)
}

/** Cancel every pending confirmation (e.g. on route change). */
export function cancelAllConfirms(): void {
  const { queue } = confirmStore.getState()
  confirmStore.setState({ queue: [] })
  queue.forEach((r) => r.resolve(false))
}

/** Renders the active confirmation. Mount once near the app root (extra instances stay idle). */
export function ConfirmHost() {
  const active = useSingletonHost('confirm')
  const request = useStore(confirmStore, (s) => s.queue[0])
  if (!active) return null
  return <ConfirmDialog request={request} />
}

function ConfirmDialog({ request }: { request: ConfirmRequest | undefined }) {
  // Keep the last request on screen while the dialog animates out.
  const [shown, setShown] = useState<ConfirmRequest | undefined>(request)
  const [typed, setTyped] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (request) {
      setShown(request)
      setTyped('')
    }
  }, [request])

  const r = request ?? shown
  if (!r) return null
  const danger = r.tone === 'danger'
  const matches = !r.requireText || typed.trim() === r.requireText
  const Icon = r.icon ?? (danger ? TriangleAlert : undefined)
  const settle = (ok: boolean) => resolveConfirm(r.id, ok && matches)

  return (
    <Dialog
      open={!!request}
      onOpenChange={(o) => !o && settle(false)}
      role="alertdialog"
      size="sm"
      hideClose
      initialFocus={r.requireText ? inputRef : danger ? cancelRef : confirmRef}
      header={
        <div className="flex gap-3 px-5 pt-5 pb-2">
          {Icon && (
            <span
              aria-hidden
              className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-sm', danger ? 'bg-fail-tint text-fail-ink' : 'bg-hover text-ink-2')}
            >
              <Icon className="size-4" strokeWidth={1.75} />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle className="text-base leading-6">{r.title}</DialogTitle>
            {r.description && <DialogDescription>{r.description}</DialogDescription>}
          </div>
        </div>
      }
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={() => settle(false)}>
            {r.cancelLabel ?? 'Cancel'}
          </Button>
          <Button ref={confirmRef} variant={danger ? 'danger-solid' : 'primary'} disabled={!matches} onClick={() => settle(true)}>
            {r.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {r.requireText ? (
        <form
          className="pt-1 pb-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (matches) settle(true)
          }}
        >
          <Field
            label={
              <span className="font-normal text-ink-2">
                Type <span className="rounded-xs bg-hover px-1 py-px font-mono text-xs text-ink select-all">{r.requireText}</span> to confirm
              </span>
            }
          >
            <Input ref={inputRef} value={typed} onValueChange={setTyped} autoComplete="off" spellCheck={false} />
          </Field>
        </form>
      ) : null}
    </Dialog>
  )
}
