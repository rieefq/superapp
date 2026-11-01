import { describe, expect, it } from 'vitest'
import { emptyTables } from '@/core/db'
import { fx } from '@/core/services/testFixtures'
import { derivedRefsIn, runForIn } from './useDerived'

const T0 = 1_700_000_000_000

describe('derived items', () => {
  const s = emptyTables()
  s.messages.msg_1 = fx.message({ id: 'msg_1', derived: [{ kind: 'investigation', id: 'inv_1' }, { kind: 'task', id: 'tsk_1' }] })
  s.investigations.inv_1 = { ...fx.investigation(), id: 'inv_1', runIds: ['run_old', 'run_new'] }
  s.tasks.tsk_1 = fx.task({ id: 'tsk_1', runIds: [] })
  s.runs.run_old = fx.run({ id: 'run_old', kind: 'research', status: 'failed' })
  s.runs.run_new = fx.run({ id: 'run_new', kind: 'research', status: 'running' })
  // An agent run started from the message (its origin) and linked derived_from it.
  s.runs.run_agent = fx.run({ id: 'run_agent', kind: 'agent', origin: { kind: 'message', id: 'msg_1' } })
  s.links.lnk_1 = { id: 'lnk_1', from: { kind: 'run', id: 'run_agent' }, to: { kind: 'message', id: 'msg_1' }, rel: 'derived_from', createdAt: T0 }
  // The chat turn that answered is not "derived" work.
  s.runs.run_chat = fx.run({ id: 'run_chat', kind: 'chat', origin: { kind: 'message', id: 'msg_1' } })
  s.sessions.ses_1 = { ...fx.session(), id: 'ses_1', turns: [{ id: 'trn_1', prompt: 'x', runId: 'run_code', createdAt: T0 }, { id: 'trn_2', prompt: 'y', createdAt: T0 }] }
  s.runs.run_code = fx.run({ id: 'run_code', kind: 'code' })

  it('lists message.derived first, then derived_from links and runs started from the source, once each', () => {
    expect(derivedRefsIn(s, { kind: 'message', id: 'msg_1' })).toEqual([
      { kind: 'investigation', id: 'inv_1' },
      { kind: 'task', id: 'tsk_1' },
      { kind: 'run', id: 'run_agent' },
    ])
  })

  it('finds the run working on each kind of derived entity', () => {
    expect(runForIn(s, { kind: 'investigation', id: 'inv_1' })?.id).toBe('run_new')
    expect(runForIn(s, { kind: 'run', id: 'run_agent' })?.id).toBe('run_agent')
    expect(runForIn(s, { kind: 'session', id: 'ses_1' })?.id).toBe('run_code')
    expect(runForIn(s, { kind: 'task', id: 'tsk_1' })).toBeUndefined()
    expect(runForIn(s, { kind: 'knowledge', id: 'kno_1' })).toBeUndefined()
  })
})
