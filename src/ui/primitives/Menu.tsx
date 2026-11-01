import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { Check, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useControllableState } from '@/ui/hooks/useControllableState'
import { useReducedMotion } from '@/ui/hooks/useReducedMotion'
import { toAriaKeyShortcuts } from '@/ui/hooks/hotkeys'
import { KbdCombo } from './Kbd'
import { focusElement, getTabbables, registerReturnTarget, suppressTooltips, useLayer } from './layers'
import { floatingMotion } from './motion'
import { Portal } from './Portal'
import { pointRect, type Placement } from './positioning'
import { mergeProps, mergeRefs } from './slot'
import { findTypeaheadMatch, isTypeaheadKey, useTypeahead } from './typeahead'
import { useFloating, type FloatingAnchor } from './useFloating'

// ------------------------------------------------------------------------------------------------ types

interface MenuItemBase {
  id?: string
  label: string
  icon?: LucideIcon
  /** Second line, quieter. */
  description?: string
  /** Display-only shortcut, e.g. 'mod+d'. */
  shortcut?: string
  disabled?: boolean
  /** Keep the menu open after selecting (toggles). */
  keepOpen?: boolean
}

export interface MenuActionItem extends MenuItemBase {
  type?: 'item'
  /** Destructive action: fail-colored. */
  danger?: boolean
  onSelect?: () => void
}

