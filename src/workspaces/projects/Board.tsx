import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, Ellipsis, Layers, Orbit, Plus, Trash2 } from 'lucide-react'
import { announce } from '@/app/shell/Announcer'
import { toggleHold } from '@/app/shell/scope'
import { useDB } from '@/core/db'
import { createTask, TASK_STATUS_LABEL } from '@/core/services'
import type { ActorRef, ID, Task, TaskStatus } from '@/core/types'
import { cn } from '@/lib/cn'
import { IconButton, Menu, Portal, PriorityGlyph, TaskGlyph, Tabs, type MenuItem } from '@/ui'
import { beforeIdAt, BOARD_STATUSES, boardColumns, placeInColumn, stepPlacement, type BoardColumns } from './logic'
import { ActorMark, DueText, RunLine, TaskStatusGlyph, useActorName, useTaskSignal } from './parts'
import { deleteWithConfirm, moveToStatus } from './taskActions'

/**
 * The task board (§6.9): Backlog · To do · In progress · Review · Done, columns at 280. Cards move by
 * dragging (pointer), by keyboard (Space picks up, arrows move, Space drops, Esc cancels) or through
 * "Move to…" in each card's ⋯ menu. Each column has a quick add. Phones show one column at a time.
 */

export interface BoardProps {
  /** Visible tasks (filters applied), cancelled excluded. */
  tasks: readonly Task[]
  projectId: ID
  selectedId: ID | null
  onOpen: (taskId: ID) => void
  onAssignAgent: (taskId: ID) => void
  /** Defaults for quick-added tasks (the active milestone filter, "Mine"). */
  quickAdd: { milestoneId?: ID; assignee?: ActorRef | null }
  phone?: boolean
}

interface Drag {
  taskId: ID
  from: TaskStatus
  to: TaskStatus
  /** Index in the target column without the dragged card. */
  index: number
  mode: 'pointer' | 'keyboard'
  width: number
  height: number
}

const ORDER = BOARD_STATUSES as readonly TaskStatus[]

