/**
 * Diff model for DiffView / DiffStat. Pure functions over the `diff` package so the
 * interesting logic (numbering, context collapsing, split pairing, stats) is unit-tested.
 */
import { diffLines, diffWordsWithSpace, parsePatch, type StructuredPatch } from 'diff'

export type DiffLineKind = 'context' | 'add' | 'del'

export interface DiffLine {
  kind: DiffLineKind
  /** 1-based line number in the old file (null for additions). */
  oldNo: number | null
  /** 1-based line number in the new file (null for deletions). */
  newNo: number | null
  text: string
}

export interface DiffStats {
  additions: number
  deletions: number
}

/** Split text into lines; a trailing newline does not create an empty last line. CRLF-safe. */
export function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
}

export function countLines(text: string): number {
  return splitLines(text).length
}

/**
 * Full line-level diff with old/new numbering. Returns null when the diff exceeds the
 * time budget (pathological inputs) so callers can show a "too complex" state.
 */
export function buildDiffLines(oldText: string, newText: string, timeoutMs = 2500): DiffLine[] | null {
  const changes = diffLines(oldText, newText, { ignoreNewlineAtEof: true, timeout: timeoutMs })
  if (!changes) return null
  const out: DiffLine[] = []
  let oldNo = 1
  let newNo = 1
  for (const change of changes) {
    for (const text of splitLines(change.value)) {
      if (change.added) out.push({ kind: 'add', oldNo: null, newNo: newNo++, text })
      else if (change.removed) out.push({ kind: 'del', oldNo: oldNo++, newNo: null, text })
      else out.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text })
    }
  }
  return out
}

/** Lines added / removed between two texts (`+12 −3`). */
export function computeDiffStats(oldText: string, newText: string): DiffStats {
  const lines = buildDiffLines(oldText, newText, 10_000) ?? []
  return statsOf(lines)
}

export function statsOf(lines: readonly DiffLine[]): DiffStats {
  let additions = 0
  let deletions = 0
  for (const l of lines) {
    if (l.kind === 'add') additions++
    else if (l.kind === 'del') deletions++
  }
  return { additions, deletions }
}

/**
 * The 5-cell proportional bar next to a stat: additions, deletions, then neutral cells
 * when there are fewer changes than cells. Both kinds stay visible when both exist.
 */
export function diffStatCells(additions: number, deletions: number, cells = 5): ('add' | 'del' | 'neutral')[] {
  const a = Math.max(0, additions)
  const d = Math.max(0, deletions)
  const total = a + d
  if (total === 0) return Array.from({ length: cells }, () => 'neutral' as const)
  const filled = Math.min(cells, total)
  let add = Math.round((filled * a) / total)
  if (a > 0 && add === 0) add = 1
  if (d > 0 && add >= filled) add = filled - 1
  const del = filled - add
  return [
    ...Array.from({ length: add }, () => 'add' as const),
    ...Array.from({ length: del }, () => 'del' as const),
    ...Array.from({ length: cells - filled }, () => 'neutral' as const),
  ]
}

/* ------------------------------------------------------------------------------------------ */
/* Segments: visible hunks and collapsed unchanged context                                    */
/* ------------------------------------------------------------------------------------------ */

export interface HunkInfo {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
}

export type DiffSegment =
  | { type: 'lines'; id: string; lines: DiffLine[]; hunk: HunkInfo }
  | {
      type: 'gap'
      id: string
      /** Hidden lines (empty when the source is a patch without full text). */
      lines: DiffLine[]
      count: number
      expandable: boolean
    }

export function hunkOf(lines: readonly DiffLine[]): HunkInfo {
  const olds = lines.filter((l) => l.oldNo != null)
  const news = lines.filter((l) => l.newNo != null)
  return {
    oldStart: olds[0]?.oldNo ?? 0,
    oldLines: olds.length,
    newStart: news[0]?.newNo ?? 0,
    newLines: news.length,
  }
}

