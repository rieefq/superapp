import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextStore } from '@/core/context'
import { db, emptyTables } from '@/core/db'
import { DEFAULT_SETTINGS, useSettingsStore } from '@/core/settings'
import { Composer, type ComposerProps } from './Composer'

function setup(props: Partial<ComposerProps> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn()
  const utils = render(
    <MemoryRouter>
      <Composer aria-label="Message" {...props} onSubmit={onSubmit} />
    </MemoryRouter>,
  )
  const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
  const type = (text: string) => fireEvent.change(input, { target: { value: text, selectionStart: text.length } })
  return { ...utils, input, type, onSubmit }
}

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0))
})

afterEach(cleanup)

beforeEach(() => {
  db.replaceAll(emptyTables())
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, autoRetrieve: false } } })
})

describe('Composer', () => {
  it('sends on Enter with the model and context, then clears the draft', async () => {
    const { input, type, onSubmit } = setup()
    type('Summarize the PRD')
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [text, meta] = (onSubmit as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(text).toBe('Summarize the PRD')
    expect(meta).toMatchObject({ background: false, modelId: 'sim-swift', attachments: [] })
    expect(meta.context).toMatchObject({ projectId: null, held: [], attached: [] })
    expect(input.value).toBe('')
  })

  it('Shift+Enter does not send', async () => {
    const { input, type, onSubmit } = setup()
    type('two lines')
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    await flush()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('⌘⏎ runs in the background only in navigating composers', async () => {
    const nav = setup({ backgroundable: true, submitLabel: 'Run' })
    nav.type('Research webhook retries')
    fireEvent.keyDown(nav.input, { key: 'Enter', metaKey: true })
    await flush()
    expect((nav.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0][1].background).toBe(true)
    nav.unmount()

    const inPlace = setup()
    inPlace.type('Hello')
    fireEvent.keyDown(inPlace.input, { key: 'Enter', ctrlKey: true })
    await flush()
    expect((inPlace.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0][1].background).toBe(false)
  })

  it('queues a message typed while a reply streams, and sends it when the reply ends', async () => {
    const onSubmit = vi.fn()
    const onStop = vi.fn()
    const { input, type, rerender } = setup({ streaming: true, onStop, onSubmit })
    type('And the risks?')
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('Queued — sends when this answer finishes')
    rerender(
      <MemoryRouter>
        <Composer aria-label="Message" streaming={false} onStop={onStop} onSubmit={onSubmit} />
      </MemoryRouter>,
    )
    await flush()
    expect(onSubmit).toHaveBeenCalledWith('And the risks?', expect.objectContaining({ background: false }))
  })

  it('"Send now" stops the reply and sends; "Cancel" gives the draft back', async () => {
    const onSubmit = vi.fn()
    const onStop = vi.fn()
    const first = setup({ streaming: true, onStop, onSubmit })
    first.type('Send me now')
    fireEvent.keyDown(first.input, { key: 'Enter' })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    await flush()
    expect(onStop).toHaveBeenCalled()
    expect(onSubmit).toHaveBeenCalledWith('Send me now', expect.anything())
    first.unmount()

    const second = setup({ streaming: true, onStop: vi.fn(), onSubmit: vi.fn() })
    second.type('Keep me')
    fireEvent.keyDown(second.input, { key: 'Enter' })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await flush()
    expect(second.input.value).toBe('Keep me')
  })

  it('↑ in an empty composer edits the last message; ⌘. stops a streaming reply', async () => {
    const onEditLast = vi.fn()
    const onStop = vi.fn()
    const { input } = setup({ onEditLast, streaming: true, onStop })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onEditLast).toHaveBeenCalled()
    fireEvent.keyDown(input, { key: '.', metaKey: true })
    expect(onStop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stop the reply' })).toBeTruthy()
  })

  it('routes /commands to onSlashCommand, and sends unknown or declined ones as text', async () => {
    const onSlashCommand = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(false)
    const onSubmit = vi.fn()
    const commands = [{ name: 'research', args: '<question>', description: 'Start research' }]
    const { input, type } = setup({ slashCommands: commands, onSlashCommand, onSubmit })
    type('/research webhook retries')
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()
    expect(onSlashCommand).toHaveBeenCalledWith(commands[0], 'webhook retries', expect.anything())
    expect(onSubmit).not.toHaveBeenCalled()
    type('/research declined')
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()
    expect(onSubmit).toHaveBeenCalledWith('/research declined', expect.anything())
  })

  it('gives the draft back when sending fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network down'))
    const { input, type } = setup({ onSubmit })
    type('Will fail')
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()
    await flush()
    expect(input.value).toBe('Will fail')
  })

  it('is disabled with its reason', () => {
    const { input } = setup({ disabled: true, reason: 'Archived conversations are read-only.' })
    expect(input.disabled).toBe(true)
    expect(screen.getByText('Archived conversations are read-only.')).toBeTruthy()
  })
})
