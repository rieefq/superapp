import type { KnowledgeItem, KnowledgeKind } from '@/core/types'
import { formatBytes } from '@/lib/format'
import { firstSentences } from './serviceHelpers'

/**
 * Real, local file reading for Knowledge imports. Text-like files are read in full
 * (up to MAX_TEXT_BYTES); images get a small JPEG preview; everything else is stored
 * as metadata only, with an honest note about what was not extracted.
 */

export const TEXT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'org', 'tex', 'json', 'csv', 'tsv', 'yaml', 'yml', 'toml', 'ini', 'cfg',
  'conf', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte', 'py', 'rb',
  'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'lua', 'r', 'dart', 'scala', 'graphql', 'proto',
  'sql', 'log', 'sh',
] as const

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'] as const

export const MAX_TEXT_BYTES = 400 * 1024
export const PREVIEW_MAX_PX = 480

export type FileClass = 'text' | 'image' | 'pdf' | 'binary'

const PROSE = new Set(['txt', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'org', 'tex'])
const TABLES = new Set(['csv', 'tsv'])
const HTML = new Set(['html', 'htm'])

const LANGUAGE: Record<string, { label: string; fence: string }> = {
  json: { label: 'JSON', fence: 'json' },
  csv: { label: 'CSV', fence: 'csv' },
  tsv: { label: 'TSV', fence: 'tsv' },
  yaml: { label: 'YAML', fence: 'yaml' },
  yml: { label: 'YAML', fence: 'yaml' },
  toml: { label: 'TOML', fence: 'toml' },
  ini: { label: 'INI', fence: 'ini' },
  cfg: { label: 'Config', fence: 'ini' },
  conf: { label: 'Config', fence: 'text' },
  xml: { label: 'XML', fence: 'xml' },
  html: { label: 'HTML', fence: 'html' },
  htm: { label: 'HTML', fence: 'html' },
  css: { label: 'CSS', fence: 'css' },
  scss: { label: 'SCSS', fence: 'scss' },
  less: { label: 'Less', fence: 'less' },
  js: { label: 'JavaScript', fence: 'javascript' },
  mjs: { label: 'JavaScript', fence: 'javascript' },
  cjs: { label: 'JavaScript', fence: 'javascript' },
  jsx: { label: 'JavaScript (JSX)', fence: 'jsx' },
  ts: { label: 'TypeScript', fence: 'typescript' },
  tsx: { label: 'TypeScript (TSX)', fence: 'tsx' },
  vue: { label: 'Vue', fence: 'vue' },
  svelte: { label: 'Svelte', fence: 'svelte' },
  py: { label: 'Python', fence: 'python' },
  rb: { label: 'Ruby', fence: 'ruby' },
  go: { label: 'Go', fence: 'go' },
  rs: { label: 'Rust', fence: 'rust' },
  java: { label: 'Java', fence: 'java' },
  kt: { label: 'Kotlin', fence: 'kotlin' },
  swift: { label: 'Swift', fence: 'swift' },
  c: { label: 'C', fence: 'c' },
  h: { label: 'C header', fence: 'c' },
  cpp: { label: 'C++', fence: 'cpp' },
  hpp: { label: 'C++ header', fence: 'cpp' },
  cs: { label: 'C#', fence: 'csharp' },
  php: { label: 'PHP', fence: 'php' },
  lua: { label: 'Lua', fence: 'lua' },
  r: { label: 'R', fence: 'r' },
  dart: { label: 'Dart', fence: 'dart' },
  scala: { label: 'Scala', fence: 'scala' },
  graphql: { label: 'GraphQL', fence: 'graphql' },
  proto: { label: 'Protocol Buffers', fence: 'protobuf' },
  sql: { label: 'SQL', fence: 'sql' },
  sh: { label: 'Shell', fence: 'bash' },
  log: { label: 'Log', fence: 'text' },
}

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', mdx: 'text/markdown', csv: 'text/csv',
  tsv: 'text/tab-separated-values', json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml',
  toml: 'application/toml', xml: 'application/xml', html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', jsx: 'text/javascript', ts: 'text/typescript',
  tsx: 'text/typescript', sql: 'application/sql', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
}

export function fileExtension(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name)
  return match ? match[1].toLowerCase() : ''
}

export function classifyFile(file: { name: string; type: string }): FileClass {
  const ext = fileExtension(file.name)
  if ((TEXT_EXTENSIONS as readonly string[]).includes(ext)) return 'text'
  if (file.type.startsWith('image/') || (IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image'
  if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf'
  if (file.type.startsWith('text/')) return 'text'
  return 'binary'
}

/** "q4_pricing-notes.md" → "Q4 pricing notes". */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!base) return 'Untitled file'
  return base[0].toUpperCase() + base.slice(1)
}

function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsText(blob)
  })
}

/** Read a text file, keeping at most `maxBytes` (a cut multi-byte character at the end is dropped). */
export async function readTextFile(file: Blob, maxBytes = MAX_TEXT_BYTES): Promise<{ text: string; truncated: boolean }> {
  const truncated = file.size > maxBytes
  let text = await blobText(truncated ? file.slice(0, maxBytes) : file)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (truncated) text = text.replace(/�+$/, '')
  return { text, truncated }
}

