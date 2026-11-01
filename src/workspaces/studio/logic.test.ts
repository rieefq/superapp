import { describe, expect, it } from 'vitest'
import type { Asset, Slide } from '@/core/types'
import { luminance } from '@/core/sim/art'
import {
  addSlideAfter, aspectRatio, boardsInScope, deckToHtml, deckToJson, deckToMarkdown, exportSize, fileSlug, filterAssets, gridMove, markdownToHtml, moveSlide,
  parseShot, parseShots, placeFromParams, quoteParts, removeSlide, sheetSearch, shotAt, simulatedHeader, slideTheme, splitColumns, storyboardDuration, textToHtml,
  textToMarkdown,
} from './logic'
import { studioHref, withParam } from './view'

const T = new Date('2026-11-01T10:00:00Z').getTime()

const asset = (o: Partial<Asset>): Asset => ({
  id: 'ast_1', kind: 'image', title: 'Hero', prompt: 'A calm harbor', projectId: null, boardId: null, status: 'ready',
  generator: { id: 'image-gen', label: 'Image generator', simulated: true }, params: {}, versions: [], currentVersion: 0, tags: [],
  createdAt: T, updatedAt: T, ...o,
})

describe('contact sheet views', () => {
  const assets = [
    asset({ id: 'a', kind: 'image', boardId: 'brd_1', projectId: 'prj_1', favorite: true, createdAt: T - 3 }),
    asset({ id: 'b', kind: 'presentation', title: 'Launch keynote', boardId: 'brd_1', projectId: 'prj_1', createdAt: T - 1 }),
    asset({ id: 'c', kind: 'document', title: 'Launch email', boardId: null, projectId: 'prj_2', tags: ['email'], createdAt: T - 2 }),
  ]

  it('parses and writes the URL', () => {
    expect(placeFromParams(new URLSearchParams('board=brd_1'))).toEqual({ type: 'board', id: 'brd_1' })
    expect(placeFromParams(new URLSearchParams('board=none'))).toEqual({ type: 'unfiled' })
    expect(placeFromParams(new URLSearchParams('filter=favorites'))).toEqual({ type: 'favorites' })
    expect(placeFromParams(new URLSearchParams(''))).toEqual({ type: 'all' })
    expect(sheetSearch({ type: 'board', id: 'brd_1' }, 'image', ' harbor ')).toBe('?board=brd_1&kind=image&q=harbor')
    expect(sheetSearch({ type: 'all' }, null)).toBe('')
    expect(studioHref({ place: { type: 'favorites' }, kind: null, q: '', showAll: true })).toBe('/studio?filter=favorites&all=1')
    expect(withParam('/studio?board=b', 'compose', '1')).toBe('/studio?board=b&compose=1')
  })

  it('filters by place, kind, search and scope, newest first', () => {
    expect(filterAssets(assets, { place: { type: 'all' }, kind: null, q: '', projectId: null }).map((a) => a.id)).toEqual(['b', 'c', 'a'])
    expect(filterAssets(assets, { place: { type: 'board', id: 'brd_1' }, kind: null, q: '', projectId: null }).map((a) => a.id)).toEqual(['b', 'a'])
    expect(filterAssets(assets, { place: { type: 'favorites' }, kind: null, q: '', projectId: null }).map((a) => a.id)).toEqual(['a'])
    expect(filterAssets(assets, { place: { type: 'unfiled' }, kind: null, q: '', projectId: null }).map((a) => a.id)).toEqual(['c'])
    expect(filterAssets(assets, { place: { type: 'all' }, kind: 'presentation', q: '', projectId: null }).map((a) => a.id)).toEqual(['b'])
    expect(filterAssets(assets, { place: { type: 'all' }, kind: null, q: 'launch EMAIL', projectId: null }).map((a) => a.id)).toEqual(['c'])
    expect(filterAssets(assets, { place: { type: 'all' }, kind: null, q: '', projectId: 'prj_1' }).map((a) => a.id)).toEqual(['b', 'a'])
  })

  it('lists the scoped project’s boards first, then global ones', () => {
    const boards = [
      { id: 'g', name: 'Global', projectId: null, createdAt: 1 },
      { id: 'o', name: 'Other project', projectId: 'prj_2', createdAt: 2 },
      { id: 'p', name: 'This project', projectId: 'prj_1', createdAt: 3 },
    ]
    expect(boardsInScope(boards, 'prj_1').map((b) => b.id)).toEqual(['p', 'g'])
    expect(boardsInScope(boards, null).map((b) => b.id)).toEqual(['g', 'o', 'p'])
  })

  it('moves through the grid with the arrow keys', () => {
    expect(gridMove(0, 'ArrowRight', 4, 10)).toBe(1)
    expect(gridMove(0, 'ArrowLeft', 4, 10)).toBe(0)
    expect(gridMove(1, 'ArrowDown', 4, 10)).toBe(5)
    expect(gridMove(7, 'ArrowDown', 4, 10)).toBe(7)
    expect(gridMove(5, 'ArrowUp', 4, 10)).toBe(1)
    expect(gridMove(5, 'End', 4, 10)).toBe(9)
    expect(gridMove(5, 'Home', 4, 10)).toBe(0)
  })
})

