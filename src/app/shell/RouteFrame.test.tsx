import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { getManifest } from '../registry'
import { WorkspaceRoute } from './RouteFrame'

let broken = true
function Flaky() {
  if (broken) throw new Error('Kaboom in the transcript')
  return <p>Recovered view</p>
}

describe('WorkspaceRoute (per-workspace error boundary)', () => {
  it('shows a friendly error with Retry, and Retry recovers once the cause is gone', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <WorkspaceRoute manifest={getManifest('chat')}>
          <Flaky />
        </WorkspaceRoute>
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('Couldn’t open Chat')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Go home' })).toBeTruthy()
    broken = false
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })
    expect(screen.getByText('Recovered view')).toBeTruthy()
  })
})