export function Board({ tasks, projectId, selectedId, onOpen, onAssignAgent, quickAdd, phone }: BoardProps) {
  const helpId = useId()
  const boardRef = useRef<HTMLDivElement>(null)
  const columns = useMemo(() => boardColumns(tasks), [tasks])
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const byIdRef = useRef(byId)
  byIdRef.current = byId
  const focusAfter = useRef<ID | null>(null)
  const [phoneColumn, setPhoneColumn] = useState<TaskStatus>('todo')

  const setDrag = useCallback((d: Drag | null) => {
    dragRef.current = d
    setDragState(d)
  }, [])

  /** Columns as rendered: the dragged card removed from its column and placed at the drop target. */
  const rendered = useMemo<BoardColumns>(() => {
    if (!drag) return columns
    const dragged = byId.get(drag.taskId)
    if (!dragged) return columns
    const out = { ...columns }
    for (const s of ORDER) out[s] = columns[s].filter((t) => t.id !== drag.taskId)
    out[drag.to] = placeInColumn(out[drag.to], dragged, drag.index)
    return out
  }, [drag, columns, byId])

  const commit = useCallback(
    (d: Drag) => {
      const task = byIdRef.current.get(d.taskId)
      setDrag(null)
      if (!task) return
      const column = columnsRef.current[d.to]
      const currentIndex = column.findIndex((t) => t.id === d.taskId)
      if (d.to === d.from && currentIndex === d.index) {
        if (d.mode === 'keyboard') announce(`“${task.title}” stays in ${TASK_STATUS_LABEL[d.to]}`)
        return
      }
      focusAfter.current = d.mode === 'keyboard' ? d.taskId : null
      moveToStatus(task, d.to, beforeIdAt(column, d.taskId, d.index))
    },
    [setDrag],
  )

  const cancel = useCallback(
    (announceIt: boolean) => {
      const d = dragRef.current
      setDrag(null)
      if (d && announceIt) {
        const task = byIdRef.current.get(d.taskId)
        focusAfter.current = d.mode === 'keyboard' ? d.taskId : null
        announce(`Move cancelled. “${task?.title ?? 'The task'}” is back in ${TASK_STATUS_LABEL[d.from]}.`)
      }
    },
    [setDrag],
  )

  // ---------------------------------------------------------------------------------------- pointer drag

  const ghostRef = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ id: ID; status: TaskStatus; x: number; y: number; dx: number; dy: number; w: number; h: number } | null>(null)
  const last = useRef({ x: 0, y: 0 })
  const frame = useRef(0)
  const suppressClick = useRef(false)

  const placeGhost = () => {
    const p = pointer.current
    const el = ghostRef.current
    if (p && el) el.style.transform = `translate3d(${last.current.x - p.dx}px, ${last.current.y - p.dy}px, 0)`
  }

  const updateTarget = useCallback(() => {
    const d = dragRef.current
    const board = boardRef.current
    if (!d || !board) return
    const { x, y } = last.current
    let best: HTMLElement | null = null
    let bestDist = Infinity
    for (const col of board.querySelectorAll<HTMLElement>('[data-board-column]')) {
      const r = col.getBoundingClientRect()
      const dist = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
      if (dist < bestDist) {
        bestDist = dist
        best = col
      }
    }
    if (!best) return
    const status = best.dataset.boardColumn as TaskStatus
    const cards = Array.from(best.querySelectorAll<HTMLElement>('[data-board-card]')).filter((el) => el.dataset.boardCard !== d.taskId)
    let index = cards.length
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (y < r.top + r.height / 2) {
        index = i
        break
      }
    }
    if (status !== d.to || index !== d.index) setDrag({ ...d, to: status, index })
  }, [setDrag])

  /** While dragging near an edge, scroll the board (sideways) or the column list (up and down). */
  const autoScroll = useCallback(() => {
    const d = dragRef.current
    const board = boardRef.current
    if (!d || d.mode !== 'pointer' || !board) return
    const { x, y } = last.current
    const r = board.getBoundingClientRect()
    const edge = 56
    let moved = false
    if (x < r.left + edge) {
      board.scrollLeft -= Math.ceil((r.left + edge - x) / 4)
      moved = true
    } else if (x > r.right - edge) {
      board.scrollLeft += Math.ceil((x - (r.right - edge)) / 4)
      moved = true
    }
    const list = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-column-list]')
    if (list) {
      const lr = list.getBoundingClientRect()
      if (y < lr.top + 40) {
        list.scrollTop -= Math.ceil((lr.top + 40 - y) / 4)
        moved = true
      } else if (y > lr.bottom - 40) {
        list.scrollTop += Math.ceil((y - (lr.bottom - 40)) / 4)
        moved = true
      }
    }
    if (moved) updateTarget()
    frame.current = requestAnimationFrame(autoScroll)
  }, [updateTarget])

  const endPointer = useCallback(() => {
    pointer.current = null
    cancelAnimationFrame(frame.current)
    document.documentElement.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = pointer.current
      if (!p) return
      last.current = { x: e.clientX, y: e.clientY }
      if (!dragRef.current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return
        const column = columnsRef.current[p.status]
        setDrag({ taskId: p.id, from: p.status, to: p.status, index: Math.max(0, column.findIndex((t) => t.id === p.id)), mode: 'pointer', width: p.w, height: p.h })
        document.documentElement.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
        frame.current = requestAnimationFrame(autoScroll)
      }
      placeGhost()
      updateTarget()
    }
    const onUp = () => {
      if (!pointer.current) return
      const d = dragRef.current
      endPointer()
      if (d?.mode === 'pointer') {
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false), 0)
        commit(d)
      }
    }
    const onCancel = () => {
      if (!pointer.current) return
      endPointer()
      if (dragRef.current?.mode === 'pointer') cancel(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current?.mode === 'pointer') {
        e.preventDefault()
        e.stopPropagation()
        endPointer()
        cancel(true)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      cancelAnimationFrame(frame.current)
    }
  }, [autoScroll, cancel, commit, endPointer, setDrag, updateTarget])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.pointerType === 'touch' || phone || dragRef.current) return
    const target = e.target as HTMLElement
    if (target.closest('[data-no-drag]')) return
    const card = target.closest<HTMLElement>('[data-board-card]')
    const id = card?.dataset.boardCard
    const task = id ? byId.get(id) : undefined
    if (!card || !task) return
    const r = card.getBoundingClientRect()
    pointer.current = { id: task.id, status: task.status, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height }
    last.current = { x: e.clientX, y: e.clientY }
  }

  // ---------------------------------------------------------------------------------------- keyboard

  const focusCard = (id: ID) => {
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-board-card="${CSS.escape(id)}"] [data-card-open]`)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  // Keep focus on the held card as it moves (it re-mounts in another column), and after a drop.
  useLayoutEffect(() => {
    if (drag?.mode === 'keyboard') focusCard(drag.taskId)
  }, [drag])
  useLayoutEffect(() => {
    if (!focusAfter.current) return
    const id = focusAfter.current
    focusAfter.current = null
    focusCard(id)
  }, [columns, drag])

  const onCardKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const id = e.currentTarget.dataset.taskId
      const task = id ? byIdRef.current.get(id) : undefined
      if (!task) return
      const d = dragRef.current
      const cols = columnsRef.current
      if (d && d.mode === 'keyboard' && d.taskId === task.id) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const next = stepPlacement(cols, ORDER, task.id, { status: d.to, index: d.index }, e.key)
          if (next.status === d.to && next.index === d.index) return
          const len = cols[next.status as TaskStatus].filter((t) => t.id !== task.id).length + 1
          setDrag({ ...d, to: next.status as TaskStatus, index: next.index })
          announce(`${TASK_STATUS_LABEL[next.status as TaskStatus]}, position ${next.index + 1} of ${len}`)
        } else if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          announce(`Dropped “${task.title}” in ${TASK_STATUS_LABEL[d.to]}, position ${d.index + 1}`)
          commit(d)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          cancel(true)
        } else if (e.key === 'Tab') {
          cancel(true)
        }
        return
      }
      if (d) return
      if (e.key === ' ') {
        e.preventDefault()
        const index = cols[task.status].findIndex((t) => t.id === task.id)
        const r = e.currentTarget.parentElement?.getBoundingClientRect()
        setDrag({ taskId: task.id, from: task.status, to: task.status, index: Math.max(0, index), mode: 'keyboard', width: r?.width ?? 260, height: r?.height ?? 72 })
        announce(`Picked up “${task.title}” in ${TASK_STATUS_LABEL[task.status]}. Arrow keys move it, Space drops it, Escape cancels.`)
        return
      }
      // Arrow keys move focus between cards (↑↓ within a column, ←→ across columns).
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const col = cols[task.status]
        const i = col.findIndex((t) => t.id === task.id)
        let target: Task | undefined
        if (e.key === 'ArrowDown') target = col[i + 1]
        else if (e.key === 'ArrowUp') target = col[i - 1]
        else {
          const step = e.key === 'ArrowRight' ? 1 : -1
          for (let c = ORDER.indexOf(task.status) + step; c >= 0 && c < ORDER.length; c += step) {
            const other = cols[ORDER[c]]
            if (other.length) {
              target = other[Math.min(i, other.length - 1)]
              break
            }
          }
        }
        if (target) {
          e.preventDefault()
          focusCard(target.id)
        }
      }
    },
    [cancel, commit, setDrag],
  )

  const onCardOpen = useCallback(
    (id: ID) => {
      if (suppressClick.current) return
      onOpen(id)
    },
    [onOpen],
  )

  const dragged = drag ? byId.get(drag.taskId) : undefined
  const visibleStatuses = phone ? [phoneColumn] : ORDER

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p id={helpId} className="sr-only">
        Press Enter to open a task. Press Space to pick it up, the arrow keys to move it, and Space again to drop it. Each card’s menu also has Move to.
      </p>
      {phone && (
        <div className="shrink-0 border-b border-line px-2">
          <Tabs
            variant="pill"
            size="sm"
            aria-label="Column"
            value={phoneColumn}
            onValueChange={setPhoneColumn}
            items={ORDER.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s], count: columns[s].length }))}
            className="py-1.5"
          />
        </div>
      )}
      <div
        ref={boardRef}
        role="group"
        aria-label="Board"
        aria-describedby={helpId}
        onPointerDown={onPointerDown}
        className={cn('flex min-h-0 flex-1 gap-3 overflow-x-auto overscroll-x-contain px-4 pt-4 pb-4 md:px-6', drag?.mode === 'pointer' && 'cursor-grabbing')}
      >
        {visibleStatuses.map((status) => (
          <Column
            key={status}
            status={status}
            items={rendered[status]}
            count={columns[status].length}
            dragId={drag?.to === status ? drag.taskId : null}
            dragMode={drag?.mode ?? null}
            dragHeight={drag?.height ?? 0}
            dropTarget={drag?.mode === 'pointer' && drag.to === status}
            selectedId={selectedId}
            projectId={projectId}
            quickAdd={quickAdd}
            onOpen={onCardOpen}
            onCardKeyDown={onCardKeyDown}
            onAssignAgent={onAssignAgent}
            helpId={helpId}
            fullWidth={phone}
          />
        ))}
      </div>
      {drag?.mode === 'pointer' && dragged && (
        <Portal>
          <div
            ref={ghostRef}
            aria-hidden
            className="pointer-events-none fixed top-0 left-0 z-(--z-popover) rotate-[0.6deg] opacity-95"
            style={{ width: drag.width, transform: `translate3d(${last.current.x - (pointer.current?.dx ?? 0)}px, ${last.current.y - (pointer.current?.dy ?? 0)}px, 0)` }}
          >
            <div className="rounded-md border border-line-strong bg-raised px-3 py-2.5 shadow-e3">
              <CardBody task={dragged} />
            </div>
          </div>
        </Portal>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ column

interface ColumnProps {
  status: TaskStatus
  items: readonly Task[]
  count: number
  dragId: ID | null
  dragMode: Drag['mode'] | null
  dragHeight: number
  dropTarget: boolean
  selectedId: ID | null
  projectId: ID
  quickAdd: BoardProps['quickAdd']
  onOpen: (id: ID) => void
  onCardKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
  onAssignAgent: (taskId: ID) => void
  helpId: string
  fullWidth?: boolean
}

const Column = memo(function Column({
  status,
  items,
  count,
  dragId,
  dragMode,
  dragHeight,
  dropTarget,
  selectedId,
  projectId,
  quickAdd,
  onOpen,
  onCardKeyDown,
  onAssignAgent,
  helpId,
  fullWidth,
}: ColumnProps) {
  const headId = useId()
  const [adding, setAdding] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const label = TASK_STATUS_LABEL[status]
  return (
    <section
      data-board-column={status}
      aria-labelledby={headId}
      className={cn(
        'flex max-h-full min-h-0 shrink-0 flex-col rounded-md bg-sunken transition-[background-color,box-shadow] duration-(--dur-1)',
        // 280 per the spec; on wide stages columns may grow to 360 so titles and labels breathe.
        fullWidth ? 'w-full' : 'w-[280px] min-w-[280px] grow-0 3xl:w-auto 3xl:max-w-[360px] 3xl:grow',
        dropTarget && 'shadow-[inset_0_0_0_1px_var(--line-strong)]',
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 pr-1.5 pl-3">
        <TaskGlyph status={status} decorative />
        <h3 id={headId} className="type-body-sm font-semibold text-ink">
          {label}
        </h3>
        <span className="type-meta text-ink-3 tabular" aria-label={`${count} tasks`}>
          {count}
        </span>
        <span className="flex-1" />
        <IconButton
          icon={Plus}
          size="xs"
          label={`Add a task to ${label}`}
          onClick={() => {
            setAdding(true)
            requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }))
          }}
        />
      </header>
      <div ref={listRef} data-column-list className="flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2 pb-2">
        {items.map((task) =>
          task.id === dragId && dragMode === 'pointer' ? (
            <div key={task.id} data-board-placeholder aria-hidden className="shrink-0 rounded-md bg-accent-tint outline-1 outline-ink outline-solid" style={{ height: dragHeight }} />
          ) : (
            <BoardCard
              key={task.id}
              task={task}
              selected={task.id === selectedId}
              lifted={task.id === dragId && dragMode === 'keyboard'}
              onOpen={onOpen}
              onKeyDown={onCardKeyDown}
              onAssignAgent={onAssignAgent}
              helpId={helpId}
            />
          ),
        )}
        {items.length === 0 && !adding && (
          <p className="type-caption px-1.5 py-2 text-ink-3">{status === 'review' ? 'Agent work waiting for you lands here.' : status === 'done' ? 'Nothing done yet.' : 'No tasks.'}</p>
        )}
        {adding ? (
          <QuickAdd status={status} projectId={projectId} defaults={quickAdd} onClose={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="type-caption flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-left font-medium text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
          >
            <Plus aria-hidden className="size-3.5" strokeWidth={2} />
            Add task
          </button>
        )}
      </div>
    </section>
  )
})

function QuickAdd({ status, projectId, defaults, onClose }: { status: TaskStatus; projectId: ID; defaults: BoardProps['quickAdd']; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const submit = () => {
    const clean = title.trim()
    if (!clean) {
      onClose()
      return
    }
    createTask({ title: clean, projectId, status, milestoneId: defaults.milestoneId, assignee: defaults.assignee ?? null })
    announce(`Added “${clean}” to ${TASK_STATUS_LABEL[status]}`)
    setTitle('')
  }
  return (
    <div className="shrink-0 rounded-md border border-line-strong bg-raised p-2">
      <textarea
        autoFocus
        rows={2}
        value={title}
        aria-label={`New task in ${TASK_STATUS_LABEL[status]}`}
        placeholder="Task title"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && onClose()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
        className="type-body-sm block w-full resize-none bg-transparent px-1 text-ink outline-none placeholder:text-ink-3"
      />
      <p className="type-meta mt-1 flex justify-between px-1 text-ink-3">
        <span>⏎ add · esc close</span>
        <span>{TASK_STATUS_LABEL[status]}</span>
      </p>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ card

interface CardProps {
  task: Task
  selected: boolean
  lifted: boolean
  onOpen: (id: ID) => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
  onAssignAgent: (taskId: ID) => void
  helpId: string
}

const BoardCard = memo(function BoardCard({ task, selected, lifted, onOpen, onKeyDown, onAssignAgent, helpId }: CardProps) {
  const assignee = useActorName(task.assignee)
  const due = task.dueAt ? new Date(task.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null
  const menu = useMemo<MenuItem[]>(
    () => [
      { id: 'open', label: 'Open', icon: ArrowUpRight, onSelect: () => onOpen(task.id) },
      { type: 'label', label: 'Move to' },
      ...ORDER.map((s) => ({
        type: 'radio' as const,
        id: `move-${s}`,
        label: TASK_STATUS_LABEL[s],
        checked: task.status === s,
        onSelect: () => moveToStatus(task, s),
      })),
      { type: 'separator' },
      { id: 'up', label: 'Move up', icon: ArrowUp, onSelect: () => nudge(task, -1) },
      { id: 'down', label: 'Move down', icon: ArrowDown, onSelect: () => nudge(task, 1) },
      { type: 'separator' },
      { id: 'assign', label: 'Assign to agent…', icon: Orbit, onSelect: () => onAssignAgent(task.id) },
      { id: 'hold', label: 'Hold or release', description: 'Held items ride along in every new AI action', icon: Layers, onSelect: () => toggleHold({ kind: 'task', id: task.id }) },
      { id: 'delete', label: 'Delete…', icon: Trash2, danger: true, onSelect: () => void deleteWithConfirm(task) },
    ],
    [task, onOpen, onAssignAgent],
  )
  return (
    <article
      data-board-card={task.id}
      className={cn(
        'group/card relative shrink-0 rounded-md border bg-raised px-3 py-2.5 transition-[border-color,box-shadow] duration-(--dur-1) ease-standard',
        selected ? 'border-ink/70 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_45%,transparent)]' : 'border-line hover:border-line-strong',
        lifted && 'z-10 border-line-strong shadow-e3',
      )}
    >
      <button
        type="button"
        data-card-open=""
        data-task-id={task.id}
        aria-label={`${task.title}. ${TASK_STATUS_LABEL[task.status]}. ${assignee}${due ? `, due ${due}` : ''}${lifted ? '. Picked up' : ''}`}
        aria-describedby={helpId}
        aria-pressed={lifted || undefined}
        onClick={() => onOpen(task.id)}
        onKeyDown={onKeyDown}
        className={cn(
          'absolute inset-0 cursor-pointer rounded-[inherit] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--focus-ring)',
          lifted && 'outline-2 outline-offset-1 outline-(--focus-ring)',
        )}
      />
      <div className="pointer-events-none relative">
        <CardBody task={task} />
      </div>
      <div data-no-drag className="absolute top-1.5 right-1.5 opacity-0 transition-opacity duration-(--dur-1) group-hover/card:opacity-100 group-focus-within/card:opacity-100 has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100">
        <Menu items={menu} aria-label={`Actions for ${task.title}`} placement="bottom-end" trigger={<IconButton icon={Ellipsis} size="xs" label={`Actions for “${task.title}”`} />} />
      </div>
    </article>
  )
})

/** Move a card one place up or down in its column (the menu equivalent of a vertical drag). */
function nudge(task: Task, dir: 1 | -1) {
  const all = boardColumnsFor(task)
  const i = all.findIndex((t) => t.id === task.id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= all.length) return
  const before = dir < 0 ? all[j].id : (all[j + 1]?.id ?? null)
  moveToStatus(task, task.status, before)
}

/** The task's full column (unfiltered), in kanban order, read when the action runs. */
function boardColumnsFor(task: Task): Task[] {
  const tasks = Object.values(useDB.getState().tasks).filter((t) => t.projectId === task.projectId && t.status === task.status)
  return tasks.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

/** A card's content (also drawn in the drag ghost). */
const CardBody = memo(function CardBody({ task }: { task: Task }) {
  const signal = useTaskSignal(task)
  const done = task.subtasks.filter((s) => s.done).length
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2 pr-5">
        <span className="mt-[3px] flex shrink-0">
          <TaskStatusGlyph task={task} decorative />
        </span>
        <span className={cn('type-body-sm line-clamp-3 font-medium text-pretty', task.status === 'done' ? 'text-ink-2' : 'text-ink')}>{task.title}</span>
      </div>
      {signal.activeRunId && <RunLine runId={signal.activeRunId} className="pl-5" />}
      <div className="flex min-w-0 items-center gap-2 pl-5">
        {task.priority !== 'none' && <PriorityGlyph priority={task.priority} />}
        {task.labels.slice(0, 2).map((l) => (
          <span key={l} className="type-meta max-w-24 truncate text-ink-3">
            #{l}
          </span>
        ))}
        <span className="flex-1" />
        {task.subtasks.length > 0 && (
          <span className="type-meta shrink-0 text-ink-3 tabular" aria-label={`${done} of ${task.subtasks.length} subtasks done`}>
            {done}/{task.subtasks.length}
          </span>
        )}
        <DueText dueAt={task.dueAt} done={task.status === 'done'} />
        <ActorMark actor={task.assignee} size={18} live={signal.live} />
      </div>
    </div>
  )
})
