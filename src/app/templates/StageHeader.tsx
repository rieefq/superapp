import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ChevronLeft, Ellipsis, PanelLeft, PanelRight } from 'lucide-react'
import { IconButton, Menu, Tabs, type MenuItem, type TabItem } from '@/ui'
import { cn } from '@/lib/cn'
import { useShellLayout } from '../shell/context'
import { useWorkspaceScreen } from './WorkspaceScreen'

export interface StageHeaderTabs<T extends string = string> {
  items: readonly TabItem<T>[]
  value?: T
  onChange?: (value: T) => void
  'aria-label'?: string
}

export interface StageHeaderProps<T extends string = string> {
  /** The item title (the top bar never repeats it). */
  title: ReactNode
  /** Make the title editable inline (renamable items). Called with the trimmed new title. */
  onRename?: (title: string) => void
  /** A mark before the title (entity mark, glyph). */
  leading?: ReactNode
  /** Status chip after the title. */
  status?: ReactNode
  /** Underline tabs; they drop to a second 40px row when the header is narrow. */
  tabs?: StageHeaderTabs<T>
  /** Up to three actions (buttons). */
  actions?: ReactNode
  /** The ⋯ menu: rename, copy link, copy handle, archive/delete, export. */
  menu?: MenuItem[]
  /** Hide the Inspector toggle (rare: full-screen editors). */
  hideInspectorToggle?: boolean
  /** Phones: where the back button goes (default: the workspace root). */
  backTo?: string
  className?: string
}

/**
 * The 48px stage header (§3.4): list-pane toggle · title (inline rename) · status · tabs · up to 3
 * actions + ⋯ · Inspector toggle. On phones it leads with a back button to the list.
 */
export function StageHeader<T extends string = string>({
  title,
  onRename,
  leading,
  status,
  tabs,
  actions,
  menu,
  hideInspectorToggle,
  backTo,
  className,
}: StageHeaderProps<T>) {
  const navigate = useNavigate()
  const layout = useShellLayout()
  const screen = useWorkspaceScreen()
  const phone = layout.formFactor === 'phone'
  const showBack = phone && screen.hasList && screen.phoneView === 'stage'
  const showListToggle = !phone && screen.hasList && (screen.listMode === 'collapsed' || screen.listMode === 'drawer' || layout.formFactor === 'tablet')
  const tabsNode = (variant: 'inline' | 'row') =>
    tabs ? (
      <Tabs
        items={tabs.items}
        value={tabs.value}
        onValueChange={tabs.onChange}
        size="md"
        aria-label={tabs['aria-label'] ?? 'Views'}
        className={cn('border-b-0', variant === 'inline' ? 'gap-5' : 'gap-5 px-4 md:px-5')}
      />
    ) : null

  return (
    <header className={cn('@container shrink-0 border-b border-line bg-canvas', className)}>
      <div className="flex h-12 items-center gap-1.5 pr-2 pl-3 md:pl-4">
        {showBack && (
          <IconButton icon={ChevronLeft} label="Back to the list" size="sm" onClick={() => navigate(backTo ?? layout.workspace.path)} className="-ml-1.5" />
        )}
        {showListToggle && (
          <IconButton icon={PanelLeft} label="Show the list" shortcut="[" size="sm" onClick={screen.toggleList} tooltipPlacement="bottom" className="-ml-1" />
        )}
        {leading && <span className="flex shrink-0 items-center">{leading}</span>}
        <div className="flex min-w-28 flex-1 items-center gap-2">
          <Title title={title} onRename={onRename} />
          {status && <span className="flex shrink-0 items-center">{status}</span>}
        </div>
        {tabs && <div className="hidden h-12 shrink-0 items-end self-stretch @min-[760px]:flex">{tabsNode('inline')}</div>}
        {actions && <div className="no-scrollbar flex min-w-0 shrink items-center gap-1.5 overflow-x-auto pl-1">{actions}</div>}
        {menu && menu.length > 0 && (
          <Menu items={menu} aria-label="More actions" placement="bottom-end" trigger={<IconButton icon={Ellipsis} label="More actions" size="sm" shortcut="." tooltipPlacement="bottom" />} />
        )}
        {!hideInspectorToggle && (
          <IconButton
            icon={PanelRight}
            label={layout.inspectorOpen ? 'Hide the Inspector' : 'Show the Inspector'}
            shortcut="]"
            size="sm"
            active={layout.inspectorOpen}
            onClick={layout.toggleInspector}
            tooltipPlacement="bottom"
          />
        )}
      </div>
      {tabs && <div className="flex h-10 items-end @min-[760px]:hidden">{tabsNode('row')}</div>}
    </header>
  )
}

function Title({ title, onRename }: { title: ReactNode; onRename?: (title: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const text = typeof title === 'string' ? title : ''

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  if (!onRename || !text) {
    return <h1 className="type-title-3 min-w-0 truncate text-ink">{title}</h1>
  }
  if (editing) {
    const commit = () => {
      const next = draft.replace(/\s+/g, ' ').trim()
      setEditing(false)
      if (next && next !== text) onRename(next)
    }
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setEditing(false)
          }
        }}
        aria-label="Title"
        className="type-title-3 -mx-1.5 h-8 min-w-0 flex-1 rounded-sm border border-line-input bg-raised px-1.5 text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-(--focus-ring)"
      />
    )
  }
  return (
    <h1 className="min-w-0">
      <button
        type="button"
        onClick={() => {
          setDraft(text)
          setEditing(true)
        }}
        title="Rename"
        className="type-title-3 -mx-1.5 block max-w-full truncate rounded-sm px-1.5 text-left text-ink transition-colors duration-(--dur-1) hover:bg-hover"
      >
        {title}
      </button>
    </h1>
  )
}
