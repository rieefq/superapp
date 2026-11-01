/**
 * Small pure helpers behind the display components (log tone heuristics, file kinds,
 * tree flattening, table sorting/pagination, activity grouping, stat tones).
 */
import type { Hue } from '@/core/types'

/* ------------------------------------------------------------------------------------------ */
/* Terminal / log lines                                                                       */
/* ------------------------------------------------------------------------------------------ */

export type LogTone = 'done' | 'fail' | 'attn' | 'dim' | 'plain'

const TS_RE = /^(\[?\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?\]?|\[?\d{1,2}:\d{2}:\d{2}(\.\d{1,3})?\]?)\s+/
const ZERO_RE = /\b(0|no|zero) (?:[a-z-]+ )?(failed|failures?|errors?|warnings?|problems?)\b/gi
const FAIL_RE = /(✗|✕|✖|❌|(^|\s)×\s|\bFAIL(ED|URE|S)?\b|\bERR!|\bERROR\b|\b[A-Z]?\w*Error\b|\berror(s)?\b|\bfailed\b|\bfailures?\b|\bfatal\b|\bpanic(ked)?\b|Traceback|\bException\b|\bexit code [1-9]\d*)/i
const ATTN_RE = /(⚠|\bWARN(ING)?S?\b|\bwarn(ing|ings)?\b|\bdeprecated\b)/i
const DONE_RE = /(✓|✔|✅|\bPASS(ED)?\b|\bpassed\b|\bsucce(ss|eded|ssful|ssfully)\b|\bdone\b|\bcompleted?\b|\bready\b|\bbuilt\b|\bok\b)/i
const DIM_RE = /^(\s*(#|\/\/)|\s+at\s|\s*(DEBUG|TRACE|debug|verbose)\b)/

/** Split a leading timestamp ("10:42:01", "[2026-11-01T10:42:01Z]") from a log line. */
export function splitTimestamp(line: string): { ts?: string; rest: string } {
  const m = TS_RE.exec(line)
  if (!m) return { rest: line }
  return { ts: m[0].trimEnd(), rest: line.slice(m[0].length) }
}

/**
 * Heuristic tone for a line of output: failures (✗, FAIL, Error, "3 failed") beat warnings,
 * which beat successes (✓, PASS, passed). "0 failed" / "no errors" are not failures.
 */
export function classifyLogLine(line: string): LogTone {
  const { rest } = splitTimestamp(line)
  if (!rest.trim()) return 'plain'
  if (DIM_RE.test(rest)) return 'dim'
  const scrubbed = rest.replace(ZERO_RE, '')
  if (FAIL_RE.test(scrubbed)) return 'fail'
  if (ATTN_RE.test(scrubbed)) return 'attn'
  if (DONE_RE.test(rest)) return 'done'
  return 'plain'
}

/* ------------------------------------------------------------------------------------------ */
/* File kinds                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export type FileKind =
  | 'folder'
  | 'code'
  | 'test'
  | 'markup'
  | 'style'
  | 'data'
  | 'config'
  | 'doc'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'lock'
  | 'env'
  | 'shell'
  | 'database'
  | 'font'
  | 'file'

const EXT_KIND: Record<string, FileKind> = {}
const add = (kind: FileKind, exts: string) => exts.split(' ').forEach((e) => (EXT_KIND[e] = kind))
add('code', 'ts tsx js jsx mjs cjs py rb go rs java kt kts swift c h cc cpp hpp cs php lua zig scala dart ex exs erl clj hs ml vue svelte astro sol')
add('markup', 'html htm xml svg mdx')
add('style', 'css scss sass less styl pcss')
add('data', 'json jsonc json5 yaml yml csv tsv toml ndjson parquet graphql gql proto')
add('config', 'ini conf cfg editorconfig prettierrc eslintrc babelrc npmrc nvmrc gitignore gitattributes dockerignore')
add('doc', 'md markdown txt rst adoc pdf doc docx rtf tex')
add('image', 'png jpg jpeg gif webp avif bmp ico heic tiff')
add('video', 'mp4 mov webm mkv avi')
add('audio', 'mp3 wav flac ogg m4a aac')
add('archive', 'zip tar gz tgz bz2 xz 7z rar')
add('lock', 'lock lockb')
add('shell', 'sh bash zsh fish ps1 bat cmd')
add('database', 'sql sqlite db prisma')
add('font', 'ttf otf woff woff2')

const NAME_KIND: Record<string, FileKind> = {
  dockerfile: 'config',
  makefile: 'config',
  procfile: 'config',
  license: 'doc',
  'package-lock.json': 'lock',
  'pnpm-lock.yaml': 'lock',
  'yarn.lock': 'lock',
  'bun.lockb': 'lock',
  'cargo.lock': 'lock',
  'tsconfig.json': 'config',
  'vite.config.ts': 'config',
  'vitest.config.ts': 'config',
}

/** Classify a file name (or a directory) into an icon kind. */
export function fileKind(name: string, isDirectory = false): FileKind {
  if (isDirectory) return 'folder'
  const base = (name.split('/').pop() ?? name).toLowerCase()
  if (NAME_KIND[base]) return NAME_KIND[base]
  if (base === '.env' || base.startsWith('.env.')) return 'env'
  if (/\.(test|spec)\.[a-z0-9]+$/.test(base) || /(^|\/)__tests__\//.test(name)) return 'test'
  if (/\.config\.[a-z]+$/.test(base)) return 'config'
  if (base.startsWith('.') && !base.slice(1).includes('.')) return EXT_KIND[base.slice(1)] ?? 'config'
  const ext = base.includes('.') ? base.split('.').pop()! : ''
  return EXT_KIND[ext] ?? 'file'
}

/** Identity hue per kind — used sparingly (only kinds people scan for get one). */
export const FILE_KIND_HUE: Partial<Record<FileKind, Hue>> = {
  code: 'sky',
  test: 'violet',
  style: 'rose',
  data: 'amber',
  image: 'coral',
  video: 'coral',
  shell: 'volt',
}

/* ------------------------------------------------------------------------------------------ */
/* Tree                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export interface TreeNodeLike {
  id: string
  label: string
  children?: readonly TreeNodeLike[]
  /** Children exist but are not loaded yet (lazy). */
  hasChildren?: boolean
}

export interface FlatTreeItem<N extends TreeNodeLike> {
  node: N
  depth: number
  parentId: string | null
  /** 1-based position among visible siblings. */
  posInSet: number
  setSize: number
  expandable: boolean
  expanded: boolean
}

/**
 * Visible rows of a tree in display order. With a `filter`, only matching nodes and their
 * ancestors are kept and ancestors of matches are force-expanded.
 */
export function flattenTree<N extends TreeNodeLike>(
  nodes: readonly N[],
  expanded: ReadonlySet<string>,
  filter = '',
): FlatTreeItem<N>[] {
  const q = filter.trim().toLowerCase()
  const out: FlatTreeItem<N>[] = []
  const matchMemo = new Map<string, boolean>()
  const subtreeMatches = (n: N): boolean => {
    if (!q) return true
    const memo = matchMemo.get(n.id)
    if (memo !== undefined) return memo
    const own = n.label.toLowerCase().includes(q)
    const kids = (n.children as readonly N[] | undefined)?.some((c) => subtreeMatches(c)) ?? false
    const res = own || kids
    matchMemo.set(n.id, res)
    return res
  }
  const walk = (list: readonly N[], depth: number, parentId: string | null) => {
    const visible = q ? list.filter(subtreeMatches) : list
    visible.forEach((n, i) => {
      const kids = n.children as readonly N[] | undefined
      const expandable = !!(kids && kids.length > 0) || !!n.hasChildren
      const childMatch = q ? (kids?.some(subtreeMatches) ?? false) : false
      const isOpen = expandable && (expanded.has(n.id) || childMatch)
      out.push({ node: n, depth, parentId, posInSet: i + 1, setSize: visible.length, expandable, expanded: isOpen })
      if (isOpen && kids) walk(kids, depth + 1, n.id)
    })
  }
  walk(nodes, 1, null)
  return out
}

/** All ids of nodes that have (loaded) children — for "expand all". */
export function collectExpandableIds(nodes: readonly TreeNodeLike[]): string[] {
  const ids: string[] = []
  const walk = (list: readonly TreeNodeLike[]) => {
    for (const n of list) {
      if (n.children && n.children.length) {
        ids.push(n.id)
        walk(n.children)
      }
    }
  }
  walk(nodes)
  return ids
}

/* ------------------------------------------------------------------------------------------ */
/* Table                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export type SortDirection = 'asc' | 'desc'
export type SortValue = string | number | boolean | null | undefined | Date

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Compare two cell values: numbers numerically, strings naturally; empty values sort last. */
export function compareValues(a: SortValue, b: SortValue): number {
  const empty = (v: SortValue) => v === null || v === undefined || v === ''
  if (empty(a) && empty(b)) return 0
  if (empty(a)) return 1
  if (empty(b)) return -1
  const na = a instanceof Date ? a.getTime() : a
  const nb = b instanceof Date ? b.getTime() : b
  if (typeof na === 'number' && typeof nb === 'number') return na - nb
  if (typeof na === 'boolean' && typeof nb === 'boolean') return Number(na) - Number(nb)
  return collator.compare(String(na), String(nb))
}

/** Stable sort; empty values stay last in both directions. */
export function sortRows<T>(rows: readonly T[], accessor: (row: T) => SortValue, direction: SortDirection): T[] {
  const sign = direction === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, v: accessor(row) }))
    .sort((x, y) => {
      const xe = x.v === null || x.v === undefined || x.v === ''
      const ye = y.v === null || y.v === undefined || y.v === ''
      if (xe !== ye) return xe ? 1 : -1
      return sign * compareValues(x.v, y.v) || x.index - y.index
    })
    .map((x) => x.row)
}