export interface ImagePreview {
  dataUrl: string
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
}

/**
 * Decode an image and render a JPEG thumbnail no larger than `maxPx` on its longest side.
 * Returns null when the environment cannot decode or draw images (old browsers, tests,
 * unsupported formats such as HEIC).
 */
export async function createImagePreview(file: Blob, maxPx = PREVIEW_MAX_PX): Promise<ImagePreview | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file)
    const naturalWidth = bitmap.width
    const naturalHeight = bitmap.height
    if (!naturalWidth || !naturalHeight) return null
    const scale = Math.min(1, maxPx / Math.max(naturalWidth, naturalHeight))
    const width = Math.max(1, Math.round(naturalWidth * scale))
    const height = Math.max(1, Math.round(naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // JPEG has no alpha channel: matte transparent pixels on white instead of black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    if (!dataUrl.startsWith('data:image/jpeg')) return null
    return { dataUrl, width, height, naturalWidth, naturalHeight }
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}

// ---------------------------------------------------------------- content builders

function fenced(text: string, lang: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}${lang}\n${text.replace(/\n+$/, '')}\n${fence}`
}

function splitRow(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`

function tableSummary(text: string, ext: string, truncated: boolean): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return 'Empty table.'
  const header = splitRow(lines[0], ext === 'tsv' ? '\t' : ',')
  const shown = header.slice(0, 6).join(', ') + (header.length > 6 ? ', …' : '')
  return `${truncated ? 'At least ' : ''}${plural(lines.length - 1, 'row')} × ${plural(header.length, 'column')}: ${shown}.`
}

function jsonSummary(text: string, truncated: boolean): string {
  if (truncated) return 'JSON file (partially imported).'
  try {
    const value: unknown = JSON.parse(text)
    if (Array.isArray(value)) return `JSON array with ${plural(value.length, 'item')}.`
    if (value && typeof value === 'object') {
      const keys = Object.keys(value)
      return `JSON object with ${plural(keys.length, 'key')}${keys.length ? `: ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', …' : ''}` : ''}.`
    }
    return 'JSON value.'
  } catch {
    return 'JSON file (could not be parsed).'
  }
}

export interface PreparedImport {
  kind: KnowledgeKind
  title: string
  content: string
  summary?: string
  file: NonNullable<KnowledgeItem['file']>
}

/** NUL characters near the start: the file is binary data despite its name or type. */
export function looksBinary(text: string): boolean {
  return text.slice(0, 8192).includes('\u0000')
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Inline elements: their text joins the surrounding paragraph. */
const INLINE_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'I', 'KBD', 'LABEL', 'MARK', 'Q', 'S', 'SAMP',
  'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR', 'IMG',
])
/** Never readable content (scripts, styles, chrome and controls). */
const DROP_SELECTOR = 'script, style, noscript, template, svg, canvas, iframe, object, embed, nav, form, button, select, input, textarea'

/**
 * Readable text of an HTML page (real extraction with the browser's own parser): the title, then
 * headings, paragraphs, list items, table rows and preformatted blocks as light Markdown. Scripts,
 * styles, navigation and form controls are dropped. Null when there is no parser or no text.
 */
export function htmlToReadable(html: string): { title: string; text: string } | null {
  if (typeof DOMParser === 'undefined') return null
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return null
  }
  const title = squash(doc.querySelector('title')?.textContent ?? '') || squash(doc.querySelector('h1')?.textContent ?? '')
  for (const el of Array.from(doc.querySelectorAll(DROP_SELECTOR))) el.remove()
  const blocks: string[] = []
  let inline = ''
  const flush = () => {
    const t = squash(inline)
    if (t) blocks.push(t)
    inline = ''
  }
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      inline += node.textContent ?? ''
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    const tag = el.tagName
    if (tag === 'BR') {
      inline += ' '
      return
    }
    if (INLINE_TAGS.has(tag)) {
      inline += el.textContent ?? ''
      return
    }
    flush()
    if (/^H[1-6]$/.test(tag)) {
      const t = squash(el.textContent ?? '')
      if (t) blocks.push(`${'#'.repeat(Number(tag[1]))} ${t}`)
      return
    }
    if (tag === 'LI') {
      const t = squash(el.textContent ?? '')
      if (t) blocks.push(`- ${t}`)
      return
    }
    if (tag === 'TR') {
      const cells = Array.from(el.children).map((c) => squash(c.textContent ?? '')).filter(Boolean)
      if (cells.length) blocks.push(`| ${cells.join(' | ')} |`)
      return
    }
    if (tag === 'PRE') {
      const t = (el.textContent ?? '').replace(/\n+$/, '')
      if (t.trim()) blocks.push(fenced(t, ''))
      return
    }
    for (const child of Array.from(el.childNodes)) visit(child)
    flush()
  }
  if (doc.body) visit(doc.body)
  flush()
  const text = blocks.join('\n\n').trim()
  return text ? { title, text } : null
}

