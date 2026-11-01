import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import type { Approval, Project, Run, RunStep } from '@/core/types'
import { ApprovalCard } from './ApprovalCard'
import { EntityChip } from './entity'
import { ProvenanceLine } from './provenance'
import { RunTimeline } from './RunTimeline'
import { StepTape } from './StepTape'

afterEach(cleanup)
beforeEach(() => db.replaceAll(emptyTables()))

const ME = { type: 'user' as const, id: 'usr_me' }

const approval = (patch: Partial<Approval> = {}): Approval => ({
  id: 'apv_t1', runId: 'run_t1', stepId: 'stp_t1', title: 'Run npm test', capability: 'shell.execute', risk: 'medium',
  requestedBy: { type: 'agent', id: 'agt_forge' }, status: 'pending', reason: 'Forge works in balanced mode and asks before medium-risk actions',
  preview: { kind: 'command', content: 'npm test', label: 'Session sandbox' }, createdAt: Date.now() - 4 * 60_000, ...patch,
})

const step = (id: string, patch: Partial<RunStep> = {}): RunStep => ({ id, kind: 'think', title: `Step ${id}`, status: 'done', ...patch })

const run = (patch: Partial<Run> = {}): Run => ({
  id: 'run_t1', kind: 'code', title: 'Fix flaky test', status: 'running', projectId: null, initiator: ME, steps: [], outputs: [],
  simulated: true, usage: { inputTokens: 700, outputTokens: 280, costUsd: 0.0049 }, progress: 0, createdAt: 0, modelId: 'sim-deep', ...patch,
})

function card(props: Partial<Parameters<typeof ApprovalCard>[0]> = {}) {
  const handlers = { onApprove: vi.fn(), onReject: vi.fn(), onEdit: vi.fn(), onAlwaysAllow: vi.fn() }
  render(<ApprovalCard approval={approval()} requester={{ name: 'Forge' }} {...handlers} {...props} />)
  const root = screen.getByRole('article')
  return { root, ...handlers }
}

const press = (el: Element, key: string) => fireEvent.keyDown(el, { key })
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)))

