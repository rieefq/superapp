import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Layers, Paperclip, Plus, X } from 'lucide-react'
import { useEntity } from '@/core/services/entities'
import { cn } from '@/lib/cn'
import { HUE_FILL, Sheet, Switch, Tooltip, toast } from '@/ui'
import { EntityMark } from '../sig'
import type { ComposerContext, ContextEntry, ContextGroup } from './useComposerContext'
import { useOpenContextInspector } from './ContextMeter'
import { formatTokenCount } from './tokens'

export interface ContextLineProps {
  context: ComposerContext
  /** Collapse into one `Context · n` chip that opens a sheet with toggles (phones, compact composers). */
  collapsed?: boolean
  /** Replaces the project chip (e.g. a ProjectPicker in the Start sheet). */
  projectSlot?: ReactNode
  /** Opens Inspector › Context for "+n more" (default: the current workspace's Inspector). */
  onOpenInspector?: () => void
  /** Wrap onto more lines instead of folding into "+n more" (sheets and dialogs, where the Inspector is out of reach). */
  wrap?: boolean
  className?: string
}

const GROUP_LABEL: Record<ContextGroup, string> = {
  project: 'Project memory',
  held: 'Held',
  attached: 'Attached',
  file: 'Attached file',
  likely: 'Likely',
}

/**
 * Context Line (§5.4.10, §2.5): Project → Held → Attached → Likely. Click a chip to switch it off for
 * this action (struck through); × removes it (releases a held item, detaches an attachment, excludes a
 * likely match). Likely chips are dimmed with a `+`; clicking one attaches it. Overflow folds into
 * "+n more", which opens Inspector › Context.
 */
export function ContextLine({ context, collapsed, projectSlot, onOpenInspector, wrap, className }: ContextLineProps) {
  const openInspector = useOpenContextInspector()
  const entries = context.entries
  if (!entries.length && !projectSlot) return null
  if (collapsed) return <CollapsedContext context={context} className={className} />
  return <ChipRow context={context} projectSlot={projectSlot} onMore={onOpenInspector ?? openInspector} wrap={wrap} className={className} />
}

// ------------------------------------------------------------------------------------------------ chip row

function ChipRow({ context, projectSlot, onMore, wrap, className }: { context: ComposerContext; projectSlot?: ReactNode; onMore: () => void; wrap?: boolean; className?: string }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(0)
  const entries = context.entries
  const signature = entries.map((e) => `${e.key}:${e.on ? 1 : 0}`).join('|')

  // Fold chips that do not fit into "+n more" (measured; chips keep their natural width).
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row || wrap) return
    const measure = () => {
      const chips = Array.from(row.querySelectorAll<HTMLElement>('[data-context-chip]'))
      chips.forEach((c) => (c.style.display = ''))
      const limit = row.clientWidth - 88 // room for "+n more"
      let count = 0
      const fitsAll = chips.every((c) => c.offsetLeft + c.offsetWidth <= row.clientWidth)
      if (!fitsAll) {
        for (const c of chips) {
          if (c.offsetLeft + c.offsetWidth > limit) {
            c.style.display = 'none'
            count++
          }
        }
      }
      setHidden(count)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    return () => ro.disconnect()
  }, [signature, wrap])

  let lastGroup: ContextGroup | 'slot' | null = projectSlot ? 'slot' : null
  return (
    <div
      ref={rowRef}
      role="group"
      aria-label="Context for this action"
      className={cn('flex min-w-0 items-center gap-1.5', wrap ? 'flex-wrap py-0.5' : 'h-7 overflow-hidden', className)}
    >
      {projectSlot}
      {entries.map((e) => {
        const group = e.group === 'file' ? 'attached' : e.group
        const divider = lastGroup !== null && lastGroup !== group && !(lastGroup === 'slot' && group === 'project')
        lastGroup = group
        return (
          <span key={e.key} data-context-chip className="flex shrink-0 items-center gap-1.5">
            {divider && <span aria-hidden className="h-3 w-px shrink-0 bg-line-strong" />}
            <ContextChip entry={e} context={context} />
          </span>
        )
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={onMore}
          className="type-caption h-[22px] shrink-0 rounded-sm px-1.5 font-medium text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
        >
          +{hidden} more
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ chips

function ProjectMark({ hue, off }: { hue: string; off?: boolean }) {
  return <span aria-hidden className={cn('size-2.5 shrink-0 rounded-[3px]', HUE_FILL[hue as keyof typeof HUE_FILL], off && 'opacity-40')} />
}

export interface ContextChipProps {
  entry: ContextEntry
  context: ComposerContext
}

/** One Context Line chip (22px): toggle for this action, optional ×. */
export function ContextChip({ entry, context }: ContextChipProps) {
  if (entry.group === 'project') return <ProjectChip entry={entry} context={context} />
  if (entry.group === 'file') return <FileChip entry={entry} context={context} />
  return <RefChip entry={entry} context={context} />
}

const CHIP = 'group/chip inline-flex h-[22px] max-w-[240px] shrink-0 items-stretch rounded-sm border text-xs font-medium transition-colors duration-(--dur-1) ease-standard'
const CHIP_BUTTON =
  'inline-flex min-w-0 items-center gap-1.5 rounded-[5px] px-1.5 outline-offset-1 transition-colors duration-(--dur-1) ease-standard hover:bg-hover'

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative -ml-0.5 grid w-5 shrink-0 place-items-center rounded-[5px] text-ink-3 outline-offset-1 transition-colors duration-(--dur-1) hover:bg-press hover:text-ink",
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']",
      )}
    >
      <X aria-hidden className="size-3" strokeWidth={2} />
    </button>
  )
}

