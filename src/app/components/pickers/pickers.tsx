import { useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { FolderGit2, Plus, Plug } from 'lucide-react'
import { useShellStore } from '@/app/shell/store'
import { useModels, type ModelAvailability } from '@/core/ai'
import { describeTrigger } from '@/core/assist/triggers'
import { usePinned } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { useSearch } from '@/core/search'
import { computeAgentLiveStatus, KIND_META, resolveIn, useEntity, type AgentLiveStatus } from '@/core/services'
import { isRunActive, type EntityKind, type EntityRef, type ID, type Run } from '@/core/types'
import { cn } from '@/lib/cn'
import { AgentMark, DynamicIcon, HUE_FILL, MonogramMark, SimBadge, type PopoverTriggerProps } from '@/ui'
import { Picker, PickerTrigger, type PickerOption } from './Picker'

/**
 * Entity pickers built on Picker: ProjectPicker, AgentPicker, RepoPicker, CollectionPicker,
 * WorkflowPicker, ModelPicker and EntityPicker. Each renders a default trigger ('field' or 'chip')
 * or takes a custom `trigger` render function.
 */

type TriggerRender = (props: PopoverTriggerProps, state: { open: boolean }) => ReactNode

interface BasePickerProps {
  variant?: 'field' | 'chip'
  /** Custom trigger (receives the props to spread). */
  trigger?: TriggerRender | ReactElement
  disabled?: boolean
  /** Accessible name of the trigger when it has no visible label. */
  'aria-label'?: string
  /** Id of the field label (when used inside <Field>). */
  'aria-labelledby'?: string
  id?: string
  className?: string
}

function HueSquare({ hue, size = 12 }: { hue: string; size?: number }) {
  return <span aria-hidden className={cn('shrink-0 rounded-[3px]', HUE_FILL[hue as keyof typeof HUE_FILL])} style={{ width: size, height: size }} />
}

function NoneSquare({ size = 12 }: { size?: number }) {
  return <span aria-hidden className="shrink-0 rounded-[3px] border border-line-input" style={{ width: size, height: size }} />
}

function defaultTrigger(base: BasePickerProps, leading: ReactNode, text: ReactNode, placeholder: boolean): TriggerRender {
  return (props) => (
    <PickerTrigger
      {...props}
      variant={base.variant}
      leading={leading}
      placeholder={placeholder}
      disabled={base.disabled}
      aria-label={base['aria-label']}
      aria-labelledby={base['aria-labelledby']}
      id={base.id}
      className={base.className}
    >
      {text}
    </PickerTrigger>
  )
}

// ------------------------------------------------------------------------------------------------ projects

export interface ProjectPickerProps extends BasePickerProps {
  value: ID | null
  onChange: (projectId: ID | null) => void
  /** Offer "No project". Default true. */
  allowNone?: boolean
}

export function ProjectPicker({ value, onChange, allowNone = true, ...base }: ProjectPickerProps) {
  const navigate = useNavigate()
  const rows = useDB(
    useShallow((s: Tables) =>
      Object.values(s.projects)
        .filter((p) => p.status === 'active' || p.status === 'paused' || p.id === value)
        .sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || b.updatedAt - a.updatedAt),
    ),
  )
  const running = useDB(
    useShallow((s: Tables) => {
      const m: Record<string, number> = {}
      for (const r of Object.values(s.runs)) if (r.projectId && isRunActive(r.status)) m[r.projectId] = (m[r.projectId] ?? 0) + 1
      return m
    }),
  )
  const options = useMemo<PickerOption[]>(
    () => [
      ...(allowNone ? [{ value: '__none__', label: 'No project', leading: <NoneSquare />, description: 'Not filed in a project' }] : []),
      ...rows.map((p) => ({
        value: p.id,
        label: p.name,
        leading: <HueSquare hue={p.hue} />,
        description: p.goal || p.description || undefined,
        meta: running[p.id] ? <span className="type-meta text-ink-3">● {running[p.id]}</span> : undefined,
        keywords: p.description,
      })),
    ],
    [rows, running, allowNone],
  )
  const current = rows.find((p) => p.id === value)
  return (
    <Picker
      label="Projects"
      placeholder="Switch project…"
      options={options}
      value={value ?? '__none__'}
      onSelect={(v) => onChange(v === '__none__' ? null : v)}
      trigger={base.trigger ?? defaultTrigger(base, current ? <HueSquare hue={current.hue} /> : <NoneSquare />, current?.name ?? 'No project', !current)}
      footer={(close) => (
        <PickerFooterButton
          icon={<Plus aria-hidden className="size-3.5" strokeWidth={2} />}
          onClick={() => {
            close()
            navigate('/projects?new=1')
          }}
        >
          New project
        </PickerFooterButton>
      )}
    />
  )
}