async function prepareText(file: File, meta: PreparedImport['file']): Promise<PreparedImport> {
  const ext = fileExtension(file.name)
  const title = titleFromFilename(file.name)
  const { text, truncated } = await readTextFile(file)
  if (looksBinary(text)) {
    return prepareOpaque(file, meta, false, 'This file looks like binary data rather than text, so its contents were not imported or indexed.')
  }
  const note = truncated
    ? `\n\n> Only the first ${formatBytes(MAX_TEXT_BYTES)} of this ${formatBytes(file.size)} file were imported.`
    : ''
  if (!text.trim()) {
    return { kind: 'doc', title, content: '_This file is empty._', summary: 'Empty file.', file: meta }
  }
  if (HTML.has(ext)) {
    const page = htmlToReadable(text)
    if (page) {
      return {
        kind: 'doc',
        title: page.title ? (page.title.length > 120 ? `${page.title.slice(0, 119)}…` : page.title) : title,
        content: page.text + note,
        summary: firstSentences(page.text) || undefined,
        file: meta,
      }
    }
  }
  const lang = LANGUAGE[ext]
  if (PROSE.has(ext) || !lang) {
    const summary = firstSentences(text) || undefined
    return { kind: 'doc', title, content: text + note, summary, file: meta }
  }
  const lineCount = text.split(/\r?\n/).length
  if (TABLES.has(ext)) {
    return { kind: 'dataset', title, content: fenced(text, lang.fence) + note, summary: tableSummary(text, ext, truncated), file: meta }
  }
  const summary = ext === 'json' ? jsonSummary(text, truncated) : `${lang.label} file, ${plural(lineCount, 'line')}${truncated ? ' (partially imported)' : ''}.`
  return { kind: 'snippet', title, content: fenced(text, lang.fence) + note, summary, file: meta }
}

function imageLabel(file: File): string {
  const sub = (file.type.split('/')[1] ?? fileExtension(file.name)).replace('svg+xml', 'svg').replace('jpeg', 'jpg')
  return `${sub ? sub.toUpperCase() : 'Image'} image`
}

async function prepareImage(file: File, meta: PreparedImport['file']): Promise<PreparedImport> {
  const preview = await createImagePreview(file)
  const label = imageLabel(file)
  const lines = [
    `**${label}** · ${file.name}`,
    '',
    `- Type: ${meta.mime}`,
    preview ? `- Dimensions: ${preview.naturalWidth} × ${preview.naturalHeight} px` : undefined,
    `- Size: ${formatBytes(file.size)}`,
    preview
      ? `- Preview: a ${preview.width} × ${preview.height} px JPEG thumbnail is stored with this item.`
      : '- Preview: not available (this browser could not decode the image).',
    '',
    'Only this metadata and the thumbnail are stored; the original file is not kept. No captioning or text recognition (OCR) was run — image understanding isn’t available in this build. Add notes here to make the image searchable.',
  ].filter((l): l is string => l !== undefined)
  return {
    kind: 'file',
    title: titleFromFilename(file.name),
    content: lines.join('\n'),
    summary: preview ? `${label}, ${preview.naturalWidth} × ${preview.naturalHeight} px.` : `${label}, ${formatBytes(file.size)}.`,
    file: preview ? { ...meta, previewUrl: preview.dataUrl } : meta,
  }
}

function prepareOpaque(file: File, meta: PreparedImport['file'], isPdf: boolean, why?: string): PreparedImport {
  const ext = fileExtension(file.name)
  const heading = isPdf ? 'PDF document' : `${ext ? ext.toUpperCase() : 'Binary'} file`
  const reason =
    why ??
    (isPdf
      ? 'Text extraction from PDFs isn’t available in this build, so the contents of this file were not read or indexed.'
      : 'This file type can’t be read in the browser, so its contents were not imported or indexed.')
  const content = [
    `**${heading}** · ${file.name}`,
    '',
    `- Type: ${meta.mime}`,
    `- Size: ${formatBytes(file.size)}`,
    '',
    `${reason} Only the file name and metadata are stored; the original file is not kept.`,
    '',
    'To use it as AI context, paste the key passages into this item or import a text or Markdown export of the file.',
  ].join('\n')
  return {
    kind: 'file',
    title: titleFromFilename(file.name),
    content,
    summary: `${heading}, ${formatBytes(file.size)} — contents not extracted.`,
    file: meta,
  }
}

/** Read a file and turn it into the fields of a knowledge item. */
export async function prepareImport(file: File): Promise<PreparedImport> {
  const ext = fileExtension(file.name)
  const cls = classifyFile(file)
  const meta: PreparedImport['file'] = {
    name: file.name,
    mime: file.type || MIME_BY_EXT[ext] || (cls === 'text' ? 'text/plain' : 'application/octet-stream'),
    size: file.size,
  }
  switch (cls) {
    case 'text':
      return prepareText(file, meta)
    case 'image':
      return prepareImage(file, meta)
    case 'pdf':
      return prepareOpaque(file, meta, true)
    case 'binary':
      return prepareOpaque(file, meta, false)
  }
}