export interface MenuCheckboxItem extends MenuItemBase {
  type: 'checkbox'
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

export interface MenuRadioItem extends MenuItemBase {
  type: 'radio'
  checked: boolean
  onSelect: () => void
}

export interface MenuSeparator {
  type: 'separator'
  id?: string
}

export interface MenuLabel {
  type: 'label'
  label: string
  id?: string
}

export type MenuItem = MenuActionItem | MenuCheckboxItem | MenuRadioItem | MenuSeparator | MenuLabel
type ActionableItem = MenuActionItem | MenuCheckboxItem | MenuRadioItem

function isActionable(item: MenuItem): item is ActionableItem {
  return item.type !== 'separator' && item.type !== 'label'
}

// ------------------------------------------------------------------------------------------------ panel

interface Section {
  key: string
  label?: string
  entries: { item: ActionableItem; index: number }[]
  separatorBefore: boolean
}

function toSections(items: readonly MenuItem[]): { sections: Section[]; flat: ActionableItem[] } {
  const sections: Section[] = []
  const flat: ActionableItem[] = []
  let current: Section | null = null
  let pendingSeparator = false
  items.forEach((item, i) => {
    if (item.type === 'separator') {
      pendingSeparator = sections.length > 0 || (current?.entries.length ?? 0) > 0
      current = null
      return
    }
    if (item.type === 'label' || !current) {
      current = { key: item.id ?? `s${i}`, label: item.type === 'label' ? item.label : undefined, entries: [], separatorBefore: pendingSeparator }
      pendingSeparator = false
      sections.push(current)
      if (item.type === 'label') return
    }
    if (isActionable(item)) {
      current.entries.push({ item, index: flat.length })
      flat.push(item)
    }
  })
  return { sections: sections.filter((s) => s.entries.length > 0 || s.label), flat }
}

interface MenuPanelProps {
  items: readonly MenuItem[]
  anchor: FloatingAnchor | null
  placement: Placement
  offset?: number
  /** Which item to focus when the menu opens. */
  focusOnOpen: 'first' | 'last' | 'none'
  onClose: (reason: 'select' | 'escape' | 'outside' | 'tab') => void
  /** Elements counted as inside (the trigger), so pressing it toggles instead of closing+reopening. */
  insideRefs?: { current: Element | null }[]
  returnFocusTo: HTMLElement | null
  id: string
  labelledBy?: string
  ariaLabel?: string
  className?: string
}

function MenuPanel({
  items,
  anchor,
  placement,
  offset = 4,
  focusOnOpen,
  onClose,
  insideRefs = [],
  returnFocusTo,
  id,
  labelledBy,
  ariaLabel,
  className,
}: MenuPanelProps) {
  const { sections, flat } = useMemo(() => toSections(items), [items])
  const panelRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [active, setActive] = useState(-1)
  const reduced = useReducedMotion()
  const typeahead = useTypeahead()
  const floating = useFloating({ open: true, anchor, placement, offset, padding: 8 })
  const preset = floatingMotion(floating.side, reduced)
  // One shared leading slot (icon, or the check/radio indicator) keeps every label on the same column.
  const hasLeading = flat.some((i) => i.icon || i.type === 'checkbox' || i.type === 'radio')
  const labels = useMemo(() => flat.map((i) => i.label), [flat])
  const isDisabled = useCallback((i: number) => !!flat[i]?.disabled, [flat])
  // While exiting (fade-out), the panel is no longer an interactive layer.
  const present = useIsPresent()

  useLayer({
    open: present,
    inside: [panelRef, ...insideRefs],
    onEscape: () => onClose('escape'),
    onOutside: () => onClose('outside'),
  })

  // Initial focus (mount only): an item (keyboard open) or the panel itself (pointer open).
  const mountState = useRef({ flat, focusOnOpen, returnFocusTo })
  useEffect(() => {
    const { flat: initialFlat, focusOnOpen: how, returnFocusTo: returnTo } = mountState.current
    registerReturnTarget(panelRef.current, returnTo)
    const frame = requestAnimationFrame(() => {
      const enabled = initialFlat.map((_, i) => i).filter((i) => !initialFlat[i].disabled)
      if (how === 'first' && enabled.length) setActive(enabled[0])
      else if (how === 'last' && enabled.length) setActive(enabled[enabled.length - 1])
      else focusElement(panelRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  // Hand focus back as soon as the menu closes — only if focus is still in the menu (or was lost).
  useEffect(() => {
    if (present) return
    const current = document.activeElement
    if (!current || current === document.body || panelRef.current?.contains(current)) {
      suppressTooltips()
      focusElement(returnFocusTo)
    }
  }, [present, returnFocusTo])

  useEffect(() => {
    if (active >= 0) focusElement(itemRefs.current[active])
  }, [active])

  const move = (dir: 1 | -1) => {
    const n = flat.length
    if (!n) return
    let i = active
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n
      if (i < 0) i = n - 1
      if (!flat[i].disabled) {
        setActive(i)
        return
      }
    }
  }

  const activate = (index: number) => {
    const item = flat[index]
    if (!item || item.disabled) return
    if (item.type === 'checkbox') item.onCheckedChange(!item.checked)
    else item.onSelect?.()
    if (!item.keepOpen) onClose('select')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        e.preventDefault()
        setActive(flat.findIndex((i) => !i.disabled))
        break
      case 'End': {
        e.preventDefault()
        for (let i = flat.length - 1; i >= 0; i--) {
          if (!flat[i].disabled) {
            setActive(i)
            break
          }
        }
        break
      }
      case 'Enter':
      case ' ':
        if (e.key === ' ' && typeahead.active()) {
          e.preventDefault()
          const match = findTypeaheadMatch(labels, typeahead.push(' '), active, isDisabled)
          if (match >= 0) setActive(match)
          break
        }
        e.preventDefault()
        if (active >= 0) activate(active)
        break
      case 'Tab': {
        // Close and move on from the trigger, as if the menu were never there.
        e.preventDefault()
        const from = returnFocusTo
        onClose('tab')
        if (from) {
          const all = getTabbables(document.body)
          const at = all.indexOf(from)
          const next = all[at + (e.shiftKey ? -1 : 1)]
          focusElement(next ?? from)
        }
        break
      }
      default:
        if (isTypeaheadKey(e)) {
          e.preventDefault()
          const match = findTypeaheadMatch(labels, typeahead.push(e.key), active, isDisabled)
          if (match >= 0) setActive(match)
        }
    }
  }

  return (
    <motion.div
      ref={mergeRefs(panelRef, floating.setFloating)}
      id={id}
      role="menu"
      aria-orientation="vertical"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : ariaLabel}
      tabIndex={-1}
      data-layer=""
      initial={preset.initial}
      animate={preset.animate}
      exit={preset.exit}
      transition={preset.transition}
      onKeyDown={onKeyDown}
      onPointerLeave={() => {
        setActive(-1)
        focusElement(panelRef.current)
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'fixed top-0 left-0 z-(--z-popover) flex min-w-48 max-w-80 flex-col overflow-y-auto overscroll-contain rounded-md border border-line bg-overlay p-1 shadow-e1 outline-none',
        className,
      )}
    >
      {sections.map((section) => (
        <div key={section.key} role="group" aria-label={section.label} className="flex flex-col">
          {section.separatorBefore && <div role="separator" className="-mx-1 my-1 h-px bg-line" />}
          {section.label && (
            <div aria-hidden className="type-label px-2 pt-1.5 pb-1 text-ink-3 select-none">
              {section.label}
            </div>
          )}
          {section.entries.map(({ item, index }) => {
            const Icon = item.icon
            const danger = (item.type === undefined || item.type === 'item') && (item as MenuActionItem).danger
            const checked = item.type === 'checkbox' || item.type === 'radio' ? item.checked : undefined
            return (
              <div
                key={item.id ?? `${item.label}-${index}`}
                ref={(el) => {
                  itemRefs.current[index] = el
                }}
                role={item.type === 'checkbox' ? 'menuitemcheckbox' : item.type === 'radio' ? 'menuitemradio' : 'menuitem'}
                aria-checked={checked}
                aria-disabled={item.disabled || undefined}
                aria-keyshortcuts={item.shortcut ? toAriaKeyShortcuts(item.shortcut) : undefined}
                tabIndex={-1}
                data-active={active === index ? '' : undefined}
                onPointerMove={() => {
                  if (!item.disabled && active !== index) setActive(index)
                }}
                onClick={() => activate(index)}
                className={cn(
                  'group/item flex shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm outline-none select-none',
                  item.description ? 'py-1.5' : 'h-8 pointer-coarse:h-11',
                  danger ? 'text-fail-ink focus:bg-fail-tint' : 'text-ink-2 focus:bg-ink/8 focus:text-ink',
                  item.disabled && 'cursor-not-allowed opacity-45',
                )}
              >
                {hasLeading && (
                  <span aria-hidden className={cn('grid size-4 shrink-0 place-items-center', item.description && 'mt-0.5 self-start')}>
                    {item.type === 'checkbox' || item.type === 'radio' ? (
                      checked ? (
                        item.type === 'radio' ? (
                          <span className="size-1.5 rounded-full bg-current" />
                        ) : (
                          <Check className="size-3.5" strokeWidth={2.25} />
                        )
                      ) : null
                    ) : Icon ? (
                      <Icon
                        className={cn('size-4', danger ? 'text-fail-ink' : 'text-ink-3 group-focus/item:text-ink-2')}
                        strokeWidth={1.75}
                      />
                    ) : null}
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.label}</span>
                  {item.description && <span className="text-xs text-ink-3 text-pretty">{item.description}</span>}
                </span>
                {item.shortcut && (
                  <KbdCombo aria-hidden combo={item.shortcut} variant="plain" className={cn('ml-4', item.description && 'mt-0.5 self-start')} />
                )}
              </div>
            )
          })}
        </div>
      ))}
      {flat.length === 0 && <div className="px-2 py-1.5 text-sm text-ink-3">No actions</div>}
    </motion.div>
  )
}

// ------------------------------------------------------------------------------------------------ dropdown

export interface MenuTriggerProps {
  ref: Ref<HTMLElement>
  id: string
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls'?: string
  'data-state': 'open' | 'closed'
  onClick: (e: ReactMouseEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

export interface MenuProps {
  /** An element (Button/IconButton…) or a render function receiving trigger props to spread. */
  trigger: ReactElement | ((props: MenuTriggerProps, state: { open: boolean }) => ReactNode)
  items: readonly MenuItem[]
  placement?: Placement
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Accessible name for the menu (defaults to the trigger's label). */
  'aria-label'?: string
  className?: string
}

/**
 * Dropdown menu. Keyboard: Enter/Space/↓ open on the first item, ↑ on the last; arrows, Home/End and
 * typeahead move; Enter/Space select; Escape closes and returns focus; Tab closes and moves on.
 */
export function Menu({ trigger, items, placement = 'bottom-start', open: openProp, defaultOpen = false, onOpenChange, className, ...rest }: MenuProps) {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange })
  const [focusOnOpen, setFocusOnOpen] = useState<'first' | 'last' | 'none'>('none')
  const triggerRef = useRef<HTMLElement | null>(null)
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null)
  const baseId = useId()
  const triggerId = `${baseId}-trigger`
  const menuId = `${baseId}-menu`

  const show = (focus: 'first' | 'last' | 'none') => {
    setFocusOnOpen(focus)
    setOpen(true)
  }

  const triggerProps: MenuTriggerProps = {
    ref: mergeRefs(triggerRef, setTriggerEl),
    id: triggerId,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    'data-state': open ? 'open' : 'closed',
    onClick: (e) => {
      if (open) setOpen(false)
      // A click from the keyboard (Enter/Space on a button) has detail 0.
      else show(e.detail === 0 ? 'first' : 'none')
    },
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        show('first')
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        show('last')
      }
    },
  }

  let triggerNode: ReactNode
  if (typeof trigger === 'function') triggerNode = trigger(triggerProps, { open })
  else if (isValidElement(trigger))
    triggerNode = cloneElement(trigger as ReactElement<Record<string, unknown>>, mergeProps(trigger.props as Record<string, unknown>, triggerProps as unknown as Record<string, unknown>))

  return (
    <>
      {triggerNode}
      <AnimatePresence>
        {open && (
          <Portal>
            <MenuPanel
              items={items}
              anchor={triggerEl}
              placement={placement}
              focusOnOpen={focusOnOpen}
              insideRefs={[triggerRef]}
              returnFocusTo={triggerEl}
              onClose={() => setOpen(false)}
              id={menuId}
              labelledBy={rest['aria-label'] ? undefined : triggerId}
              ariaLabel={rest['aria-label']}
              className={className}
            />
          </Portal>
        )}
      </AnimatePresence>
    </>
  )
}

/** Alias for discoverability. */
export const DropdownMenu = Menu
export type DropdownMenuProps = MenuProps

// ------------------------------------------------------------------------------------------------ context menu

export interface ContextMenuProps {
  /** The region (one element) that opens the menu on right-click, Shift+F10 or the Menu key. */
  children: ReactElement
  /** Items, or a function of the element that was right-clicked (per-row menus). */
  items: readonly MenuItem[] | ((target: Element) => readonly MenuItem[])
  'aria-label'?: string
  className?: string
  disabled?: boolean
}

/** Right-click menu that opens at the pointer (or at the focused element from the keyboard). */
export function ContextMenu({ children, items, className, disabled, ...rest }: ContextMenuProps) {
  const [state, setState] = useState<{
    key: number
    anchor: FloatingAnchor
    items: readonly MenuItem[]
    focus: 'first' | 'none'
    returnTo: HTMLElement | null
  } | null>(null)
  const openCount = useRef(0)
  const menuId = useId()

  const resolveItems = (target: Element) => (typeof items === 'function' ? items(target) : items)

  const region = isValidElement(children)
    ? cloneElement(
        children as ReactElement<Record<string, unknown>>,
        mergeProps(children.props as Record<string, unknown>, {
          'aria-haspopup': 'menu',
          onContextMenu: (e: ReactMouseEvent) => {
            if (disabled) return
            e.preventDefault()
            const target = e.target as Element
            const returnTo = (document.activeElement as HTMLElement | null) ?? null
            const rect = pointRect(e.clientX, e.clientY)
            setState({
              key: ++openCount.current,
              anchor: { getBoundingClientRect: () => ({ left: rect.x, top: rect.y, width: 0, height: 0 }) },
              items: resolveItems(target),
              focus: 'none',
              returnTo,
            })
          },
          onKeyDown: (e: KeyboardEvent) => {
            if (disabled) return
            if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
              e.preventDefault()
              const target = (document.activeElement as HTMLElement | null) ?? (e.currentTarget as HTMLElement)
              const r = target.getBoundingClientRect()
              setState({
                key: ++openCount.current,
                anchor: { getBoundingClientRect: () => ({ left: r.left + 8, top: r.bottom, width: 0, height: 0 }) },
                items: resolveItems(target),
                focus: 'first',
                returnTo: target,
              })
            }
          },
        }),
      )
    : children

  return (
    <>
      {region}
      <AnimatePresence>
        {state && (
          <Portal key={state.key}>
            <MenuPanel
              items={state.items}
              anchor={state.anchor}
              placement="right-start"
              offset={2}
              focusOnOpen={state.focus}
              returnFocusTo={state.returnTo}
              onClose={() => setState(null)}
              id={menuId}
              ariaLabel={rest['aria-label'] ?? 'Context menu'}
              className={className}
            />
          </Portal>
        )}
      </AnimatePresence>
    </>
  )
}
