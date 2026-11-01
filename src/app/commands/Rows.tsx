import type { ComponentType, ReactNode } from 'react'
import { ArrowRight, ChevronDown, CornerDownLeft } from 'lucide-react'
import { useDB } from '@/core/db'
import { KIND_META, useEntity } from '@/core/services'
import type { Intent } from '@/core/ai'
import type { EntityRef, ID } from '@/core/types'
import { EntityMark, KbdCombo, SimBadge } from '@/ui'
import { shortCode } from '@/lib/id'
import { timeAgo, truncate } from '@/lib/format'
import { getManifest } from '../registry'
import type { Command } from '../types'
import { useLens } from '../lens/registry'
import type { LensProps } from '../lens/types'
import { GenericPanel } from '../inspector/ItemTab'
import type { Range } from './model'
import { VERB_EFFECT, VERB_LABEL } from './model'

/** Title text with matched ranges washed in --highlight (neutral; §4.1). */
export function Highlighted({ text, ranges }: { text: string; ranges?: Range[] }) {
  if (!ranges?.length) return <>{text}</>
  const out: ReactNode[] = []
  let at = 0
  ranges.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s))
    out.push(
      <mark key={i} className="rounded-[2px] bg-highlight text-inherit">
        {text.slice(s, e)}
      </mark>,
    )
    at = e
  })
  if (at < text.length) out.push(text.slice(at))
  return <>{out}</>
}

/** A 20px entity mark (shape grammar: circles act, squares last, capsules happen; dashed = simulated). */
export function RowMark({ entity }: { entity: EntityRef }) {
  const resolved = useEntity(entity)
  return (
    <span className="grid size-5 shrink-0 place-items-center">
      <EntityMark entity={entity} resolved={resolved} size={entity.kind === 'run' || entity.kind === 'approval' ? 18 : 20} />
    </span>
  )
}

/** `Atlas Portal v2 › Code` — where an item lives. */
export function usePathLabel(entity: EntityRef, projectId: ID | null | undefined): string {
  const project = useDB((s) => (projectId ? s.projects[projectId]?.name : undefined))
  const ws = getManifest(KIND_META[entity.kind].workspace).label
  // A project's own path is just its workspace (no "Lumen Launch › Projects" under "Lumen Launch").
  return project && entity.kind !== 'project' ? `${project} › ${ws}` : ws
}

export function EntityRowContent({ entity, titleRanges, snippet, snippetRanges }: { entity: EntityRef; titleRanges?: Range[]; snippet?: string; snippetRanges?: Range[] }) {
  const e = useEntity(entity)
  const path = usePathLabel(entity, e.projectId)
  return (
    <>
      <RowMark entity={entity} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="type-body-sm truncate font-medium text-ink">
            <Highlighted text={e.title} ranges={titleRanges} />
          </span>
          <span className="type-caption hidden shrink-0 truncate text-ink-3 sm:inline">{path}</span>
          {e.simulated && <SimBadge size="xs" />}
        </span>
        {snippet && (
          <span className="type-caption truncate text-ink-3">
            <Highlighted text={snippet} ranges={snippetRanges} />
          </span>
        )}
      </span>
      <span className="type-meta shrink-0 text-ink-3">{shortCode(entity.id)}</span>
    </>
  )
}

export function CommandRowContent({ command, ranges }: { command: Command; ranges?: Range[] }) {
  const Icon = command.icon
  return (
    <>
      <span aria-hidden className="grid size-5 shrink-0 place-items-center text-ink-3">
        {Icon ? <Icon className="size-4" strokeWidth={1.75} /> : <ArrowRight className="size-4" strokeWidth={1.75} />}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="type-body-sm truncate font-medium text-ink">
          <Highlighted text={command.title} ranges={ranges} />
        </span>
        {command.subtitle && <span className="type-caption truncate text-ink-3">{command.subtitle}</span>}
      </span>
      {command.shortcut && <KbdCombo combo={command.shortcut} variant="plain" className="shrink-0 pointer-coarse:hidden" />}
    </>
  )
}

