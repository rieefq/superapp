import { describe, expect, it } from 'vitest'
import { emptyTables, type Tables } from '@/core/db'
import { fx } from '@/core/services/testFixtures'
import type { Task } from '@/core/types'
import {
  addDays,
  axisX,
  beforeIdAt,
  boardColumns,
  dateInputValue,
  deliverablesIn,
  dueBucket,
  dueFromDateInput,
  dueInfo,
  groupByDue,
  labelsIn,
  lineageIn,
  matchesFilters,
  milestoneProgress,
  NO_FILTERS,
  placeInColumn,
  readFilters,
  rulerLayout,
  sortProjects,
  startOfDay,
  stepPlacement,
  timeAxis,
  timelineLayout,
  urgentTasks,
  writeFilters,
} from './logic'

// A Wednesday at 10:00 local time.
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime()
const DAY = 86_400_000

const task = (o: Partial<Task>) => fx.task({ id: `tsk_${Math.random().toString(36).slice(2, 8)}`, ...o })

describe('dates', () => {
  it('reads due dates like a person would', () => {
    expect(dueInfo(NOW + 2 * 3_600_000, NOW)).toMatchObject({ text: 'Today', overdue: false, soon: true })
    expect(dueInfo(addDays(NOW, 1) + 10 * 3_600_000, NOW)).toMatchObject({ text: 'Tomorrow', soon: true })
    expect(dueInfo(NOW - 3_600_000, NOW)).toMatchObject({ text: 'Due earlier today', overdue: true })
    expect(dueInfo(NOW - 3 * DAY, NOW)).toMatchObject({ text: '3d overdue', overdue: true })
    // Done tasks never read as overdue.
    expect(dueInfo(NOW - 3 * DAY, NOW, true).overdue).toBe(false)
  })

  it('round-trips date inputs at 17:00 local', () => {
    const due = dueFromDateInput('2026-11-06')!
    expect(new Date(due).getHours()).toBe(17)
    expect(dateInputValue(due)).toBe('2026-11-06')
    expect(dueFromDateInput('nope')).toBeUndefined()
    expect(dateInputValue(undefined)).toBe('')
  })

  it('buckets due dates: overdue · today · this week · later · no date', () => {
    expect(dueBucket(NOW - 1, NOW)).toBe('overdue')
    expect(dueBucket(startOfDay(NOW) + 23 * 3_600_000, NOW)).toBe('today')
    expect(dueBucket(addDays(NOW, 1) + 1, NOW)).toBe('week')
    expect(dueBucket(addDays(NOW, 7) + 1, NOW)).toBe('week')
    expect(dueBucket(addDays(NOW, 8) + 1, NOW)).toBe('later')
    expect(dueBucket(undefined, NOW)).toBe('none')
  })

  it('groups my tasks by bucket, soonest first then by priority, dropping empty groups', () => {
    const a = task({ title: 'late', dueAt: NOW - DAY })
    const b = task({ title: 'today low', dueAt: NOW + 3_600_000, priority: 'low' })
    const c = task({ title: 'today urgent', dueAt: NOW + 3_600_000, priority: 'urgent' })
    const d = task({ title: 'undated' })
    const groups = groupByDue([d, b, a, c], NOW)
    expect(groups.map((g) => g.id)).toEqual(['overdue', 'today', 'none'])
    expect(groups[1].tasks.map((t) => t.title)).toEqual(['today urgent', 'today low'])
    const urgent = urgentTasks([a, b, c, d], NOW)
    expect(urgent.overdue.map((t) => t.title)).toEqual(['late'])
    expect(urgent.today).toHaveLength(2)
  })
})

