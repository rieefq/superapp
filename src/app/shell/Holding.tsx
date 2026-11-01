import { useMemo, useState, type DragEvent } from 'react'
import { Layers, X } from 'lucide-react'
import { usePinned, useContextStore } from '@/core/context'
import { useEntity } from '@/core/services'
import type { ContextItem } from '@/core/types'
import { Button, IconButton, VisuallyHidden, toast } from '@/ui'
import { EntityChip } from '@/ui/signature'
import { cn } from '@/lib/cn'
import { useShellStore } from './store'
import { ShellPopover } from './overlays'
import { ENTITY_DRAG_TYPE, estimateRefTokens, formatTokenEstimate, readDraggedEntity, releaseAll, releaseOne } from './scope'

/** Top-bar Holding chip: count, popover, and a drop target for dragged entity chips (§3.2, §3.9). */
export function HoldingChip({ showLabel }: { showLabel: boolean }) {
  const pinned = usePinned()
  const open = useShellStore((s) => s.holdingOpen)
  const setOpen = useShellStore((s) => s.setHoldingOpen)
  const [dragOver, setDragOver] = useState(false)
  const count = pinned.length

  const accepts = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(ENTITY_DRAG_TYPE)
  const dropProps = {
    onDragEnter: (e: DragEvent) => {
      if (!accepts(e)) return
      e.preventDefault()
      setDragOver(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!accepts(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: DragEvent) => {
      setDragOver(false)
      const ref = readDraggedEntity(e.dataTransfer)
      if (!ref) return
      e.preventDefault()
      const ctx = useContextStore.getState()
      if (ctx.pinned.some((p) => p.ref.kind === ref.kind && p.ref.id === ref.id)) return
      ctx.pin(ref)
      toast({ title: 'Holding it now', description: 'It rides along in every new AI action.' })
    },
  }

  return (
    <ShellPopover
      open={open}
      onOpenChange={setOpen}
      title="Holding"
      width={360}
      trigger={(props, state) => (
        <button
          type="button"
          {...(props as object)}
          {...dropProps}
          aria-label={`Holding ${count} item${count === 1 ? '' : 's'}`}
          className={cn(
            'relative flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-sm px-2 transition-colors duration-(--dur-1) ease-standard',
            'text-ink-3 hover:bg-hover hover:text-ink active:bg-press',
            state.open && 'bg-hover text-ink',
            dragOver && 'bg-accent-tint text-ink outline outline-1 outline-ink',
          )}
        >
          <Layers aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
          {showLabel && <span className="type-body-sm font-medium">Holding</span>}
          <span className={cn('type-meta tabular-nums', count === 0 ? 'text-ink-4' : 'text-ink')}>{count}</span>
        </button>
      )}
    >
      {() => <HoldingPanel pinned={pinned} />}
    </ShellPopover>
  )
}

function HoldingPanel({ pinned }: { pinned: ContextItem[] }) {
  const total = useMemo(() => pinned.reduce((sum, p) => sum + estimateRefTokens(p.ref), 0), [pinned])
  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
        <h2 className="type-title-3 flex-1 text-[15px]">Holding</h2>
        {pinned.length > 0 && <span className="type-meta text-ink-3">{formatTokenEstimate(total)}</span>}
      </header>
      {pinned.length === 0 ? (
        <div className="flex flex-col items-start gap-1.5 px-4 py-5">
          <p className="type-body-sm font-medium text-ink">Nothing held</p>
          <p className="type-caption text-ink-3">Press H on any item, or drag a chip onto the Holding chip, to keep it in every new AI action.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5" aria-label="Held items">
          {pinned.map((p) => (
            <HeldRow key={`${p.ref.kind}:${p.ref.id}`} item={p} />
          ))}
        </ul>
      )}
      <footer className="flex shrink-0 flex-col gap-2.5 border-t border-line px-4 py-3">
        <p className="type-caption text-ink-3">Held items ride along in every new AI action. Switch them off per action in the composer.</p>
        {pinned.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="type-meta text-ink-3">
              Total {formatTokenEstimate(total)}
            </span>
            <Button size="sm" variant="ghost" onClick={releaseAll}>
              Release all
            </Button>
          </div>
        )}
      </footer>
    </div>
  )
}

function HeldRow({ item }: { item: ContextItem }) {
  const entity = useEntity(item.ref)
  const tokens = estimateRefTokens(item.ref)
  return (
    <li className="group flex h-9 items-center gap-2 rounded-sm px-2 hover:bg-hover">
      <span className="min-w-0 flex-1">
        <EntityChip entity={item.ref} size="md" className="max-w-full" />
      </span>
      <span className="type-meta shrink-0 text-ink-3 tabular-nums">{formatTokenEstimate(tokens)}</span>
      <IconButton icon={X} size="xs" label={`Release ${entity.title}`} tooltip="Release" onClick={() => releaseOne(item.ref)} />
      <VisuallyHidden>{entity.exists ? '' : 'Deleted item'}</VisuallyHidden>
    </li>
  )
}
