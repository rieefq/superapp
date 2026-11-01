import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Download } from 'lucide-react'
import { minuteCeil, rangeLabel, useMinuteNow } from '@/core/analytics'
import { useTable } from '@/core/db'
import { entityRoute, KIND_META } from '@/core/services'
import { useSettings } from '@/core/settings'
import type { ActivityEvent, ActorRef, EntityKind } from '@/core/types'
import {
  ActivityFeed, AgentMark, Avatar, Button, MonogramMark, SearchField, Select, toast, type ActivityItem, type SelectOption,
} from '@/ui'
import {
  downloadText, filterJournal, journalExport, journalKinds, journalVerbs, type ActorFilter,
} from './logic'
import { useInsightsFilters } from './state'

/**
 * Journal (§6.10): the activity log as a feed, filtered by actor, verb, project and kind, in the
 * same range as the Overview, with Export JSON of exactly what is shown.
 */

const PAGE = 60

export function Journal() {
  const { params, filters, patch } = useInsightsFilters()
  const now = minuteCeil(useMinuteNow())
  const activity = useTable('activity')
  const agents = useTable('agents')
  const workflows = useTable('workflows')
  const projects = useTable('projects')
  const profile = useSettings((s) => s.profile)
  const [limit, setLimit] = useState(PAGE)

  const actor = (params.get('actor') as ActorFilter | null) ?? 'all'
  const verb = params.get('verb')
  const kind = (params.get('target') as EntityKind | null) ?? null
  const text = params.get('jq') ?? ''
  const from = now - filters.rangeDays * 86_400_000

  const all = useMemo(() => Object.values(activity), [activity])
  const inWindow = useMemo(
    () => filterJournal(all, { from, to: now, projectId: filters.projectId, actor: 'all', verb: null, kind: null }),
    [all, from, now, filters.projectId],
  )
  const events = useMemo(
    () => filterJournal(inWindow, { from, to: now, projectId: filters.projectId, actor, verb, kind, text }),
    [inWindow, from, now, filters.projectId, actor, verb, kind, text],
  )

  const actorOptions = useMemo<SelectOption[]>(() => {
    const agentIds = new Set(inWindow.filter((e) => e.actor.type === 'agent').map((e) => e.actor.id))
    return [
      { value: 'all', label: 'Anyone' },
      { value: 'me', label: 'You' },
      { value: 'agents', label: 'Any agent' },
      ...[...agentIds]
        .map((id) => ({ value: `agent:${id}`, label: agents[id]?.name ?? 'Deleted agent', group: 'Agents' }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      { value: 'workflows', label: 'Workflows', group: 'Other' },
      { value: 'system', label: 'Atrium', group: 'Other' },
    ]
  }, [inWindow, agents])
  const verbOptions = useMemo<SelectOption[]>(
    () => [{ value: 'all', label: 'Any action' }, ...journalVerbs(inWindow).map((v) => ({ value: v.verb, label: sentenceCase(v.verb), meta: String(v.count) }))],
    [inWindow],
  )
  const kindOptions = useMemo<SelectOption[]>(
    () => [{ value: 'all', label: 'Any item' }, ...journalKinds(inWindow).map((k) => ({ value: k.kind, label: KIND_META[k.kind]?.plural ?? k.kind, meta: String(k.count) }))],
    [inWindow],
  )

  const items: ActivityItem[] = useMemo(() => {
    const actorLabel = (a: ActorRef) =>
      a.type === 'user' ? 'You' : a.type === 'agent' ? (agents[a.id]?.name ?? 'Deleted agent') : a.type === 'workflow' ? (workflows[a.id]?.name ?? 'A workflow') : 'Atrium'
    return events.slice(0, limit).map((e: ActivityEvent) => {
        const a = e.actor
        const agent = a.type === 'agent' ? agents[a.id] : undefined
        const workflow = a.type === 'workflow' ? workflows[a.id] : undefined
        const mark =
          a.type === 'user' ? (
            <Avatar name={profile.name} hue={profile.hue} size="sm" />
          ) : agent ? (
            <AgentMark seed={agent.sigil} hue={agent.hue} size={20} />
          ) : workflow ? (
            <MonogramMark text={workflow.name} hue={workflow.hue} size={20} />
          ) : undefined
        const project = e.projectId ? projects[e.projectId] : undefined
        return {
          id: e.id,
          at: e.at,
          actor: { label: actorLabel(a), mark },
          summary: (
            <Link
              to={entityRoute(e.target)}
              className="rounded-xs underline decoration-transparent underline-offset-2 transition-colors duration-(--dur-1) hover:text-ink hover:decoration-line-input"
            >
              {summaryAfterActor(e.summary, actorLabel(a), a.type === 'system')}
            </Link>
          ),
          detail: (
            <span className="type-meta">
              {KIND_META[e.target.kind]?.label ?? e.target.kind}
              {project && !filters.projectId ? ` · ${project.name}` : ''}
            </span>
          ),
        }
    })
  }, [events, limit, agents, workflows, projects, profile.name, profile.hue, filters.projectId])

  const exportJson = () => {
    const project = filters.projectId ? (projects[filters.projectId]?.name ?? filters.projectId) : 'All work'
    const json = journalExport(events, {
      exportedAt: Date.now(),
      range: rangeLabel(filters.rangeDays),
      project,
      filters: {
        actor,
        ...(verb ? { verb } : {}),
        ...(kind ? { kind } : {}),
        ...(text ? { text } : {}),
      },
    })
    const stamp = new Date().toISOString().slice(0, 10)
    downloadText(`atrium-journal-${stamp}.json`, json)
    toast({ title: `Exported ${events.length} ${events.length === 1 ? 'event' : 'events'}`, description: `atrium-journal-${stamp}.json` })
  }

  return (
    <div className="flex flex-col gap-4" data-testid="insights-journal">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          size="sm"
          value={text}
          onValueChange={(v) => patch({ jq: v || null })}
          placeholder="Search the journal"
          aria-label="Search the journal"
          kbd="/"
          data-search-input
          className="w-full sm:w-64"
        />
        <Select size="sm" aria-label="Actor" value={actor} options={actorOptions} onValueChange={(v) => patch({ actor: v === 'all' ? null : v })} className="w-[156px]" />
        <Select size="sm" aria-label="Action" value={verb ?? 'all'} options={verbOptions} onValueChange={(v) => patch({ verb: v === 'all' ? null : v })} className="w-[148px]" />
        <Select size="sm" aria-label="Item kind" value={kind ?? 'all'} options={kindOptions} onValueChange={(v) => patch({ target: v === 'all' ? null : v })} className="w-[148px]" />
        <span className="flex-1" />
        <span className="type-meta text-ink-3">
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
        <Button size="sm" variant="secondary" leadingIcon={Download} onClick={exportJson} disabled={events.length === 0}>
          Export JSON
        </Button>
      </div>
      <div className="rounded-md border border-line px-4 py-4 md:px-5">
        <ActivityFeed
          items={items}
          now={now}
          empty={
            inWindow.length === 0 ? `Nothing happened in the ${rangeLabel(filters.rangeDays).toLowerCase()}.` : 'No events match these filters.'
          }
        />
        {events.length > limit && (
          <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
            <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, events.length - limit)} more
            </Button>
            <span className="type-meta text-ink-3">
              {limit} of {events.length}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function sentenceCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/**
 * The feed prints the actor, then the summary: "You completed “X”", "Forge requested approval: …".
 * Summaries that already start with the actor's name drop it; system notes read "Atrium — …".
 */
export function summaryAfterActor(summary: string, actor: string, system = false): string {
  if (!summary) return summary
  if (system) return `— ${summary}`
  const rest = summary.toLowerCase().startsWith(`${actor.toLowerCase()} `) ? summary.slice(actor.length + 1) : summary
  const second = rest.charAt(1)
  // Keep acronyms and names ("PR #48", "API") as they are.
  if (second && /[A-Z]/.test(second)) return rest
  return rest.charAt(0).toLowerCase() + rest.slice(1)
}
