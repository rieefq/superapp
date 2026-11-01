import { hexToRgb, luminance } from '@/core/sim/art'
import type { Asset, AssetKind, Board, ID, Slide } from '@/core/types'

/**
 * Studio's pure helpers: what the contact sheet shows, storyboard parsing, slide theming and the
 * text of every export. No React, no store — unit-tested in logic.test.ts.
 */

// ------------------------------------------------------------------------------------------------ views

/** Where the contact sheet is: everything, favorites, a board, or assets without a board. */
export type Place = { type: 'all' } | { type: 'favorites' } | { type: 'board'; id: ID } | { type: 'unfiled' }

export interface SheetQuery {
  place: Place
  kind: AssetKind | null
  q: string
  /** Scope filter (null: all projects). */
  projectId: ID | null
}

export const ASSET_KINDS: readonly AssetKind[] = ['image', 'video', 'presentation', 'document', 'audio']

export function isAssetKind(v: string | null | undefined): v is AssetKind {
  return !!v && (ASSET_KINDS as readonly string[]).includes(v)
}

/** Parse the contact sheet's URL (`?board=`, `?kind=`, `?filter=favorites`, `?q=`). */
export function placeFromParams(params: URLSearchParams): Place {
  const board = params.get('board')
  if (board === 'none') return { type: 'unfiled' }
  if (board) return { type: 'board', id: board }
  if (params.get('filter') === 'favorites') return { type: 'favorites' }
  return { type: 'all' }
}

