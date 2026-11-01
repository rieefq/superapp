import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { useSecretsStore } from '@/core/secrets'
import { fx } from '@/core/services/testFixtures'
import { lenses } from './lens'

/** The `integration` lens (Inspector › Item body and hover card) renders honestly from live rows. */

beforeEach(() => {
  db.replaceAll(emptyTables())
  useSecretsStore.setState({ secrets: {} })
})

afterEach(cleanup)

const Panel = lenses.integration!.panel!
const Card = lenses.integration!.card!

describe('integration lens', () => {
  it('panel: mode, status, permissions, who uses it and the test action', () => {
    db.insert('connections', {
      id: 'slack',
      status: 'connected',
      mode: 'simulated',
      account: 'northwind.slack.example',
      scopes: [{ capability: 'messages.send', mode: 'deny' }],
      config: {},
      usageCount: 6,
      lastUsedAt: Date.now() - 2 * 3_600_000,
    })
    db.insert('agents', fx.agent({ id: 'agt_herald', name: 'Herald', capabilities: [{ capability: 'messages.send', mode: 'ask', integrationId: 'slack' }] }))
    render(
      <MemoryRouter>
        <Panel entity={{ kind: 'integration', id: 'slack' }} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByText(/northwind\.slack\.example/)).toBeTruthy()
    expect(screen.getByText(/Simulated — nothing leaves your browser\./)).toBeTruthy()
    expect(screen.getByText('Send messages')).toBeTruthy()
    expect(screen.getByText('Deny')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Agent: Herald/ })).toBeTruthy()
    expect(screen.getByText('6 uses · 2h ago')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Test connection' }).hasAttribute('disabled')).toBe(false)
  })

  it('panel: a model provider that isn’t connected cannot be tested yet', () => {
    render(
      <MemoryRouter>
        <Panel entity={{ kind: 'integration', id: 'anthropic' }} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Not connected')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Test connection' }).hasAttribute('disabled')).toBe(true)
  })

  it('card: status, error text and capabilities', () => {
    db.insert('connections', { id: 'jira', status: 'error', mode: 'simulated', scopes: [], config: {}, usageCount: 0, error: 'Token expired' })
    render(<Card entity={{ kind: 'integration', id: 'jira' }} />)
    expect(screen.getByText('Error')).toBeTruthy()
    expect(screen.getByText(/Token expired/)).toBeTruthy()
    expect(screen.getByText('Manage tasks')).toBeTruthy()
  })

  it('renders nothing for an unknown integration', () => {
    const { container } = render(<Card entity={{ kind: 'integration', id: 'nope' }} />)
    expect(container.textContent).toBe('')
  })
})