export interface Page<T> {
  rows: T[]
  page: number
  pageCount: number
  /** 1-based index of the first row on the page (0 when empty). */
  from: number
  /** 1-based index of the last row on the page. */
  to: number
  total: number
}

/** Slice a page (1-based `page`, clamped into range). */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): Page<T> {
  const total = rows.length
  const size = Math.max(1, Math.floor(pageSize))
  const pageCount = Math.max(1, Math.ceil(total / size))
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount)
  const start = (p - 1) * size
  const slice = rows.slice(start, start + size)
  return { rows: slice, page: p, pageCount, from: total ? start + 1 : 0, to: start + slice.length, total }
}

/* ------------------------------------------------------------------------------------------ */
/* Activity                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "Today", "Yesterday", weekday within the last week, else "Oct 3" (+ year if different). */
export function dayLabel(ts: number, now = Date.now(), locale?: string): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days === -1) return 'Tomorrow'
  if (days > 1 && days < 7) return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(ts)
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(locale, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(ts)
}

export interface DayGroup<T> {
  key: string
  label: string
  items: T[]
}

/** Group items by local day, newest first (items inside each day newest first too). */
export function groupByDay<T extends { at: number }>(items: readonly T[], now = Date.now(), locale?: string): DayGroup<T>[] {
  const sorted = [...items].sort((a, b) => b.at - a.at)
  const groups: DayGroup<T>[] = []
  for (const item of sorted) {
    const key = String(startOfDay(item.at))
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, label: dayLabel(item.at, now, locale), items: [item] })
  }
  return groups
}

