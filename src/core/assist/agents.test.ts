import { describe, expect, it } from 'vitest'
import { pickAgentForInstruction, recentSuccessRate } from './agents'
import { cast, fx, HOUR, NOW } from './fixtures.test-utils'

const agents = cast()
const pick = (text: string, context?: string) => pickAgentForInstruction(text, agents, context ? { context } : {})?.agentId ?? null

describe('pickAgentForInstruction', () => {
  it.each([
    // research / web → web.search
    ['Research usage-based pricing trends in B2B SaaS', 'agt_scout'],
    ['Search the web for news about Portbase', 'agt_scout'],
    ['Look into the competitive landscape for freight portals', 'agt_scout'],
    // code / repo / test → repo agents
    ['Fix the flaky checkout test in the repo', 'agt_forge'],
    ['Refactor the auth middleware and open a pull request', 'agt_forge'],
    ['Add unit tests for the invoice module', 'agt_forge'],
    // post / slack / email / announce → messages.send
    ['Post the release notes to Slack', 'agt_herald'],
    ['Announce the Lumen beta to the team', 'agt_herald'],
    ['Email the customers about the maintenance window', 'agt_herald'],
    // image / video / brand → media.generate
    ['Generate three hero images for the launch', 'agt_muse'],
    ['Storyboard a 30 second video for the brand campaign', 'agt_muse'],
    // data / metrics / revenue → data.query
    ['What was revenue by cohort last quarter?', 'agt_ledger'],
    ['Pull the churn and retention metrics for October', 'agt_ledger'],
    // triage / support / inbox → tasks.manage + files.read
    ['Triage the support inbox', 'agt_sentinel'],
    ['Go through new support tickets and prioritize them', 'agt_sentinel'],
    // writing → communications role
    ['Write the weekly digest', 'agt_herald'],
  ])('%s → %s', (text, expected) => {
    expect(pick(text)).toBe(expected)
  })

  it('explains the pick with capabilities and the matching cue', () => {
    const result = pickAgentForInstruction('Research competitor pricing', agents)
    expect(result).toMatchObject({ agentId: 'agt_scout', capability: 'web.search' })
    expect(result?.reason).toBe('Scout (Research analyst) can search the web and browse pages — fits “research”.')
    expect(result!.score).toBeGreaterThanOrEqual(2)
    expect(pickAgentForInstruction('Triage the support inbox', agents)?.reason).toBe(
      'Sentinel (Support triage) can manage tasks and read files — fits “triage”.',
    )
  })

  it('honors an agent mentioned by name', () => {
    expect(pick('Have Scout fix the login bug')).toBe('agt_scout')
    expect(pick('ask ledger to draft the launch post')).toBe('agt_ledger')
    expect(pickAgentForInstruction('@muse summarize the incident', agents)?.reason).toBe('You mentioned Muse by name.')
    // A lowercase common word is not a name mention.
    expect(pick('forge ahead with the research on pricing')).toBe('agt_scout')
  })

  it('only considers active agents and ignores denied capabilities', () => {
    expect(pick('Dedupe and re-tag the knowledge base')).not.toBe('agt_archivist')
    const onlyDenied = [fx.agent('agt_x', { name: 'X', role: 'Assistant', capabilities: [{ capability: 'data.query', mode: 'deny' }] })]
    expect(pickAgentForInstruction('Query revenue metrics', onlyDenied)).toBeNull()
    expect(pickAgentForInstruction('Research pricing', [fx.agent('agt_p', { status: 'paused', capabilities: [{ capability: 'web.search', mode: 'allow' }] })])).toBeNull()
  })

  it('returns null when nothing fits or there is nothing to match', () => {
    expect(pick('Hello there')).toBeNull()
    expect(pick('')).toBeNull()
    expect(pickAgentForInstruction('Research pricing', [])).toBeNull()
  })

  it('weighs surrounding context at half strength', () => {
    // "Summarize it" alone falls to the communications role…
    expect(pick('Summarize it')).toBe('agt_herald')
    // …but inside a support-email workflow the triage agent fits better.
    expect(pick('Summarize it', 'When a new support email arrives, summarize it and file a ticket')).toBe('agt_sentinel')
    expect(pick('Review it', 'When a PR is opened, review it')).toBe('agt_forge')
    // Messaging cues in the context do not pull the work toward the messaging agent.
    expect(pick('Summarize it', 'When a new support email arrives, summarize it and post it to #support')).toBe('agt_sentinel')
    // A specific writing deliverable outweighs the input's domain.
    expect(pick('Write the release notes', 'When a PR is merged, write the release notes')).toBe('agt_herald')
  })

  it('breaks ties by recent success rate, then by name', () => {
    const twins = [
      fx.agent('agt_a', { name: 'Atlas', role: 'Research analyst', capabilities: [{ capability: 'web.search', mode: 'allow' }] }),
      fx.agent('agt_b', { name: 'Birch', role: 'Research analyst', capabilities: [{ capability: 'web.search', mode: 'allow' }] }),
    ]
    expect(pickAgentForInstruction('Research pricing', twins)?.agentId).toBe('agt_a')
    const runs = [
      fx.run('r1', { agentId: 'agt_a', status: 'failed', endedAt: NOW - HOUR }),
      fx.run('r2', { agentId: 'agt_a', status: 'succeeded', endedAt: NOW - 2 * HOUR }),
      fx.run('r3', { agentId: 'agt_b', status: 'succeeded', endedAt: NOW - HOUR }),
    ]
    const result = pickAgentForInstruction('Research pricing', twins, { runs })
    expect(result?.agentId).toBe('agt_b')
    expect(result?.reason).toContain('Chosen over Atlas for a better recent success rate (100%).')
  })
})

describe('recentSuccessRate', () => {
  it('uses the last 10 finished runs and ignores active or cancelled ones', () => {
    const runs = [
      ...Array.from({ length: 10 }, (_, i) => fx.run(`ok${i}`, { agentId: 'agt_a', status: 'succeeded', endedAt: NOW - i * HOUR })),
      fx.run('old', { agentId: 'agt_a', status: 'failed', endedAt: NOW - 100 * HOUR }),
      fx.run('live', { agentId: 'agt_a', status: 'running' }),
      fx.run('stop', { agentId: 'agt_a', status: 'cancelled' }),
      fx.run('other', { agentId: 'agt_b', status: 'failed' }),
    ]
    expect(recentSuccessRate('agt_a', runs)).toBe(1)
    expect(recentSuccessRate('agt_b', runs)).toBe(0)
    expect(recentSuccessRate('agt_c', runs)).toBeNull()
  })
})
