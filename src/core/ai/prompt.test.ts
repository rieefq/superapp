import { describe, expect, it } from 'vitest'
import {
  ATRIUM_IDENTITY,
  buildSystemPrompt,
  CITE_INSTRUCTION,
  formatAttachmentBlock,
  formatAttachmentNote,
  parseKnowledgeBlock,
  parsePromptFacts,
  parseUserContent,
} from './prompt'

describe('system prompt', () => {
  const now = Date.UTC(2026, 10, 1, 12)

  it('includes identity, date, user, project, pinned context and numbered knowledge', () => {
    const system = buildSystemPrompt({
      now,
      userName: 'Morgan Lee',
      project: { name: 'Atlas Portal v2', goal: 'Ship SSO by Q1', instructions: 'Prefer short answers.' },
      context: ['Task: “Fix login redirect” (in progress)'],
      docs: [
        { index: 1, title: 'ADR-012: Session tokens & refresh', passage: 'Access tokens expire after 15 minutes. Use <short> lifetimes.' },
        { index: 2, title: 'Brand "voice"', passage: 'We write like a calm colleague.' },
      ],
    })
    expect(system).toContain(ATRIUM_IDENTITY)
    expect(system).toContain("Today's date is Sunday, November 1, 2026.")
    expect(system).toContain("The user's name is Morgan Lee.")
    expect(system).toContain('This conversation is part of the project “Atlas Portal v2”.')
    expect(system).toContain('Project goal: Ship SSO by Q1')
    expect(system).toContain('Project instructions: Prefer short answers.')
    expect(system).toContain('- Task: “Fix login redirect” (in progress)')
    expect(system).toContain('<doc index="1" title="ADR-012: Session tokens &amp; refresh">')
    expect(system).toContain(CITE_INSTRUCTION)
  })

  it('round-trips knowledge passages and facts through the parser (with escaping)', () => {
    const docs = [
      { index: 1, title: 'ADR-012: Session tokens & refresh', passage: 'Access tokens expire after 15 minutes. Use <short> lifetimes & rotate.' },
      { index: 2, title: 'Brand "voice"', passage: 'We write like a calm colleague.' },
    ]
    const system = buildSystemPrompt({ now, userName: 'Morgan Lee', project: { name: 'Lumen Launch', goal: 'Launch Lumen' }, docs })
    expect(parseKnowledgeBlock(system)).toEqual(docs)
    expect(parsePromptFacts(system)).toEqual({
      userName: 'Morgan Lee',
      projectName: 'Lumen Launch',
      projectGoal: 'Launch Lumen',
      date: 'Sunday, November 1, 2026',
    })
  })

  it('omits empty sections', () => {
    const system = buildSystemPrompt({ now })
    expect(system).not.toContain('<knowledge>')
    expect(system).not.toContain('project')
    expect(parseKnowledgeBlock(system)).toEqual([])
  })
})

describe('user content with attachments', () => {
  it('formats text attachments as labeled fenced blocks and parses them back', () => {
    const content = [
      'Summarize the attached notes',
      formatAttachmentBlock('notes.md', '# Notes\nWe agreed to ship on Friday.\n```js\nconst x = 1\n```'),
      formatAttachmentNote('diagram.png', 'image'),
      formatAttachmentNote('deck.key', 'file'),
    ].join('\n\n')
    const parsed = parseUserContent(content)
    expect(parsed.text).toBe('Summarize the attached notes')
    expect(parsed.files).toEqual([{ name: 'notes.md', text: '# Notes\nWe agreed to ship on Friday.\n```js\nconst x = 1\n```' }])
    expect(parsed.notes).toEqual([
      { name: 'diagram.png', kind: 'image' },
      { name: 'deck.key', kind: 'file' },
    ])
  })

  it('uses a fence longer than any backtick run inside the file', () => {
    const block = formatAttachmentBlock('a.md', 'has ```` four')
    expect(block.split('\n')[1]).toBe('`````')
  })

  it('leaves plain text untouched', () => {
    expect(parseUserContent('Just a question?')).toEqual({ text: 'Just a question?', files: [], notes: [] })
  })
})
