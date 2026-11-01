import { describe, expect, it } from 'vitest'
import { entitiesFromLocation } from './recents'
import { documentTitle } from './TabPresence'
import { parseInspectParam, formatInspectParam } from '../inspector/inspect'

describe('entitiesFromLocation (§2.6 route map)', () => {
  it('reads the entity each route opens', () => {
    expect(entitiesFromLocation('/chat/thr_sso_bug')).toEqual([{ kind: 'thread', id: 'thr_sso_bug' }])
    expect(entitiesFromLocation('/research/inv_1/report')).toEqual([{ kind: 'investigation', id: 'inv_1' }])
    expect(entitiesFromLocation('/code/repos/rep_atlas')).toEqual([{ kind: 'repo', id: 'rep_atlas' }])
    expect(entitiesFromLocation('/code/ses_1/changes')).toEqual([{ kind: 'session', id: 'ses_1' }])
    expect(entitiesFromLocation('/agents/runs/run_1')).toEqual([{ kind: 'run', id: 'run_1' }])
    expect(entitiesFromLocation('/agents/agt_scout/now')).toEqual([{ kind: 'agent', id: 'agt_scout' }])
    expect(entitiesFromLocation('/projects/prj_atlas', '?task=tsk_1')).toEqual([
      { kind: 'project', id: 'prj_atlas' },
      { kind: 'task', id: 'tsk_1' },
    ])
    expect(entitiesFromLocation('/knowledge/kno_lumen_prd')).toEqual([{ kind: 'knowledge', id: 'kno_lumen_prd' }])
    expect(entitiesFromLocation('/integrations/github')).toEqual([{ kind: 'integration', id: 'github' }])
  })

  it('never treats reserved segments as ids', () => {
    for (const p of ['/research/new', '/code/new', '/agents/roster', '/agents/new', '/agents/runs', '/projects/my-tasks', '/workflows/new', '/', '/chat', '/insights']) {
      expect(entitiesFromLocation(p)).toEqual([])
    }
  })
})

describe('tab presence (§3.8)', () => {
  it('formats (n) {Item} — {Workspace} · Atrium', () => {
    expect(documentTitle(2, 'Stripe migration risks', 'Chat')).toBe('(2) Stripe migration risks — Chat · Atrium')
    expect(documentTitle(0, undefined, 'Home')).toBe('Home · Atrium')
  })
})

describe('?inspect= (§2.6)', () => {
  it('parses kind:id and rejects unknown kinds', () => {
    expect(parseInspectParam('knowledge:kno_lumen_prd')).toEqual({ kind: 'knowledge', id: 'kno_lumen_prd' })
    expect(parseInspectParam('run:run_a:b')).toEqual({ kind: 'run', id: 'run_a:b' })
    expect(parseInspectParam('nope:x')).toBeNull()
    expect(parseInspectParam('task:')).toBeNull()
    expect(parseInspectParam(null)).toBeNull()
    expect(formatInspectParam({ kind: 'task', id: 'tsk_1' })).toBe('task:tsk_1')
  })
})