export function formatHunkHeader(h: HunkInfo): string {
  return `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`
}

/**
 * Collapse runs of unchanged lines that are farther than `context` lines from any change.
 * Runs shorter than `minHidden` stay visible (an "expand 2 lines" row saves nothing).
 */
export function collapseContext(lines: readonly DiffLine[], context = 3, minHidden = 4): DiffSegment[] {
  const n = lines.length
  const keep = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (lines[i].kind === 'context') continue
    for (let k = Math.max(0, i - context); k <= Math.min(n - 1, i + context); k++) keep[k] = 1
  }
  const segments: DiffSegment[] = []
  let i = 0
  while (i < n) {
    const start = i
    if (keep[i]) {
      while (i < n && keep[i]) i++
    } else {
      while (i < n && !keep[i]) i++
      if (i - start < minHidden) {
        // Too short to hide: merge into the neighbouring visible run.
        const prev = segments[segments.length - 1]
        const slice = lines.slice(start, i)
        if (prev && prev.type === 'lines') prev.lines.push(...slice)
        else segments.push({ type: 'lines', id: `l${start}`, lines: [...slice], hunk: hunkOf(slice) })
        continue
      }
      segments.push({ type: 'gap', id: `g${start}`, lines: lines.slice(start, i), count: i - start, expandable: true })
      continue
    }
    const slice = lines.slice(start, i)
    const prev = segments[segments.length - 1]
    if (prev && prev.type === 'lines') prev.lines.push(...slice)
    else segments.push({ type: 'lines', id: `l${start}`, lines: [...slice], hunk: hunkOf(slice) })
  }
  for (const s of segments) if (s.type === 'lines') s.hunk = hunkOf(s.lines)
  return segments
}

/** Segments from a structured patch (hunks only — gaps between hunks are not expandable). */
export function segmentsFromPatch(patch: StructuredPatch): DiffSegment[] {
  const segments: DiffSegment[] = []
  let prevOldEnd = 1
  patch.hunks.forEach((h, hi) => {
    const gap = h.oldStart - prevOldEnd
    if (gap > 0) segments.push({ type: 'gap', id: `pg${hi}`, lines: [], count: gap, expandable: false })
    const lines: DiffLine[] = []
    let oldNo = h.oldStart
    let newNo = h.newStart
    for (const raw of h.lines) {
      const mark = raw[0]
      const text = raw.slice(1)
      if (mark === '+') lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text })
      else if (mark === '-') lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text })
      else if (mark === ' ' || mark === undefined) lines.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text })
      // '\' = "No newline at end of file" — metadata, not content.
    }
    segments.push({ type: 'lines', id: `pl${hi}`, lines, hunk: { oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines } })
    prevOldEnd = h.oldStart + h.oldLines
  })
  return segments
}

/**
 * Parse a unified diff string (git or plain). Returns one entry per file. Falls back to a
 * lenient parser when hunk counts are wrong (common in hand-written or AI-written patches).
 */
