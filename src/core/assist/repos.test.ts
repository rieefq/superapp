import { describe, expect, it } from 'vitest'
import { DAY, fx, NOW } from './fixtures.test-utils'
import { pickRepoForScope } from './repos'

const demo = fx.repo('rep_atlas', { provider: 'demo', mode: 'simulated', projectId: 'prj_atlas', lastSyncedAt: NOW - DAY })
const api = fx.repo('rep_api', { projectId: 'prj_atlas', lastSyncedAt: NOW - 3 * DAY })
const web = fx.repo('rep_web', { projectId: 'prj_atlas', lastSyncedAt: NOW - 2 * DAY })
const tools = fx.repo('rep_tools', { projectId: null, lastSyncedAt: NOW - 5 * DAY })
const lumen = fx.repo('rep_lumen', { projectId: 'prj_lumen', lastSyncedAt: NOW - 1000 })

describe('pickRepoForScope', () => {
  it('prefers the project’s repoIds in order when given a project', () => {
    expect(pickRepoForScope({ id: 'prj_atlas', repoIds: ['rep_api', 'rep_web'] }, [demo, api, web, tools])).toBe('rep_api')
    expect(pickRepoForScope({ id: 'prj_atlas', repoIds: ['rep_gone', 'rep_web'] }, [demo, api, web, tools])).toBe('rep_web')
  })

  it('with a project id, uses repos assigned to the project, most recently synced first', () => {
    expect(pickRepoForScope('prj_atlas', [api, web, tools, demo])).toBe('rep_atlas')
    expect(pickRepoForScope('prj_atlas', [api, web, tools])).toBe('rep_web')
  })

  it('falls back to the most recently synced connected repo, avoiding other projects’ repos', () => {
    expect(pickRepoForScope('prj_new', [tools, lumen, demo])).toBe('rep_tools')
    expect(pickRepoForScope(null, [tools, lumen, demo])).toBe('rep_tools')
    expect(pickRepoForScope(null, [lumen, demo])).toBe('rep_lumen')
    const fresh = fx.repo('rep_fresh', { connectedAt: NOW - 10 })
    expect(pickRepoForScope(undefined, [tools, fresh])).toBe('rep_fresh')
  })

  it('falls back to the demo repository, then null', () => {
    expect(pickRepoForScope('prj_new', [demo])).toBe('rep_atlas')
    expect(pickRepoForScope(null, [])).toBeNull()
  })

  it('is deterministic on ties', () => {
    const a = fx.repo('rep_a', { fullName: 'acme/a', lastSyncedAt: NOW })
    const b = fx.repo('rep_b', { fullName: 'acme/b', lastSyncedAt: NOW })
    expect(pickRepoForScope(null, [b, a])).toBe('rep_a')
    expect(pickRepoForScope(null, [a, b])).toBe('rep_a')
  })
})