// ------------------------------------------------------------------------------------------------ agents

const STATUS_WORD: Record<AgentLiveStatus, string> = {
  working: 'Working',
  waiting: 'Needs you',
  attention: 'Failed recently',
  idle: 'Idle',
  paused: 'Paused',
}

function StatusWord({ status }: { status: AgentLiveStatus }) {
  const glyph = status === 'working' ? '●' : status === 'waiting' ? '◆' : status === 'attention' ? '✕' : status === 'paused' ? '‖' : '○'
  const tone = status === 'working' ? 'text-live-ink' : status === 'waiting' ? 'text-attn-ink' : status === 'attention' ? 'text-fail-ink' : 'text-ink-3'
  return (
    <span className="type-meta inline-flex items-center gap-1 text-ink-3">
      <span aria-hidden className={tone}>
        {glyph}
      </span>
      {STATUS_WORD[status]}
    </span>
  )
}

export interface AgentPickerProps extends BasePickerProps {
  value: ID | null
  onChange: (agentId: ID) => void
  /** Show paused agents as disabled (they cannot take new work). Default true. */
  disablePaused?: boolean
}

export function AgentPicker({ value, onChange, disablePaused = true, ...base }: AgentPickerProps) {
  const agents = useDB(useShallow((s: Tables) => Object.values(s.agents).filter((a) => a.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name))))
  const statuses = useDB(
    useShallow((s: Tables) => {
      const byAgent: Record<string, Run[]> = {}
      for (const r of Object.values(s.runs)) if (r.agentId) (byAgent[r.agentId] ??= []).push(r)
      const out: Record<string, AgentLiveStatus> = {}
      for (const a of Object.values(s.agents)) out[a.id] = computeAgentLiveStatus(a, byAgent[a.id] ?? [])
      return out
    }),
  )
  const options = useMemo<PickerOption[]>(
    () =>
      agents.map((a) => ({
        value: a.id,
        label: a.name,
        description: a.status === 'paused' && disablePaused ? 'Paused — resume it in Agents to give it work' : a.role,
        leading: <AgentMark seed={a.sigil} hue={a.hue} size={20} live={statuses[a.id] === 'working'} label={a.name} />,
        meta: <StatusWord status={statuses[a.id] ?? 'idle'} />,
        disabled: disablePaused && a.status === 'paused',
        keywords: `${a.role} ${a.description}`,
      })),
    [agents, statuses, disablePaused],
  )
  const current = agents.find((a) => a.id === value)
  return (
    <Picker
      label="Agents"
      placeholder="Find an agent…"
      options={options}
      value={value}
      onSelect={onChange}
      trigger={
        base.trigger ??
        defaultTrigger(base, current ? <AgentMark seed={current.sigil} hue={current.hue} size={16} label={current.name} /> : null, current?.name ?? 'Choose an agent', !current)
      }
    />
  )
}

// ------------------------------------------------------------------------------------------------ repositories

export interface RepoPickerProps extends BasePickerProps {
  value: ID | null
  onChange: (repoId: ID) => void
}

function RepoMode({ live }: { live: boolean }) {
  return live ? (
    <span className="type-meta-caps rounded-xs border border-line-input px-1 text-[10px] leading-[14px] text-ink-2">LIVE</span>
  ) : (
    <SimBadge size="xs" label="SIM" />
  )
}

export function RepoPicker({ value, onChange, ...base }: RepoPickerProps) {
  const navigate = useNavigate()
  const repos = useDB(useShallow((s: Tables) => Object.values(s.repos).sort((a, b) => a.fullName.localeCompare(b.fullName))))
  const options = useMemo<PickerOption[]>(
    () =>
      repos.map((r) => ({
        value: r.id,
        label: r.fullName,
        description: `${r.defaultBranch}${r.mode === 'simulated' ? ' · demo repository' : ' · GitHub'}`,
        leading: <FolderGit2 aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />,
        meta: <RepoMode live={r.mode === 'live'} />,
        keywords: r.description,
      })),
    [repos],
  )
  const current = repos.find((r) => r.id === value)
  return (
    <Picker
      label="Repositories"
      placeholder="Find a repository…"
      options={options}
      value={value}
      onSelect={onChange}
      emptyText="No repositories connected"
      trigger={
        base.trigger ??
        defaultTrigger(
          base,
          <FolderGit2 aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />,
          current ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-xs">{current.fullName}</span>
              <RepoMode live={current.mode === 'live'} />
            </span>
          ) : (
            'Choose a repository'
          ),
          !current,
        )
      }
      footer={(close) => (
        <PickerFooterButton
          icon={<Plug aria-hidden className="size-3.5" strokeWidth={2} />}
          onClick={() => {
            close()
            navigate('/code')
          }}
        >
          Connect a repository
        </PickerFooterButton>
      )}
    />
  )
}