export function parseUnifiedDiff(patch: string): StructuredPatch[] {
  try {
    const strict = parsePatch(patch)
    if (strict.some((p) => p.hunks.length)) return strict
  } catch {
    /* fall through to the lenient parser */
  }
  return lenientParsePatch(patch)
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parse hunks without trusting their declared line counts (counts are recomputed). */
export function lenientParsePatch(patch: string): StructuredPatch[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const files: StructuredPatch[] = []
  let file: StructuredPatch | null = null
  let hunk: StructuredPatch['hunks'][number] | null = null
  const startFile = () => {
    file = { oldFileName: undefined, newFileName: undefined, oldHeader: undefined, newHeader: undefined, hunks: [] }
    files.push(file)
    hunk = null
    return file
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      const f = startFile()
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
      if (m) {
        f.oldFileName = `a/${m[1]}`
        f.newFileName = `b/${m[2]}`
      }
      continue
    }
    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      const f: StructuredPatch = file && !(file as StructuredPatch).hunks.length ? file : startFile()
      f.oldFileName = line.slice(4).split('\t')[0]
      f.newFileName = lines[i + 1].slice(4).split('\t')[0]
      hunk = null
      i++
      continue
    }
    const h = HUNK_RE.exec(line)
    if (h) {
      const f: StructuredPatch = file ?? startFile()
      hunk = { oldStart: Number(h[1]), oldLines: 0, newStart: Number(h[3]), newLines: 0, lines: [] }
      f.hunks.push(hunk)
      continue
    }
    const cur = hunk as StructuredPatch['hunks'][number] | null
    if (!cur) continue
    const mark = line[0]
    if (mark === '+') cur.newLines++
    else if (mark === '-') cur.oldLines++
    else if (mark === ' ' || line === '') {
      cur.oldLines++
      cur.newLines++
    } else if (mark !== '\\') continue
    cur.lines.push(line === '' ? ' ' : line)
  }
  return files.filter((f) => f.hunks.length > 0)
}

export function patchFileName(p: StructuredPatch): string | undefined {
  const clean = (n?: string) => (n && n !== '/dev/null' ? n.replace(/^[ab]\//, '') : undefined)
  return clean(p.newFileName) ?? clean(p.oldFileName)
}

/* ------------------------------------------------------------------------------------------ */
/* Split view pairing + intra-line word highlights                                            */
/* ------------------------------------------------------------------------------------------ */

export interface SplitRow {
  left: DiffLine | null
  right: DiffLine | null
}

/** Pair deletions with additions inside each change run; context appears on both sides. */
export function pairLines(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.kind === 'context') {
      rows.push({ left: line, right: line })
      i++
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].kind !== 'context') {
      if (lines[i].kind === 'del') dels.push(lines[i])
      else adds.push(lines[i])
      i++
    }
    const max = Math.max(dels.length, adds.length)
    for (let k = 0; k < max; k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null })
  }
  return rows
}

/** [start, end) character ranges. */
export type Range = [number, number]

/**
 * Changed character ranges between a removed line and its replacement, for intra-line
 * emphasis. Returns null when the lines are too different (the whole line is the change)
 * or too long to be worth it.
 */
export function wordRanges(oldLine: string, newLine: string): { old: Range[]; new: Range[] } | null {
  if (oldLine.length > 500 || newLine.length > 500) return null
  if (oldLine === newLine) return { old: [], new: [] }
  const parts = diffWordsWithSpace(oldLine, newLine)
  const oldR: Range[] = []
  const newR: Range[] = []
  let o = 0
  let n = 0
  let common = 0
  for (const p of parts) {
    const len = p.value.length
    if (p.added) {
      newR.push([n, n + len])
      n += len
    } else if (p.removed) {
      oldR.push([o, o + len])
      o += len
    } else {
      common += p.value.trim().length
      o += len
      n += len
    }
  }
  const longest = Math.max(oldLine.trim().length, newLine.trim().length, 1)
  if (common / longest < 0.35) return null
  return { old: mergeRanges(oldR), new: mergeRanges(newR) }
}

function mergeRanges(ranges: Range[]): Range[] {
  const out: Range[] = []
  for (const r of ranges) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

/**
 * For unified view: map each changed line to its partner's word ranges (dels pair with adds
 * in order within a run). Keyed by the line object.
 */
export function unifiedWordRanges(lines: readonly DiffLine[]): Map<DiffLine, Range[]> {
  const map = new Map<DiffLine, Range[]>()
  for (const row of pairLines(lines)) {
    if (row.left && row.right && row.left !== row.right) {
      const r = wordRanges(row.left.text, row.right.text)
      if (r) {
        map.set(row.left, r.old)
        map.set(row.right, r.new)
      }
    }
  }
  return map
}
