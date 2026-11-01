import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, formatAttachmentBlock, formatAttachmentNote } from '../prompt'
import type { ChatTurn } from '../types'
import { composeAnswer } from './compose'
import { gatherEvidence } from './evidence'
import { LENGTH } from './layout'
import { detectShape, extractComparisonItems } from './shapes'
import { extractSubject } from './subject'
import { countWords, splitSentences } from './text'

const DOCS = [
  {
    index: 1,
    title: 'ADR-012: Session tokens & refresh',
    passage:
      'Access tokens expire after 15 minutes. Refresh tokens are rotated on every use and expire after 30 days of inactivity. When the SSO provider returns a session, we mint our own session token rather than reusing the IdP token. The current bug happens because the refresh call races the redirect after login.',
  },
  {
    index: 2,
    title: 'Atlas Lumen PRD',
    passage:
      'Lumen gives operations managers lane-level margin trends without exporting data to spreadsheets. The first release targets mid-market freight companies. Pricing will be an add-on to the Atlas Pro plan.',
  },
]

const system = (docs = DOCS) => buildSystemPrompt({ now: Date.UTC(2026, 10, 1), userName: 'Morgan Lee', docs })
const ask = (content: string, modelId = 'sim-swift', sys = system(), seed?: number) =>
  composeAnswer({ modelId, system: sys, messages: [{ role: 'user', content }], seed })

/** Sentences of all passages, for "quotes what the passages actually say" checks. */
const passageSentences = DOCS.flatMap((d) => splitSentences(d.passage).map((s) => s.replace(/[.]$/, '')))