describe('filters', () => {
  const mine = task({ assignee: null, priority: 'high', labels: ['auth'], milestoneId: 'mst_1' })
  const agent = task({ assignee: { type: 'agent', id: 'agt_1' }, priority: 'low', labels: ['billing'] })
  const me = task({ assignee: { type: 'user', id: 'usr_me' } })

  it('splits mine and delegated', () => {
    expect([mine, agent, me].filter((t) => matchesFilters(t, { ...NO_FILTERS, who: 'mine' }))).toEqual([mine, me])
    expect([mine, agent, me].filter((t) => matchesFilters(t, { ...NO_FILTERS, who: 'delegated' }))).toEqual([agent])
  })

  it('filters by milestone, assignee, priority and label', () => {
    expect(matchesFilters(mine, { ...NO_FILTERS, milestone: 'mst_1' })).toBe(true)
    expect(matchesFilters(agent, { ...NO_FILTERS, milestone: 'none' })).toBe(true)
    expect(matchesFilters(mine, { ...NO_FILTERS, milestone: 'none' })).toBe(false)
    expect(matchesFilters(agent, { ...NO_FILTERS, assignee: 'agt_1' })).toBe(true)
    expect(matchesFilters(me, { ...NO_FILTERS, assignee: 'me' })).toBe(true)
    expect(matchesFilters(mine, { ...NO_FILTERS, assignee: 'unassigned' })).toBe(true)
    expect(matchesFilters(me, { ...NO_FILTERS, assignee: 'unassigned' })).toBe(false)
    expect(matchesFilters(mine, { ...NO_FILTERS, priority: 'high', label: 'auth' })).toBe(true)
    expect(matchesFilters(mine, { ...NO_FILTERS, label: 'billing' })).toBe(false)
  })

  it('round-trips through the URL and keeps unrelated params', () => {
    const f = { who: 'delegated' as const, milestone: 'mst_1', assignee: 'agt_1', priority: 'urgent' as const, label: 'auth' }
    const params = writeFilters(new URLSearchParams('task=tsk_1&view=board'), f)
    expect(params.get('task')).toBe('tsk_1')
    expect(readFilters(params)).toEqual(f)
    expect(readFilters(writeFilters(params, NO_FILTERS))).toEqual(NO_FILTERS)
    expect(readFilters(new URLSearchParams('priority=bogus&who=x')).priority).toBeNull()
  })

  it('lists labels by use', () => {
    expect(labelsIn([mine, agent, task({ labels: ['auth', 'sso'] })])).toEqual(['auth', 'billing', 'sso'])
  })
})

