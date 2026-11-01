import { shortCode } from '@/lib/id'
import { describe, expect, it } from 'vitest'
import { emptyTables } from '@/core/db'
import { detectIntent } from '@/core/ai'
import { findByHandle, isStrongTitleMatch, matchText, mentionsFromReason, nextVerb, parseQuery, shouldShowIntent, VERBS } from './model'

describe('parseQuery (§3.7 prefixes)', () => {
  it('detects > # @ ? prefixes', () => {
    expect(parseQuery('> theme light')).toEqual({ mode: 'command', text: 'theme light', prefix: '>' })
    expect(parseQuery('#atlas')).toMatchObject({ mode: 'project', text: 'atlas' })
    expect(parseQuery('@prd')).toMatchObject({ mode: 'item', text: 'prd' })
    expect(parseQuery('? why do runs fail')).toMatchObject({ mode: 'ask', text: 'why do runs fail' })
    expect(parseQuery('  atlas lumen ')).toMatchObject({ mode: 'search', text: 'atlas lumen' })
  })
})

describe('matchText', () => {
  it('ranks exact > prefix > word prefixes > substring > subsequence', () => {
    const exact = matchText('chat', 'Chat')!.score
    const prefix = matchText('cha', 'Chat')!.score
    const words = matchText('lumen prd', 'Atlas Lumen PRD')!.score
    const sub = matchText('umen', 'Atlas Lumen PRD')!.score
    const fuzzy = matchText('alp', 'Atlas Lumen PRD')!.score
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(words)
    expect(words).toBeGreaterThan(sub)
    expect(sub).toBeGreaterThan(fuzzy)
    expect(matchText('zzz', 'Chat')).toBeNull()
  })

  it('returns highlight ranges in the title', () => {
    expect(matchText('lumen prd', 'Atlas Lumen PRD')!.ranges).toEqual([
      [6, 11],
      [12, 15],
    ])
    expect(matchText('theme light', 'Theme: Light', ['theme', 'light'])).not.toBeNull()
  })

  it('recognizes a strong title match', () => {
    expect(isStrongTitleMatch('atlas lumen prd', 'Atlas Lumen PRD')).toBe(true)
    expect(isStrongTitleMatch('compare competitors pricing pages', 'Atlas Lumen PRD')).toBe(false)
  })
})

describe('handles (§2.7)', () => {
  it('resolves RUN-XXXX to the run whose shortCode matches', () => {
    const t = emptyTables()
    t.runs = { run_k3j9x0q2ab: { id: 'run_k3j9x0q2ab' } as never }
    t.knowledge = { kno_lumen_prd: { id: 'kno_lumen_prd' } as never }
    expect(findByHandle(t, 'RUN-K3J9')).toEqual({ kind: 'run', id: 'run_k3j9x0q2ab' })
    expect(findByHandle(t, 'run-k3j9')).toEqual({ kind: 'run', id: 'run_k3j9x0q2ab' })
    expect(findByHandle(t, shortCode('kno_lumen_prd'))).toEqual({ kind: 'knowledge', id: 'kno_lumen_prd' })
    expect(findByHandle(t, 'RUN-ZZZZ')).toBeNull()
    expect(findByHandle(t, 'hello')).toBeNull()
  })
})

describe('intent row', () => {
  it('cycles verbs in the spec order and wraps', () => {
    expect(VERBS).toEqual(['ask', 'research', 'build', 'delegate', 'create', 'automate', 'organize'])
    expect(nextVerb('ask')).toBe('research')
    expect(nextVerb('organize')).toBe('ask')
    expect(nextVerb('ask', -1)).toBe('organize')
  })

  it('shows for requests (≥3 words or a confident non-chat intent), not for short searches', () => {
    expect(shouldShowIntent('atlas', detectIntent('atlas'))).toBe(false)
    expect(shouldShowIntent('research competitors', detectIntent('research competitors'))).toBe(true)
    expect(shouldShowIntent('what is our churn', detectIntent('what is our churn'))).toBe(true)
  })

  it('extracts the mentioned cues', () => {
    expect(mentionsFromReason('Looks like a research task: mentions “competitors”, “sources”.')).toEqual(['competitors', 'sources'])
    expect(mentionsFromReason('Reads as a question, so chat is the best place to answer it.')).toEqual([])
  })
})