describe('aspect and sizes', () => {
  it('reads aspects and sizes exports by the long edge', () => {
    expect(aspectRatio('16:9')).toBeCloseTo(16 / 9)
    expect(aspectRatio('4/5')).toBeCloseTo(0.8)
    expect(aspectRatio('wide', 1.5)).toBe(1.5)
    expect(exportSize(16 / 9)).toEqual({ width: 2048, height: 1152 })
    expect(exportSize(9 / 16, 1600)).toEqual({ width: 900, height: 1600 })
  })
})

describe('storyboards', () => {
  const generated: Slide = { id: 's1', layout: 'image', title: 'Shot 3 · Turn', body: 'Framing: Close-up\nMotion: rack focus\nVO: “There’s a simpler way.”', notes: '0:10–0:15 · 16:9' }
  const seeded: Slide = { id: 's2', layout: 'image', title: 'Beat 3 · 0:12–0:22 · Lumen appears', body: 'The Lumen lane view, with dwell time highlighted.', notes: 'VO: Lumen shows you where the time goes, stop by stop.' }

  it('reads generated shots and seeded beats', () => {
    expect(parseShot(generated, 2, 6, 30)).toEqual({
      index: 2, label: 'Shot 3', beat: 'Turn', start: 10, end: 15, framing: 'Close-up', motion: 'rack focus', vo: 'There’s a simpler way.',
    })
    expect(parseShot(seeded, 2, 6, 45)).toEqual({
      index: 2, label: 'Beat 3', beat: 'Lumen appears', start: 12, end: 22, description: 'The Lumen lane view, with dwell time highlighted.', vo: 'Lumen shows you where the time goes, stop by stop.',
    })
    const plain: Slide = { id: 's3', layout: 'image', title: 'Opening', body: 'A dispatcher at dawn.', notes: 'No narration; quiet office sound.' }
    expect(parseShot(plain, 0, 3, 30)).toMatchObject({ label: 'Opening', beat: 'Opening', start: 0, end: 10, note: 'No narration; quiet office sound.' })
  })

  it('finds the shot playing at a time and the total length', () => {
    const shots = parseShots([generated, { ...generated, id: 's4', title: 'Shot 4 · Solution', notes: '0:15–0:20 · 16:9' }], 30)
    expect(shotAt(shots, 0)).toBe(0)
    expect(shotAt(shots, 16)).toBe(1)
    expect(storyboardDuration(shots, 30)).toBe(30)
    expect(storyboardDuration(shots, undefined)).toBe(20)
  })
})