describe('board', () => {
  const a = task({ id: 'a', status: 'todo', order: 0 })
  const b = task({ id: 'b', status: 'todo', order: 1 })
  const c = task({ id: 'c', status: 'todo', order: 2 })
  const d = task({ id: 'd', status: 'in_progress', order: 0 })

  it('puts tasks in kanban order per column', () => {
    const cols = boardColumns([c, d, a, b])
    expect(cols.todo.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(cols.in_progress.map((t) => t.id)).toEqual(['d'])
    expect(cols.review).toEqual([])
  })

  it('computes the drop target as “before” ids without the dragged card', () => {
    const col = [a, b, c]
    expect(beforeIdAt(col, 'a', 0)).toBe('b') // a stays first: before b
    expect(beforeIdAt(col, 'a', 2)).toBeNull() // to the end
    expect(beforeIdAt(col, 'c', 0)).toBe('a')
    expect(beforeIdAt([d], 'a', 0)).toBe('d') // into another column
    expect(placeInColumn(col, c, 1).map((t) => t.id)).toEqual(['a', 'c', 'b'])
    expect(placeInColumn([], a, 3).map((t) => t.id)).toEqual(['a'])
  })

  it('steps a held card with the arrow keys', () => {
    const cols = { todo: [a, b, c], in_progress: [d], review: [] }
    const order = ['todo', 'in_progress', 'review']
    expect(stepPlacement(cols, order, 'b', { status: 'todo', index: 1 }, 'ArrowUp')).toEqual({ status: 'todo', index: 0 })
    expect(stepPlacement(cols, order, 'b', { status: 'todo', index: 2 }, 'ArrowDown')).toEqual({ status: 'todo', index: 2 })
    expect(stepPlacement(cols, order, 'b', { status: 'todo', index: 2 }, 'ArrowRight')).toEqual({ status: 'in_progress', index: 1 })
    expect(stepPlacement(cols, order, 'b', { status: 'review', index: 0 }, 'ArrowRight')).toEqual({ status: 'review', index: 0 })
    expect(stepPlacement(cols, order, 'b', { status: 'todo', index: 0 }, 'ArrowLeft')).toEqual({ status: 'todo', index: 0 })
  })
})

describe('milestones and the time axis', () => {
  it('counts progress per milestone, ignoring cancelled tasks', () => {
    const p = milestoneProgress([
      task({ milestoneId: 'm1', status: 'done' }),
      task({ milestoneId: 'm1' }),
      task({ milestoneId: 'm1', status: 'cancelled' }),
      task({}),
    ])
    expect(p.get('m1')).toEqual({ done: 1, total: 2 })
    expect(p.get('')).toEqual({ done: 0, total: 1 })
  })

  it('builds an axis holding today and every date, with weekly Monday ticks', () => {
    const axis = timeAxis([NOW + 10 * DAY, NOW - 5 * DAY], NOW)
    expect(axis.start).toBeLessThan(NOW - 5 * DAY)
    expect(axis.end).toBeGreaterThan(NOW + 10 * DAY)
    expect(axis.today).toBeGreaterThan(0)
    expect(axis.today).toBeLessThan(1)
    expect(axis.ticks.length).toBeGreaterThan(1)
    for (const t of axis.ticks) expect(new Date(t.at).getDay()).toBe(1)
    expect(axisX(axis, axis.start - DAY)).toBe(0)
    expect(axisX(axis, axis.end + DAY)).toBe(1)
  })

  it('places milestones on the ruler by due date and lists undated ones', () => {
    const ruler = rulerLayout(
      [
        { id: 'late', title: 'GA', dueAt: NOW + 20 * DAY, status: 'upcoming' },
        { id: 'early', title: 'Beta', dueAt: NOW - 3 * DAY, status: 'done' },
        { id: 'tbd', title: 'Someday', status: 'upcoming' },
      ],
      NOW,
    )!
    expect(ruler.marks.map((m) => m.milestone.id)).toEqual(['early', 'late'])
    expect(ruler.marks[0].x).toBeLessThan(ruler.axis.today)
    expect(ruler.marks[1].x).toBeGreaterThan(ruler.axis.today)
    expect(ruler.undated.map((m) => m.id)).toEqual(['tbd'])
    expect(rulerLayout([], NOW)).toBeNull()
  })

  it('lays out the timeline by milestone, then loose dated tasks; counts undated open tasks', () => {
    const project = { milestones: [{ id: 'm1', title: 'Beta', dueAt: NOW + 5 * DAY, status: 'active' as const }] }
    const layout = timelineLayout(
      project,
      [
        task({ id: 'x', milestoneId: 'm1', dueAt: NOW + 4 * DAY }),
        task({ id: 'y', dueAt: NOW + 2 * DAY }),
        task({ id: 'z' }),
        task({ id: 'w', dueAt: NOW, status: 'cancelled' }),
      ],
      NOW,
    )
    expect(layout.groups.map((g) => g.milestone?.id ?? null)).toEqual(['m1', null])
    expect(layout.groups[0].tasks.map((t) => t.id)).toEqual(['x'])
    expect(layout.groups[1].tasks.map((t) => t.id)).toEqual(['y'])
    expect(layout.undated).toBe(1)
  })
})

describe('lineage and deliverables', () => {
  function world(): Tables {
    const s = emptyTables()
    s.projects.prj_1 = fx.project()
    s.messages.msg_1 = fx.message({ id: 'msg_1' })
    s.investigations.inv_1 = fx.investigation({
      id: 'inv_1',
      projectId: 'prj_1',
      status: 'complete',
      report: '# Report',
      origin: { kind: 'message', id: 'msg_1' },
      updatedAt: NOW,
    })
    s.sessions.ses_1 = fx.session({
      id: 'ses_1',
      projectId: 'prj_1',
      status: 'merged',
      pr: { number: 48, title: 'Idempotency keys', status: 'merged', simulated: true },
      updatedAt: NOW + 1000,
    })
    s.links.lnk_1 = { id: 'lnk_1', from: { kind: 'session', id: 'ses_1' }, to: { kind: 'investigation', id: 'inv_1' }, rel: 'derived_from', createdAt: NOW }
    s.tasks.tsk_1 = fx.task({ id: 'tsk_1', origin: { kind: 'run', id: 'run_1' } })
    s.runs.run_1 = fx.run({ id: 'run_1', origin: { kind: 'message', id: 'msg_1' } })
    return s
  }

  it('walks the origin chain oldest first, past runs', () => {
    const s = world()
    expect(lineageIn(s, { kind: 'session', id: 'ses_1' })).toEqual([
      { kind: 'message', id: 'msg_1' },
      { kind: 'investigation', id: 'inv_1' },
    ])
    expect(lineageIn(s, { kind: 'task', id: 'tsk_1' })).toEqual([{ kind: 'message', id: 'msg_1' }])
  })

  it('lists reports and simulated pull requests with their provenance, newest first', () => {
    const items = deliverablesIn(world(), 'prj_1')
    expect(items.map((d) => d.kind)).toEqual(['Pull request #48 (simulated)', 'Report'])
    expect(items[0].chain.map((r) => r.kind)).toEqual(['message', 'investigation', 'session'])
    expect(items[0].simulated).toBe(true)
  })
})

describe('project order', () => {
  it('sorts active work first, starred first, then most recently updated', () => {
    const list = sortProjects([
      fx.project({ id: 'p', status: 'paused', updatedAt: 9 }),
      fx.project({ id: 'a', updatedAt: 1 }),
      fx.project({ id: 's', starred: true, updatedAt: 0 }),
      fx.project({ id: 'n', updatedAt: 5 }),
    ])
    expect(list.map((p) => p.id)).toEqual(['s', 'n', 'a', 'p'])
  })
})
