import { useEffect, useState, type ReactNode, type Ref } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Plus, X } from 'lucide-react'
import { EntityPicker, formatTokenCount, RepoPicker } from '@/app/components'
import { useInspectEntity } from '@/app/templates'
import { useDB, type Tables } from '@/core/db'
import { KIND_META, pinToProject, unpinFromProject, updateProject, useEntity } from '@/core/services'
import { refKey, type EntityRef, type Project } from '@/core/types'
import { Button, EntityMark, IconButton, SimBadge, Textarea, toast } from '@/ui'
import { useMemoryBreakdown } from './memory'
import { QuietLine, SectionLabel } from './parts'

/**
 * Memory (§6.9): the goal, the instructions ("Prepended to every AI request in this project"), the
 * items held in memory (add through search, remove), repositories, and what the AI sees in tokens.
 * Project memory rides along in every run in the project and is the first chip of every Context Line.
 */
export default function Memory({ project }: { project: Project }) {
  return (
    <div className="flex flex-col gap-10">
      <TextMemory
        project={project}
        field="goal"
        title="Goal"
        hint="The outcome this project exists to achieve. Every AI action in this project sees it."
        placeholder="Every customer on v2, with p95 page loads under 1.5 s."
        rows={2}
        large
      />
      <TextMemory
        project={project}
        field="instructions"
        title="Instructions"
        hint="Prepended to every AI request in this project."
        placeholder={'- Cite every claim.\n- Write for a busy executive: summary first, then evidence.'}
        rows={5}
      />
      <HeldItems project={project} />
      <Repositories project={project} />
      <WhatTheAISees project={project} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ goal & instructions

function TextMemory({
  project,
  field,
  title,
  hint,
  placeholder,
  rows,
  large,
}: {
  project: Project
  field: 'goal' | 'instructions'
  title: string
  hint: string
  placeholder: string
  rows: number
  large?: boolean
}) {
  const saved = project[field] ?? ''
  const [draft, setDraft] = useState(saved)
  // Follow outside changes while you are not editing.
  const dirty = draft !== saved
  useEffect(() => {
    if (!dirty) setDraft(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved])
  const id = `memory-${field}`
  const save = () => {
    updateProject(project.id, { [field]: draft.trim() || undefined })
    setDraft(draft.trim())
    toast({ title: `${title} saved`, description: 'New runs in this project use it from now on.' })
  }
  return (
    <section aria-labelledby={id}>
      <SectionLabel id={id} title={title} />
      <p className="type-caption -mt-1 mb-2 text-ink-3">{hint}</p>
      <Textarea
        value={draft}
        onValueChange={setDraft}
        autosize
        minRows={rows}
        maxRows={16}
        placeholder={placeholder}
        aria-labelledby={id}
        className={large ? 'type-body-lg' : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && dirty) {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape' && dirty) {
            e.preventDefault()
            e.stopPropagation()
            setDraft(saved)
          }
        }}
      />
      {dirty && (
        <div className="mt-2 flex items-center gap-1.5">
          <Button size="sm" variant="primary" kbd="mod+enter" onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
            Discard
          </Button>
        </div>
      )}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ held items

function HeldItems({ project }: { project: Project }) {
  const memory = useMemoryBreakdown(project.id)
  const remove = (ref: EntityRef) => {
    unpinFromProject(project.id, ref)
    toast({ title: 'Removed from project memory', duration: 8000, action: { label: 'Undo', onClick: () => pinToProject(project.id, ref) } })
  }
  return (
    <section aria-labelledby="memory-items">
      <SectionLabel
        id="memory-items"
        title="In memory"
        count={project.pinnedRefs.length}
        action={
          <EntityPicker
            value={null}
            onChange={(ref) => {
              if (project.pinnedRefs.some((r) => r.kind === ref.kind && r.id === ref.id)) {
                toast({ title: 'Already in memory' })
                return
              }
              pinToProject(project.id, ref)
              toast({ title: 'Added to project memory', description: 'It rides along in every new run in this project.' })
            }}
            placeholder="Add to memory"
            trigger={(props) => (
              <AddButton {...props} buttonRef={props.ref as Ref<HTMLButtonElement>}>
                Add to memory
              </AddButton>
            )}
          />
        }
      />
      <p className="type-caption -mt-1 mb-2 text-ink-3">Documents, decisions and references every run in this project should see. Search adds them; × removes them.</p>
      {project.pinnedRefs.length === 0 ? (
        <QuietLine>Nothing held in memory. Add the documents this project keeps returning to.</QuietLine>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {project.pinnedRefs.map((ref, i) => (
            <MemoryItemRow key={refKey(ref)} entity={ref} tokens={memory.items[i] ?? 0} onRemove={() => remove(ref)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function MemoryItemRow({ entity, tokens, onRemove }: { entity: EntityRef; tokens: number; onRemove: () => void }) {
  const e = useEntity(entity)
  const inspect = useInspectEntity()
  return (
    <li className="flex min-h-12 items-center gap-2 py-1 pr-1.5 pl-1.5">
      <button
        type="button"
        onClick={() => inspect(entity)}
        aria-label={`Inspect ${e.title}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm px-1.5 py-1 text-left transition-colors duration-(--dur-1) hover:bg-hover"
      >
        <EntityMark entity={entity} resolved={e} size={18} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={e.exists ? 'type-body-sm truncate text-ink' : 'type-body-sm truncate text-ink-3 line-through'}>{e.exists ? e.title : 'Deleted item'}</span>
          <span className="type-caption truncate text-ink-3">
            {KIND_META[entity.kind].label}
            {e.subtitle && e.subtitle !== KIND_META[entity.kind].label ? ` · ${e.subtitle}` : ''}
          </span>
        </span>
        {e.simulated && <SimBadge size="xs" />}
      </button>
      <span className="type-meta w-16 shrink-0 text-right text-ink-3 tabular">{formatTokenCount(tokens)} tok</span>
      <IconButton icon={X} size="sm" label={`Remove ${e.title} from memory`} onClick={onRemove} />
    </li>
  )
}

function AddButton({ children, buttonRef, ...props }: { children: ReactNode; buttonRef: Ref<HTMLButtonElement> } & Record<string, unknown>) {
  return (
    <button
      {...props}
      ref={buttonRef}
      type="button"
      className="type-caption inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-1.5 font-medium text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
    >
      <Plus aria-hidden className="size-3.5" strokeWidth={2} />
      {children}
    </button>
  )
}

// ------------------------------------------------------------------------------------------------ repositories

function Repositories({ project }: { project: Project }) {
  const repos = useDB(useShallow((s: Tables) => project.repoIds.map((id) => s.repos[id]).filter(Boolean)))
  const add = (repoId: string) => {
    if (project.repoIds.includes(repoId)) return
    updateProject(project.id, { repoIds: [...project.repoIds, repoId] })
    toast({ title: 'Repository linked', description: 'Start on your own tasks here opens a coding session on it.' })
  }
  const remove = (repoId: string) => {
    const before = project.repoIds
    updateProject(project.id, { repoIds: before.filter((id) => id !== repoId) })
    toast({ title: 'Repository unlinked', duration: 8000, action: { label: 'Undo', onClick: () => updateProject(project.id, { repoIds: before }) } })
  }
  return (
    <section aria-labelledby="memory-repos">
      <SectionLabel
        id="memory-repos"
        title="Repositories"
        count={repos.length}
        action={
          <RepoPicker
            value={null}
            onChange={add}
            trigger={(props) => (
              <AddButton {...props} buttonRef={props.ref as Ref<HTMLButtonElement>}>
                Link a repository
              </AddButton>
            )}
          />
        }
      />
      {repos.length === 0 ? (
        <QuietLine>No repository linked. Link one so coding work on this project’s tasks starts there.</QuietLine>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {repos.map((r) => (
            <li key={r!.id} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{r!.fullName}</span>
              {r!.mode === 'simulated' ? (
                <SimBadge size="xs" />
              ) : (
                <span className="type-meta-caps inline-flex h-4 items-center rounded-xs border border-line-input px-1 text-[10px] text-ink-2">LIVE</span>
              )}
              <span className="type-meta hidden shrink-0 text-ink-3 sm:inline">{r!.defaultBranch}</span>
              <IconButton icon={X} size="sm" label={`Unlink ${r!.fullName}`} onClick={() => remove(r!.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ what the AI sees

function WhatTheAISees({ project }: { project: Project }) {
  const memory = useMemoryBreakdown(project.id)
  const items = memory.items.reduce((a, b) => a + b, 0)
  const rows: { label: string; tokens: number; note?: string }[] = [
    { label: 'Goal', tokens: memory.goal, note: project.goal ? undefined : 'none' },
    { label: 'Instructions', tokens: memory.instructions, note: project.instructions ? undefined : 'none' },
    { label: `${project.pinnedRefs.length} ${project.pinnedRefs.length === 1 ? 'item' : 'items'} in memory`, tokens: items },
  ]
  return (
    <section aria-labelledby="memory-sees">
      <SectionLabel id="memory-sees" title="What the AI sees" action={<span className="type-meta text-ink-2 tabular">{formatTokenCount(memory.total)} tok</span>} />
      <dl className="type-mono-sm flex flex-col rounded-md border border-line bg-sunken px-3.5 py-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline gap-2 py-0.5">
            <dt className="shrink-0 text-ink-2">{r.label}</dt>
            <span aria-hidden className="mb-[3px] min-w-3 flex-1 self-end border-b border-dotted border-line-input" />
            <dd className="shrink-0 text-ink-3 tabular">{r.note ?? `${formatTokenCount(r.tokens)} tok`}</dd>
          </div>
        ))}
      </dl>
      <p className="type-caption mt-2 text-ink-3">
        Added to every run in {project.name}, ahead of held and attached context. Composers show it as the first chip of the Context Line, where it can be switched off for one action.
      </p>
    </section>
  )
}
