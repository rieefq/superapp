import { describe, expect, it } from 'vitest'
import { failureFingerprint, normalizeFailureReason, runFailureMessage, UNKNOWN_FAILURE } from './failures'
import { mkRun } from './fixtures.test-utils'

describe('normalizeFailureReason', () => {
  it('keeps the first sentence and drops trailing punctuation', () => {
    expect(normalizeFailureReason('Linear API returned 503 Service Unavailable after 3 retries. The email stays unlabeled, so the next run files it.'))
      .toBe('Linear API returned 503 Service Unavailable after 3 retries')
    expect(normalizeFailureReason('The web search provider timed out (simulated).')).toBe('The web search provider timed out (simulated)')
    expect(normalizeFailureReason('Slack is not connected. Connect it in Integrations and run again.')).toBe('Slack is not connected')
  })

  it('keeps the first clause after a semicolon or spaced dash', () => {
    expect(normalizeFailureReason('Notion API rate limited the sync (HTTP 429) after 3 retries; 18 of 64 changed pages fetched, nothing written.'))
      .toBe('Notion API rate limited the sync (HTTP 429) after 3 retries')
    expect(normalizeFailureReason('Token expired — reconnect to resume syncing')).toBe('Token expired')
  })

  it('never cuts to a stub shorter than a few words', () => {
    expect(normalizeFailureReason('Slack — channel not found')).toBe('Slack — channel not found')
    expect(normalizeFailureReason('Timed out. Retrying did not help.')).toBe('Timed out. Retrying did not help')
  })

  it('drops a generic Error: prefix, uses the first line and collapses whitespace', () => {
    expect(normalizeFailureReason('ERROR: canceling statement due to statement timeout (30 s). Joining 24 months is too heavy.'))
      .toBe('Canceling statement due to statement timeout (30 s)')
    expect(normalizeFailureReason('\n  Build   failed:\tmissing   module  \nstack trace line 1\nline 2')).toBe('Build failed: missing module')
    expect(normalizeFailureReason('TypeError: x is undefined')).toBe('TypeError: x is undefined')
  })

  it('truncates long reasons and handles empty messages', () => {
    const reason = normalizeFailureReason(`Upstream said ${'very '.repeat(60)}bad things`)
    expect(reason.length).toBeLessThanOrEqual(160)
    expect(reason.endsWith('…')).toBe(true)
    expect(normalizeFailureReason('   ')).toBe(UNKNOWN_FAILURE)
    expect(normalizeFailureReason('...')).toBe(UNKNOWN_FAILURE)
  })
})

describe('failureFingerprint', () => {
  it('groups messages that differ only in quoted names, ids, hashes, URLs or long numbers', () => {
    expect(failureFingerprint('“Draft reply” has no available agent.')).toBe(failureFingerprint('“Classify” has no available agent.'))
    expect(failureFingerprint('Run run_k3j9x0q2ab not found')).toBe(failureFingerprint('Run run_seed_agent_scout_5 not found'))
    expect(failureFingerprint('Push rejected at 3f9a2c1d')).toBe(failureFingerprint('Push rejected at 0b7e44aa9'))
    expect(failureFingerprint('Could not fetch https://a.example/x?y=1')).toBe(failureFingerprint('Could not fetch https://b.example/'))
    expect(failureFingerprint('Request 1700000000123 timed out')).toBe(failureFingerprint('Request 1700000000999 timed out'))
    expect(failureFingerprint('Slack is not connected.')).toBe(failureFingerprint('SLACK IS NOT CONNECTED'))
  })

  it('keeps short numbers that distinguish failures (status codes, retries, timeouts)', () => {
    expect(failureFingerprint('Linear API returned 503 after 3 retries')).not.toBe(failureFingerprint('Linear API returned 429 after 3 retries'))
    expect(failureFingerprint('Statement timeout (30 s)')).not.toBe(failureFingerprint('Statement timeout (60 s)'))
  })

  it('fingerprints the normalized reason, so trailing detail does not split groups', () => {
    expect(failureFingerprint('Slack is not connected. Connect it in Integrations and run again.')).toBe(failureFingerprint('Slack is not connected'))
  })
})

describe('runFailureMessage', () => {
  it('prefers the run error, then the last failed step, then any step error', () => {
    expect(runFailureMessage(mkRun({ id: 'r', error: ' Boom ' }))).toBe('Boom')
    const steps = [
      { id: 's1', kind: 'tool' as const, title: 'a', status: 'failed' as const, error: 'first failure' },
      { id: 's2', kind: 'tool' as const, title: 'b', status: 'failed' as const, error: 'last failure' },
      { id: 's3', kind: 'tool' as const, title: 'c', status: 'done' as const, error: 'warning only' },
    ]
    expect(runFailureMessage(mkRun({ id: 'r', steps }))).toBe('last failure')
    expect(runFailureMessage(mkRun({ id: 'r', steps: [steps[2]] }))).toBe('warning only')
    expect(runFailureMessage(mkRun({ id: 'r', error: '  ' }))).toBe(UNKNOWN_FAILURE)
  })
})