function ProjectChip({ entry, context }: ContextChipProps) {
  const project = context.project
  if (!project) return null
  const count = project.pinnedRefs.length
  const on = entry.on
  return (
    <span className={cn(CHIP, 'border-line-strong text-ink-2')}>
      <Tooltip
        content={
          on
            ? `Project memory · ${formatTokenCount(entry.tokens)} tok · goal, instructions${count ? ` and ${count} pinned item${count === 1 ? '' : 's'}` : ''} ride along. Click to leave it out of this action.`
            : 'Project memory is off for this action. Click to include it.'
        }
      >
        <button
          type="button"
          aria-pressed={on}
          aria-label={`Project memory: ${project.name}${count ? `, ${count} items` : ''}, ${on ? 'included' : 'left out'}`}
          onClick={() => context.toggle(entry.key)}
          className={CHIP_BUTTON}
        >
          <ProjectMark hue={project.hue} off={!on} />
          <span className={cn('truncate', on ? 'text-ink' : 'text-ink-4 line-through decoration-ink-4')}>{project.name}</span>
          {count > 0 && <span className={cn('shrink-0 font-normal', on ? 'text-ink-3' : 'text-ink-4 line-through')}>· memory {count}</span>}
        </button>
      </Tooltip>
    </span>
  )
}

function FileChip({ entry, context }: ContextChipProps) {
  const f = entry.file
  if (!f) return null
  const on = entry.on
  const what = f.kind === 'image' ? 'Image' : f.text ? 'File' : 'File (contents not read)'
  return (
    <span className={cn(CHIP, 'border-line-strong text-ink-2')}>
      <Tooltip content={`${what} · ${formatTokenCount(entry.tokens)} tok · read locally, never uploaded. Click to ${on ? 'leave it out' : 'include it'}.`}>
        <button type="button" aria-pressed={on} aria-label={`Attached file ${f.name}, ${on ? 'included' : 'left out'}`} onClick={() => context.toggle(entry.key)} className={CHIP_BUTTON}>
          {f.previewUrl ? (
            <img src={f.previewUrl} alt="" className={cn('size-3.5 shrink-0 rounded-[3px] object-cover', !on && 'opacity-40')} />
          ) : (
            <Paperclip aria-hidden className={cn('size-3 shrink-0', on ? 'text-ink-3' : 'text-ink-4')} strokeWidth={2} />
          )}
          <span className={cn('truncate', on ? 'text-ink' : 'text-ink-4 line-through decoration-ink-4')}>{f.name}</span>
        </button>
      </Tooltip>
      <RemoveButton label={`Remove ${f.name}`} onClick={() => context.removeFile(f.id)} />
    </span>
  )
}

