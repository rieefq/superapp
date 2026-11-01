import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useContextStore } from '@/core/context'
import { db, emptyTables } from '@/core/db'
import { fx } from '@/core/services/testFixtures'
import { DEFAULT_SETTINGS, useSettingsStore } from '@/core/settings'
import type { EntityRef } from '@/core/types'
import { StartPanel } from './StartSheet'

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname}</output>
}

function renderPanel(props: Partial<Parameters<typeof StartPanel>[0]> & { kind: Parameters<typeof StartPanel>[0]['kind'] }) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="*" element={<><StartPanel variant="inline" {...props} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0))
})

afterEach(cleanup)

beforeEach(() => {
  db.replaceAll(emptyTables())
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, autoRetrieve: false } } })
  db.insert('projects', fx.project({ id: 'prj_1', name: 'Atlas Portal v2' }))
  db.insert('threads', fx.thread({ id: 'thr_1', projectId: 'prj_1', messageIds: ['msg_1'] }))
  db.insert('messages', fx.message({ id: 'msg_1', threadId: 'thr_1', content: 'Webhook retries can double-charge customers during the migration.' }))
})

describe('StartPanel', () => {
  it('prefills from the source and attaches it to the Context Line', () => {
    const source: EntityRef = { kind: 'message', id: 'msg_1' }
    renderPanel({ kind: 'research', source })
    const question = screen.getByLabelText('Question') as HTMLTextAreaElement
    expect(question.value).toContain('Webhook retries can double-charge customers')
    // The source's project is preselected, and the message rides along as Attached.
    expect(screen.getByRole('button', { name: /^Attached: .+, included$/ })).toBeTruthy()
    expect(screen.getAllByText('Atlas Portal v2', { selector: 'button span' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /^Project memory: Atlas Portal v2/ })).toBeTruthy()
    // A run-producing kind reads its plan back.
    expect(screen.getByText('no model is called')).toBeTruthy()
  })

  it('validates, then creates a note and navigates to it', async () => {
    renderPanel({ kind: 'note' })
    fireEvent.click(screen.getByRole('button', { name: /^Create/ }))
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('Write something to save.')
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'Retry with exponential backoff and an idempotency key.' } })
    fireEvent.click(screen.getByRole('button', { name: /^Create/ }))
    await flush()
    const items = db.all('knowledge')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'note', content: 'Retry with exponential backoff and an idempotency key.' })
    expect(screen.getByTestId('where').textContent).toBe(`/knowledge/${items[0].id}`)
  })

  it('switches kinds from the radio group with the keyboard', () => {
    render(
      <MemoryRouter>
        <StartPanel kind="task" />
      </MemoryRouter>,
    )
    const task = screen.getByRole('radio', { name: 'Task' })
    expect(task.getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(task, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Research' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('heading', { name: 'New research' })).toBeTruthy()
  })
})
