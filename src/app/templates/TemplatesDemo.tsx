/**
 * Development-only demo of the templates inside the real shell (/dev/templates?t=session|board|canvas|library).
 * Uses live data so the docking rule, list keyboard, drawers and push navigation can be checked by eye.
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Workflow } from 'lucide-react'
import { useRows } from '@/core/db'
import { Badge, Button, EmptyState, SegmentedControl } from '@/ui'
import { timeAgo } from '@/lib/format'
import { BoardTemplate, CanvasTemplate, LibraryTemplate, ListGroup, ListPane, ListRow, ListRows, ScopeFilterRow, SessionTemplate, StageHeader } from '.'

type Kind = 'session' | 'board' | 'canvas' | 'library'

export default function TemplatesDemo() {
  const [params, setParams] = useSearchParams()
  const kind = (params.get('t') as Kind) ?? 'session'
  const selected = params.get('id')
  const [q, setQ] = useState('')
  const [drawer, setDrawer] = useState(true)
  const threads = useRows('threads', (t) => !t.archived, (a, b) => b.updatedAt - a.updatedAt)
  const shown = useMemo(() => threads.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())), [threads, q])
  const thread = threads.find((t) => t.id === selected)
  const pick = (id: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      n.set('id', id)
      return n
    })

  const list = (
    <ListPane title="Conversations" count={shown.length} onNew={() => setParams({ t: kind })} search={{ value: q, onChange: setQ, placeholder: 'Search conversations' }}>
      <ScopeFilterRow />
      <ListRows label="Conversations">
        <ListGroup label="Recent" count={shown.length}>
          {shown.map((t) => (
            <ListRow
              key={t.id}
              onClick={() => pick(t.id)}
              selected={t.id === selected}
              entity={{ kind: 'thread', id: t.id }}
              title={t.title}
              secondary={`${t.messageIds.length} messages`}
              meta={timeAgo(t.updatedAt)}
            />
          ))}
        </ListGroup>
      </ListRows>
    </ListPane>
  )
  const switcher = (
    <SegmentedControl
      size="sm"
      aria-label="Template"
      value={kind}
      onValueChange={(t) => setParams({ t })}
      options={[
        { value: 'session', label: 'Session' },
        { value: 'board', label: 'Board' },
        { value: 'canvas', label: 'Canvas' },
        { value: 'library', label: 'Library' },
      ]}
    />
  )
  const header = (
    <StageHeader
      title={thread?.title ?? 'Templates'}
      status={thread ? <Badge tone="neutral">{thread.messageIds.length} messages</Badge> : undefined}
      tabs={{ items: [{ value: 'a', label: 'Activity' }, { value: 'b', label: 'Changes' }, { value: 'c', label: 'Files' }], value: 'a' }}
      actions={switcher}
      menu={[{ id: 'copy', label: 'Copy link', onSelect: () => {} }]}
    />
  )
  const primary = thread ? { kind: 'thread' as const, id: thread.id } : null
  const body = thread ? (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 24 }, (_, i) => (
        <p key={i} className="type-body-lg text-ink-2">
          Paragraph {i + 1} of a long transcript for “{thread.title}”. The body scrolls; the header stays; the composer stays docked.
        </p>
      ))}
    </div>
  ) : (
    <EmptyState title="Pick a conversation" description="Select a row, or press Space on one to inspect it." />
  )

  if (kind === 'board') {
    return (
      <BoardTemplate header={header} filters={<span className="type-caption text-ink-3">Filters · Status · Kind · Agent</span>}>
        {body}
      </BoardTemplate>
    )
  }
  if (kind === 'canvas') {
    return (
      <CanvasTemplate
        list={list}
        header={header}
        primary={primary}
        phoneView={selected ? 'stage' : 'list'}
        toolbar={
          <>
            <Button size="xs" variant="ghost" leadingIcon={Workflow}>
              Add node
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setDrawer((d) => !d)}>
              Toggle drawer
            </Button>
          </>
        }
        drawer={{ open: drawer, onOpenChange: setDrawer, title: 'Run overlay', children: <p className="type-body-sm p-4 text-ink-3">Drawer content</p> }}
      >
        <div className="grid h-full place-items-center bg-sunken text-ink-3">Canvas</div>
      </CanvasTemplate>
    )
  }
  if (kind === 'library') {
    return (
      <LibraryTemplate list={list} header={header} primary={primary} phoneView={selected ? 'stage' : 'list'} toolbar={<span className="type-caption text-ink-3">Search · Grid / List</span>}>
        {body}
      </LibraryTemplate>
    )
  }
  return (
    <SessionTemplate
      list={list}
      header={header}
      primary={primary}
      phoneView={selected ? 'stage' : 'list'}
      composer={<div className="flex h-16 items-center rounded-md border border-line-input bg-raised px-3 text-ink-3" data-composer>Composer slot</div>}
    >
      {body}
    </SessionTemplate>
  )
}