/** The URL search for a place (+ the kind facet and search, kept when given). */
export function sheetSearch(place: Place, kind: AssetKind | null, q = ''): string {
  const p = new URLSearchParams()
  if (place.type === 'board') p.set('board', place.id)
  else if (place.type === 'unfiled') p.set('board', 'none')
  else if (place.type === 'favorites') p.set('filter', 'favorites')
  if (kind) p.set('kind', kind)
  if (q.trim()) p.set('q', q.trim())
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function inPlace(asset: Asset, place: Place): boolean {
  switch (place.type) {
    case 'all':
      return true
    case 'favorites':
      return !!asset.favorite
    case 'board':
      return asset.boardId === place.id
    case 'unfiled':
      return !asset.boardId
  }
}

/** Case-insensitive match on title, prompt and tags (every word must match somewhere). */
export function matchesQuery(asset: Asset, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = `${asset.title}\n${asset.prompt}\n${asset.tags.join(' ')}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

export function inScope(asset: Asset, projectId: ID | null): boolean {
  return !projectId || asset.projectId === projectId
}

/** The assets a contact sheet shows, newest first. */
export function filterAssets(assets: readonly Asset[], query: SheetQuery): Asset[] {
  return assets
    .filter((a) => inScope(a, query.projectId) && inPlace(a, query.place) && (!query.kind || a.kind === query.kind) && matchesQuery(a, query.q))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}

/** Boards to list while scoped: the project's boards first, then boards without a project. */
export function boardsInScope(boards: readonly Board[], projectId: ID | null): Board[] {
  const list = projectId ? boards.filter((b) => b.projectId === projectId || !b.projectId) : [...boards]
  return list.sort((a, b) => Number(b.projectId === projectId && !!projectId) - Number(a.projectId === projectId && !!projectId) || a.createdAt - b.createdAt)
}

export function samePlace(a: Place, b: Place): boolean {
  return a.type === b.type && (a.type !== 'board' || (b.type === 'board' && a.id === b.id))
}

// ------------------------------------------------------------------------------------------------ aspect

/** "16:9" → 16/9; unknown → fallback. */
export function aspectRatio(aspect: unknown, fallback = 1): number {
  if (typeof aspect !== 'string') return fallback
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)\s*$/.exec(aspect)
  if (!m) return fallback
  const r = Number(m[1]) / Number(m[2])
  return Number.isFinite(r) && r > 0 ? r : fallback
}

/** Pixel size for an export with the long edge at `long`. */
export function exportSize(ratio: number, long = 2048): { width: number; height: number } {
  return ratio >= 1 ? { width: long, height: Math.round(long / ratio) } : { width: Math.round(long * ratio), height: long }
}

// ------------------------------------------------------------------------------------------------ storyboards

export interface Shot {
  index: number
  /** "Shot 3" / "Beat 3". */
  label: string
  /** "Turn", "Cold open". */
  beat: string
  start: number
  end: number
  framing?: string
  motion?: string
  /** The voice-over line. */
  vo?: string
  /** What is on screen (seeded beat sheets describe it in prose). */
  description?: string
  /** Production notes that are not a voice-over line ("No narration; quiet office sound."). */
  note?: string
}

const clockRe = /(\d+):(\d{2})\s*[–-]\s*(\d+):(\d{2})/

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "0:10–0:15 · 16:9": a line that only carries a timecode (and an aspect). */
const isTimecodeLine = (line: string) => clockRe.test(line) && line.replace(clockRe, '').replace(/[·\s\d:/x×.]/g, '') === ''

/** Read a storyboard slide (generated "Shot 3 · Turn" or a seeded "Beat 3 · 0:12–0:22 · …" beat). */
export function parseShot(slide: Slide, index: number, total: number, durationSec: number): Shot {
  const per = durationSec / Math.max(1, total)
  const time = clockRe.exec(`${slide.title} ${slide.notes ?? ''}`)
  const start = time ? Number(time[1]) * 60 + Number(time[2]) : index * per
  const end = time ? Number(time[3]) * 60 + Number(time[4]) : (index + 1) * per
  const parts = slide.title.split('·').map((s) => s.trim()).filter(Boolean)
  const label = parts[0] ?? `Shot ${index + 1}`
  const beat = parts.slice(1).filter((p) => !clockRe.test(p)).join(' · ') || label
  const shot: Shot = { index, label, beat, start, end: Math.max(end, start + 1) }
  const read = (text: string, into: 'description' | 'note') => {
    const prose: string[] = []
    for (const raw of text.split('\n')) {
      const l = raw.trim()
      if (!l || isTimecodeLine(l)) continue
      const m = /^(Framing|Motion|VO):\s*(.+)$/i.exec(l)
      if (!m) {
        prose.push(l)
        continue
      }
      const value = m[2].trim().replace(/^[“"]|[”"]$/g, '')
      const key = m[1].toLowerCase()
      if (key === 'framing') shot.framing = value
      else if (key === 'motion') shot.motion = value
      else shot.vo = value
    }
    if (prose.length) shot[into] = prose.join(' ')
  }
  read(slide.body, 'description')
  read(slide.notes ?? '', 'note')
  return shot
}

export function parseShots(slides: readonly Slide[], durationSec: number): Shot[] {
  return slides.map((s, i) => parseShot(s, i, slides.length, durationSec))
}

/** Total length of a storyboard: the asset's duration, or the last shot's end. */
export function storyboardDuration(shots: readonly Shot[], durationSec: number | undefined): number {
  const last = shots.length ? shots[shots.length - 1].end : 0
  return Math.max(last, durationSec ?? 0, 1)
}

/** The shot playing at time `t` (seconds). */
export function shotAt(shots: readonly Shot[], t: number): number {
  for (let i = shots.length - 1; i >= 0; i--) if (t >= shots[i].start) return i
  return 0
}

// ------------------------------------------------------------------------------------------------ slides

export interface SlideTheme {
  background: string
  ink: string
  muted: string
  accent: string
  /** Dark slide (light text). */
  dark: boolean
}

function chroma(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return Math.max(r, g, b) - Math.min(r, g, b)
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * A legible slide theme from a version's palette: the darkest color as the background (or the
 * lightest, for light palettes), the most contrasting light/dark color as ink, and the most
 * chromatic color as the accent. Falls back to near-black/near-white when contrast is short.
 */
export function slideTheme(palette: readonly string[]): SlideTheme {
  const colors = palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c))
  if (!colors.length) return { background: '#16171a', ink: '#f2efe8', muted: '#b9b4a9', accent: '#d9b77a', dark: true }
  const byL = [...colors].sort((a, b) => luminance(a) - luminance(b))
  const darkest = byL[0]
  const lightest = byL[byL.length - 1]
  const dark = luminance(darkest) < 0.12 || luminance(lightest) < 0.5
  const background = dark ? (luminance(darkest) < 0.06 ? darkest : '#121316') : lightest
  let ink = dark ? lightest : darkest
  if (contrast(ink, background) < 7) ink = dark ? '#f4f1ea' : '#15161a'
  const muted = dark ? 'rgba(244, 241, 234, 0.72)' : 'rgba(21, 22, 26, 0.68)'
  const accents = [...colors].filter((c) => c !== background).sort((a, b) => chroma(b) - chroma(a))
  const accent = accents.find((c) => contrast(c, background) >= 2.2) ?? ink
  return { background, ink, muted, accent, dark }
}

/** A slide body's lines as bullets (lines starting with "- " or "• "); other lines are paragraphs. */
export function bodyBlocks(body: string): Array<{ type: 'bullet' | 'para'; text: string }> {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[-•*]\s+/.test(l) ? { type: 'bullet' as const, text: l.replace(/^[-•*]\s+/, '') } : { type: 'para' as const, text: l }))
}

/** Two columns for the split layout: blank line separates them; otherwise the lines halve. */
export function splitColumns(body: string): [string, string] {
  const parts = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) return [parts[0], parts.slice(1).join('\n\n')]
  const lines = body.split('\n').filter((l) => l.trim())
  const half = Math.ceil(lines.length / 2)
  return [lines.slice(0, half).join('\n'), lines.slice(half).join('\n')]
}

/** A quote slide: the quote and its attribution ("— Name, Role" on its own line). */
export function quoteParts(body: string): { quote: string; by?: string } {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  const byAt = lines.findIndex((l) => /^[—–-]\s*\S/.test(l))
  if (byAt > 0) return { quote: lines.slice(0, byAt).join(' ').replace(/^[“"]|[”"]$/g, ''), by: lines[byAt].replace(/^[—–-]\s*/, '') }
  return { quote: lines.join(' ').replace(/^[“"]|[”"]$/g, '') }
}

let slideCounter = 0
/** A new slide id (unique within the session; slides live inside the asset row). */
export function newSlideId(): string {
  slideCounter += 1
  return `sld_${Date.now().toString(36)}${slideCounter.toString(36)}`
}

export function addSlideAfter(slides: readonly Slide[], index: number): { slides: Slide[]; at: number } {
  const slide: Slide = { id: newSlideId(), layout: 'bullets', title: 'New slide', body: '- First point\n- Second point', notes: '' }
  const at = Math.min(slides.length, Math.max(0, index + 1))
  return { slides: [...slides.slice(0, at), slide, ...slides.slice(at)], at }
}

export function duplicateSlide(slides: readonly Slide[], index: number): { slides: Slide[]; at: number } {
  const src = slides[index]
  if (!src) return { slides: [...slides], at: index }
  const copy: Slide = { ...src, id: newSlideId() }
  return { slides: [...slides.slice(0, index + 1), copy, ...slides.slice(index + 1)], at: index + 1 }
}

export function removeSlide(slides: readonly Slide[], index: number): { slides: Slide[]; at: number } {
  if (slides.length <= 1 || !slides[index]) return { slides: [...slides], at: index }
  const next = slides.filter((_, i) => i !== index)
  return { slides: next, at: Math.min(index, next.length - 1) }
}

export function moveSlide(slides: readonly Slide[], index: number, delta: -1 | 1): { slides: Slide[]; at: number } {
  const to = index + delta
  if (!slides[index] || to < 0 || to >= slides.length) return { slides: [...slides], at: index }
  const next = [...slides]
  ;[next[index], next[to]] = [next[to], next[index]]
  return { slides: next, at: to }
}

// ------------------------------------------------------------------------------------------------ exports

/** The first line of every export that contains simulated content (§8.4). */
export function simulatedHeader(at: number): string {
  const date = new Date(at).toISOString().slice(0, 10)
  return `> **Simulated content.** Generated by Atrium's local simulator on ${date}. No AI model, web search or external service was used.`
}

export function fileSlug(title: string, fallback = 'asset'): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug || fallback
}