// ------------------------------------------------------------------------------------------------ collections

export interface CollectionPickerProps extends BasePickerProps {
  value: ID | null
  onChange: (collectionId: ID | null) => void
  allowNone?: boolean
}

export function CollectionPicker({ value, onChange, allowNone = true, ...base }: CollectionPickerProps) {
  const collections = useDB(useShallow((s: Tables) => Object.values(s.collections).sort((a, b) => a.name.localeCompare(b.name))))
  const counts = useDB(
    useShallow((s: Tables) => {
      const m: Record<string, number> = {}
      for (const k of Object.values(s.knowledge)) if (k.collectionId) m[k.collectionId] = (m[k.collectionId] ?? 0) + 1
      return m
    }),
  )
  const options = useMemo<PickerOption[]>(
    () => [
      ...(allowNone ? [{ value: '__none__', label: 'No collection', leading: <NoneSquare /> }] : []),
      ...collections.map((c) => ({
        value: c.id,
        label: c.name,
        description: c.description,
        leading: <HueSquare hue={c.hue} />,
        meta: <span className="type-meta text-ink-3">{counts[c.id] ?? 0}</span>,
      })),
    ],
    [collections, counts, allowNone],
  )
  const current = collections.find((c) => c.id === value)
  return (
    <Picker
      label="Collections"
      placeholder="Find a collection…"
      options={options}
      value={value ?? '__none__'}
      onSelect={(v) => onChange(v === '__none__' ? null : v)}
      trigger={base.trigger ?? defaultTrigger(base, current ? <HueSquare hue={current.hue} /> : <NoneSquare />, current?.name ?? 'No collection', !current)}
    />
  )
}

// ------------------------------------------------------------------------------------------------ workflows

export interface WorkflowPickerProps extends BasePickerProps {
  value: ID | null
  onChange: (workflowId: ID) => void
}

export function WorkflowPicker({ value, onChange, ...base }: WorkflowPickerProps) {
  const workflows = useDB(useShallow((s: Tables) => Object.values(s.workflows).sort((a, b) => b.updatedAt - a.updatedAt)))
  const options = useMemo<PickerOption[]>(
    () =>
      workflows.map((w) => ({
        value: w.id,
        label: w.name,
        description: describeTrigger(w.trigger),
        leading: <MonogramMark text={w.name.slice(0, 1).toUpperCase()} hue={w.hue} size={20} />,
        meta: w.enabled ? undefined : <span className="type-meta text-ink-3">Off</span>,
        keywords: w.description,
      })),
    [workflows],
  )
  const current = workflows.find((w) => w.id === value)
  return (
    <Picker
      label="Workflows"
      placeholder="Find a workflow…"
      options={options}
      value={value}
      onSelect={onChange}
      emptyText="No workflows yet"
      trigger={
        base.trigger ??
        defaultTrigger(base, current ? <MonogramMark text={current.name.slice(0, 1).toUpperCase()} hue={current.hue} size={16} /> : null, current?.name ?? 'Choose a workflow', !current)
      }
    />
  )
}

// ------------------------------------------------------------------------------------------------ models

const PROVIDER_GROUP: Record<string, string> = { simulator: 'Simulator', anthropic: 'Anthropic', 'openai-compatible': 'OpenAI-compatible' }

/** The model chip label: "Simulator · Swift", "Claude Sonnet 5.5". */
export function ModelLabel({ model, className }: { model: ModelAvailability['model'] | undefined; className?: string }) {
  if (!model) return <span className={className}>Choose a model</span>
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      {model.simulated && <SimBadge size="xs" label="SIM" />}
      <span className="truncate">{model.label}</span>
    </span>
  )
}

export interface ModelPickerProps extends BasePickerProps {
  value: string
  onChange: (modelId: string) => void
}

export function ModelPicker({ value, onChange, ...base }: ModelPickerProps) {
  const navigate = useNavigate()
  const models = useModels()
  const options = useMemo<PickerOption[]>(
    () =>
      models.map((m) => ({
        value: m.model.id,
        label: m.model.label,
        group: PROVIDER_GROUP[m.model.providerId] ?? 'Other',
        description: m.available ? m.model.description : m.reason,
        disabled: !m.available,
        meta: m.model.simulated ? <SimBadge size="xs" label="SIM" /> : undefined,
        keywords: m.model.providerId,
      })),
    [models],
  )
  const current = models.find((m) => m.model.id === value)?.model
  return (
    <Picker
      label="Models"
      placeholder="Find a model…"
      width={340}
      options={options}
      value={value}
      onSelect={onChange}
      trigger={base.trigger ?? defaultTrigger(base, null, <ModelLabel model={current} />, !current)}
      footer={(close) => (
        <div className="flex flex-col gap-1">
          <p className="px-2 pt-1 text-xs text-ink-3">Simulator answers are generated locally. No model is called.</p>
          <PickerFooterButton
            icon={<Plug aria-hidden className="size-3.5" strokeWidth={2} />}
            onClick={() => {
              close()
              navigate('/integrations/anthropic')
            }}
          >
            Connect a model…
          </PickerFooterButton>
        </div>
      )}
    />
  )
}