describe('ApprovalCard', () => {
  it('writes the headline in the product voice and shows why it asked', () => {
    card()
    expect(screen.getByText('Forge wants to run npm test')).toBeTruthy()
    expect(screen.getByText('Forge works in balanced mode and asks before medium-risk actions')).toBeTruthy()
    expect(screen.getByText('waiting 4m')).toBeTruthy()
  })

  it('approves on Y while focused', async () => {
    const { root, onApprove } = card()
    root.focus()
    press(root, 'y')
    await flush()
    expect(onApprove).toHaveBeenCalledTimes(1)
  })

  it('asks for a second Y on HIGH risk', async () => {
    const { root, onApprove } = card({ approval: approval({ risk: 'high' }) })
    press(root, 'y')
    await flush()
    expect(onApprove).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm approve' })).toBeTruthy()
    press(root, 'y')
    await flush()
    expect(onApprove).toHaveBeenCalledTimes(1)
  })

  it('denies with an optional reason (D, type, Enter) and cancels with Escape', async () => {
    const { root, onReject } = card()
    press(root, 'd')
    const input = screen.getByRole('textbox', { name: /Reason for denying/ })
    press(input, 'Escape')
    expect(screen.queryByRole('textbox', { name: /Reason for denying/ })).toBeNull()
    press(root, 'd')
    const again = screen.getByRole('textbox', { name: /Reason for denying/ })
    fireEvent.change(again, { target: { value: 'Not on the shared sandbox' } })
    fireEvent.submit(again.closest('form')!)
    await flush()
    expect(onReject).toHaveBeenCalledWith('Not on the shared sandbox')
  })

  it('edits command previews before approving (E)', async () => {
    const { root, onEdit } = card()
    press(root, 'e')
    const input = screen.getByRole('textbox', { name: /Edit the command/ })
    fireEvent.change(input, { target: { value: 'npm test -- --run' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and approve' }))
    await flush()
    expect(onEdit).toHaveBeenCalledWith('npm test -- --run')
  })

  it('never offers Edit for diffs', () => {
    card({ approval: approval({ preview: { kind: 'diff', content: '@@ -1 +1 @@\n-a\n+b', label: 'a.ts' } }) })
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
  })

  it('stamps resolved approvals and drops the actions', () => {
    const resolvedAt = new Date(2026, 10, 1, 10, 42).getTime()
    card({ approval: approval({ status: 'approved', resolvedAt, resolution: { by: ME } }) })
    expect(screen.getByText('Approved by you · 10:42')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('collapses an already resolved approval to its stamp line', () => {
    render(<ApprovalCard approval={approval({ status: 'rejected', resolution: { by: ME, note: 'Later' } })} collapseResolved />)
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.getByText('Denied · Later')).toBeTruthy()
  })
})

describe('StepTape', () => {
  it('labels the tape for assistive tech', () => {
    render(<StepTape run={run({ plannedSteps: 3, steps: [step('a'), step('b', { kind: 'read', title: 'Read 4 sources', status: 'running' })] })} />)
    expect(screen.getByRole('img', { name: 'Step 2 of 3: Reading 4 sources, running' })).toBeTruthy()
  })

  it('works as a slider in the Inspector', () => {
    const onSelectStep = vi.fn()
    const r = run({ plannedSteps: 3, steps: [step('a'), step('b'), step('c', { status: 'running' })] })
    render(<StepTape run={r} size="md" interactive selectedStepId="b" onSelectStep={onSelectStep} />)
    const slider = screen.getByRole('slider')
    expect(slider.getAttribute('aria-valuenow')).toBe('2')
    press(slider, 'ArrowRight')
    expect(onSelectStep).toHaveBeenLastCalledWith('c', 2)
    press(slider, 'Home')
    expect(onSelectStep).toHaveBeenLastCalledWith('a', 0)
  })
})

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>
}

describe('EntityChip', () => {
  const project: Project = {
    id: 'prj_test', name: 'Atlas Portal v2', description: '', hue: 'sky', icon: 'Boxes', status: 'active', milestones: [], pinnedRefs: [], repoIds: [],
    createdAt: 0, updatedAt: 0,
  }

  function setup() {
    db.insert('projects', project)
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="*" element={<><EntityChip entity={{ kind: 'project', id: 'prj_test' }} noHoverCard /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    )
    return screen.getByRole('link', { name: 'Project: Atlas Portal v2' })
  }

  it('opens Inspector › Item via ?inspect= on click and Space', () => {
    const link = setup()
    fireEvent.click(link)
    expect(screen.getByTestId('where').textContent).toBe('/home?inspect=project%3Aprj_test')
    press(link, ' ')
    expect(screen.getByTestId('where').textContent).toContain('inspect=project%3Aprj_test')
  })

  it('navigates to the entity on ⌘/Ctrl-click', () => {
    const link = setup()
    fireEvent.click(link, { ctrlKey: true })
    expect(screen.getByTestId('where').textContent).toBe('/projects/prj_test')
  })

  it('drags as application/x-atrium-entity', () => {
    const link = setup()
    const data: Record<string, string> = {}
    fireEvent.dragStart(link, { dataTransfer: { setData: (t: string, v: string) => (data[t] = v), effectAllowed: '' } })
    expect(JSON.parse(data['application/x-atrium-entity'])).toEqual({ kind: 'project', id: 'prj_test' })
  })

  it('renders deleted items as static chips', () => {
    render(
      <MemoryRouter>
        <EntityChip entity={{ kind: 'task', id: 'tsk_missing' }} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Deleted item')).toBeTruthy()
  })
})

describe('ProvenanceLine', () => {
  it('reads like the simulated Colophon', () => {
    render(<ProvenanceLine run={run({ status: 'succeeded', startedAt: 0, endedAt: 1800 })} onViewRun={() => undefined} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Simulator · Deep')
    expect(text).toContain('No model was called')
    expect(text).toContain('~980 tok est.')
    expect(text).toContain('$0.00')
    expect(text).toContain('1.8 s')
    expect(screen.getByRole('button', { name: 'View run' })).toBeTruthy()
  })

  it('reads like the live Colophon and ends with "Stopped by you" when stopped', () => {
    render(
      <ProvenanceLine
        run={run({ simulated: false, modelId: 'claude-sonnet-5-5', status: 'cancelled', usage: { inputTokens: 900, outputTokens: 304, costUsd: 0.004 }, startedAt: 0, endedAt: 3100 })}
      />,
    )
    const text = document.body.textContent ?? ''
    expect(text).toContain('Claude Sonnet 5.5')
    expect(text).toContain('1,204 tok')
    expect(text).toContain('$0.004')
    expect(text).toContain('3.1 s')
    expect(text.trim().endsWith('Stopped by you')).toBe(true)
  })

  it('lists tools only when live and simulated work mix', () => {
    const steps = [
      step('a', { kind: 'read', tool: 'github', integrationId: 'github', capability: 'repo.read' }),
      step('b', { kind: 'search', tool: 'web.search', integrationId: 'web-search', capability: 'web.search' }),
    ]
    render(<ProvenanceLine run={run({ simulated: false, modelId: 'claude-sonnet-5-5', steps })} />)
    expect(document.body.textContent).toContain('tools:GitHub readLIVE,Web searchSIM')
  })
})

describe('RunTimeline', () => {
  it('writes running steps in the present and done steps in the past, framing simulated terminals', () => {
    render(
      <MemoryRouter>
        <RunTimeline
          run={run({
            steps: [
              step('a', { kind: 'plan', title: 'Plan the fix' }),
              step('b', { kind: 'command', title: 'Run `npm test`', status: 'running', tool: 'terminal', input: 'npm test', output: 'RUN v3' }),
            ],
          })}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Planned the fix')).toBeTruthy()
    expect(screen.getByText('npm test', { selector: 'code' })).toBeTruthy()
    expect(document.body.textContent).toContain('Running npm test')
    expect(screen.getByText('Simulated terminal — nothing was executed')).toBeTruthy()
  })

  it('collapses finished reads into one group that expands', () => {
    render(
      <MemoryRouter>
        <RunTimeline
          run={run({
            status: 'succeeded',
            steps: [step('a', { kind: 'read', title: 'Read src/a.ts' }), step('b', { kind: 'read', title: 'Read src/b.ts and src/c.ts' }), step('c', { kind: 'write', title: 'Write the fix' })],
          })}
        />
      </MemoryRouter>,
    )
    const group = screen.getByRole('button', { name: /Read 3 files/ })
    expect(screen.queryByText('Read src/a.ts')).toBeNull()
    fireEvent.click(group)
    expect(screen.getByText('Read src/a.ts')).toBeTruthy()
    expect(screen.getByText('Wrote the fix')).toBeTruthy()
  })

  it('wires approval steps to the store when no approvals are passed', () => {
    db.insert('approvals', approval({ id: 'apv_store', stepId: 'stp_w' }))
    render(
      <MemoryRouter>
        <RunTimeline run={run({ status: 'waiting', steps: [step('stp_w', { kind: 'command', title: 'Run npm test', status: 'waiting', approvalId: 'apv_store' })] })} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('article', { name: 'Approval: Run npm test' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
  })
})
