import { useEffect, useState, type ReactElement, type RefObject } from 'react'
import { useNavigate } from 'react-router'
import { BookPlus, Check, CornerUpRight, Layers } from 'lucide-react'
import { openStartSheet, type StartKind } from '@/app/shell/store'
import { useContextStore, useIsPinned } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { entityRoute, toKnowledge, useEntity } from '@/core/services'
import { sameRef, type EntityRef } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, IconButton, Menu, isTypingTarget, toast, type ButtonSize, type ButtonVariant, type MenuItem } from '@/ui'
import { START_KIND_META, START_KINDS } from '../start/kinds'

/**
 * Connected actions for any entity: Turn into… (T), Hold (H), Save to Knowledge (S). Each works as a
 * visible control; the single-key shortcut fires while focus is inside `hotkeyScope` (§3.11).
 */

/** Listen for a single key (no modifiers, not while typing) inside a focus scope. */
export function useScopedKey(scope: RefObject<HTMLElement | null> | undefined, key: string, handler: () => void, enabled = true): void {
  useEffect(() => {
    const el = scope?.current
    if (!el || !enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (e.key.toLowerCase() !== key || isTypingTarget(e.target)) return
      e.preventDefault()
      handler()
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  })
}

// ------------------------------------------------------------------------------------------------ Turn into

export interface TurnIntoMenuProps {
  /** The source: any entity (message, finding, task, report, run…). */
  entity: EntityRef
  /** Kinds to offer (default: all seven). */
  kinds?: readonly StartKind[]
  /** Prefill passed to the Start sheet (e.g. a selection as the brief). */
  prefill?: Record<string, unknown>
  /** Custom trigger element; default is a "Turn into…" button. */
  trigger?: ReactElement
  size?: ButtonSize
  variant?: ButtonVariant
  /** `T` opens the menu while focus is inside this element. */
  hotkeyScope?: RefObject<HTMLElement | null>
  className?: string
}

/** 'Turn into…' (§7.1): opens the Start sheet with that kind and the entity as the source. */
export function TurnIntoMenu({ entity, kinds = START_KINDS, prefill, trigger, size = 'sm', variant = 'ghost', hotkeyScope, className }: TurnIntoMenuProps) {
  const [open, setOpen] = useState(false)
  useScopedKey(hotkeyScope, 't', () => setOpen(true))
  const items: MenuItem[] = [
    { type: 'label', label: 'Turn into' },
    ...kinds.map((k) => ({
      id: k,
      label: START_KIND_META[k].label,
      icon: START_KIND_META[k].icon,
      onSelect: () => openStartSheet(k, { source: entity, prefill }),
    })),
  ]
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      items={items}
      aria-label="Turn into"
      trigger={
        trigger ?? (
          <Button size={size} variant={variant} leadingIcon={CornerUpRight} className={className} aria-keyshortcuts="t">
            Turn into…
          </Button>
        )
      }
    />
  )
}

/** Alias for workspaces written against the older name. */
export const HandoffMenu = TurnIntoMenu

// ------------------------------------------------------------------------------------------------ Hold

export interface HoldButtonProps {
  entity: EntityRef
  size?: ButtonSize
  variant?: ButtonVariant
  /** Icon-only (lists, hover actions). */
  iconOnly?: boolean
  /** `H` toggles while focus is inside this element. */
  hotkeyScope?: RefObject<HTMLElement | null>
  className?: string
}

/** Hold / Release (§2.5): held items ride along in every new AI action. */
export function HoldButton({ entity, size = 'sm', variant = 'ghost', iconOnly, hotkeyScope, className }: HoldButtonProps) {
  const held = useIsPinned(entity)
  const e = useEntity(entity)
  const toggle = () => {
    const store = useContextStore.getState()
    if (held) {
      store.unpin(entity)
      toast({
        title: `Released “${e.title}”`,
        description: 'It no longer rides along in new AI actions.',
        action: { label: 'Undo', onClick: () => useContextStore.getState().pin(entity) },
      })
    } else {
      store.pin(entity)
    }
  }
  useScopedKey(hotkeyScope, 'h', toggle)
  const label = held ? 'Release' : 'Hold'
  if (iconOnly) {
    return (
      <IconButton
        icon={Layers}
        label={held ? `Release “${e.title}”` : `Hold “${e.title}” — it rides along in new AI actions`}
        shortcut="h"
        size={size === 'lg' ? 'lg' : size}
        active={held}
        onClick={toggle}
        className={className}
      />
    )
  }
  return (
    <Button
      size={size}
      variant={variant}
      leadingIcon={held ? Check : Layers}
      aria-pressed={held}
      aria-keyshortcuts="h"
      onClick={toggle}
      className={cn(held && 'text-ink', className)}
    >
      {label}
    </Button>
  )
}

/** Alias for workspaces written against the older name. */
export const PinButton = HoldButton

// ------------------------------------------------------------------------------------------------ Save to Knowledge

export interface SaveToKnowledgeButtonProps {
  entity: EntityRef
  size?: ButtonSize
  variant?: ButtonVariant
  iconOnly?: boolean
  /** `S` saves while focus is inside this element. */
  hotkeyScope?: RefObject<HTMLElement | null>
  /** Called after saving. */
  onDone?: () => void
  className?: string
}

/** The knowledge item already saved from this entity, if any. */
function useSavedFrom(entity: EntityRef): string | undefined {
  return useDB((s: Tables) => {
    if (entity.kind === 'knowledge') return entity.id
    if (entity.kind === 'investigation') {
      const k = s.investigations[entity.id]?.knowledgeId
      if (k && s.knowledge[k]) return k
    }
    for (const k of Object.values(s.knowledge)) if (k.source.ref && sameRef(k.source.ref, entity)) return k.id
    return undefined
  })
}

/** Save to Knowledge (§2.5, `S`): durable, retrievable, with provenance. Uses the toKnowledge handoff. */
export function SaveToKnowledgeButton({ entity, size = 'sm', variant = 'ghost', iconOnly, hotkeyScope, onDone, className }: SaveToKnowledgeButtonProps) {
  const navigate = useNavigate()
  const saved = useSavedFrom(entity)
  const [busy, setBusy] = useState(false)
  const save = () => {
    if (saved) {
      navigate(entityRoute({ kind: 'knowledge', id: saved }))
      return
    }
    setBusy(true)
    try {
      const result = toKnowledge(entity)
      onDone?.()
      toast({ tone: 'success', title: 'Saved to Knowledge', description: 'Retrievable in every composer from now on.', action: { label: 'Open', onClick: () => navigate(result.route) } })
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t save to Knowledge', description: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }
  useScopedKey(hotkeyScope, 's', save)
  const label = saved ? 'In Knowledge' : 'Save to Knowledge'
  if (iconOnly) {
    return (
      <IconButton icon={saved ? Check : BookPlus} label={saved ? 'Open in Knowledge' : 'Save to Knowledge'} shortcut="s" size={size === 'lg' ? 'lg' : size} loading={busy} onClick={save} className={className} />
    )
  }
  return (
    <Button size={size} variant={variant} leadingIcon={saved ? Check : BookPlus} loading={busy} aria-keyshortcuts="s" onClick={save} className={className}>
      {label}
    </Button>
  )
}
