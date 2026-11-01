import { memo } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { BookOpen } from 'lucide-react'
import { useInspectEntity } from '@/app/templates'
import { useDB, type Tables } from '@/core/db'
import { KNOWLEDGE_KIND_META, entityRoute, plainText } from '@/core/services'
import type { Agent, ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo, truncate } from '@/lib/format'
import { EmptyState, KindTile, SimBadge } from '@/ui'
import { useAgentMemoryIds } from '../shared'

/** Memory (§6.4): knowledge items the agent wrote, newest first. */
export default function MemoryTab({ agent }: { agent: Agent }) {
  const navigate = useNavigate()
  const ids = useAgentMemoryIds(agent.id)
  const canWrite = agent.capabilities.some((g) => g.capability === 'knowledge.write' && g.mode !== 'deny')
  if (!ids.length) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Nothing saved yet"
        description={
          canWrite
            ? `When ${agent.name} saves notes to Knowledge during a run, they collect here.`
            : `${agent.name} can’t write to Knowledge. Give it “Write knowledge” in Configure to keep notes from its runs.`
        }
        actions={
          !canWrite ? (
            <button
              type="button"
              onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}/configure`)}
              className="type-body-sm text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink"
            >
              Open Configure
            </button>
          ) : undefined
        }
        className="py-10"
      />
    )
  }
  return (
    <section aria-label={`Knowledge ${agent.name} wrote`} className="flex flex-col gap-2">
      <p className="type-caption text-ink-3">
        Knowledge {agent.name} wrote. It’s shared memory: every composer can hold it, and retrieval can use it.
      </p>
      <ul className="-mx-2 flex flex-col gap-px">
        {ids.map((id) => (
          <MemoryRow key={id} id={id} />
        ))}
      </ul>
    </section>
  )
}

const MemoryRow = memo(function MemoryRow({ id }: { id: ID }) {
  const navigate = useNavigate()
  const inspect = useInspectEntity()
  const item = useDB(
    useShallow((s: Tables) => {
      const k = s.knowledge[id]
      if (!k) return null
      const usedBy = Object.values(s.runs).filter((r) => r.steps.some((st) => st.refs?.some((x) => x.kind === 'knowledge' && x.id === id))).length
      return {
        title: k.title || 'Untitled',
        kind: k.kind,
        excerpt: truncate(k.summary || plainText(k.content), 180),
        updatedAt: k.updatedAt,
        simulated: !!k.simulated,
        usedBy,
      }
    }),
  )
  if (!item) return null
  const ref = { kind: 'knowledge' as const, id }
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(entityRoute(ref))}
        onKeyDown={(e) => {
          if (e.key === ' ') {
            e.preventDefault()
            inspect(ref)
          }
        }}
        className={cn('flex w-full min-w-0 items-start gap-3 rounded-sm px-2 py-2.5 text-left transition-colors duration-(--dur-1) hover:bg-hover')}
      >
        <KindTile kind="knowledge" icon={KNOWLEDGE_KIND_META[item.kind]?.icon} size={16} simulated={item.simulated} className="mt-0.5" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="type-body-sm truncate font-semibold text-ink">{item.title}</span>
          {item.excerpt && <span className="type-caption line-clamp-2 text-ink-2">{item.excerpt}</span>}
          <span className="type-meta flex flex-wrap items-center gap-x-2 text-ink-3">
            <span>{KNOWLEDGE_KIND_META[item.kind]?.label ?? 'Note'}</span>
            <span aria-hidden>·</span>
            <span>updated {timeAgo(item.updatedAt)}</span>
            {item.usedBy > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>used by {item.usedBy} {item.usedBy === 1 ? 'run' : 'runs'}</span>
              </>
            )}
            {item.simulated && <SimBadge />}
          </span>
        </span>
      </button>
    </li>
  )
})