/** A deck as Markdown: the simulated header, the title, then one section per slide with its notes. */
export function deckToMarkdown(title: string, slides: readonly Slide[], opts: { simulated: boolean; at: number }): string {
  const out: string[] = []
  if (opts.simulated) out.push(simulatedHeader(opts.at), '')
  out.push(`# ${title}`, '')
  slides.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}`, '')
    if (s.body.trim()) out.push(s.body.trim(), '')
    if (s.notes?.trim()) out.push(`> Speaker notes: ${s.notes.trim()}`, '')
  })
  return `${out.join('\n').trimEnd()}\n`
}

/** A deck as JSON (title, slides, provenance). */
export function deckToJson(asset: Pick<Asset, 'id' | 'title' | 'prompt' | 'generator'>, slides: readonly Slide[], at: number): string {
  return `${JSON.stringify(
    {
      title: asset.title,
      prompt: asset.prompt,
      simulated: asset.generator.simulated,
      note: asset.generator.simulated ? "Simulated content: generated by Atrium's local simulator. No AI model was used." : undefined,
      exportedAt: new Date(at).toISOString(),
      slides: slides.map(({ id, title, body, layout, notes }) => ({ id, title, layout, body, notes: notes ?? '' })),
    },
    null,
    2,
  )}\n`
}

/** A text asset as Markdown (with the simulated header when simulated). */
export function textToMarkdown(content: string, opts: { simulated: boolean; at: number }): string {
  const body = content.trim()
  return `${opts.simulated ? `${simulatedHeader(opts.at)}\n\n` : ''}${body}\n`
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESC[c])
}

/** Inline Markdown → HTML: **bold**, _italic_ / *italic*, `code`, [links](https://…). Input is escaped first. */
export function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
}

/** A small, safe Markdown → HTML converter for exports: headings, paragraphs, lists, quotes, rules and tables. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  const para: string[] = []
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inlineHtml).join('<br>')}</p>`)
    para.length = 0
  }
  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()
    if (!t) {
      flush()
      i++
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t)
    if (h) {
      flush()
      out.push(`<h${h[1].length}>${inlineHtml(h[2])}</h${h[1].length}>`)
      i++
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      flush()
      out.push('<hr>')
      i++
      continue
    }
    if (t.startsWith('>')) {
      flush()
      const quote: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) quote.push(lines[i++].trim().replace(/^>\s?/, ''))
      out.push(`<blockquote><p>${quote.map(inlineHtml).join('<br>')}</p></blockquote>`)
      continue
    }
    if (/^([-*•]|\d+\.)\s+/.test(t) || /^- \[[ x]\]\s+/i.test(t)) {
      flush()
      const ordered = /^\d+\.\s+/.test(t)
      const items: string[] = []
      while (i < lines.length && /^([-*•]|\d+\.)\s+/.test(lines[i].trim())) {
        const item = lines[i++].trim().replace(/^([-*•]|\d+\.)\s+/, '')
        const task = /^\[([ x])\]\s+(.*)$/i.exec(item)
        items.push(task ? `<li>${task[1].toLowerCase() === 'x' ? '☑' : '☐'} ${inlineHtml(task[2])}</li>` : `<li>${inlineHtml(item)}</li>`)
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    }
    if (t.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1].trim())) {
      flush()
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = cells(t)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]))
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      )
      continue
    }
    para.push(t)
    i++
  }
  flush()
  return out.join('\n')
}

