import { describe, expect, it } from 'vitest'
import { emptyTables, type Tables } from '@/core/db'
import { fx } from '@/core/services/testFixtures'
import type { Message } from '@/core/types'
import { actionItemsFor, cleanItem, extractActionItems } from './actionItems'
import { parseAgentArgs, parseAgentMention, placeAfterMessages } from './commands'
import { markdownFileName, simulatedNotice, threadToMarkdown } from './exportMarkdown'
import { daysBefore, groupOf, groupThreads, previewOf, rowTime, startOfLocalDay } from './grouping'
import { deriveSuggestions, docPhrase } from './suggestions'

const NOW = new Date(2026, 10, 1, 15, 30).getTime() // Sun 1 Nov 2026, 15:30 local
const HOUR = 3_600_000

describe('grouping', () => {
  it('puts pinned first, then Today · Yesterday · Previous 7 days · Earlier by local calendar day', () => {
    const today = startOfLocalDay(NOW)
    const threads = [
      fx.thread({ id: 'a', updatedAt: NOW - HOUR }),
      fx.thread({ id: 'b', updatedAt: today - 1 }),
      fx.thread({ id: 'c', updatedAt: daysBefore(NOW, 3) }),
      fx.thread({ id: 'd', updatedAt: daysBefore(NOW, 30) }),
      fx.thread({ id: 'e', updatedAt: daysBefore(NOW, 30), pinned: true }),
      fx.thread({ id: 'f', updatedAt: NOW - 60_000 }),
    ]
    const groups = groupThreads(threads, NOW)
    expect(groups.map((g) => g.label)).toEqual(['Pinned', 'Today', 'Yesterday', 'Previous 7 days', 'Earlier'])
    expect(groups[1].threads.map((t) => t.id)).toEqual(['f', 'a'])
    expect(groupOf({ updatedAt: daysBefore(NOW, 7) }, NOW)).toBe('week')
    expect(groupOf({ updatedAt: daysBefore(NOW, 7) - 1 }, NOW)).toBe('earlier')
  })

  it('formats compact row times', () => {
    expect(rowTime(NOW - 20_000, NOW)).toBe('now')
    expect(rowTime(NOW - 5 * 60_000, NOW)).toBe('5m')
    expect(rowTime(NOW - 3 * HOUR, NOW)).toBe('3h')
  })

  it('previews the last message with text; a streaming placeholder falls back to the one before', () => {
    const user = fx.message({ id: 'm1', role: 'user', content: 'What is **ADR-012**?' })
    const empty = fx.message({ id: 'm2', role: 'assistant', content: '', status: 'streaming' })
    expect(previewOf([user, empty])).toBe('You: What is ADR-012?')
    const answer = fx.message({ id: 'm3', content: '## Heading\n\nThe refresh is scheduled from the held token.' })
    expect(previewOf([user, answer])).toBe('Heading The refresh is scheduled from the held token.')
    expect(previewOf([])).toBe('')
  })
})

describe('suggestions', () => {
  function world(): Tables {
    const t = emptyTables()
    t.projects.prj_1 = fx.project({ id: 'prj_1', name: 'Atlas Portal v2' })
    t.knowledge.k_prd = fx.knowledge({ id: 'k_prd', kind: 'doc', title: 'Atlas Lumen PRD', projectIds: ['prj_1'], updatedAt: 10 })
    t.knowledge.k_tide = fx.knowledge({ id: 'k_tide', title: 'Competitor teardown: Tidewell', tags: ['competitor', 'tidewell'], updatedAt: 5 })
    t.knowledge.k_fre = fx.knowledge({ id: 'k_fre', title: 'Freightly product notes', tags: ['competitor', 'freightly'], updatedAt: 4 })
    t.knowledge.k_never = fx.knowledge({ id: 'k_never', kind: 'doc', title: 'Secret plan', aiAvailability: 'never', updatedAt: 99 })
    t.tasks.t_1 = fx.task({ id: 't_1', title: 'Fix session refresh', status: 'in_progress', projectId: 'prj_1' })
    t.investigations.i_1 = {
      id: 'i_1', title: 'EU supplier risk', question: 'Which suppliers are risky?', projectId: 'prj_1', status: 'complete', depth: 'standard',
      angles: [], sourceIds: [], findings: [], runIds: [], createdAt: 1, updatedAt: 1,
    }
    return t
  }

  it('derives four distinct starters from real work, each attaching what it is about', () => {
    const s = deriveSuggestions(world(), 'prj_1')
    expect(s.map((x) => x.kind)).toEqual(['summarize', 'compare', 'task', 'research'])
    expect(s[0].prompt).toBe('Summarize the Atlas Lumen PRD')
    expect(s[0].refs).toEqual([{ kind: 'knowledge', id: 'k_prd' }])
    expect(s[1].prompt).toBe('Compare Tidewell and Freightly')
    expect(s[1].refs).toHaveLength(2)
    expect(s[2].prompt).toContain('“Fix session refresh”')
    expect(s[3].refs).toEqual([{ kind: 'investigation', id: 'i_1' }])
    // Items set to "Never" are not offered to AI.
    expect(s.flatMap((x) => x.refs).some((r) => r.id === 'k_never')).toBe(false)
  })

  it('falls back to honest generic starters in an empty world', () => {
    const s = deriveSuggestions(emptyTables(), null)
    expect(s).toHaveLength(4)
    expect(s.every((x) => x.refs.length === 0)).toBe(true)
  })

  it('phrases document titles naturally or quotes them exactly', () => {
    expect(docPhrase('Atlas Lumen PRD')).toBe('the Atlas Lumen PRD')
    expect(docPhrase('Brand voice guide')).toBe('“Brand voice guide”')
    expect(docPhrase('ADR-012: Session tokens & refresh')).toBe('“ADR-012: Session tokens & refresh”')
  })
})