// ------------------------------------------------------------------------------------------------ any entity

export interface EntityPickerProps extends BasePickerProps {
  /** Kinds to offer (default: every kind). */
  kinds?: EntityKind[]
  value?: EntityRef | null
  onChange: (ref: EntityRef) => void
  /** Trigger text when nothing is picked. */
  placeholder?: string
  /** Restrict search to one project (null = everywhere). */
  projectId?: ID | null
}

const refValue = (r: EntityRef) => `${r.kind}:${r.id}`
const parseRef = (v: string): EntityRef => {
  const at = v.indexOf(':')
  return { kind: v.slice(0, at) as EntityKind, id: v.slice(at + 1) }
}

/** Search any kinds (real local full-text search); when empty, offers held items and recents. */
export function EntityPicker({ kinds, value, onChange, placeholder = 'Choose an item', projectId, ...base }: EntityPickerProps) {
  const [query, setQuery] = useState('')
  const { results, ready } = useSearch(query, { kinds, projectId: projectId ?? undefined, limit: 24 })
  const recents = useShellStore((s) => s.recents)
  const pinned = usePinned()
  const allow = (k: EntityKind) => !kinds || kinds.includes(k)
  const suggestions = useMemo(() => {
    const out: { ref: EntityRef; group: string }[] = []
    for (const p of pinned) if (allow(p.ref.kind)) out.push({ ref: p.ref, group: 'Held' })
    for (const r of recents) if (allow(r.kind) && !out.some((o) => refValue(o.ref) === refValue(r))) out.push({ ref: r, group: 'Recent' })
    return out.slice(0, 12)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, recents, kinds?.join(',')])
  // A snapshot while the list is open (search results refresh as the index changes).
  const resolved = useMemo(() => {
    const st = useDB.getState()
    const refs = query.trim() ? results.map((r) => r.ref) : suggestions.map((x) => x.ref)
    return refs.map((r) => resolveIn(st, r))
  }, [query, results, suggestions])
  const options = useMemo<PickerOption[]>(() => {
    const groupOf = (i: number) => (query.trim() ? KIND_META[resolved[i].ref.kind].plural : suggestions[i]?.group)
    const rows = resolved.map((r, i) => ({ r, group: groupOf(i) })).filter((x) => x.r.exists)
    // Search results arrive ranked across kinds; group them by kind (stable) so headings stay contiguous.
    if (query.trim()) rows.sort((a, b) => (a.group ?? '').localeCompare(b.group ?? ''))
    return rows.map(({ r, group }) => ({
      value: refValue(r.ref),
      label: r.title,
      description: r.subtitle,
      group,
      leading: <DynamicIcon name={r.icon} aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />,
      meta: r.simulated ? <SimBadge size="xs" label="SIM" /> : undefined,
    }))
  }, [resolved, query, suggestions])
  const current = useMaybeEntity(value)
  return (
    <Picker
      label="Items"
      placeholder={kinds?.length === 1 ? `Search ${KIND_META[kinds[0]].plural.toLowerCase()}…` : 'Search everything…'}
      options={options}
      value={value ? refValue(value) : null}
      onSelect={(v) => onChange(parseRef(v))}
      filter={false}
      loading={!!query.trim() && !ready}
      onQueryChange={setQuery}
      emptyText={query.trim() ? 'No matches' : 'Type to search'}
      trigger={
        base.trigger ??
        defaultTrigger(
          base,
          current?.exists ? <DynamicIcon name={current.icon} aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} /> : null,
          current?.exists ? current.title : placeholder,
          !current?.exists,
        )
      }
    />
  )
}

// ------------------------------------------------------------------------------------------------ shared

const NO_REF: EntityRef = { kind: 'project', id: '' }

/** useEntity for an optional ref (stable across renders; undefined when absent). */
export function useMaybeEntity(ref: EntityRef | null | undefined) {
  const e = useEntity(ref ?? NO_REF)
  return ref ? e : undefined
}

export function PickerFooterButton({ icon, children, onClick }: { icon?: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
    >
      {icon}
      {children}
    </button>
  )
}
