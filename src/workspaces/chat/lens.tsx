import { useMemo, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { MessageSquareText, Plus } from 'lucide-react'
import { DerivedList, EntityPicker } from '@/app/components'
import type { LensModule, LensProps } from '@/app/lens/types'
import { attachRun } from '@/app/shell/store'
import { addThreadContext, getModelInfo, removeThreadContext } from '@/core/ai'
import { useDB, useRow, type Tables } from '@/core/db'
import { clipLine, plainText } from '@/core/services'
import { refKey, type EntityRef, type Message, type Thread } from '@/core/types'
import { formatDateTime, timeAgo } from '@/lib/format'
import { EntityChip, Markdown, ProvenanceLine, SimBadge } from '@/ui'
import { Attachments, speakerOf } from './transcript/parts'

/**
 * Lens renderers for Chat's kinds (§5.4.8): `thread` and `message`, as the Inspector › Item body (panel)
 * and the hover card / ⌘K preview (card). The Inspector adds Links and History around the panel.
 */

const route = (t: Pick<Thread, 'id'>, messageId?: string) => `/chat/${encodeURIComponent(t.id)}${messageId ? `?m=${encodeURIComponent(messageId)}` : ''}`
const excerpt = (m: Message | undefined, max: number) => (m ? clipLine(plainText(m.content), max) : '')

function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-t border-line px-4 py-3.5 first:border-t-0">
      <div className="flex min-h-6 items-center gap-2">
        <h3 className="type-label text-ink-3">{title}</h3>
        {count !== undefined && <span className="type-meta text-ink-3">{count}</span>}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

function Facts({ items }: { items: ReactNode[] }) {
  return (
    <p className="type-meta flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3">
      {items.filter(Boolean).map((node, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden className="text-ink-4">
              ·
            </span>
          )}
          {node}
        </span>
      ))}
    </p>
  )
}

/** The last question and the last answer of a thread. */
function useLatest(thread: Thread | undefined) {
  return useDB(
    useShallow((s: Tables) => {
      let question: Message | undefined
      let answer: Message | undefined
      const ids = thread?.messageIds ?? []
      for (let i = ids.length - 1; i >= 0 && (!question || !answer); i--) {
        const m = s.messages[ids[i]]
        if (!m) continue
        if (m.role === 'user' && !question) question = m
        if (m.role === 'assistant' && !answer && m.status !== 'streaming') answer = m
      }
      return { question, answer }
    }),
  )
}

// ------------------------------------------------------------------------------------------------ thread

function ThreadPanel({ entity }: LensProps) {
  const thread = useRow('threads', entity.id)
  const { question, answer } = useLatest(thread)
  const forkedFrom = useDB((s: Tables) => (thread?.forkedFrom ? s.threads[thread.forkedFrom.threadId] : undefined))
  const made = useDB(
    useShallow((s: Tables) => {
      const out: string[] = []
      for (const id of thread?.messageIds ?? []) for (const r of s.messages[id]?.derived ?? []) out.push(refKey(r))
      return out
    }),
  )
  if (!thread) return null
  const model = getModelInfo(thread.modelId)
  const simulated = !!model?.simulated
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <Facts
          items={[
            `${thread.messageIds.length} ${thread.messageIds.length === 1 ? 'message' : 'messages'}`,
            <span className="inline-flex items-center gap-1">
              {simulated && <SimBadge />}
              {model?.label ?? thread.modelId}
            </span>,
            <span title={formatDateTime(thread.createdAt)}>Started {timeAgo(thread.createdAt)}</span>,
          ]}
        />
        {forkedFrom && thread.forkedFrom && (
          <p className="type-caption text-ink-3">
            Forked from{' '}
            <Link to={route(forkedFrom, thread.forkedFrom.messageId)} className="text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
              {forkedFrom.title}
            </Link>
          </p>
        )}
        {question || answer ? (
          <div className="flex flex-col gap-2 rounded-sm border border-line bg-raised px-3 py-2.5">
            {question && (
              <p className="type-body-sm line-clamp-2 text-ink">
                <span className="type-meta-caps mr-1.5 text-ink-3">You</span>
                {excerpt(question, 220)}
              </p>
            )}
            {answer && (
              <p className="type-body-sm line-clamp-4 text-ink-2">
                <span className="type-meta-caps mr-1.5 text-ink-3">{speakerOf(answer).label}</span>
                {answer.status === 'error' ? (answer.error ?? 'The answer failed.') : excerpt(answer, 360)}
              </p>
            )}
          </div>
        ) : (
          <p className="type-caption text-ink-3">No messages yet.</p>
        )}
      </div>

      <AttachedContext thread={thread} />

      {answer?.citations?.length ? (
        <Section title="Sources of the latest answer" count={answer.citations.length}>
          <div className="flex flex-wrap gap-1.5">
            {answer.citations.map((c, i) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                <span className="type-meta text-ink-3">{i + 1}</span>
                <EntityChip entity={c.ref} size="sm" />
              </span>
            ))}
          </div>
          {answer.runId && (
            <button
              type="button"
              onClick={() => answer.runId && attachRun(answer.runId, 'chat')}
              className="type-caption self-start rounded-xs text-ink-3 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink"
            >
              View the run’s receipt
            </button>
          )}
        </Section>
      ) : null}

      {made.length > 0 && (
        <Section title="Made from this conversation" count={made.length}>
          <div className="flex flex-wrap gap-1.5">
            {made.map((k) => {
              const at = k.indexOf(':')
              const ref = { kind: k.slice(0, at), id: k.slice(at + 1) } as EntityRef
              return <EntityChip key={k} entity={ref} size="sm" showKind />
            })}
          </div>
        </Section>
      )}
    </div>
  )
}