const DOC_CSS = `body{margin:0;background:#f7f6f2;color:#1c1b18;font:18px/1.65 Georgia,'Times New Roman',serif}
main{max-width:68ch;margin:0 auto;padding:48px 24px 96px}
h1,h2,h3{font-weight:500;line-height:1.25}h1{font-size:30px}h2{font-size:24px;margin-top:1.6em}h3{font-size:20px}
blockquote{margin:1.2em 0;padding:.2em 1em;border-left:3px solid #cfccc2;color:#55524a}
table{border-collapse:collapse;width:100%;font-size:15px}td,th{border-bottom:1px solid #e2e0d8;padding:6px 8px;text-align:left}
code{font-family:ui-monospace,Menlo,monospace;font-size:.85em}a{color:inherit}`

/** A standalone HTML document for a text asset (doc, narration script, storyboard). */
export function textToHtml(title: string, content: string, opts: { simulated: boolean; at: number }): string {
  const body = markdownToHtml(textToMarkdown(content, opts))
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>${DOC_CSS}</style>\n</head>\n<body>\n<main>\n${body}\n</main>\n</body>\n</html>\n`
}

/** A standalone HTML deck: one 16:9 section per slide, themed from the palette; arrow keys page through it. */
export function deckToHtml(title: string, slides: readonly Slide[], palette: readonly string[], opts: { simulated: boolean; at: number }): string {
  const th = slideTheme(palette)
  const css = `*{box-sizing:border-box}body{margin:0;background:#0b0b0c;font-family:Georgia,'Times New Roman',serif}
.note{color:#b9b4a9;font:13px/1.5 ui-monospace,Menlo,monospace;max-width:1100px;margin:24px auto;padding:0 24px}
section{position:relative;width:min(1100px,calc(100vw - 48px));aspect-ratio:16/9;margin:24px auto;background:${th.background};color:${th.ink};padding:5.5% 7%;container-type:inline-size;overflow:hidden;display:flex;flex-direction:column;justify-content:center;break-after:page}
section h2{font-weight:500;font-size:4.4cqw;line-height:1.15;margin:0 0 3cqw}section.title h2{font-size:6cqw}
section .rule{width:6cqw;height:.45cqw;background:${th.accent};margin-bottom:2.4cqw}
section p,section li{font-size:2.3cqw;line-height:1.45;margin:.4em 0;color:${th.ink}}section .muted{color:${th.muted}}
section ul{padding-left:1.2em;margin:0}section li::marker{color:${th.accent}}
section blockquote{font-style:italic;font-size:3.4cqw;line-height:1.35;margin:0}
section .cols{display:grid;grid-template-columns:1fr 1fr;gap:5cqw}
section .num{position:absolute;right:4cqw;bottom:3cqw;font:1.4cqw ui-monospace,Menlo,monospace;color:${th.muted}}
aside{max-width:1100px;margin:-12px auto 24px;padding:0 24px;color:#9b978d;font:14px/1.5 system-ui,sans-serif}
@media print{body{background:none}.note,aside{display:none}section{margin:0;width:100%}}`
  const block = bodyBlocksHtml
  const sections = slides.map((s, i) => {
    const num = `<span class="num">${i + 1} / ${slides.length}</span>`
    let inner: string
    if (s.layout === 'title') inner = `<div class="rule"></div><h2>${inlineHtml(s.title)}</h2><p class="muted">${inlineHtml(s.body.replace(/\n+/g, ' · '))}</p>`
    else if (s.layout === 'quote') {
      const q = quoteParts(s.body)
      inner = `<div class="rule"></div><blockquote>“${inlineHtml(q.quote)}”</blockquote>${q.by ? `<p class="muted">— ${inlineHtml(q.by)}</p>` : ''}<p class="muted">${inlineHtml(s.title)}</p>`
    } else if (s.layout === 'split') {
      const [a, b] = splitColumns(s.body)
      inner = `<h2>${inlineHtml(s.title)}</h2><div class="cols"><div>${block(a)}</div><div>${block(b)}</div></div>`
    } else inner = `<h2>${inlineHtml(s.title)}</h2>${block(s.body)}`
    const notes = s.notes?.trim() ? `<aside>Notes: ${inlineHtml(s.notes.trim())}</aside>` : ''
    return `<section class="${s.layout}" id="s${i + 1}">${inner}${num}</section>${notes}`
  })
  const header = opts.simulated
    ? `<p class="note">Simulated content. Generated by Atrium's local simulator on ${new Date(opts.at).toISOString().slice(0, 10)}. No AI model, web search or external service was used.</p>`
    : ''
  const script = `<script>addEventListener('keydown',e=>{const s=[...document.querySelectorAll('section')];const y=scrollY+innerHeight/3;let i=s.findIndex(x=>x.offsetTop+x.offsetHeight>y);if(e.key==='ArrowRight'||e.key==='PageDown')s[Math.min(s.length-1,i+1)]?.scrollIntoView({block:'center'});if(e.key==='ArrowLeft'||e.key==='PageUp')s[Math.max(0,i-1)]?.scrollIntoView({block:'center'})})</script>`
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>${css}</style>\n</head>\n<body>\n${header}\n${sections.join('\n')}\n${script}\n</body>\n</html>\n`
}

function bodyBlocksHtml(text: string): string {
  const blocks = bodyBlocks(text)
  const out: string[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) out.push(`<ul>${list.join('')}</ul>`)
    list = []
  }
  for (const b of blocks) {
    if (b.type === 'bullet') list.push(`<li>${inlineHtml(b.text)}</li>`)
    else {
      flush()
      out.push(`<p>${inlineHtml(b.text)}</p>`)
    }
  }
  flush()
  return out.join('')
}

/** Trigger a browser download of text content. */
export function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ------------------------------------------------------------------------------------------------ grid keyboard

/** Index after an arrow key in a grid of `count` items laid out in `columns`. */
export function gridMove(index: number, key: string, columns: number, count: number): number {
  const cols = Math.max(1, columns)
  switch (key) {
    case 'ArrowRight':
      return Math.min(count - 1, index + 1)
    case 'ArrowLeft':
      return Math.max(0, index - 1)
    case 'ArrowDown':
      return index + cols < count ? index + cols : index
    case 'ArrowUp':
      return index - cols >= 0 ? index - cols : index
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return index
  }
}