function RefChip({ entry, context }: ContextChipProps) {
  const ref = entry.ref!
  const e = useEntity(ref)
  const on = entry.on
  const likely = entry.group === 'likely'
  const name = e.exists ? e.title : 'Missing item'

  if (likely) {
    const terms = entry.terms?.length ? `Matches: ${entry.terms.join(', ')}` : 'Matches your draft'
    return (
      <span className={cn(CHIP, 'border-line text-ink-3 hover:text-ink-2', !on && 'opacity-70')}>
        <Tooltip content={`${terms} · ${formatTokenCount(entry.tokens)} tok · Click to attach`}>
          <button
            type="button"
            aria-label={`Likely: ${name}. ${terms}. Attach`}
            onClick={() => context.attach(ref)}
            className={cn(CHIP_BUTTON, 'hover:text-ink')}
          >
            <Plus aria-hidden className="size-3 shrink-0" strokeWidth={2} />
            <span className="truncate">{name}</span>
          </button>
        </Tooltip>
        <RemoveButton label={`Exclude ${name}`} onClick={() => context.dismissLikely(ref)} />
      </span>
    )
  }

  const held = entry.group === 'held'
  const verb = on ? 'Click to leave it out of this action.' : 'Off for this action. Click to include it.'
  return (
    <span className={cn(CHIP, 'border-line-strong text-ink-2', !e.exists && 'border-dashed')}>
      <Tooltip content={`${GROUP_LABEL[entry.group]} · ${formatTokenCount(entry.tokens)} tok · ${verb}`}>
        <button
          type="button"
          aria-pressed={on}
          aria-label={`${GROUP_LABEL[entry.group]}: ${name}, ${on ? 'included' : 'left out'}`}
          onClick={() => context.toggle(entry.key)}
          className={CHIP_BUTTON}
        >
          <span className={cn('flex shrink-0', !on && 'opacity-40')}>
            <EntityMark entity={ref} resolved={e} size={14} />
          </span>
          <span className={cn('truncate', on ? 'text-ink' : 'text-ink-4 line-through decoration-ink-4')}>{name}</span>
          {e.simulated && <span className="type-meta-caps sim-hatch -my-px shrink-0 rounded-xs border border-dashed border-line-input px-1 text-[10px] leading-[14px] text-sim-ink">SIM</span>}
        </button>
      </Tooltip>
      <RemoveButton
        label={held ? `Release ${name}` : `Remove ${name}`}
        onClick={() => {
          if (held) {
            context.release(ref)
            toast({
              title: `Released “${name}”`,
              description: 'It no longer rides along in new AI actions.',
              action: { label: 'Undo', onClick: () => context.hold(ref) },
            })
          } else context.detach(ref)
        }}
      />
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ collapsed

function CollapsedContext({ context, className }: { context: ComposerContext; className?: string }) {
  const [open, setOpen] = useState(false)
  const on = context.entries.filter((e) => e.on && e.group !== 'likely').length
  const likely = context.entries.filter((e) => e.group === 'likely').length
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          'inline-flex h-[22px] w-fit shrink-0 items-center gap-1.5 rounded-sm border border-line-strong px-1.5 text-xs font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink',
          className,
        )}
      >
        <Layers aria-hidden className="size-3 text-ink-3" strokeWidth={2} />
        Context · {on}
        {likely > 0 && <span className="font-normal text-ink-3">+{likely}</span>}
      </button>
      <Sheet open={open} onOpenChange={setOpen} side="bottom" title="Context for this action" description="Switch items off for this action, or remove them.">
        <ul className="flex flex-col pb-2">
          {context.entries.map((e) => (
            <CollapsedRow key={e.key} entry={e} context={context} />
          ))}
        </ul>
      </Sheet>
    </>
  )
}

function CollapsedRow({ entry, context }: ContextChipProps) {
  const e = useEntity(entry.ref ?? { kind: 'project', id: context.projectId ?? '' })
  const title = entry.group === 'project' ? (context.project?.name ?? 'Project') : entry.group === 'file' ? (entry.file?.name ?? 'File') : e.title
  return (
    <li className="flex min-h-11 items-center gap-3 border-b border-line py-1.5 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-label text-ink-3">{GROUP_LABEL[entry.group]}</span>
        <span className={cn('type-body-sm truncate', entry.on ? 'text-ink' : 'text-ink-4 line-through')}>{title}</span>
      </div>
      <span className="type-meta shrink-0 text-ink-3">{formatTokenCount(entry.tokens)} tok</span>
      {entry.group === 'likely' ? (
        <button type="button" onClick={() => entry.ref && context.attach(entry.ref)} className="type-caption rounded-sm px-2 py-1 font-medium text-ink-2 hover:bg-hover hover:text-ink">
          Attach
        </button>
      ) : (
        <Switch size="sm" checked={entry.on} onCheckedChange={() => context.toggle(entry.key)} aria-label={`Include ${title}`} />
      )}
    </li>
  )
}