export function IntentRowContent({ verb, projectName, mentions, onPickVerb }: { verb: Intent; projectName?: string; mentions: string[]; onPickVerb: () => void }) {
  return (
    <>
      <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full border border-line-strong text-ink-2">
        <CornerDownLeft className="size-3" strokeWidth={2} />
      </span>
      <span className="type-body-sm flex min-w-0 flex-1 items-center gap-1.5 text-ink-2">
        <span className="shrink-0">Run as</span>
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            onPickVerb()
          }}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-xs px-1 font-semibold text-ink hover:bg-press"
          aria-label={`Verb: ${VERB_LABEL[verb]}. Press Tab to change`}
        >
          {VERB_LABEL[verb]}
          <ChevronDown aria-hidden className="size-3 text-ink-3" strokeWidth={2} />
        </button>
        <span className="truncate text-ink-3">
          {projectName ? ` · in ${projectName}` : ' · in All work'}
          {mentions.length ? ` · mentions ${mentions.join(', ')}` : ''}
        </span>
      </span>
      <span className="type-meta hidden shrink-0 items-center gap-1 text-ink-3 sm:flex">
        <KbdCombo combo="tab" variant="plain" /> verb
      </span>
    </>
  )
}

// ------------------------------------------------------------------------------------------------ preview pane

export function EntityPreview({ entity }: { entity: EntityRef }) {
  const { lens, loading } = useLens(entity.kind)
  const Card = lens?.card as ComponentType<LensProps> | undefined
  const e = useEntity(entity)
  const path = usePathLabel(entity, e.projectId)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <RowMark entity={entity} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="type-label text-ink-3">{KIND_META[entity.kind].label}</span>
          <span className="type-body-sm font-semibold text-pretty text-ink">{e.title}</span>
        </div>
      </div>
      <div className="type-meta flex flex-wrap gap-x-2 gap-y-1 text-ink-3">
        <span>{shortCode(entity.id)}</span>
        <span aria-hidden>·</span>
        <span>{path}</span>
        {e.updatedAt && (
          <>
            <span aria-hidden>·</span>
            <span>{timeAgo(e.updatedAt)}</span>
          </>
        )}
        {e.simulated && <SimBadge size="xs" />}
      </div>
      {Card && !loading ? (
        <Card entity={entity} />
      ) : (
        <div className="-mx-4 [&>section]:border-b-0">
          <GenericPanel entity={entity} />
        </div>
      )}
    </div>
  )
}

export function CommandPreview({ command }: { command: Command }) {
  const Icon = command.icon
  return (
    <div className="flex flex-col gap-2.5">
      <span className="type-label text-ink-3">{command.group}</span>
      <span className="flex items-center gap-2">
        {Icon && <Icon aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
        <span className="type-body-sm font-semibold text-ink">{command.title}</span>
      </span>
      {command.subtitle && <p className="type-caption text-ink-2">{truncate(command.subtitle, 180)}</p>}
      {command.shortcut && (
        <span className="type-caption flex items-center gap-2 text-ink-3">
          Shortcut <KbdCombo combo={command.shortcut} />
        </span>
      )}
    </div>
  )
}

export function IntentPreview({ verb, projectName, reason }: { verb: Intent; projectName?: string; reason: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="type-label text-ink-3">Run as {VERB_LABEL[verb]}</span>
      <p className="type-body-sm text-ink">{VERB_EFFECT[verb]}</p>
      <p className="type-caption text-ink-2">{projectName ? `Filed in ${projectName}.` : 'Not filed in a project.'} Held items ride along.</p>
      <div className="flex flex-col gap-1 rounded-sm border border-line bg-raised px-2.5 py-2">
        <span className="type-label text-ink-3">Why this verb</span>
        <span className="type-caption text-ink-2">{reason}</span>
        <span className="type-caption text-ink-3">Rule-based intent detection. No model was called.</span>
      </div>
      <p className="type-caption flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">
        <KbdCombo combo="enter" variant="plain" /> start · <KbdCombo combo="mod+enter" variant="plain" /> in the background · <KbdCombo combo="tab" variant="plain" /> change verb
      </p>
    </div>
  )
}