describe('action items', () => {
  it('takes open checklist items first', () => {
    const md = 'Done so far\n\n- [x] Reproduced it\n- [ ] Write the **regression** test\n- [ ] Ship the fix to staging.\n'
    expect(extractActionItems(md)).toEqual(['Write the regression test', 'Ship the fix to staging'])
  })

  it('takes list items under a next-steps heading and ignores code', () => {
    const md = [
      '## Analysis',
      '- not an action',
      '',
      '### Next steps',
      '1. Ask Meridian IT about token lifetimes',
      '2. Hand the fix to Forge',
      '',
      '```ts',
      '- [ ] not a task inside code',
      '```',
    ].join('\n')
    expect(extractActionItems(md)).toEqual(['Ask Meridian IT about token lifetimes', 'Hand the fix to Forge'])
  })

  it('falls back to a short numbered list, and finds nothing in prose', () => {
    expect(extractActionItems('Do this:\n\n1. First\n2. Second\n3. Third')).toEqual(['First', 'Second', 'Third'])
    expect(extractActionItems('Just a paragraph with no list at all.')).toEqual([])
    expect(cleanItem('**Reproduce first:** fake timers.')).toBe('Reproduce first: fake timers')
  })

  it('uses the latest answer that has items', () => {
    const messages: Message[] = [
      fx.message({ id: 'a1', content: '- [ ] Old item' }),
      fx.message({ id: 'u1', role: 'user', content: '- [ ] user text is never mined' }),
      fx.message({ id: 'a2', content: 'No list here.' }),
    ]
    expect(actionItemsFor(messages)).toEqual({ messageId: 'a1', items: ['Old item'] })
  })
})

describe('commands', () => {
  const agents = [
    { id: 'agt_scout', name: 'Scout' },
    { id: 'agt_forge', name: 'Forge' },
    { id: 'agt_old', name: 'Archivist', status: 'archived' },
  ]

  it('reads an @Agent mention at the start of a message', () => {
    expect(parseAgentMention('@Scout compare EU suppliers', agents)).toEqual({ agentId: 'agt_scout', name: 'Scout', instruction: 'compare EU suppliers' })
    expect(parseAgentMention('@scout, check this', agents)?.agentId).toBe('agt_scout')
    expect(parseAgentMention('Ask @Scout later', agents)).toBeNull()
    expect(parseAgentMention('@Scoutmaster go', agents)).toBeNull()
    expect(parseAgentMention('@Archivist tidy up', agents)).toBeNull()
  })

  it('parses /agent arguments with or without a known name', () => {
    expect(parseAgentArgs('Forge fix the login', agents)).toEqual({ agentId: 'agt_forge', instruction: 'fix the login' })
    expect(parseAgentArgs('fix the login', agents)).toEqual({ instruction: 'fix the login' })
  })

  it('places conversation-level items after the message they followed', () => {
    const messages = [
      { id: 'm1', createdAt: 10 },
      { id: 'm2', createdAt: 20 },
      { id: 'm3', createdAt: 30 },
    ]
    const placed = placeAfterMessages(messages, [{ at: 25 }, { at: 5 }, { at: 40 }, { at: 21 }])
    expect(placed.get('m2')).toEqual([{ at: 21 }, { at: 25 }])
    expect(placed.get('')).toEqual([{ at: 5 }])
    expect(placed.get('m3')).toEqual([{ at: 40 }])
  })
})

describe('export', () => {
  it('opens with the §8.4 notice when any answer is simulated and labels each simulated answer', () => {
    const md = threadToMarkdown({
      thread: { title: 'Stripe migration risks', createdAt: NOW },
      messages: [
        fx.message({ id: 'u', role: 'user', content: 'Rank the risks', createdAt: NOW }),
        fx.message({ id: 'a', content: 'Double billing [1]', simulated: true, modelId: 'sim-deep', createdAt: NOW, citations: [{ id: 'c', ref: { kind: 'knowledge', id: 'k' }, title: 'Stripe Billing migration plan' }] }),
      ],
      projectName: 'Atlas Portal v2',
      modelLabel: () => 'Simulator · Deep',
      now: NOW,
    })
    expect(md.split('\n')[0]).toBe(simulatedNotice(NOW))
    expect(md).toContain('# Stripe migration risks')
    expect(md).toContain('Project: Atlas Portal v2')
    expect(md).toContain('**Simulator · Deep**')
    expect(md).toContain('simulated — no model was called')
    expect(md).toContain('1. Stripe Billing migration plan')
  })

  it('has no notice for live-only conversations and makes safe file names', () => {
    const md = threadToMarkdown({ thread: { title: 'Plan', createdAt: NOW }, messages: [fx.message({ content: 'Live answer' })], modelLabel: () => 'Claude Sonnet 5.5', now: NOW })
    expect(md.startsWith('# Plan')).toBe(true)
    expect(markdownFileName('Stripe migration risks!')).toBe('stripe-migration-risks.md')
    expect(markdownFileName('—')).toBe('conversation.md')
  })
})