describe('composeAnswer — knowledge grounding', () => {
  it('cites relevant passages with [n] markers and quotes their real sentences', () => {
    const out = ask('Why do users get logged out after SSO login?')
    expect(out.content).toMatch(/\[1\]/)
    const quoted = passageSentences.filter((s) => out.content.toLowerCase().includes(s.toLowerCase().slice(1)))
    expect(quoted.length).toBeGreaterThan(0)
    // The unrelated PRD is not presented as support for an SSO answer.
    expect(out.content).not.toMatch(/margin trends[^\n]*\[2\]/)
  })

  it('lists passages that do not match the request as possibly related instead of citing them as support', () => {
    const out = ask('Plan a 6-week migration to Stripe Billing', 'sim-deep')
    expect(out.content).toContain('Possibly related in your workspace')
    expect(out.content).toMatch(/\[1\]/)
  })

  it('is honest when there is no knowledge at all', () => {
    const out = ask('What is a vector database?', 'sim-swift', system([]))
    expect(out.content).toMatch(/framework|not .*verified|isn't grounded/i)
    expect(out.content).not.toMatch(/\[\d\]/)
  })

  it('never invents statistics or links', () => {
    const prompts = [
      'What is a vector database?',
      'Compare Postgres vs MongoDB for our event store',
      'Brainstorm ideas for our onboarding',
      'Draft a launch email for Lumen to existing customers',
      'Plan a launch for the new mobile app',
      'How do I set up SSO for our portal?',
    ]
    for (const p of prompts) {
      for (const model of ['sim-swift', 'sim-deep']) {
        const { content } = ask(p, model, system([]))
        expect(content, p).not.toMatch(/https?:\/\//)
        expect(content, p).not.toMatch(/\d+(?:\.\d+)?\s?%/)
      }
    }
  })
})

describe('composeAnswer — request shapes', () => {
  it('compares with a markdown table naming both options', () => {
    const { content, shape } = ask('Compare Postgres vs MongoDB for our event store', 'sim-swift', system([]))
    expect(shape).toBe('compare')
    expect(content).toMatch(/\| Criterion \| What to check \| Postgres \| MongoDB \|/)
    expect(content).toMatch(/\| --- \|/)
  })

  it('writes code in a fenced block in the requested language', () => {
    const py = ask('Write a Python function to retry a flaky call with exponential backoff', 'sim-swift', system([]))
    expect(py.shape).toBe('code')
    expect(py.content).toMatch(/```python\n[\s\S]*def retry\(/)
    const ts = ask('Write a TypeScript debounce function', 'sim-swift', system([]))
    expect(ts.content).toMatch(/```ts\n[\s\S]*export function debounce<A extends unknown\[\]>/)
    const js = ask('Write a JavaScript debounce function', 'sim-swift', system([]))
    expect(js.content).toMatch(/```js\n[\s\S]*export function debounce\(fn, waitMs\)/)
    const sql = ask('SQL query for the top 5 customers by revenue from orders', 'sim-swift', system([]))
    expect(sql.content).toMatch(/```sql\n[\s\S]*LIMIT 5;/)
  })

  it('scaffolds unknown code honestly with a TODO', () => {
    const { content } = ask('Write a Rust function that parses invoice lines into objects', 'sim-swift', system([]))
    expect(content).toMatch(/```rust\n[\s\S]*pub fn parse_invoice_lines\(/)
    expect(content).toContain('TODO')
  })

  it('summarizes pasted text extractively using its real sentences', () => {
    const source =
      'The quarterly review covered three areas. Revenue grew in the mid-market segment while enterprise deals slipped. The team agreed that onboarding is the main bottleneck for new accounts. Support volume rose after the September release. We will hire two support engineers by December. Marketing should prepare a case study with Meridian Freight.'
    const { content, shape } = ask(`Summarize this: ${source}`, 'sim-swift', system([]))
    expect(shape).toBe('summarize')
    const sourceSentences = splitSentences(source)
    const bullets = content.split('\n').filter((l) => l.startsWith('- ') || l.startsWith('**TL;DR:**'))
    expect(bullets.length).toBeGreaterThan(1)
    for (const line of bullets) {
      const text = line.replace(/^- |\*\*TL;DR:\*\* /, '')
      expect(sourceSentences.some((s) => s === text || s.startsWith(text.replace(/…$/, ''))), text).toBe(true)
    }
  })

  it('summarizes an attached file and asks for text when there is nothing to summarize', () => {
    const withFile = ask(`Summarize this\n\n${formatAttachmentBlock('notes.md', 'We shipped the beta to five customers. Two asked for CSV export. The team will add export next sprint.')}`)
    expect(withFile.content).toContain('**notes.md**')
    const nothing = ask('Summarize this', 'sim-swift', system([]))
    expect(nothing.content).toMatch(/don't see any text to summarize/i)
  })

  it('drafts writing in the requested format with placeholders instead of invented details', () => {
    const { content, shape } = ask('Draft a launch email for Lumen to existing customers')
    expect(shape).toBe('write')
    expect(content).toContain('**Subject:** Introducing Lumen')
    expect(content).toContain('Morgan Lee')
    expect(content).toContain('[date]')
    expect(content).toMatch(/Lumen gives operations managers lane-level margin trends/)
    expect(content).toMatch(/\[2\]/)
  })

  it('plans in phases and brainstorms numbered ideas', () => {
    const plan = ask('Plan a 6-week rollout of the new billing system', 'sim-swift', system([]))
    expect(plan.content).toMatch(/### Phase 1 — \w+ \(Weeks? 1/)
    const ideas = ask('Give me 5 ideas for improving onboarding', 'sim-swift', system([]))
    expect(ideas.shape).toBe('brainstorm')
    expect(ideas.content).toMatch(/^1\. \*\*/m)
    expect(ideas.content).toMatch(/^5\. \*\*/m)
  })

  it('acknowledges images it cannot see by name', () => {
    const { content } = ask(`What do you think of this layout?\n\n${formatAttachmentNote('homepage-v2.png', 'image')}`)
    expect(content).toContain('**homepage-v2.png**')
    expect(content).toMatch(/can't view images/)
  })

  it('asks a clarifying question instead of guessing when the request is too vague', () => {
    expect(ask('Write a function', 'sim-swift', system([])).content).toMatch(/which language/i)
    expect(ask('compare', 'sim-swift', system([])).content).toMatch(/Name the options/)
    expect(ask('What is', 'sim-swift', system([])).content).toMatch(/say a bit more|not sure what you're asking/i)
  })

  it('answers greetings briefly', () => {
    const out = ask('hi')
    expect(out.shape).toBe('greeting')
    expect(out.content).toContain('Morgan')
    expect(countWords(out.content)).toBeLessThan(60)
  })
})

describe('composeAnswer — length, reasoning and determinism', () => {
  const prompts = [
    'What is a vector database?',
    'How do I set up SSO for our customer portal?',
    'Compare Postgres vs MongoDB for our event store',
    'Brainstorm ideas for the Lumen launch event',
    'Plan a 6-week migration to Stripe Billing',
    'Why do our users get logged out after SSO login?',
    'What should we prioritize for Q1?',
  ]

  it('keeps sim-swift around 120–250 words and sim-deep around 250–450', () => {
    for (const p of prompts) {
      const swift = countWords(ask(p, 'sim-swift').content)
      const deep = countWords(ask(p, 'sim-deep').content)
      expect(swift, `swift: ${p}`).toBeGreaterThanOrEqual(LENGTH.swift.min)
      expect(swift, `swift: ${p}`).toBeLessThanOrEqual(LENGTH.swift.max)
      expect(deep, `deep: ${p}`).toBeGreaterThanOrEqual(LENGTH.deep.min - 40)
      expect(deep, `deep: ${p}`).toBeLessThanOrEqual(LENGTH.deep.max)
    }
  })

  it('produces a 3–5 sentence reasoning trace only for sim-deep', () => {
    expect(ask('How do I set up SSO?', 'sim-swift').reasoning).toBeUndefined()
    const deep = ask('How do I set up SSO?', 'sim-deep')
    const sentences = splitSentences(deep.reasoning ?? '')
    expect(sentences.length).toBeGreaterThanOrEqual(3)
    expect(sentences.length).toBeLessThanOrEqual(5)
    expect(composeAnswer({ modelId: 'sim-deep', messages: [{ role: 'user', content: 'How do I set up SSO?' }], reasoning: false }).reasoning).toBeUndefined()
  })

  it('is deterministic for the same input and seed, and varies with the seed', () => {
    const p = 'Brainstorm ideas for our onboarding'
    expect(ask(p, 'sim-swift', system([]), 7).content).toBe(ask(p, 'sim-swift', system([]), 7).content)
    const variants = new Set([1, 2, 3, 4, 5].map((seed) => ask(p, 'sim-swift', system([]), seed).content))
    expect(variants.size).toBeGreaterThan(1)
  })

  it('answers the last user turn and can summarize the previous answer', () => {
    const messages: ChatTurn[] = [
      { role: 'user', content: 'Tell me about our launch.' },
      { role: 'assistant', content: 'The launch moves to March. Marketing will prepare the announcement. Support needs a new FAQ before launch day.' },
      { role: 'user', content: 'tl;dr of your last answer?' },
    ]
    const out = composeAnswer({ modelId: 'sim-swift', messages })
    expect(out.shape).toBe('summarize')
    expect(out.content).toContain('my previous answer')
    expect(out.content).toContain('The launch moves to March.')
  })
})

describe('simulator helpers', () => {
  it('detects shapes from phrasing', () => {
    const cases: Array<[string, string]> = [
      ['Summarize the meeting notes below', 'summarize'],
      ['Write a Python script to rename photos by date', 'code'],
      ['Postgres vs MySQL?', 'compare'],
      ['Create a 30-day onboarding plan for new engineers', 'plan'],
      ['Draft a memo to the board about the delay', 'write'],
      ['How do I configure SSO with Okta?', 'howto'],
      ['Give me 10 names for a podcast', 'brainstorm'],
      ['What is event sourcing?', 'explain'],
    ]
    for (const [text, shape] of cases) expect(detectShape(text).shape, text).toBe(shape)
  })

  it('extracts comparison items', () => {
    expect(extractComparisonItems('Compare Postgres and MongoDB for event storage')).toEqual(['Postgres', 'MongoDB'])
    expect(extractComparisonItems('What are the differences between REST and GraphQL?')).toEqual(['REST', 'GraphQL'])
    expect(extractComparisonItems('Should we use Stripe or Paddle for billing?')).toEqual(['Stripe', 'Paddle'])
    expect(extractComparisonItems('React vs Vue vs Svelte')).toEqual(['React', 'Vue', 'Svelte'])
  })

  it('restates the subject in second person', () => {
    expect(extractSubject('How do I set up SSO for our portal?')).toMatchObject({ kind: 'action', vp: 'set up SSO for your portal', np: 'setting up SSO for your portal' })
    expect(extractSubject('What is a vector database?')).toMatchObject({ kind: 'thing', np: 'a vector database' })
    expect(extractSubject('Why does our churn spike in Q4?').kind).toBe('question')
  })

  it('only gathers evidence from passages that share keywords with the request', () => {
    const evidence = gatherEvidence(
      DOCS.map((d) => ({ index: d.index, title: d.title, text: d.passage, source: 'knowledge' as const })),
      'session token refresh after SSO login',
      { perSource: 1, max: 3 },
    )
    expect(evidence.length).toBeGreaterThan(0)
    expect(evidence.every((e) => e.index === 1)).toBe(true)
    expect(evidence.every((e) => e.overlap > 0)).toBe(true)
  })
})

describe('composeAnswer — robustness', () => {
  const odd = [
    '',
    '   ',
    '?',
    '!!!',
    '…',
    '🙂🙂🙂',
    'a',
    'vs',
    'compare',
    'summarize',
    'write',
    'Write a function',
    'Compare A vs',
    'How do I',
    'What is',
    '```\nconst x = 1\n```',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    '# Heading only',
    'x '.repeat(3000),
    'Ünïcödé ﬁle naïve café — “quotes” and ‘single’ and <tags> & ampersands',
    'Give me 999 ideas for 0 things',
    'Plan a 0-week project',
    'every Monday at 25:99 do the thing',
    'Write a regex in Rust and Kotlin and Swift and PHP',
    `Summarize this: ${'Sentence number one is here. '.repeat(200)}`,
  ]

  it('never throws and always returns some content', () => {
    for (const model of ['sim-swift', 'sim-deep']) {
      for (const text of odd) {
        const out = composeAnswer({ modelId: model, system: system(), messages: [{ role: 'user', content: text }] })
        expect(out.content.trim().length, JSON.stringify(text.slice(0, 40))).toBeGreaterThan(0)
      }
    }
  })

  it('handles conversations without a user turn and multi-part content', () => {
    expect(composeAnswer({ modelId: 'sim-swift', messages: [] }).shape).toBe('empty')
    expect(composeAnswer({ modelId: 'sim-swift', messages: [{ role: 'assistant', content: 'Hi!' }] }).shape).toBe('empty')
    const out = composeAnswer({
      modelId: 'sim-swift',
      messages: [{ role: 'user', content: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAAA' }, { type: 'text', text: 'What is in this picture?' }] }],
    })
    expect(out.content).toMatch(/can't view images/)
  })
})