/** The conversation's attached context: remove with ×, add anything with the picker. */
function AttachedContext({ thread }: { thread: Thread }) {
  const refs = thread.contextRefs
  return (
    <Section
      title="Attached context"
      count={refs.length}
      action={
        <EntityPicker
          value={null}
          onChange={(ref) => addThreadContext(thread.id, ref)}
          placeholder="Add context"
          trigger={(p) => (
            <button
              type="button"
              {...p}
              ref={p.ref as Ref<HTMLButtonElement>}
              className="type-caption inline-flex h-6 items-center gap-1 rounded-sm px-1.5 font-medium text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink data-[state=open]:bg-press"
            >
              <Plus aria-hidden className="size-3.5" strokeWidth={1.75} />
              Add
            </button>
          )}
        />
      }
    >
      {refs.length ? (
        <div className="flex flex-wrap gap-1.5">
          {refs.map((r) => (
            <EntityChip key={refKey(r)} entity={r} size="sm" onRemove={() => removeThreadContext(thread.id, r)} />
          ))}
        </div>
      ) : (
        <p className="type-caption text-ink-3">Nothing attached. Items you attach ride along with every message in this conversation.</p>
      )}
    </Section>
  )
}

function ThreadCard({ entity }: LensProps) {
  const thread = useRow('threads', entity.id)
  const { answer } = useLatest(thread)
  if (!thread) return null
  const model = getModelInfo(thread.modelId)
  return (
    <div className="flex flex-col gap-1.5">
      <Facts items={[`${thread.messageIds.length} messages`, model?.label ?? thread.modelId]} />
      {answer && <p className="type-caption line-clamp-3 text-ink-2 text-pretty">{excerpt(answer, 240)}</p>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ message

function MessagePanel({ entity }: LensProps) {
  const message = useRow('messages', entity.id)
  const thread = useRow('threads', message?.threadId)
  const run = useRow('runs', message?.runId)
  const markers = useMemo(() => (message?.citations ?? []).map((c, i) => ({ index: i + 1, title: c.title })), [message?.citations])
  if (!message) return null
  const { label, simulated } = speakerOf(message)
  const model = getModelInfo(message.modelId)
  const assistant = message.role === 'assistant'
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <Facts
          items={[
            <span className="inline-flex items-center gap-1">
              {simulated && <SimBadge />}
              {label}
            </span>,
            <span title={formatDateTime(message.createdAt)}>{timeAgo(message.createdAt)}</span>,
            thread ? (
              <Link to={route(thread, message.id)} className="inline-flex items-center gap-1 text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
                <MessageSquareText aria-hidden className="size-3" strokeWidth={1.75} />
                {thread.title}
              </Link>
            ) : null,
          ]}
        />
        <div className="max-h-[360px] overflow-y-auto overscroll-contain rounded-sm border border-line bg-raised px-3 py-2.5">
          {assistant ? (
            <Markdown citations={markers} className="type-body-sm text-ink [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" codeMaxHeight={200}>
              {message.content || (message.status === 'streaming' ? '…' : '')}
            </Markdown>
          ) : (
            <p className="type-body-sm whitespace-pre-wrap text-ink">{message.content}</p>
          )}
        </div>
        {message.attachments?.length ? <Attachments items={message.attachments} /> : null}
        {assistant && (
          <ProvenanceLine
            modelLabel={model?.label}
            simulated={simulated}
            usage={message.usage}
            durationMs={run?.startedAt !== undefined && run.endedAt !== undefined ? run.endedAt - run.startedAt : undefined}
            stopped={message.status === 'stopped'}
            onViewRun={run ? () => attachRun(run.id, 'chat') : undefined}
          />
        )}
      </div>
      {message.citations?.length ? (
        <Section title="Sources" count={message.citations.length}>
          <div className="flex flex-wrap gap-1.5">
            {message.citations.map((c, i) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                <span className="type-meta text-ink-3">{i + 1}</span>
                <EntityChip entity={c.ref} size="sm" />
              </span>
            ))}
          </div>
        </Section>
      ) : null}
      {message.derived?.length ? (
        <Section title="Made from this message" count={message.derived.length}>
          <DerivedList source={{ kind: 'message', id: message.id }} />
        </Section>
      ) : null}
    </div>
  )
}

function MessageCard({ entity }: LensProps) {
  const message = useRow('messages', entity.id)
  const thread = useRow('threads', message?.threadId)
  if (!message) return null
  return (
    <div className="flex flex-col gap-1.5">
      <p className="type-caption line-clamp-3 text-ink-2 text-pretty">{excerpt(message, 240) || 'Empty message'}</p>
      {thread && <p className="type-meta truncate text-ink-3">In {thread.title}</p>}
    </div>
  )
}

export const lenses: LensModule['lenses'] = {
  thread: { panel: ThreadPanel, card: ThreadCard },
  message: { panel: MessagePanel, card: MessageCard },
}