describe('slides', () => {
  it('builds a legible theme from any palette', () => {
    for (const palette of [['#0B1426', '#13294B', '#F2A93B', '#F4F1EA'], ['#f4f1ea', '#e8dcc4', '#d9b77a'], ['#8dbaf2'], []]) {
      const t = slideTheme(palette)
      const lb = luminance(t.background)
      const li = luminance(t.ink)
      expect((Math.max(lb, li) + 0.05) / (Math.min(lb, li) + 0.05)).toBeGreaterThanOrEqual(7)
    }
    expect(slideTheme(['#0B1426', '#13294B', '#F2A93B', '#F4F1EA'])).toMatchObject({ background: '#0B1426', accent: '#F2A93B', dark: true })
  })

  it('splits columns, reads quotes and edits the slide list', () => {
    expect(splitColumns('**A**\nSmall\n\n**B**\nBig')).toEqual(['**A**\nSmall', '**B**\nBig'])
    expect(splitColumns('one\ntwo\nthree')).toEqual(['one\ntwo', 'three'])
    expect(quoteParts('“It works.”\n— Dana, VP Ops')).toEqual({ quote: 'It works.', by: 'Dana, VP Ops' })
    const slides: Slide[] = ['a', 'b', 'c'].map((id) => ({ id, title: id, body: '', layout: 'bullets' }))
    const added = addSlideAfter(slides, 0)
    expect(added.at).toBe(1)
    expect(added.slides.map((s) => s.title)).toEqual(['a', 'New slide', 'b', 'c'])
    expect(moveSlide(slides, 0, 1).slides.map((s) => s.id)).toEqual(['b', 'a', 'c'])
    expect(moveSlide(slides, 0, -1).slides.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(removeSlide(slides, 2)).toMatchObject({ at: 1 })
    expect(removeSlide([slides[0]], 0).slides).toHaveLength(1)
  })
})

describe('exports', () => {
  const slides: Slide[] = [
    { id: 's1', layout: 'title', title: 'Atlas <Lumen>', body: 'From tracking to knowing.', notes: 'Open calmly.' },
    { id: 's2', layout: 'bullets', title: 'Why', body: '- One\n- **Two**', notes: '' },
  ]

  it('start every simulated export with the exact header line', () => {
    const header = simulatedHeader(T)
    expect(header).toBe("> **Simulated content.** Generated by Atrium's local simulator on 2026-11-01. No AI model, web search or external service was used.")
    expect(deckToMarkdown('Deck', slides, { simulated: true, at: T }).split('\n')[0]).toBe(header)
    expect(textToMarkdown('# Copy', { simulated: true, at: T }).startsWith(header)).toBe(true)
    expect(textToMarkdown('# Copy', { simulated: false, at: T })).toBe('# Copy\n')
    expect(deckToMarkdown('Deck', slides, { simulated: true, at: T })).toContain('## 2. Why\n\n- One\n- **Two**')
    expect(deckToMarkdown('Deck', slides, { simulated: true, at: T })).toContain('> Speaker notes: Open calmly.')
  })

  it('writes escaped, standalone HTML and JSON', () => {
    const html = deckToHtml('Deck & co', slides, ['#0B1426', '#F2A93B', '#F4F1EA'], { simulated: true, at: T })
    expect(html).toContain('<title>Deck &amp; co</title>')
    expect(html).toContain('Atlas &lt;Lumen&gt;')
    expect(html).not.toContain('<Lumen>')
    expect(html).toContain('Simulated content.')
    expect(html.match(/<section /g)).toHaveLength(2)
    const json = JSON.parse(deckToJson({ id: 'a', title: 'Deck', prompt: 'p', generator: { id: 'g', label: 'G', simulated: true } }, slides, T))
    expect(json).toMatchObject({ title: 'Deck', simulated: true, slides: [{ id: 's1', layout: 'title' }, { id: 's2' }] })
    expect(textToHtml('Copy', '# Hi\n\nText <b>x</b>', { simulated: false, at: T })).toContain('<h1>Hi</h1>\n<p>Text &lt;b&gt;x&lt;/b&gt;</p>')
  })

  it('converts the Markdown Studio writes (headings, lists, quotes, tables, emphasis)', () => {
    const md = '# Title\n\n**Bold** and _italic_\n\n- one\n- two\n\n1. first\n\n> quote\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] done'
    const html = markdownToHtml(md)
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>Bold</strong> and <em>italic</em>')
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).toContain('<ol><li>first</li></ol>')
    expect(html).toContain('<blockquote><p>quote</p></blockquote>')
    expect(html).toContain('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
    expect(html).toContain('☑ done')
    expect(fileSlug('Hero key art — four directions!')).toBe('hero-key-art-four-directions')
    expect(fileSlug('···')).toBe('asset')
  })
})
