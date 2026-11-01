import { describe, expect, it } from 'vitest'
import { completeTrigger, detectTrigger, filterCommands, matchedTerms, parseSlash } from './text'

const COMMANDS = [
  { name: 'research', args: '<question>', description: 'Start a research run' },
  { name: 'task', args: '<title>', description: 'Make a task' },
  { name: 'note', description: 'Save a note to Knowledge' },
]

describe('detectTrigger', () => {
  it('opens the mention menu on an @ that starts a word', () => {
    expect(detectTrigger('Compare with @lum', 17)).toEqual({ kind: '@', query: 'lum', start: 13, end: 17 })
    expect(detectTrigger('@', 1)).toEqual({ kind: '@', query: '', start: 0, end: 1 })
    expect(detectTrigger('see (@atlas', 11)?.query).toBe('atlas')
  })

  it('ignores @ inside words (emails) and after a newline or too many spaces', () => {
    expect(detectTrigger('mail me@northwind.example', 25)).toBeNull()
    expect(detectTrigger('@atlas\nnext', 11)).toBeNull()
    expect(detectTrigger('@one two three four', 19)).toBeNull()
    expect(detectTrigger('@ leading space', 3)).toBeNull()
  })

  it('allows short multi-word mention queries', () => {
    expect(detectTrigger('@atlas lumen', 12)?.query).toBe('atlas lumen')
  })

  it('opens the command menu only for a slash at the start of the draft', () => {
    expect(detectTrigger('/res', 4)).toEqual({ kind: '/', query: 'res', start: 0, end: 4 })
    expect(detectTrigger('/', 1)?.kind).toBe('/')
    expect(detectTrigger('a/b', 3)).toBeNull()
    expect(detectTrigger('/research webhooks', 18)?.kind).not.toBe('/')
  })

  it('uses the caret, not the end of the text', () => {
    expect(detectTrigger('@lumen and more text', 6)?.query).toBe('lumen')
  })
})

describe('completeTrigger', () => {
  it('replaces the trigger and query with the insertion', () => {
    const t = detectTrigger('Ask @Sco about pricing', 8)!
    expect(completeTrigger('Ask @Sco about pricing', t, '@Scout ')).toEqual({ text: 'Ask @Scout  about pricing', caret: 11 })
  })

  it('removes a mention without leaving a double space', () => {
    const text = 'Compare @lumen with Tidewell'
    const t = detectTrigger(text, 14)!
    expect(completeTrigger(text, t, '').text).toBe('Compare with Tidewell')
  })
})

describe('slash commands', () => {
  it('filters by prefix first, then substring or description', () => {
    expect(filterCommands(COMMANDS, '').map((c) => c.name)).toEqual(['research', 'task', 'note'])
    expect(filterCommands(COMMANDS, 'no').map((c) => c.name)).toEqual(['note'])
    expect(filterCommands(COMMANDS, 'know').map((c) => c.name)).toEqual(['note'])
  })

  it('parses a submitted command and its arguments', () => {
    expect(parseSlash('/research webhook retries', COMMANDS)).toMatchObject({ command: { name: 'research' }, args: 'webhook retries' })
    expect(parseSlash('/note', COMMANDS)).toMatchObject({ command: { name: 'note' }, args: '' })
    expect(parseSlash('/unknown thing', COMMANDS)).toBeNull()
    expect(parseSlash('not a command', COMMANDS)).toBeNull()
  })
})

describe('matchedTerms', () => {
  it('returns the distinct matched words, lowercased, in order', () => {
    const text = 'Webhook retries: retry with backoff. Webhook IDs'
    const ranges: [number, number][] = [
      [0, 7],
      [17, 22],
      [37, 44],
    ]
    expect(matchedTerms(text, ranges)).toEqual(['webhook', 'retry'])
  })
})