/* ------------------------------------------------------------------------------------------ */
/* Stat / meter                                                                               */
/* ------------------------------------------------------------------------------------------ */

export type Direction = 'up' | 'down' | 'flat'
export type DeltaTone = 'good' | 'bad' | 'neutral'

/** Whether a change is good news: direction × which way is good. */
export function deltaTone(direction: Direction, goodWhen: 'up' | 'down' = 'up'): DeltaTone {
  if (direction === 'flat') return 'neutral'
  return direction === goodWhen ? 'good' : 'bad'
}

export type MeterTone = 'done' | 'attn' | 'fail'

/**
 * Meter severity from a ratio (value / max). `thresholds` are ratios where the state turns
 * to attention and to failure. With `goodWhen: 'low'` (budgets, usage) crossing upward is
 * bad; with `goodWhen: 'high'` (coverage, health) falling below is bad.
 */
export function meterTone(
  ratio: number,
  thresholds: { attn: number; fail: number } = { attn: 0.75, fail: 0.9 },
  goodWhen: 'low' | 'high' = 'low',
): MeterTone {
  const r = Number.isFinite(ratio) ? ratio : 0
  if (goodWhen === 'low') {
    if (r >= thresholds.fail) return 'fail'
    if (r >= thresholds.attn) return 'attn'
    return 'done'
  }
  if (r <= thresholds.fail) return 'fail'
  if (r <= thresholds.attn) return 'attn'
  return 'done'
}
